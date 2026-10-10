"use client";

import useSWR from "swr";
import type { Event } from "@/lib/types";
import type {
  Building,
  CampusCamera,
  CampusEvent,
  CampusGeo,
  CampusSeed,
  CampusStaff,
  GeoPoint,
  PatrolPlan,
  PinKind,
  PlacedCamera,
  PlacedPost,
  Ring,
} from "./types";

export const SEED_URL = "/campus/campus-3d-seed.json";
export const GEOJSON_URL = "/campus/taylors-lakeside-campus.geojson";
export const OSM_CREDIT = "Footprints © OpenStreetMap contributors";

// ── Geometry ──

const EARTH_M = 6_371_000;

/** Ground distance in metres between two WGS84 points (equirectangular; fine at campus scale). */
export function metresBetween(a: GeoPoint, b: GeoPoint): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const k = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return EARTH_M * Math.hypot(dLat, dLng * k);
}

export function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function centroidOf(ring: Ring): [number, number] {
  // Area-weighted centroid, which sits inside the mass of an L- or U-shaped block.
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-18) {
    return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Which building footprint a point sits in; else the nearest one within 40 m; else null. */
export function buildingAt(geo: CampusGeo, p: GeoPoint): Building | null {
  const hit = geo.buildings.find((b) => pointInRing(p.lng, p.lat, b.ring));
  if (hit) return hit;
  let best: Building | null = null;
  let bestD = 40;
  for (const b of geo.buildings) {
    const d = metresBetween(p, { lat: b.centroid[1], lng: b.centroid[0] });
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

// ── GeoJSON ──

interface Feature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
}
export interface FeatureCollection {
  type: "FeatureCollection";
  attribution?: string;
  features: Feature[];
}

function outerRing(f: Feature): Ring {
  const g = f.geometry;
  return g.type === "Polygon" ? g.coordinates[0] : g.coordinates[0][0];
}

export function parseGeo(fc: FeatureCollection): CampusGeo {
  const buildings: Building[] = [];
  const water: Ring[] = [];
  const pitches: { name: string | null; ring: Ring }[] = [];
  let campus: Ring | null = null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const f of fc.features) {
    const p = f.properties;
    const ring = outerRing(f);
    for (const [x, y] of ring) {
      if (x < minLng) minLng = x;
      if (x > maxLng) maxLng = x;
      if (y < minLat) minLat = y;
      if (y > maxLat) maxLat = y;
    }
    switch (p.kind) {
      case "building":
        buildings.push({
          id: String(p.id ?? p.osm_way),
          name: String(p.name ?? "Building"),
          height: Number(p.height_m_estimate ?? 12),
          heightEstimated: p.height_measured !== true,
          contains: Array.isArray(p.contains) ? (p.contains as string[]) : undefined,
          ring,
          centroid: centroidOf(ring),
        });
        break;
      case "campus":
        campus = ring;
        break;
      case "water":
        water.push(ring);
        break;
      case "pitch":
        pitches.push({ name: (p.name as string | null) ?? null, ring });
        break;
    }
  }
  return {
    attribution: fc.attribution ?? OSM_CREDIT,
    buildings,
    campus,
    water,
    pitches,
    bounds: [
      [minLng, minLat],
      [maxLng, maxLat],
    ],
  };
}

// ── Loading ──

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "force-cache" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return (await r.json()) as T;
}

const immutable = { revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false };

/** The seed and the footprints, from /public/campus. Static, fetched once. */
export function useCampusAssets() {
  const seed = useSWR<CampusSeed>(SEED_URL, fetchJson, immutable);
  const fc = useSWR<FeatureCollection>(GEOJSON_URL, fetchJson, immutable);
  const geo = fc.data ? parseGeo(fc.data) : undefined;
  return { seed: seed.data, geo, error: seed.error ?? fc.error };
}

// ── Merging contract data with the seed ──

export function pinKind(c: CampusCamera): PinKind {
  if (!c.online || c.black_since) return "black";
  return c.source === "live" ? "live" : "recorded";
}

/** "Block B (OSM footprint: Block A and Block B)" → "Block B". */
export function shortBuilding(name: string): string {
  return name.replace(/\s*\(.*\)\s*$/, "").replace(/,.*$/, "").trim();
}

/** "level 2, stage left" → "Level 2". */
export function shortFloor(floor: string): string {
  const first = floor.split(",")[0].trim();
  return first.charAt(0).toUpperCase() + first.slice(1);
}

const LEVEL_RANK = { calm: 0, tense: 1, fight_likely: 2, fight: 3 } as const;

export function isOpen(e: Event): boolean {
  return !e.end_time && e.status !== "dismissed" && e.status !== "resolved" && e.level !== "calm";
}

/** Open incidents, highest level then priority first. */
export function openEvents(events: CampusEvent[] | undefined): CampusEvent[] {
  return (events ?? [])
    .filter(isOpen)
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || b.priority - a.priority);
}

