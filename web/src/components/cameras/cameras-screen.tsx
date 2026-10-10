"use client";

// Minimal /cameras screen: the 3D campus above a plain list. The full grid and
// detail panel come with the web/cameras branch (brief §6.2); this keeps the
// 3D view reachable and `?cam=` working until then.
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { getCameras } from "@/lib/api";
import { PageShell } from "@/components/chrome/page-shell";
import { CampusCamerasSection } from "@/components/campus3d";
import { useSiteView } from "@/hooks/use-site-view";

export function CamerasScreen() {
  const params = useSearchParams();
  const cam = params.get("cam") ?? undefined;
  const view = useSiteView();
  const { data: cameras } = useSWR("cameras", getCameras, { refreshInterval: 10_000 });
  return (
    <PageShell kicker="Cameras" title="All cameras">
      <CampusCamerasSection focusCameraId={cam} view={view === "onsite" ? "onsite" : "remote"} />
      <section aria-label="Camera list">
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(cameras ?? []).map((c) => (
            <li
              key={c.camera_id}
              className={`rounded-[2px] border bg-white p-3 ${c.camera_id === cam ? "border-2 border-ink" : "border-line"}`}
            >
              <p className="font-mono text-[12px] text-muted-foreground">{c.camera_id}</p>
              <p className="text-[15px] font-bold">{c.location}</p>
              <p className="text-[12px] text-ink-2">{c.online && !c.black_since ? "online" : "no signal"}</p>
            </li>
          ))}
        </ul>
      </section>
    </PageShell>
  );
}
