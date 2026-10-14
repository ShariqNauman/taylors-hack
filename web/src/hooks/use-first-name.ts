"use client";

import { useCallback } from "react";
import useSWR from "swr";
import { getSite } from "@/lib/api";
import { team } from "@/lib/posts";

/** Call sign → first name ("Guard B" → "Aiman"), falling back to the call sign. */
export function useFirstName() {
  const { data: site } = useSWR("site", getSite, { revalidateOnFocus: false });
  return useCallback(
    (call: string | null | undefined) => team(site?.staff).find((p) => p.id === call)?.first ?? call ?? "The guard",
    [site],
  );
}
