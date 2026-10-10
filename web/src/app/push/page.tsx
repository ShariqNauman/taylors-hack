import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { PushScreen } from "@/components/push/push-screen";

export const metadata: Metadata = { title: "Duty phone" };
export const viewport: Viewport = {
  themeColor: "#F1F2F4",
  width: "device-width",
  initialScale: 1,
};

export default function PushPage() {
  return (
    <Suspense fallback={null}>
      <PushScreen />
    </Suspense>
  );
}
