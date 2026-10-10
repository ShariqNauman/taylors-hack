"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Event } from "@/lib/types";

const TICK_MS = 100;
const HOLD_MS = 4000;

export interface ReplayState {
  /** Index of the current replay event, or -1 before the first. */
  index: number;
  /** Seconds since the replay started (wall clock). */
  elapsed: number;
  /** Wall-clock ISO time the replay started; each event's `receivedAt` = start + its offset. */
  startedAt: string;
  /** Seconds between the first event and the last. */
  duration: number;
  restart: () => void;
}

/**
 * Timestamp-based replay (frontend plan "Replay rule"): events play by their
 * `start_time` deltas, so "fight likely in ~6 s" is true on screen. Holds on
 * the last event for 4 s, then loops.
 */
export function useReplay(
  events: Event[] | undefined,
  enabled: boolean,
): ReplayState {
  const [startedMs, setStartedMs] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const rafRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const offsets = useMemo(() => {
    if (!events?.length) return [] as number[];
    const base = Date.parse(events[0].start_time);
    return events.map((e) => (Date.parse(e.start_time) - base) / 1000);
  }, [events]);
  const duration = offsets.length ? offsets[offsets.length - 1] : 0;

  const restart = useCallback(() => {
    setStartedMs(Date.now());
    setElapsed(0);
  }, []);

  useEffect(() => {
    if (!enabled || !events?.length) return;
    rafRef.current = setInterval(() => {
      const e = (Date.now() - startedMs) / 1000;
      if (e * 1000 > duration * 1000 + HOLD_MS) {
        setStartedMs(Date.now());
        setElapsed(0);
      } else {
        setElapsed(e);
      }
    }, TICK_MS);
    return () => {
      if (rafRef.current) clearInterval(rafRef.current);
    };
  }, [enabled, events, startedMs, duration]);

  let index = -1;
  for (let i = 0; i < offsets.length; i++) if (offsets[i] <= elapsed) index = i;

  return {
    index,
    elapsed,
    startedAt: new Date(startedMs).toISOString(),
    duration,
    restart,
  };
}
