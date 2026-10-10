"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import {
  getEdgeLive,
  getEvents,
  getReplay,
  mergeEvents,
  mirrorEvent,
  patchEvent,
  sendBackup,
  usingMock,
  type EdgeLive,
} from "@/lib/api";
import { useAppStore } from "@/lib/store/app-store";
import { useReplay } from "@/hooks/use-replay";
import { isAlarmLevel, LEVEL_ORDER, normaliseStatus } from "@/lib/format";
import { useAlarmStore } from "@/lib/store/alarm-store";
import type { Event, Level, PoseFrame, Status, TopFeature } from "@/lib/types";
import { pushToast } from "@/components/alarm/push-toast";

/** Fields only the guard's phone writes; they ride along onto the replay and edge copies. */
const GUARD_FIELDS = ["acked_at", "arrived_at", "outcome", "outcome_at", "staff_note"] as const;
function guardFields(from: Partial<Event> | undefined): Partial<Event> {
  const out: Partial<Event> = {};
  if (!from) return out;
  for (const k of GUARD_FIELDS) if (from[k] != null) (out as Record<string, unknown>)[k] = from[k];
  return out;
}
/** What the guard's phone needs from a live incident (no local bookkeeping fields). */
function plainEvent(e: LiveEvent): Event {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { etaAt, isReplay, isEdge, ...plain } = e;
  return plain;
}

/** A push older than this at first sight is history, not a transition: no sound, no toast. */
const FRESH_MS = 15_000;
/** Ring buffer: 24 snapshots ≈ 12 s at 0.5 s per post. */
const BUFFER = 24;
/** `since` window: the API filters by start_time, so a window keeps recent incidents' updates flowing. */
const SINCE_WINDOW_MS = 30 * 60_000;
const SHIFT_MS = 8 * 3_600_000;

export interface BufferEntry {
  at: number; // wall-clock ms when this version arrived
  level: Level;
  score: number;
  eta: number | null;
  snapshot?: PoseFrame;
  top_features?: TopFeature[];
  pushed: boolean;
}

export interface LiveEvent extends Event {
  /** Wall-clock ms when the current eta_seconds value arrived (for the countdown). */
  etaAt: number;
  /** True for the canned ?replay=1 incident. */
  isReplay?: boolean;
  /** Came straight from the edge laptop's /live.json (on site only). */
  isEdge?: boolean;
}

interface Override {
  status: Status;
  prev: Status;
  pushed_to?: string;
  pushed_at?: string;
}

