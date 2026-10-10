import { Suspense } from "react";
import type { Metadata } from "next";
import { ProofScreen } from "@/components/proof/proof-screen";

export const metadata: Metadata = { title: "Track record" };

export default function ProofPage() {
  return (
    <Suspense fallback={null}>
      <ProofScreen />
    </Suspense>
  );
}
