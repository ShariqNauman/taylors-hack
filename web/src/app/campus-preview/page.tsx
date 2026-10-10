"use client";

// Temporary review page for the 3D campus, before it is wired into Cameras, Plan and Live.
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  getCameras,
  getEvents,
  getPatrolPlan,
  getReplay,
  getSite,
} from "@/lib/api";
import { PageShell } from "@/components/chrome/page-shell";
import { Campus3D } from "@/components/campus3d";

function Preview() {
  const params = useSearchParams();
  const withAlarm = params.get("alarm") === "1";
  const cam = params.get("cam") ?? undefined;
  const { data: site } = useSWR("site", getSite, { revalidateOnFocus: false });
  const { data: cameras } = useSWR("cameras", getCameras, { refreshInterval: 10_000 });
  const { data: events } = useSWR("events", () => getEvents(), { refreshInterval: 2_000 });
  const { data: plan } = useSWR("plan", getPatrolPlan, { revalidateOnFocus: false });
  const { data: replay } = useSWR(withAlarm ? "replay" : null, getReplay, {
    revalidateOnFocus: false,
  });
  const [last, setLast] = useState("none yet");

  // ?alarm=1 adds the last replay event (an open fight on CAM-AU-01) so the alarm styling can be reviewed.
  const evs = useMemo(() => {
    const base = events ?? [];
    const r = replay?.[replay.length - 1];
    return withAlarm && r ? [...base, r] : base;
  }, [events, replay, withAlarm]);

  if (!site || !cameras || !plan) {
    return <p className="ee-label text-muted-foreground">Loading</p>;
  }
  const common = {
    cameras,
    site,
    events: evs,
    plan,
    onOpenCamera: (id: string) => setLast(`onOpenCamera(${id})`),
    onSelectCamera: (id: string) => setLast(`onSelectCamera(${id})`),
  };
  return (
    <div className="flex flex-col gap-6">
      <p className="font-mono text-[12px] text-ink-2">
        Last callback: {last} · add <code>?alarm=1</code> for an open fight on
        CAM-AU-01, <code>?cam=CAM-BC-03</code> to preselect, <code>?view=remote</code> or{" "}
        <code>?view=onsite</code> for the feed.
      </p>
      <section className="flex flex-col gap-2">
        <h2 className="ee-display text-[28px]">Cameras layer</h2>
        <Campus3D mode="cameras" selectedCameraId={cam} {...common} />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="ee-display text-[28px]">Patrol plan layer</h2>
        <Campus3D mode="plan" {...common} />
      </section>
      <section className="flex max-w-[640px] flex-col gap-2">
        <h2 className="ee-display text-[28px]">Compact, focused on CAM-AU-01</h2>
        <Campus3D mode="cameras" compact focusCameraId="CAM-AU-01" {...common} />
        <a href="/campus-preview?cam=CAM-AU-01" className="text-[13px] font-bold text-signal underline">
          Open the 3D campus
        </a>
      </section>
    </div>
  );
}

export default function CampusPreviewPage() {
  return (
    <Suspense fallback={null}>
      <PageShell kicker="Preview · web/campus-3d" title="Campus in 3D">
        <Preview />
      </PageShell>
    </Suspense>
  );
}
