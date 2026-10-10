"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import {
  getCameras,
  getEvents,
  getReplay,
  getSite,
  patchStatus,
  usingMock,
} from "@/lib/api";
import { isAlarmLevel, LEVEL_LABEL, LEVEL_ORDER } from "@/lib/format";
import type { Event, Status } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/site-header";
import { AlertCard } from "./alert-card";
import { Queue } from "./queue";
import { CameraTiles } from "./camera-tiles";

const REPLAY_STEP_MS = 500;
const REPLAY_HOLD_MS = 4000;
const SHIFT_HOURS = 8;
const PUSH_TARGET = 3;
/** A server-side push older than this is history, not a transition: no toast, no alarm. */
const FRESH_PUSH_MS = 5000;

type Pushed = Record<string, { to: string; at: string }>;

export function LiveScreen() {
  const params = useSearchParams();
  const replay = params.get("replay") === "1";

  const { data: site } = useSWR("site", getSite, { refreshInterval: 30_000 });
  const { data: cameras } = useSWR("cameras", getCameras, {
    refreshInterval: 10_000,
  });
  const { data: polled, error: eventsError } = useSWR(
    "events",
    () => getEvents(),
    { refreshInterval: replay ? 0 : 2000 },
  );
  const { data: replayEvents } = useSWR(replay ? "replay" : null, getReplay);

  // 1 s clock for relative times.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Local state layered over polled data: pushes we triggered and labels we applied.
  const [pushed, setPushed] = useState<Pushed>({});
  const [overrides, setOverrides] = useState<
    Record<string, { status: Status }>
  >({});
  const seenAlarm = useRef<Set<string>>(new Set());

  // Replay ticker: ?replay=1 cycles replay.json at 0.5 s/event, holds on the last step, loops.
  const [step, setStep] = useState(0);
  const [cycleStart, setCycleStart] = useState<string>(() =>
    new Date().toISOString(),
  );
  useEffect(() => {
    if (!replay || !replayEvents?.length) return;
    const ids = new Set(replayEvents.map((e) => e.incident_id));
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      for (const id of ids) seenAlarm.current.delete(id);
      setPushed((p) =>
        Object.fromEntries(Object.entries(p).filter(([k]) => !ids.has(k))),
      );
      setOverrides((o) =>
        Object.fromEntries(Object.entries(o).filter(([k]) => !ids.has(k))),
      );
      setCycleStart(new Date().toISOString());
    };
    const tick = (i: number) => {
      if (i === 0) reset();
      setStep(i);
      const last = i >= replayEvents.length - 1;
      timer = setTimeout(
        () => tick(last ? 0 : i + 1),
        last ? REPLAY_HOLD_MS : REPLAY_STEP_MS,
      );
    };
    tick(0);
    return () => clearTimeout(timer);
  }, [replay, replayEvents]);

  // Merge polled events + replay frame + local overrides.
  const events: Event[] = useMemo(() => {
    let list = polled ?? [];
    let replayCurrent: Event | null = null;
    if (replay && replayEvents?.length) {
      const cur = replayEvents[Math.min(step, replayEvents.length - 1)];
      replayCurrent = { ...cur, start_time: cycleStart };
      list = [
        ...list.filter((e) => e.incident_id !== cur.incident_id),
        replayCurrent,
      ];
    }
    return list.map((e) => {
      const merged: Event = { ...e, ...(overrides[e.incident_id] ?? {}) };
      const p = pushed[e.incident_id];
      if (p && !merged.pushed_to) {
        merged.pushed_to = p.to;
        merged.pushed_at = p.at;
        if (merged.status === "new") merged.status = "pushed";
      }
      return merged;
    });
  }, [polled, replay, replayEvents, step, cycleStart, pushed, overrides]);

  const active = useMemo(
    () =>
      events
        .filter(
          (e) =>
            e.end_time == null &&
            LEVEL_ORDER[e.level] >= LEVEL_ORDER.tense &&
            e.status !== "dismissed" &&
            e.status !== "resolved",
        )
        .sort((a, b) => b.priority - a.priority),
    [events],
  );

  // In replay, show the calm negatives on the card too (hug, high-five → green).
  const replayCurrent = useMemo(() => {
    if (!replay || !replayEvents?.length) return null;
    const id = replayEvents[0].incident_id;
    return events.find((e) => e.incident_id === id) ?? null;
  }, [replay, replayEvents, events]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current: Event | null =
    (selectedId && active.find((e) => e.incident_id === selectedId)) ||
    active[0] ||
    (replayCurrent && replayCurrent.level === "calm" ? replayCurrent : null) ||
    null;

  // Two-tier: on first sight of an incident at fight_likely+, alarm + push to one person.
  const alarmRef = useRef<HTMLAudioElement>(null);
  const [soundOn, setSoundOn] = useState(false);
  useEffect(() => {
    for (const e of events) {
      if (e.end_time || !isAlarmLevel(e.level)) continue;
      if (seenAlarm.current.has(e.incident_id)) continue;
      seenAlarm.current.add(e.incident_id);
      const fresh =
        !e.pushed_to ||
        (e.pushed_at != null &&
          Date.now() - Date.parse(e.pushed_at) < FRESH_PUSH_MS);
      if (!fresh) continue; // old push from the server: history, not a transition
      const to = e.pushed_to ?? e.nearest_staff ?? "person on duty";
      if (!e.pushed_to) {
        setPushed((p) => ({
          ...p,
          [e.incident_id]: { to, at: new Date().toISOString() },
        }));
      }
      toast.error(`Pushed to ${to}`, {
        description: `${LEVEL_LABEL[e.level]} · ${e.location}`,
        duration: 6000,
      });
      alarmRef.current?.play().catch(() => {});
    }
  }, [events]);

  const enableSound = useCallback(async () => {
    const a = alarmRef.current;
    if (!a) return;
    try {
      await a.play();
      a.pause();
      a.currentTime = 0;
      setSoundOn(true);
      toast.success("Alarm sound enabled");
    } catch {
      toast.warning("Browser blocked audio; click again");
    }
  }, []);

  const pushesThisShift = useMemo(() => {
    const since = now.getTime() - SHIFT_HOURS * 3_600_000;
    return events.filter(
      (e) => e.pushed_to && Date.parse(e.pushed_at ?? e.start_time) >= since,
    ).length;
  }, [events, now]);

  const [busy, setBusy] = useState(false);
  const label = useCallback(
    async (e: Event, status: "confirmed" | "dismissed") => {
      setBusy(true);
      try {
        await patchStatus(e.incident_id, { status });
        setOverrides((o) => ({ ...o, [e.incident_id]: { status } }));
        if (status === "confirmed") toast.success(`Confirmed · ${e.location}`);
        else toast.info(`Dismissed · ${e.location} · labelled as false alarm`);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const banner = active.find((e) => isAlarmLevel(e.level)) ?? null;
  const activeCameraIds = useMemo(
    () => new Set(active.map((e) => e.camera_id)),
    [active],
  );

  return (
    <>
      <audio ref={alarmRef} src="/alarm.mp3" preload="auto" />
      <SiteHeader siteName={site?.name}>
        <span
          className={cn(
            "rounded-full border px-3 py-1 text-sm font-semibold tabular-nums",
            pushesThisShift >= PUSH_TARGET
              ? "border-red-300 bg-red-50 text-red-800"
              : "border-slate-300 bg-slate-50 text-slate-700",
          )}
          title="Fight-likely alerts pushed to a person in the last 8 hours"
        >
          {pushesThisShift} of {PUSH_TARGET} pushes this shift
        </span>
        {replay && (
          <span className="rounded-full border border-blue-300 bg-blue-50 px-3 py-1 text-sm font-medium text-blue-800">
            Replay
          </span>
        )}
        {(usingMock || eventsError) && (
          <span className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-sm text-slate-600">
            {eventsError ? "API down · mock" : "Mock data"}
          </span>
        )}
        {soundOn ? (
          <span className="text-sm font-medium text-green-700">Sound on</span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={enableSound}
            className="border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100"
          >
            Enable sound
          </Button>
        )}
      </SiteHeader>

      <div
        className={cn(
          "overflow-hidden transition-[max-height] duration-300",
          banner ? "max-h-24" : "max-h-0",
        )}
        role="alert"
      >
        {banner && (
          <div className="bg-red-600 px-4 py-3 text-center text-xl font-bold uppercase tracking-wide text-white sm:px-6">
            {LEVEL_LABEL[banner.level]} · {banner.location}
            {banner.pushed_to ? ` · pushed to ${banner.pushed_to}` : ""}
          </div>
        )}
      </div>

      <main className="mx-auto grid max-w-[1600px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <AlertCard
            event={current}
            site={site}
            busy={busy}
            onConfirm={(e) => label(e, "confirmed")}
            onDismiss={(e) => label(e, "dismissed")}
          />
        </div>
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Queue
            events={active}
            selectedId={current?.incident_id ?? null}
            onSelect={setSelectedId}
            now={now}
          />
          <CameraTiles
            cameras={cameras ?? []}
            site={site}
            now={now}
            activeCameraIds={activeCameraIds}
          />
        </div>
      </main>
    </>
  );
}
