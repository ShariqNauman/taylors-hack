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
import { showPhoneBeside, useAppStore } from "@/lib/store/app-store";
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
/** When this page load started (demo mode counts pushes from here). */
const DEMO_STARTED_AT = Date.now();

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

export function useLiveFeed(
  replayOn: boolean,
  edgeUrls: string[] = [],
  /** Who gets the push for this incident: the nearest guard on duty (Live passes it). */
  pickGuard?: (e: Event) => string | null,
) {
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
  // Hold the replay loop while its alert waits for a guard ("no answer in 20 s" must be visible).
  const [waitingForGuard, setWaitingForGuard] = useState(false);
  const replay = useReplay(replayEvents, replayOn, waitingForGuard);
  const pickRef = useRef(pickGuard);
  pickRef.current = pickGuard;
  const chosen = useRef(new Map<string, string>());

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
      // Recordings are CCTV feeds for the wall (REC), not alarms: they never alarm or push a
      // guard. Only the live webcam does (brief §8.1; the loops would ring the phone forever).
      if (x.source === "recorded") continue;
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
    // A backup (<id>-B, a second guard sent by the desk) takes over its incident: the desk shows
    // one card, the latest guard's, so their "Sorted" closes it and "Push next" stops showing.
    return [...byId.values()].filter((e) => !byId.has(`${e.incident_id}-B`));
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
  // Each loop is a fresh incident (id + loop tag), so the guard's phone rings on every run.
  const replayIncident: LiveEvent | null = useMemo(() => {
    if (!replayOn || !replayEvents?.length || replay.index < 0) return null;
    const id = `${replayEvents[0].incident_id}-${replay.loopTag}`;
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
    let guard = chosen.current.get(id);
    if (pushed && !guard) {
      guard = pickRef.current?.(cur) ?? cur.nearest_staff ?? undefined;
      if (guard) chosen.current.set(id, guard);
    }
    // Calm tail: the scene settles after the last event.
    const calm = replay.calmTail
      ? {
          level: "calm" as const,
          eta_seconds: null,
          reason: "Calm again: people apart, no fast movement.",
          snapshot: replayEvents[0].snapshot,
          people_count: replayEvents[0].people_count,
        }
      : {};
    return {
      ...cur,
      incident_id: id,
      start_time: new Date(
        started + (Date.parse(replayEvents[startIdx].start_time) - base),
      ).toISOString(),
      ...(pushed
        ? {
            pushed_to: guard,
            nearest_staff: guard ?? cur.nearest_staff,
            action: guard ? `Send ${guard} now` : cur.action,
            pushed_at: pushedAt,
            status: "pushed" as Status,
          }
        : {}),
      ...calm,
      etaAt: started + (Date.parse(cur.start_time) - base),
      isReplay: true,
    };
  }, [replayOn, replayEvents, replay.index, replay.startedAt, replay.loopTag, replay.calmTail]);

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

  // When each incident's scene went calm (kept across replay loops), for "camera agrees: calm".
  const calmAt = useRef(new Map<string, number>());
  useEffect(() => {
    for (const e of events) {
      if (e.level !== "calm" && !e.end_time) calmAt.current.delete(e.incident_id);
      else if (!calmAt.current.has(e.incident_id))
        calmAt.current.set(
          e.incident_id,
          e.end_time
            ? Date.parse(e.end_time)
            : e.isReplay && replay.calmTail
              ? Date.parse(replay.startedAt) + (replay.duration + 2) * 1000
              : Date.now(),
        );
    }
  }, [events, replay.calmTail, replay.startedAt, replay.duration]);
  const calmSince = useCallback((id: string) => calmAt.current.get(id) ?? null, []);

  // The replay holds its loop while its alert waits for the guard's "On my way".
  useEffect(() => {
    const r = events.find((e) => e.isReplay);
    setWaitingForGuard(!!r?.pushed_to && !r.acked_at && r.status === "pushed");
  }, [events]);

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
        const tail: BufferEntry = {
          at: started + (replay.duration + 2) * 1000,
          level: "calm",
          score: 0.1,
          eta: null,
          snapshot: replayEvents[0].snapshot,
          pushed: true,
        };
        return [...replayEvents.map((e, i) => ({
          at: started + (Date.parse(e.start_time) - base),
          level: e.level,
          score: e.peak_score,
          eta: e.eta_seconds,
          snapshot: e.snapshot,
          top_features: e.top_features,
          pushed: firstAlarm >= 0 && i >= firstAlarm,
        })), tail];
      }
      return buffers.current.get(id) ?? [];
    },
    // bufferTick forces fresh reads after appends
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [replayIncident, replayEvents, replay.startedAt, replay.duration, bufferTick],
  );

  // Mirrored pushes: keep the guard's "camera now" in step with the level. The stored copy is
  // the incident record: highest level reached, and an end_time once the scene is calm again
  // (like the API), so Incidents and Track record count it as the alarm it was.
  const LV = ["calm", "tense", "fight_likely", "fight"] as const;
  const peaks = useRef(new Map<string, { level: Level; score: number; priority: number }>());
  const forStore = useCallback((e: LiveEvent): Event => {
    const p = peaks.current.get(e.incident_id);
    const level = p && LV.indexOf(p.level) > LV.indexOf(e.level) ? p.level : e.level;
    const next = { level, score: Math.max(p?.score ?? 0, e.peak_score), priority: Math.max(p?.priority ?? 0, e.priority) };
    peaks.current.set(e.incident_id, next);
    const calm = e.end_time ?? (e.level === "calm" ? new Date(calmAt.current.get(e.incident_id) ?? Date.now()).toISOString() : null);
    return { ...plainEvent(e), level: next.level, peak_score: next.score, priority: next.priority, end_time: calm, status: "pushed" };
    // LV is a constant
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const mirrored = useRef(new Map<string, string>());
  const resetOnce = useRef(new Set<string>());
  useEffect(() => {
    for (const e of events) {
      const was = mirrored.current.get(e.incident_id);
      const nowKey = `${e.level}|${e.end_time}|${e.timeline?.length ?? 0}`;
      if (was == null || was === nowKey) continue;
      mirrored.current.set(e.incident_id, nowKey);
      void mirrorEvent(forStore(e));
    }
  }, [events, forStore]);

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
      // The guard reported back (sorted, hurt, nothing there): the alarm stops even if the
      // camera still sees motion. "Need backup" keeps it sounding.
      const reported = !!e.outcome && e.outcome !== "backup";
      if (!open || !isAlarmLevel(e.level) || reported) continue;
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
        if (fresh) {
          // The desk sees the guard's phone open by itself; the toast only where it can't fit.
          if (!showPhoneBeside(e.pushed_to)) pushToast(e.pushed_to, e.pushed_at ?? new Date(), e.location);
        }
        // Without the API, copy the push to the shared store so the guard's phone rings.
        if (fresh && usingMock && (e.isReplay || e.isEdge)) {
          mirrored.current.set(e.incident_id, `${e.level}|${e.end_time}|${e.timeline?.length ?? 0}`);
          // The replay loops every few seconds; clear the guard's earlier taps only once per
          // page load, so a guard who is already on the way stays on the way.
          const reset = !!e.isReplay && !resetOnce.current.has(e.incident_id);
          resetOnce.current.add(e.incident_id);
          void mirrorEvent(forStore(e), reset);
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
  }, [events, upsert, retain, decide, forStore]);

  // Operator actions.
  const act = useCallback(
    async (e: LiveEvent, status: Status, extra?: Partial<Override>) => {
      const prev = overrides[e.incident_id]?.status ?? e.status;
      setOverrides((o) => ({
        ...o,
        [e.incident_id]: { status, prev, ...extra },
      }));
      try {
        await patchEvent(e.incident_id, {
          status,
          // Push now: who and when, so the API (and the shared demo store) can ring that phone.
          ...(status === "pushed" && extra?.pushed_to ? { pushed_to: extra.pushed_to, pushed_at: extra.pushed_at } : {}),
        });
      } catch {
        // Keep the local decision; the next poll shows the server state when it agrees.
      }
    },
    [overrides],
  );

  const pushNow = useCallback(
    async (e: LiveEvent, to?: string | null) => {
      const name = to ?? pickRef.current?.(e) ?? e.nearest_staff ?? "person on duty";
      const at = new Date().toISOString();
      await act(e, "pushed", { pushed_to: name, pushed_at: at });
      toasted.current.add(e.incident_id);
      if (!showPhoneBeside(name)) pushToast(name, at, e.location);
      if (usingMock) {
        mirrored.current.set(e.incident_id, `${e.level}|${e.end_time}|${e.timeline?.length ?? 0}`);
        void mirrorEvent({ ...forStore(e), pushed_to: name, pushed_at: at });
      }
    },
    [act, forStore],
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
      if (!showPhoneBeside(name)) pushToast(name, at, e.location);
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
    // Demo mode: the shift is this demo (since the page loaded), not the stored test history.
    const since = usingMock ? Math.max(DEMO_STARTED_AT, Date.now() - SHIFT_MS) : Date.now() - SHIFT_MS;
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
    calmSince,
    label,
    undo,
    pushesThisShift,
    lastLiveEventAt,
    error: recent.error ?? full.error,
    loading: !recent.data && !full.data,
  };
}
