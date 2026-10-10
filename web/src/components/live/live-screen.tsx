"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { getCameras, getPatrolPlan, getSite, usingMock } from "@/lib/api";
import { daysInclude, LEVEL_ORDER, mytWeekday } from "@/lib/format";
import { useAlarmStore, selectPulsingCameras } from "@/lib/store/alarm-store";
import { useAppStore } from "@/lib/store/app-store";
import { SYNTHETIC_POSES_IN_MOCKS } from "@/lib/mock-poses";
import { useClock } from "@/hooks/use-clock";
import { PageShell } from "@/components/chrome/page-shell";
import { LiveHeaderControls } from "./live-header-controls";
import { DemoStrip } from "./demo-strip";
import { EvidencePanel } from "./evidence-panel";
import { AlertCard } from "./alert-card";
import { Queue } from "./queue";
import { CameraWall } from "./camera-wall";
import { HandoverDrawer } from "./handover-drawer";
import { useLiveFeed, type LiveEvent } from "./use-live-feed";

const PUSH_BUDGET = 3;
const LIVE_STALE_MS = 60_000;

export function LiveScreen() {
  const params = useSearchParams();
  const replayOn = params.get("replay") === "1";
  const camParam = params.get("cam");
  const now = useClock(replayOn ? 100 : 500);
  const apiDown = useAppStore((s) => s.apiDown);

  const { data: site } = useSWR("site", getSite, { revalidateOnFocus: false });
  const { data: cameras } = useSWR("cameras", getCameras, {
    refreshInterval: 10_000,
  });
  const { data: plan } = useSWR("plan", getPatrolPlan, {
    revalidateOnFocus: false,
  });
  const feed = useLiveFeed(replayOn);

  const active = useMemo(
    () =>
      feed.events
        .filter(
          (e) =>
            e.end_time == null &&
            LEVEL_ORDER[e.level] >= LEVEL_ORDER.tense &&
            e.status !== "dismissed" &&
            e.status !== "resolved",
        )
        .sort((a, b) => b.priority - a.priority),
    [feed.events],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fromCam = camParam
    ? active.find((e) => e.camera_id === camParam)
    : undefined;
  const replayCalm =
    feed.replayIncident && feed.replayIncident.level === "calm"
      ? feed.replayIncident
      : null;
  const current: LiveEvent | null =
    (selectedId &&
      feed.events.find(
        (e) =>
          e.incident_id === selectedId &&
          (e.status === "confirmed" ||
            e.status === "dismissed" ||
            active.includes(e)),
      )) ||
    fromCam ||
    active[0] ||
    replayCalm ||
    null;

  const pulsingStr = useAlarmStore(selectPulsingCameras);
  const pulsingCams = useMemo(
    () => new Set(pulsingStr ? pulsingStr.split(",") : []),
    [pulsingStr],
  );

  const camById = useMemo(
    () => new Map((cameras ?? []).map((c) => [c.camera_id, c])),
    [cameras],
  );
  const liveCam = cameras?.find((c) => c.source === "live");
  const currentCam = current
    ? camById.get(current.camera_id)
    : camParam
      ? camById.get(camParam)
      : liveCam;

  const liveFresh =
    !!liveCam &&
    !usingMock &&
    !apiDown &&
    now.getTime() - Date.parse(liveCam.last_frame_at) < LIVE_STALE_MS;
  const noLiveEvent = now.getTime() - feed.lastLiveEventAt > LIVE_STALE_MS;
  const strip = replayOn
    ? noLiveEvent
      ? "replay"
      : null
    : !liveFresh
      ? "idle"
      : null;

  const replaySelected = !!current?.isReplay;
  const synthetic =
    SYNTHETIC_POSES_IN_MOCKS && (replaySelected || usingMock || apiDown);

  const [handover, setHandover] = useState(false);
  const wd = mytWeekday(now);
  const todaySlot = plan?.slots.find((s) => daysInclude(s.days, wd));

  return (
    <PageShell
      headerRight={
        <LiveHeaderControls
          pushes={feed.pushesThisShift}
          budget={PUSH_BUDGET}
          now={now}
          onEndShift={() => setHandover(true)}
        />
      }
    >
      {strip && <DemoStrip mode={strip} onRestart={feed.replay.restart} />}
      <div className="grid gap-3.5 min-[1040px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="order-2 min-w-0 min-[1040px]:order-1">
          <EvidencePanel
            event={current}
            camera={currentCam}
            buffer={feed.bufferFor(current?.incident_id)}
            now={now}
            synthetic={
              synthetic && !!(current?.snapshot || current?.peak_snapshot)
            }
            replayDemo={replaySelected}
          />
        </div>
        <div className="order-1 flex min-w-0 flex-col gap-3.5 min-[1040px]:order-2">
          <AlertCard
            event={current}
            camera={currentCam}
            site={site}
            now={now}
            pulsing={!!current && pulsingCams.has(current.camera_id)}
            onPush={feed.pushNow}
            onConfirm={(e) => feed.label(e, "confirmed")}
            onDismiss={(e) => feed.label(e, "dismissed")}
            onUndo={feed.undo}
          />
          <Queue
            events={active}
            selectedId={current?.incident_id ?? null}
            onSelect={setSelectedId}
          />
        </div>
      </div>
      <CameraWall
        cameras={cameras ?? []}
        site={site}
        active={active}
        selectedId={current?.incident_id ?? null}
        pulsingCams={pulsingCams}
        now={now}
      />
      <HandoverDrawer
        open={handover}
        onOpenChange={setHandover}
        now={now}
        pushes={feed.pushesThisShift}
        budget={PUSH_BUDGET}
        events={feed.events}
        cameras={cameras ?? []}
        patrolToday={
          todaySlot
            ? `Patrol slot today: ${todaySlot.location}, ${todaySlot.hours}.`
            : null
        }
      />
    </PageShell>
  );
}
