"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** edge/launcher.py on the demo laptop. Elsewhere nothing answers and this does nothing. */
const LAUNCHER = (
  process.env.NEXT_PUBLIC_LAUNCHER_URL ?? "http://127.0.0.1:8700"
).replace(/\/$/, "");

/**
 * Opening the desk turns the laptop's cameras on; while any desk tab is open it keeps them on, and
 * the launcher turns them off a couple of minutes after the last tab closes. Phones (/guard) never do.
 */
export function CameraWake() {
  const pathname = usePathname();
  const desk = !pathname.startsWith("/guard") && !pathname.startsWith("/push");
  useEffect(() => {
    if (!desk) return;
    const call = (path: string) =>
      fetch(`${LAUNCHER}${path}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(1500),
      }).catch(() => {});
    void call("/wake");
    // Also from a background tab (switching to the slides mustn't stop the cameras mid-demo).
    const t = window.setInterval(() => void call("/ping"), 30_000);
    return () => window.clearInterval(t);
  }, [desk]);
  return null;
}
