import { Suspense } from "react";
import type { Metadata } from "next";
import { PageShell } from "@/components/chrome/page-shell";
import { CampusPlanSection } from "@/components/campus3d";

export const metadata: Metadata = { title: "Plan" };

export default function PlanPage() {
  return (
    <Suspense fallback={null}>
      <PageShell kicker="Plan" title="Where to put people this week">
        <CampusPlanSection />
        <p className="rounded-[2px] border border-dashed border-line-strong bg-white p-4 text-[15px] text-ink-2">
          Slot cards, heatmap and hotspots are built on their own branch. This screen renders with the API down.
        </p>
      </PageShell>
    </Suspense>
  );
}
