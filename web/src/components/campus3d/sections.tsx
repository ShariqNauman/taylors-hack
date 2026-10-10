"use client";

// Drop-in sections that fetch their own data, so a page needs one line:
//   /cameras  → <CampusCamerasSection />
//   /plan     → <CampusPlanSection />
//   Live card → <CampusCompact event={event} site={site} />
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { getCameras, getEvents, getPatrolPlan, getSite } from "@/lib/api";
import { useSiteView } from "@/hooks/use-site-view";
import type { Event, Site } from "@/lib/types";
import { Campus3D } from "./campus3d";
import { C, FONT } from "./tokens";
import type { CampusCamera, CampusEvent, CampusSite, SiteView } from "./types";

/** The shell probes the live camera's edge (brief §8.2); `?view=onsite|remote` overrides it. */
function useResolvedView(fallback?: SiteView): SiteView {
  const params = useSearchParams();
  const detected = useSiteView();
  const override = params.get("view");
  if (override === "onsite" || override === "remote") return override;
  if (fallback) return fallback;
  return detected === "onsite" ? "onsite" : "remote";
}

function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 12px", marginBottom: 8 }}>
      <h2 style={{ fontFamily: FONT.display, fontSize: 26, fontWeight: 800, textTransform: "uppercase", lineHeight: 1, margin: 0, color: C.ink }}>
        {children}
      </h2>
      {sub && <span style={{ fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: "0.06em" }}>{sub}</span>}
    </div>
  );
}

export function CampusCamerasSection({
  focusCameraId,
  onOpenCamera,
  view,
}: {
  focusCameraId?: string;
  onOpenCamera?: (id: string) => void;
  view?: SiteView;
}) {
  const resolvedView = useResolvedView(view);
  const { data: site } = useSWR("site", getSite, { refreshInterval: 30_000 });
  const { data: cameras } = useSWR("cameras", getCameras, { refreshInterval: 10_000 });
  const { data: events } = useSWR("events", () => getEvents(), { refreshInterval: 2000 });
  return (
    <section aria-labelledby="campus-3d-title">
      <SectionTitle sub="THE REAL TAYLOR'S LAKESIDE · CLICK A BUILDING OR A PIN">
        <span id="campus-3d-title">Campus in 3D</span>
      </SectionTitle>
      <Campus3D
        mode="cameras"
        focusCameraId={focusCameraId}
        cameras={cameras as CampusCamera[] | undefined}
        site={site as CampusSite | undefined}
        events={events as CampusEvent[] | undefined}
        onOpenCamera={onOpenCamera}
        view={resolvedView}
      />
    </section>
  );
}

export function CampusPlanSection() {
  const params = useSearchParams();
  const slot = params.get("slot") ?? undefined;
  const { data: site } = useSWR("site", getSite, { refreshInterval: 30_000 });
  const { data: plan } = useSWR("plan", getPatrolPlan, { refreshInterval: 60_000 });
  const { data: events } = useSWR("events", () => getEvents(), { refreshInterval: 10_000 });
  return (
    <section aria-labelledby="campus-plan-title">
      <SectionTitle sub="ONE POST PER SLOT · COLUMN HEIGHT = INCIDENTS IN 4 WEEKS">
        <span id="campus-plan-title">This week on the campus</span>
      </SectionTitle>
      <Campus3D
        mode="plan"
        focusPostId={slot}
        site={site as CampusSite | undefined}
        plan={plan}
        events={events as CampusEvent[] | undefined}
        view="remote"
      />
    </section>
  );
}

/** Compact, locked view for the Live alert card, with the "Open the 3D campus" link under it. */
export function CampusCompact({ event, site }: { event: Event; site?: Site }) {
  const { data: cameras } = useSWR("cameras", getCameras, { refreshInterval: 10_000 });
  return (
    <div>
      <Campus3D
        mode="cameras"
        compact
        focusCameraId={event.camera_id}
        cameras={cameras as CampusCamera[] | undefined}
        site={site as CampusSite | undefined}
        events={[event as CampusEvent]}
        allowTiles={false}
      />
      <Link
        href={`/cameras?cam=${encodeURIComponent(event.camera_id)}`}
        className="ee-campus-focus"
        style={{ display: "inline-block", marginTop: 6, fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: C.signal, textDecoration: "underline" }}
      >
        Open the 3D campus
      </Link>
    </div>
  );
}
