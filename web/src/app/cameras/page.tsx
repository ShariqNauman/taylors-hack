import { Suspense } from "react";
import type { Metadata } from "next";
import { CamerasScreen } from "@/components/cameras/cameras-screen";

export const metadata: Metadata = { title: "Cameras" };

export default function CamerasPage() {
  return (
    <Suspense fallback={null}>
      <CamerasScreen />
    </Suspense>
  );
}
