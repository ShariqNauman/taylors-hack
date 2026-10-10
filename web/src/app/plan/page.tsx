import { Suspense } from "react";
import type { Metadata } from "next";
import { PageShell } from "@/components/chrome/page-shell";

export const metadata: Metadata = { title: "Plan" };

export default function PlanPage() {
  return (
    <Suspense fallback={null}>
      <PageShell kicker="Plan" title="Where to put people this week">
        <p className="rounded-[2px] border border-dashed border-line-strong bg-white p-4 text-[15px] text-ink-2">
          This screen is built on its own branch. It renders with the API down.
        </p>
      </PageShell>
    </Suspense>
  );
}