/** The incident the alarm is about: the top open fight_likely or fight. */
export function alarmEvent(events: CampusEvent[] | undefined): CampusEvent | null {
  return openEvents(events).find((e) => e.level === "fight_likely" || e.level === "fight") ?? null;
}

/**
 * Place cameras on the map. The API list is the truth for state (online, black,
 * people, source, edge_url). The seed is the truth for where the camera is and
 * what the place is called, because its names were checked against Taylor's own
 * pages. A camera in neither list with a position is left off the map.
 */
export function placeCameras(
  apiCameras: CampusCamera[] | undefined,
  seed: CampusSeed,
  geo: CampusGeo,
  events: CampusEvent[] | undefined,
): PlacedCamera[] {
  const bySeed = new Map(seed.cameras.map((s) => [s.camera_id, s]));
  const base: CampusCamera[] = apiCameras?.length
    ? apiCameras
    : seed.cameras.map((s) => ({
        camera_id: s.camera_id,
        location: s.location,
        zone_type: s.zone_type,
        online: s.source !== "black",
        last_frame_at: new Date().toISOString(),
        black_since: s.source === "black" ? new Date(Date.now() - 3 * 86_400_000).toISOString() : undefined,
        source: s.source === "black" ? undefined : s.source,
      }));
  const open = openEvents(events);
  const out: PlacedCamera[] = [];
  for (const c of base) {
    const s = bySeed.get(c.camera_id);
    const geoPoint = c.geo ?? s?.geo;
    if (!geoPoint) continue;
    const buildingLong = c.geo?.building ?? s?.building ?? "";
    const floor = c.geo?.floor ?? s?.floor ?? "";
    const camera: CampusCamera = { ...c, source: c.source ?? (s && s.source !== "black" ? s.source : undefined) };
    const b = buildingAt(geo, geoPoint);
    out.push({
      camera,
      id: c.camera_id,
      location: s?.location ?? c.location,
      building: buildingLong ? shortBuilding(buildingLong) : (b?.name ?? ""),
      buildingLong: buildingLong || (b?.name ?? ""),
      floor,
      geo: geoPoint,
      kind: pinKind(camera),
      buildingId: b?.id ?? null,
      event: open.find((e) => e.camera_id === c.camera_id) ?? null,
    });
  }
  return out;
}

/** "Mon–Thu" → 4 days; "Fri" → 1. Unknown text counts as 1. */
export function daysCount(days: string): number {
  const names = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const m = days.toLowerCase().match(/([a-z]{3})\s*[–-]\s*([a-z]{3})/);
  if (m) {
    const a = names.indexOf(m[1]);
    const b = names.indexOf(m[2]);
    if (a >= 0 && b >= 0) return ((b - a + 7) % 7) + 1;
  }
  const single = days.toLowerCase().match(/[a-z]{3}/g)?.filter((d) => names.includes(d));
  return single?.length || 1;
}

/** "13:00–14:00" → 1 hour. */
export function hoursSpan(hours: string): number {
  const m = hours.match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/);
  if (!m) return 1;
  const a = Number(m[1]) + Number(m[2]) / 60;
  const b = Number(m[3]) + Number(m[4]) / 60;
  return b > a ? b - a : b + 24 - a;
}

/** Patrol slots placed on their seed post, matched by location, else by rank. */
export function placePosts(plan: PatrolPlan | undefined, seed: CampusSeed, geo: CampusGeo): PlacedPost[] {
  const slots = plan?.slots ?? [];
  if (!slots.length) return [];
  return slots.map((slot, i) => {
    const post =
      seed.patrol_posts.find((p) => p.location.toLowerCase() === slot.location.toLowerCase()) ??
      seed.patrol_posts[i];
    const geoPoint = post?.geo ?? seed.campus.center;
    return {
      id: post?.slot ?? `P/${String(i + 1).padStart(2, "0")}`,
      slot,
      geo: geoPoint,
      buildingId: buildingAt(geo, geoPoint)?.id ?? null,
      hoursPerWeek: daysCount(slot.days) * hoursSpan(slot.hours),
    };
  });
}

export interface Guard {
  name: string;
  post: GeoPoint;
}

/** On-duty people with a post: the API's site.staff when it has one, else the seed. */
export function guardsOnDuty(staff: CampusStaff[] | undefined, seed: CampusSeed): Guard[] {
  const list = staff?.some((s) => s.post) ? staff : seed.staff;
  return list.filter((s) => s.on_duty && s.post).map((s) => ({ name: s.name, post: s.post as GeoPoint }));
}

export function nearestGuard(guards: Guard[], to: GeoPoint): { guard: Guard; metres: number } | null {
  let best: { guard: Guard; metres: number } | null = null;
  for (const g of guards) {
    const m = metresBetween(g.post, to);
    if (!best || m < best.metres) best = { guard: g, metres: m };
  }
  return best;
}

/** Round to the nearest 10 m for the label ("~40 m"). */
export function roughMetres(m: number): number {
  return Math.max(10, Math.round(m / 10) * 10);
}
