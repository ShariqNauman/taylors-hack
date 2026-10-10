"use client";

import { useEffect } from "react";

/** Installable app shell for the guard app only (scope /guard; the desk is untouched). */
export function RegisterGuardSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/guard-sw.js", { scope: "/guard" }).catch(() => {});
  }, []);
  return null;
}
