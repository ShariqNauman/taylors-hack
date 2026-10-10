"use client";

// Cameras page: the campus map block. Map (2D) by default, 3D one tap away; both
// show the same pins, alarm state and on-duty guards, and both refresh every 2 s.
import { useState } from "react";
import useSWR from "swr";
import { getCameras, getEvents, getPatrolPlan, getSite } from "@/lib/api";
import { normaliseStatus } from "@/lib/format";
import { Campus3D } from "@/components/campus3d";
import { useWebGL } from "@/components/campus3d/webgl";
import { CampusMap2D } from "./campus-map-2d";
import { MapToggle, type MapView } from "./map-toggle";

const LIVE = { refreshInterval: 2000 };

export function CamerasMapBlock({
  visibleCameraIds,
  selectedCameraId,
  onSelectCamera,
  onOpenCamera,
}: {
  /** The page's filter chips: only these get a pin. */
  visibleCameraIds: string[];
  /** The camera shown in the detail panel; both views highlight and centre on it. */
  selectedCameraId?: string;
  onSelectCamera: (id: string) => void;
  onOpenCamera: (id: string) => void;
}) {
  // Same SWR keys as the page, so the caches are shared; 2 s here keeps both views fresh.
  const { data: site } = useSWR("site", getSite, LIVE);
  const { data: cameras } = useSWR("cameras", getCameras, LIVE);
  const { data: plan } = useSWR("plan", getPatrolPlan, LIVE);
  const { data: events } = useSWR(["events", "full"], () => getEvents(), LIVE);
  const gl = useWebGL();
  const [view, setView] = useState<MapView>("2d");
  const show3d = view === "3d" && gl === true;
  const evs = (events ?? []).map((e) => ({ ...e, status: normaliseStatus(e.status) }));

  return (
    <section aria-labelledby="map-h" className="flex flex-col gap-2.5 rounded-[2px] border border-line bg-white p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="map-h" className="ee-display text-[28px]">
            Campus map
          </h2>
          <span className="font-mono text-[12px] uppercase text-muted-ink">
            {site?.name ?? "Site"} · {show3d ? "drag to rotate" : "drag to move, scroll to zoom"} · click a camera
          </span>
        </div>
        {gl && <MapToggle view={view} onChange={setView} />}
      </div>
      {!site || !cameras ? (
        <div className="h-[560px] rounded-[2px] border border-line bg-raised" aria-busy="true" />
      ) : show3d && plan ? (
        <Campus3D
          mode="cameras"
          lockLayer
          cameras={cameras}
          site={site}
          events={evs}
          plan={plan}
          visibleCameraIds={visibleCameraIds}
          selectedCameraId={selectedCameraId}
          onSelectCamera={onSelectCamera}
          onOpenCamera={onOpenCamera}
          height={600}
        />
      ) : (
        <CampusMap2D
          layer="cameras"
          site={site}
          cameras={cameras}
          events={evs}
          visibleCameraIds={visibleCameraIds}
          selectedCameraId={selectedCameraId}
          onSelectCamera={onSelectCamera}
        />
      )}
    </section>
  );
}
