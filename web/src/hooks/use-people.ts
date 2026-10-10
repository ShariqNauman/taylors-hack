"use client";

import { useCallback, useMemo } from "react";
import useSWR from "swr";
import { getCameras, getPatrolPlan, getSite } from "@/lib/api";
import { nearestTo, type PostGeo, whereabouts } from "@/lib/people";
import { team } from "@/lib/posts";
import type { Camera, GeoPoint } from "@/lib/types";

const SEED_URL = "/campus/campus-3d-seed.json";
type Seed = { patrol_posts?: { location: string; geo: GeoPoint }[] };
const fetchSeed = (u: string) => fetch(u).then((r) => r.json() as Promise<Seed>);

/** The team with pictures and names, and who is nearest right now. Shares SWR keys with the screens. */
export function usePeople(now: number) {
  const { data: site } = useSWR("site", getSite, { refreshInterval: 10_000 });
  const { data: plan } = useSWR("plan", getPatrolPlan, { refreshInterval: 5_000 });
  const { data: cameras } = useSWR("cameras", getCameras, { refreshInterval: 10_000 });
  const { data: seed } = useSWR(SEED_URL, fetchSeed, { revalidateOnFocus: false });
  const people = useMemo(() => team(site?.staff), [site]);
  const postGeo: PostGeo = useCallback(
    (s) =>
      s.geo ??
      seed?.patrol_posts?.find((p) => p.location === s.location)?.geo ??
      cameras?.find((c) => c.location === s.location)?.geo ??
      null,
    [seed, cameras],
  );
  // Recompute where people are once a minute; check-ins arrive with the plan poll.
  const minute = Math.floor(now / 60_000);
  const where = useMemo(() => whereabouts(people, plan, postGeo, minute * 60_000), [people, plan, postGeo, minute]);
  const person = useCallback((call: string | null | undefined) => people.find((p) => p.id === call) ?? null, [people]);
  const nearest = useCallback(
    (camera: Camera | undefined, exclude: (string | null | undefined)[] = []) => nearestTo(where, camera, exclude),
    [where],
  );
  return { people, person, nearest, plan, site };
}
export type PeopleApi = ReturnType<typeof usePeople>;