export function useLiveFeed(replayOn: boolean, edgeUrls: string[] = []) {
  // On site: read each edge's /live.json every 0.5 s. Remote never calls an edge.
  const view = useAppStore((st) => st.view);
  const edgeKey =
    view === "onsite" && edgeUrls.length ? ["edge-live", ...edgeUrls] : null;
  const edge = useSWR(
    edgeKey,
    () => Promise.all(edgeUrls.map((u) => getEdgeLive(u))),
    {
      refreshInterval: 500,
      dedupingInterval: 200,
    },
  );
  const edgeLive = useMemo(
    () => (edge.data ?? []).filter((x): x is EdgeLive => !!x),
    [edge.data],
  );
  // Polling: since-window every 2 s, full list every 10 s; merged by incident_id.
  const [since, setSince] = useState(() =>
    new Date(Date.now() - SINCE_WINDOW_MS).toISOString(),
  );
  useEffect(() => {
    const id = setInterval(
      () => setSince(new Date(Date.now() - SINCE_WINDOW_MS).toISOString()),
      60_000,
    );
    return () => clearInterval(id);
  }, []);
  const recent = useSWR(["events", "since", since], () => getEvents(since), {
    refreshInterval: 2000,
  });
  const full = useSWR(["events", "full"], () => getEvents(), {
    refreshInterval: 10_000,
  });
  const { data: replayEvents } = useSWR(replayOn ? "replay" : null, getReplay, {
    revalidateOnFocus: false,
  });
  const replay = useReplay(replayEvents, replayOn);

  const polled = useMemo(() => {
    const base = mergeEvents(full.data ?? [], recent.data ?? []).map((e) => ({
      ...e,
      status: normaliseStatus(e.status),
    }));
    // Edge incidents: live level, snapshot and features from the laptop; human fields
    // (status, push, ack, note) from the API record with the same id, when it exists.
    const byId = new Map(base.map((e) => [e.incident_id, e]));
    for (const x of edgeLive) {
      const inc = x.incident;
      if (!inc) continue;
      const api = byId.get(inc.incident_id);
      byId.set(inc.incident_id, {
        ...inc,
        ...(api
          ? {
              status: api.status,
              pushed_to: api.pushed_to,
              pushed_at: api.pushed_at,
              acked_at: api.acked_at,
              staff_note: api.staff_note,
              arrived_at: api.arrived_at,
              outcome: api.outcome,
              outcome_at: api.outcome_at,
            }
          : { status: normaliseStatus(inc.status) }),
        isEdge: true,
      } as unknown as Event);
    }
    return [...byId.values()];
  }, [full.data, recent.data, edgeLive]);

  // Local overrides: operator decisions and early pushes. They survive polls until the server agrees.
  const [overrides, setOverrides] = useState<Record<string, Override>>({});

  // Alarm bookkeeping: which incidents have alarmed, their last level, which pushes were toasted.
  const seenAlarm = useRef(new Set<string>());
  const lastLevel = useRef(new Map<string, Level>());
  const toasted = useRef(new Set<string>());

  // ETA anchor per incident: when the current eta value first arrived.
  const etaAnchors = useRef(
    new Map<string, { eta: number | null; at: number }>(),
  );
  // 12 s ring buffers per incident.
  const buffers = useRef(new Map<string, BufferEntry[]>());
  const [bufferTick, setBufferTick] = useState(0);

  // Replay incident, built client-side by timestamp. The API would set the push fields; replay simulates that.
  const replayIncident: LiveEvent | null = useMemo(() => {
    if (!replayOn || !replayEvents?.length || replay.index < 0) return null;
    const base = Date.parse(replayEvents[0].start_time);
    const started = Date.parse(replay.startedAt);
    const cur = replayEvents[replay.index];
    const firstAlarm = replayEvents.findIndex((e) => isAlarmLevel(e.level));
    const pushed = firstAlarm >= 0 && replay.index >= firstAlarm;
    const pushedAt = pushed
      ? new Date(
          started + (Date.parse(replayEvents[firstAlarm].start_time) - base),
        ).toISOString()
      : undefined;
    const firstNonCalm = replayEvents.findIndex((e) => e.level !== "calm");
    const startIdx =
      firstNonCalm >= 0 && replay.index >= firstNonCalm ? firstNonCalm : 0;
    return {
      ...cur,
      start_time: new Date(
        started + (Date.parse(replayEvents[startIdx].start_time) - base),
      ).toISOString(),
      ...(pushed
        ? {
            pushed_to: cur.nearest_staff ?? undefined,
            pushed_at: pushedAt,
            status: "pushed" as Status,
          }
        : {}),
      etaAt: started + (Date.parse(cur.start_time) - base),
      isReplay: true,
    };
  }, [replayOn, replayEvents, replay.index, replay.startedAt]);

  // Restart: forget the replay incident's local state.
  const replayId = replayEvents?.[0]?.incident_id;
  const lastIndex = useRef(-1);
  useEffect(() => {
    if (!replayId) return;
    if (
      replay.index < lastIndex.current ||
      (replay.index === 0 && lastIndex.current !== 0)
    ) {
      buffers.current.delete(replayId);
      etaAnchors.current.delete(replayId);
      setOverrides((o) => {
        if (!o[replayId]) return o;
        const n = { ...o };
        delete n[replayId];
        return n;
      });
      useAlarmStore.getState().clear(replayId);
      seenAlarm.current.delete(replayId);
      lastLevel.current.delete(replayId);
      toasted.current.delete(replayId);
      mirrored.current.delete(replayId);
    }
    lastIndex.current = replay.index;
  }, [replay.index, replayId]);

  const events: LiveEvent[] = useMemo(() => {
    const now = Date.now();
    let list: LiveEvent[] = polled.map((e) => {
      const a = etaAnchors.current.get(e.incident_id);
      if (!a || a.eta !== e.eta_seconds)
        etaAnchors.current.set(e.incident_id, { eta: e.eta_seconds, at: now });
      return { ...e, etaAt: etaAnchors.current.get(e.incident_id)!.at };
    });
    if (replayIncident) {
      // The guard's taps on the replay incident come back through the poll.
      const fromPoll = list.find((e) => e.incident_id === replayIncident.incident_id);
      list = list.filter((e) => e.incident_id !== replayIncident.incident_id);
      list.push(replayIncident.pushed_to ? { ...replayIncident, ...guardFields(fromPoll) } : replayIncident);
    }
    return list.map((e) => {
      const o = overrides[e.incident_id];
      if (!o) return e;
      return {
        ...e,
        status: o.status,
        pushed_to: e.pushed_to ?? o.pushed_to,
        pushed_at: e.pushed_at ?? o.pushed_at,
      };
    });
  }, [polled, replayIncident, overrides]);

  // Ring buffers: append when the snapshot or level changes.
  useEffect(() => {
    let changed = false;
    for (const e of events) {
      if (e.isReplay) continue;
      const buf = buffers.current.get(e.incident_id) ?? [];
      const last = buf[buf.length - 1];
      const snapT = e.snapshot?.t;
      if (
        !last ||
        last.level !== e.level ||
        (snapT && last.snapshot?.t !== snapT) ||
        last.score !== e.peak_score
      ) {
        buf.push({
          at: Date.now(),
          level: e.level,
          score: e.peak_score,
          eta: e.eta_seconds,
          snapshot: e.snapshot ?? e.peak_snapshot,
          top_features: e.top_features,
          pushed: !!e.pushed_to,
        });
        if (buf.length > BUFFER) buf.splice(0, buf.length - BUFFER);
        buffers.current.set(e.incident_id, buf);
        changed = true;
      }
    }
    if (changed) setBufferTick((t) => t + 1);
  }, [events]);

  /** Buffer for an incident. The replay incident's buffer is the replay itself, by timestamp. */
  const bufferFor = useCallback(
    (id: string | undefined): BufferEntry[] => {
      if (!id) return [];
      if (replayIncident && id === replayIncident.incident_id && replayEvents) {
        const base = Date.parse(replayEvents[0].start_time);
        const started = Date.parse(replay.startedAt);
        const firstAlarm = replayEvents.findIndex((e) => isAlarmLevel(e.level));
        return replayEvents.map((e, i) => ({
          at: started + (Date.parse(e.start_time) - base),
          level: e.level,
          score: e.peak_score,
          eta: e.eta_seconds,
          snapshot: e.snapshot,
          top_features: e.top_features,
          pushed: firstAlarm >= 0 && i >= firstAlarm,
        }));
      }
      return buffers.current.get(id) ?? [];
    },
    // bufferTick forces fresh reads after appends
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [replayIncident, replayEvents, replay.startedAt, bufferTick],
  );

  // Mirrored pushes: keep the guard's "camera now" in step with the level.
  const mirrored = useRef(new Map<string, string>());
  const resetOnce = useRef(new Set<string>());
  useEffect(() => {
    for (const e of events) {
      const was = mirrored.current.get(e.incident_id);
      const nowKey = `${e.level}|${e.end_time}`;
      if (was == null || was === nowKey) continue;
      mirrored.current.set(e.incident_id, nowKey);
      void mirrorEvent({ ...plainEvent(e), status: "pushed" });
    }
  }, [events]);

  // Two-tier alarm: sound + toast on the transition into fight_likely / fight.
  const upsert = useAlarmStore((s) => s.upsert);
  const retain = useAlarmStore((s) => s.retain);
  const decide = useAlarmStore((s) => s.decide);
  useEffect(() => {
    const now = Date.now();
    const keep = new Set<string>();
    for (const e of events) {
      const prev = lastLevel.current.get(e.incident_id);
      lastLevel.current.set(e.incident_id, e.level);
      const open =
        e.end_time == null &&
        e.status !== "dismissed" &&
        e.status !== "resolved";
      if (!open || !isAlarmLevel(e.level)) continue;
      keep.add(e.incident_id);
      const firstSight = !seenAlarm.current.has(e.incident_id);
      seenAlarm.current.add(e.incident_id);
      const transition =
        prev != null && LEVEL_ORDER[prev] < LEVEL_ORDER.fight_likely;
      const freshAtFirstSight =
        firstSight &&
        (e.pushed_at
          ? now - Date.parse(e.pushed_at) < FRESH_MS
          : now - Date.parse(e.start_time) < 2 * FRESH_MS);
      const sound = e.isReplay
        ? firstSight || transition
        : transition || freshAtFirstSight;
      upsert({
        incident_id: e.incident_id,
        camera_id: e.camera_id,
        location: e.location,
        level: e.level,
        priority: e.priority,
        pushed_to: e.pushed_to,
        pushed_at: e.pushed_at,
        startSilenced: !sound,
      });
      if (e.status === "confirmed") decide(e.incident_id, "confirmed");
      if (e.pushed_to && !toasted.current.has(e.incident_id)) {
        toasted.current.add(e.incident_id);
        const fresh = e.pushed_at
          ? now - Date.parse(e.pushed_at) < FRESH_MS
          : true;
        if (fresh)
          pushToast(e.pushed_to, e.pushed_at ?? new Date(), e.location);
        // Without the API, copy the push to the shared store so the guard's phone rings.
        if (fresh && usingMock && (e.isReplay || e.isEdge)) {
          mirrored.current.set(e.incident_id, `${e.level}|${e.end_time}`);
          // The replay loops every few seconds; clear the guard's earlier taps only once per
          // page load, so a guard who is already on the way stays on the way.
          const reset = !!e.isReplay && !resetOnce.current.has(e.incident_id);
          resetOnce.current.add(e.incident_id);
          void mirrorEvent({ ...plainEvent(e), status: "pushed" }, reset);
        }
        // Same-browser demo: let an open /push tab see the replay's simulated push.
        if (fresh && e.isReplay && typeof BroadcastChannel !== "undefined") {
          const ch = new BroadcastChannel("earlyeye-push");
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { etaAt, isReplay, ...plain } = e;
          ch.postMessage({
            type: "push",
            event: { ...plain, status: "pushed" },
          });
          ch.close();
        }
      }
    }
    retain(keep);
  }, [events, upsert, retain, decide]);

  // Operator actions.
  const act = useCallback(
    async (e: LiveEvent, status: Status, extra?: Partial<Override>) => {
      const prev = overrides[e.incident_id]?.status ?? e.status;
      setOverrides((o) => ({
        ...o,
        [e.incident_id]: { status, prev, ...extra },
      }));
      try {
        await patchEvent(e.incident_id, { status });
      } catch {
        // Keep the local decision; the next poll shows the server state when it agrees.
      }
    },
    [overrides],
  );

  const pushNow = useCallback(
    async (e: LiveEvent) => {
      const name = e.nearest_staff ?? "person on duty";
      const at = new Date().toISOString();
      await act(e, "pushed", { pushed_to: name, pushed_at: at });
      toasted.current.add(e.incident_id);
      pushToast(name, at, e.location);
      if (usingMock) {
        mirrored.current.set(e.incident_id, `${e.level}|${e.end_time}`);
        void mirrorEvent({ ...plainEvent(e), status: "pushed", pushed_to: name, pushed_at: at });
      }
    },
    [act],
  );

  // Without the API nobody else applies the two-tier rule to the live webcam: push the
  // nearest person once when an edge incident reaches fight likely.
  const autoPushed = useRef(new Set<string>());
  useEffect(() => {
    if (!usingMock) return;
    for (const e of events) {
      if (!e.isEdge || e.pushed_to || !isAlarmLevel(e.level) || e.end_time != null) continue;
      if (e.status !== "new" || !e.nearest_staff || autoPushed.current.has(e.incident_id)) continue;
      autoPushed.current.add(e.incident_id);
      void pushNow(e);
    }
  }, [events, pushNow]);

  /** Desk sends another guard: a backup incident on the same camera, pushed to them. */
  const pushBackup = useCallback(
    async (e: LiveEvent, name: string) => {
      const at = new Date().toISOString();
      const id = `${e.incident_id}-B`;
      pushToast(name, at, e.location);
      if (!usingMock) {
        try {
          await sendBackup(e.incident_id, name, e.outcome === "backup" ? "need_backup" : "no_answer");
          return;
        } catch {
          // API down: fall through to the local copy so the desk still shows it
        }
      }
      await mirrorEvent(
        {
          ...plainEvent(e),
          incident_id: id,
          pushed_to: name,
          pushed_at: at,
          nearest_staff: name,
          status: "pushed",
          acked_at: null,
          arrived_at: null,
          outcome: null,
          outcome_at: null,
          action: `Back up ${e.pushed_to ?? "the first guard"} at ${e.location}`,
        },
        true,
      );
    },
    [],
  );

  const label = useCallback(
    async (e: LiveEvent, d: "confirmed" | "dismissed") => {
      decide(e.incident_id, d);
      await act(e, d, {
        pushed_to: e.pushed_to ?? undefined,
        pushed_at: e.pushed_at ?? undefined,
      });
    },
    [act, decide],
  );

  const undo = useCallback(
    async (e: LiveEvent) => {
      const o = overrides[e.incident_id];
      const prev: Status =
        o?.prev && o.prev !== e.status
          ? o.prev
          : e.pushed_to
            ? "pushed"
            : "new";
      decide(e.incident_id, null);
      setOverrides((m) => ({
        ...m,
        [e.incident_id]: { ...m[e.incident_id], status: prev, prev },
      }));
      try {
        await patchEvent(e.incident_id, { status: prev });
      } catch {
        // local only
      }
    },
    [overrides, decide],
  );

  const pushesThisShift = useMemo(() => {
    const since = Date.now() - SHIFT_MS;
    return events.filter((e) => e.pushed_at && Date.parse(e.pushed_at) >= since)
      .length;
  }, [events]);

  const lastLiveEventAt = useMemo(() => {
    let t = 0;
    for (const e of polled)
      if (e.end_time == null)
        t = Math.max(
          t,
          (e as LiveEvent).isEdge ? Date.now() : Date.parse(e.start_time),
        );
    return t;
  }, [polled]);

  return {
    events,
    bufferFor,
    replay,
    replayEvents,
    replayIncident,
    pushNow,
    pushBackup,
    label,
    undo,
    pushesThisShift,
    lastLiveEventAt,
    error: recent.error ?? full.error,
    loading: !recent.data && !full.data,
  };
}
