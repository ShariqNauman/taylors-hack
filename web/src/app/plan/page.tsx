import { Suspense } from "react";
import type { Metadata } from "next";
import { PlanScreen } from "@/components/plan/plan-screen";

export const metadata: Metadata = { title: "Plan" };

export default function PlanPage() {
  return (
    <Suspense fallback={null}>
      <PlanScreen />
    </Suspense>
  );
}
