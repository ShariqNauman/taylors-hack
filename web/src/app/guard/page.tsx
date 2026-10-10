import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { GuardApp } from "@/components/guard/guard-app";
import { RegisterGuardSW } from "@/components/guard/register-sw";

export const metadata: Metadata = {
  title: { absolute: "EarlyEye for guards" },
  manifest: "/guard/manifest.webmanifest",
  appleWebApp: { capable: true, title: "EarlyEye", statusBarStyle: "default" },
  icons: { apple: "/guard/apple-touch-icon.png" },
};
export const viewport: Viewport = {
  themeColor: "#F1F2F4",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function GuardPage() {
  return (
    <Suspense fallback={null}>
      <GuardApp />
      <RegisterGuardSW />
    </Suspense>
  );
}
