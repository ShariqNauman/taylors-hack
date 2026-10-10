import { Suspense } from "react";
import type { Metadata } from "next";
import { PageShell } from "@/components/chrome/page-shell";

export const metadata: Metadata = { title: "Incidents" };

export default function IncidentsPage() {
  return (
    <Suspense fallback={null}>
      <PageShell kicker="Incidents" title="Case review">
        <p className="rounded-[2px] border border-dashed border-line-strong bg-white p-4 text-[15px] text-ink-2">
          This screen is built on its own branch. It renders with the API down.
        </p>
      </PageShell>
    </Suspense>
  );
}
