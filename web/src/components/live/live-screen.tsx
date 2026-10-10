"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { getCameras, getPatrolPlan, getSite, resetDemoOnce, usingMock } from "@/lib/api";
import { LEVEL_ORDER, mytWeekday } from "@/lib/format";
import { useAlarmStore, selectPulsingCameras } from "@/lib/store/alarm-store";
import { useAppStore } from "@/lib/store/app-store";
import { SYNTHETIC_POSES_IN_MOCKS } from "@/lib/mock-poses";
import { useClock } from "@/hooks/use-clock";
import { usePeople } from "@/hooks/use-people";
import { activePosts, slotDays } from "@/lib/posts";
import { PageShell } from "@/components/chrome/page-shell";
import { LiveHeaderControls } from "./live-header-controls";
import { DemoStrip } from "./demo-strip";
import { EvidencePanel } from "./evidence-panel";
import { AlertCard } from "./alert-card";
import { Queue } from "./queue";
import { CameraWall } from "./camera-wall";
import { HandoverDrawer } from "./handover-drawer";
import { useLiveFeed, type LiveEvent } from "./use-live-feed";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Campus3D } from "@/components/campus3d";

const PUSH_BUDGET = 3;
const LIVE_STALE_MS = 60_000;
const ACTIVE_WINDOW_MS = 20 * 60_000;
/** After the guard reports back, the card stays as "Handled" this long. */
const HANDLED_MS = 2 * 60_000;
const handledNow = (e: { outcome_at?: string | null }, now: number) =>
  !!e.outcome_at && now - Date.parse(e.outcome_at) < HANDLED_MS;

export function LiveScreen() {
  const params = useSearchParams();
  // Demo mode: a refresh of Live starts a clean demo (no pushes or labels from earlier runs).
  const { mutate: mutateAll } = useSWRConfig();
  const clearAlarms = useAlarmStore((s) => s.retain);
  useEffect(() => {
    void resetDemoOnce().then((done) => {
      if (!done) return;
      clearAlarms(new Set());
      void mutateAll((k) => Array.isArray(k) && k[0] === "events");
    });
  }, [mutateAll, clearAlarms]);
  const camParam = params.get("cam");
  const apiDown = useAppStore((s) => s.apiDown);
  const view = useAppStore((s) => s.view);
  // Replay policy. `?replay=1` forces it, `?replay=0` suppresses it. Otherwise
  // it starts by itself once the edge probe says we are not on site: someone
  // opening the deployed link with no camera attached (a judge, a buyer) must
  // see the product work, not a quiet screen. On site the webcam drives it.
  const replayParam = params.get("replay");
  const replayOn =
    replayParam !== "0" && (replayParam === "1" || view === "remote");
  const now = useClock(replayOn ? 100 : 500);

  const { data: site } = useSWR("site", getSite, { revalidateOnFocus: false });
  const { data: cameras } = useSWR("cameras", getCameras, {
    refreshInterval: 10_000,
  });
  const { data: plan } = useSWR("plan", getPatrolPlan, {
    revalidateOnFocus: false,
  });
  const router = useRouter();
  const edgeUrls = useMemo(
    () =>
      (cameras ?? [])
        .filter((c) => c.edge_url && c.online && !c.black_since)
        .map((c) => c.edge_url!),
    [cameras],
  );
  const people = usePeople(now.getTime());
  const feed = useLiveFeed(replayOn, edgeUrls, (e) => {
    const cam = (cameras ?? []).find((c) => c.camera_id === e.camera_id);
    return people.nearest(cam)[0]?.person.id ?? null;
  });
  const mockOnSite = view === "onsite" && (usingMock || apiDown);

  const active = useMemo(
    () =>
      feed.events
        .filter(
          (e) =>
            // Reported by the guard in the last 2 minutes: stays as "Handled".
            (handledNow(e, Date.now()) && e.status !== "dismissed") ||
            // A guard is on the way: stays until they report, even if the scene calms.
            (!!e.pushed_to && !e.outcome && e.status === "pushed" && !!e.pushed_at &&
              Date.now() - Date.parse(e.pushed_at) < 10 * 60_000 && (e.isReplay || e.isEdge || e.end_time == null)) ||
            (e.end_time == null &&
            // An open record older than the window is stale history (the API cannot close
            // records yet); the edge and the replay are always current.
            (e.isEdge ||
              e.isReplay ||
              Date.now() - Date.parse(e.start_time) < ACTIVE_WINDOW_MS) &&
            // On site without an API, mock "now" incidents would hide the real webcam.
            (!mockOnSite || e.isEdge || e.isReplay) &&
            LEVEL_ORDER[e.level] >= LEVEL_ORDER.tense &&
            e.status !== "dismissed" &&
            e.status !== "resolved"),
        )
        .sort((a, b) => b.priority - a.priority),
    [feed.events, mockOnSite],
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
    // ?cam= pins the card to that camera: calm if it has no incident (the banner still shows alarms elsewhere).
    (camParam ? null : active[0]) ||
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

  // On site the edge answered /health, so the webcam is connected.
  const liveFresh = view === "onsite";
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
    SYNTHETIC_POSES_IN_MOCKS &&
    !current?.isEdge &&
    (replaySelected || usingMock || apiDown);

  const [handover, setHandover] = useState(false);
  const wd = mytWeekday(now);
  // Today's posts, with who is on them (names, not call signs).
  const todayPosts = activePosts(plan?.slots ?? []).filter((s) => slotDays(s.days).includes(wd));
  const nameOf = (call: string | null | undefined) => {
    const p = people.person(call);
    return p ? `${p.name} (${p.id})` : (call ?? "nobody yet");
  };
  const patrolToday = todayPosts.length
    ? `Posts today: ${todayPosts.map((s) => `${s.location} ${s.hours.slice(0, 5)}, ${nameOf(s.assigned_to)}`).join("; ")}.`
    : null;

  // How long the current incident's camera has been calm (for "camera agrees: calm").
  const calmForS = (() => {
    if (!current) return null;
    const t = now.getTime();
    if (current.end_time) return (t - Date.parse(current.end_time)) / 1000;
    if (current.level !== "calm") return null;
    const since = feed.calmSince(current.incident_id);
    return since != null ? (t - since) / 1000 : null;
  })();

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
      {strip && <DemoStrip mode={strip} onRestart={feed.replay.restart} location={liveCam?.location} />}
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
            people={people}
            calmForS={calmForS}
            handled={!!current && handledNow(current, now.getTime())}
            compact3d={
              current && site && cameras && plan && current.level !== "calm" ? (
                <div className="flex flex-col gap-1.5">
                  <Campus3D
                    mode="cameras"
                    compact
                    focusCameraId={current.camera_id}
                    cameras={cameras}
                    site={site}
                    events={active}
                    plan={plan}
                    height={220}
                    onOpenCamera={(id) =>
                      router.push(`/cameras?cam=${encodeURIComponent(id)}`)
                    }
                  />
                  <Link
                    href={`/cameras?cam=${encodeURIComponent(current.camera_id)}`}
                    className="text-[13px] font-bold text-signal"
                  >
                    Open the 3D campus
                  </Link>
                </div>
              ) : undefined
            }
            onPush={feed.pushNow}
            onPushBackup={feed.pushBackup}
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
        onScreenCam={currentCam?.camera_id ?? null}
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
        patrolToday={patrolToday}
        nameOf={nameOf}
      />
    </PageShell>
  );
}
