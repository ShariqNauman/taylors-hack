"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { getEvents, getReplay, mergeEvents, patchEvent } from "@/lib/api";
import { useReplay } from "@/hooks/use-replay";
import { isAlarmLevel, LEVEL_ORDER, normaliseStatus } from "@/lib/format";
import { useAlarmStore } from "@/lib/store/alarm-store";
import type { Event, Level, PoseFrame, Status, TopFeature } from "@/lib/types";
import { pushToast } from "@/components/alarm/push-toast";

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
}

interface Override {
  status: Status;
  prev: Status;
  pushed_to?: string;
  pushed_at?: string;
}

export function useLiveFeed(replayOn: boolean) {
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
    const base = mergeEvents(full.data ?? [], recent.data ?? []);
    return base.map((e) => ({ ...e, status: normaliseStatus(e.status) }));
  }, [full.data, recent.data]);

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
      list = list.filter((e) => e.incident_id !== replayIncident.incident_id);
      list.push(replayIncident);
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
    },
    [act],
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
      if (e.end_time == null) t = Math.max(t, Date.parse(e.start_time));
    return t;
  }, [polled]);

  return {
    events,
    bufferFor,
    replay,
    replayEvents,
    replayIncident,
    pushNow,
    label,
    undo,
    pushesThisShift,
    lastLiveEventAt,
    error: recent.error ?? full.error,
    loading: !recent.data && !full.data,
  };
}
