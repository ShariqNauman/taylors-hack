"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import type { Camera } from "@/lib/types";
import { useAppStore } from "@/lib/store/app-store";

const PROBE_TIMEOUT_MS = 800;

/**
 * On-site desk or remote link (brief §8.2). Probes `${edge_url}/health` of the
 * one live camera, once, with an 800 ms timeout. `?view=onsite|remote` overrides.
 * This probe is the only request the dashboard ever makes to an edge_url when
 * it is not already known to be on site.
 */
export function useDetectSiteView(cameras: Camera[] | undefined) {
  const params = useSearchParams();
  const override = params.get("view");
  const setView = useAppStore((s) => s.setView);
  const view = useAppStore((s) => s.view);

  useEffect(() => {
    if (override === "onsite" || override === "remote") {
      setView(override);
      return;
    }
    if (view !== "detecting") return;
    if (!cameras) return;
    const live = cameras.find((c) => c.source === "live" && c.edge_url);
    if (!live?.edge_url) {
      setView("remote");
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    fetch(`${live.edge_url.replace(/\/$/, "")}/health`, {
      signal: ctrl.signal,
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: { ok?: boolean }) => setView(j?.ok ? "onsite" : "remote"))
      .catch(() => setView("remote"))
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [cameras, override, view, setView]);
}

export function useSiteView() {
  return useAppStore((s) => s.view);
}
