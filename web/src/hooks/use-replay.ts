"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Event } from "@/lib/types";

const TICK_MS = 100;
/** After the last replay event the scene is calm for this long (the "camera agrees: calm" tail). */
export const CALM_TAIL_S = 35;
/** While a pushed alert waits for a guard, the loop holds this much longer at most. */
const HOLD_FOR_GUARD_MS = 25_000;

export interface ReplayState {
  /** Index of the current replay event, or -1 before the first. */
  index: number;
  /** Seconds since the replay started (wall clock). */
  elapsed: number;
  /** Wall-clock ISO time the replay started; each event's `receivedAt` = start + its offset. */
  startedAt: string;
  /** Seconds between the first event and the last. */
  duration: number;
  /** True after the last event: the scene has calmed down. */
  calmTail: boolean;
  /** Changes every loop, so each run is a fresh incident. */
  loopTag: string;
  restart: () => void;
}

/**
 * Timestamp-based replay (frontend plan "Replay rule"): events play by their
 * `start_time` deltas, so "fight likely in ~6 s" is true on screen. After the
 * last event the scene stays calm for CALM_TAIL_S, then loops. While `holdForGuard`
 * is true (an alert is waiting for a guard) the loop waits up to 25 s more, so the
 * desk's "no answer in 20 s" can appear.
 */
export function useReplay(
  events: Event[] | undefined,
  enabled: boolean,
  holdForGuard = false,
): ReplayState {
  const [startedMs, setStartedMs] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const holdRef = useRef(holdForGuard);
  holdRef.current = holdForGuard;
  const heldSince = useRef<number | null>(null);

  const offsets = useMemo(() => {
    if (!events?.length) return [] as number[];
    const base = Date.parse(events[0].start_time);
    return events.map((e) => (Date.parse(e.start_time) - base) / 1000);
  }, [events]);
  const duration = offsets.length ? offsets[offsets.length - 1] : 0;

  const restart = useCallback(() => {
    heldSince.current = null;
    setStartedMs(Date.now());
    setElapsed(0);
  }, []);

  useEffect(() => {
    if (!enabled || !events?.length) return;
    const t = setInterval(() => {
      const now = Date.now();
      const e = (now - startedMs) / 1000;
      if (e > duration + CALM_TAIL_S) {
        if (holdRef.current) {
          heldSince.current ??= now;
          if (now - heldSince.current < HOLD_FOR_GUARD_MS) {
            setElapsed(e);
            return;
          }
        }
        heldSince.current = null;
        setStartedMs(now);
        setElapsed(0);
      } else {
        setElapsed(e);
      }
    }, TICK_MS);
    return () => clearInterval(t);
  }, [enabled, events, startedMs, duration]);

  let index = -1;
  for (let i = 0; i < offsets.length; i++) if (offsets[i] <= elapsed) index = i;

  return {
    index,
    elapsed,
    startedAt: new Date(startedMs).toISOString(),
    duration,
    calmTail: index >= 0 && elapsed > duration + 2,
    loopTag: startedMs.toString(36).slice(-5),
    restart,
  };
}
