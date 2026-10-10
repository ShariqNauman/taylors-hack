import { Suspense } from "react";
import type { Metadata } from "next";
import { IncidentsScreen } from "@/components/incidents/incidents-screen";

export const metadata: Metadata = { title: "Incidents" };

export default function IncidentsPage() {
  return (
    <Suspense fallback={null}>
      <IncidentsScreen />
    </Suspense>
  );
}
