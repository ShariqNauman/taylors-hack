// Pure data helpers for the 3D campus: no React, no deck.gl.
import type {
  Camera,
  Event,
  GeoPoint,
  Level,
  PatrolPlan,
  Site,
} from "@/lib/types";
import { LEVEL_ORDER } from "@/lib/format";

export type LngLat = [number, number];
export type Ring = LngLat[];

export type FeatureKind = "building" | "campus" | "water" | "pitch";

export interface CampusFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: Ring[] };
  properties: {
    id?: string;
    name?: string | null;
    osm_way?: number;
    height_m_estimate?: number;
    kind: FeatureKind;
  };
}

export interface CampusGeoJson {
  type: "FeatureCollection";
  attribution?: string;
  center?: GeoPoint;
  features: CampusFeature[];
}

export interface PatrolPostSeed {
  slot: string;
  location: string;
  days: string;
  hours: string;
  geo: GeoPoint;
}

export interface CampusSeed {
  patrol_posts?: PatrolPostSeed[];
}

export const DEFAULT_BUILDINGS_URL = "/campus/taylors-lakeside-campus.geojson";
export const SEED_URL = "/campus/campus-3d-seed.json";

// ── Geometry ──

const R_EARTH = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial compass bearing from a to b, degrees 0–360. */
export function azimuth(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function pointInRing(p: LngLat, ring: Ring): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      c = !c;
  }
  return c;
}

/** Approximate distance in metres from a point to a ring's edges (local equirectangular). */
function distanceToRing(p: LngLat, ring: Ring): number {
  const kx = 111_320 * Math.cos(rad(p[1]));
  const ky = 110_574;
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const ax = (ring[i][0] - p[0]) * kx;
    const ay = (ring[i][1] - p[1]) * ky;
    const bx = (ring[i + 1][0] - p[0]) * kx;
    const by = (ring[i + 1][1] - p[1]) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

export function ringCentroid(ring: Ring): LngLat {
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];
  const pts = closed ? ring.slice(0, -1) : ring;
  const b = ringsBounds([pts]);
  return [(b.minLng + b.maxLng) / 2, (b.minLat + b.maxLat) / 2];
}

export interface Bounds {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}

export function ringsBounds(rings: Ring[]): Bounds {
  const b: Bounds = {
    minLng: Infinity,
    maxLng: -Infinity,
    minLat: Infinity,
    maxLat: -Infinity,
  };
  for (const r of rings)
    for (const [x, y] of r) {
      b.minLng = Math.min(b.minLng, x);
      b.maxLng = Math.max(b.maxLng, x);
      b.minLat = Math.min(b.minLat, y);
      b.maxLat = Math.max(b.maxLat, y);
    }
  return b;
}

/** Width and height of bounds in metres, and its centre. */
export function boundsSize(b: Bounds) {
  const lat = (b.minLat + b.maxLat) / 2;
  const lng = (b.minLng + b.maxLng) / 2;
  return {
    lat,
    lng,
    ew: (b.maxLng - b.minLng) * 111_320 * Math.cos(rad(lat)),
    ns: (b.maxLat - b.minLat) * 110_574,
  };
}

/**
 * Web Mercator zoom (deck.gl, 512 px tiles) that fits `b` into a w × h box at this bearing (rotation
 * changes which axis runs across the screen). `fill` < 1 leaves a margin.
 */
export function fitZoom(
  b: Bounds,
  w: number,
  h: number,
  bearing: number,
  fill = 0.85,
): number {
  const { lat, ew, ns } = boundsSize(b);
  const t = rad(bearing);
  const across = Math.abs(ew * Math.cos(t)) + Math.abs(ns * Math.sin(t));
  const down = Math.abs(ew * Math.sin(t)) + Math.abs(ns * Math.cos(t));
  const mpp = Math.max(across / (w * fill), down / (h * fill), 0.05);
  return Math.log2((78_271.51696 * Math.cos(rad(lat))) / mpp);
}

// ── Campus model ──

export interface Building {
  id: string;
  /** What we show: the seed's building name when a camera maps here, else the OSM name. */
  name: string;
  height: number;
  ring: Ring;
  centroid: LngLat;
  bounds: Bounds;
}

export type SourceKind = "live" | "recorded" | "black";

/** Black wins; only an explicit `source: "live"` is ever called live. */
export function sourceKind(c: Camera): SourceKind {
  if (c.black_since || !c.online) return "black";
  return c.source === "live" ? "live" : "recorded";
}

/** Which footprint holds this point: inside first, else the nearest edge within `maxM` metres. */
export function buildingAt(
  p: LngLat,
  buildings: Building[],
  maxM = 45,
): Building | null {
  const inside = buildings.find((b) => pointInRing(p, b.ring));
  if (inside) return inside;
  let best: Building | null = null;
  let bestD = maxM;
  for (const b of buildings) {
    const d = distanceToRing(p, b.ring);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

export function buildBuildings(
  geo: CampusGeoJson | undefined,
  cameras: Camera[],
): { buildings: Building[]; cameraBuilding: Record<string, string> } {
  const raw = (geo?.features ?? []).filter(
    (f) => f.properties.kind === "building",
  );
  const buildings: Building[] = raw.map((f, i) => {
    const ring = f.geometry.coordinates[0];
    return {
      id: f.properties.id ?? `b${f.properties.osm_way ?? i}`,
      name: f.properties.name ?? "Building",
      height: f.properties.height_m_estimate ?? 12,
      ring,
      centroid: ringCentroid(ring),
      bounds: ringsBounds([ring]),
    };
  });
  const cameraBuilding: Record<string, string> = {};
  const named = new Set<string>();
  for (const c of cameras) {
    if (!c.geo) continue;
    const b = buildingAt([c.geo.lng, c.geo.lat], buildings);
    if (!b) continue;
    cameraBuilding[c.camera_id] = b.id;
    if (c.geo.building && !named.has(b.id)) {
      b.name = c.geo.building;
      named.add(b.id);
    }
  }
  return { buildings, cameraBuilding };
}

// ── Events ──

const CLOSED = new Set(["dismissed", "resolved", "false_alarm"]);

/** Open incidents: no end_time, not dismissed or resolved. */
export function openEvents(events: Event[]): Event[] {
  return events.filter((e) => !e.end_time && !CLOSED.has(e.status as string));
}

/** The current fight_likely / fight incident: highest level, then priority. */
export function currentAlarm(events: Event[]): Event | null {
  const list = openEvents(events).filter(
    (e) => LEVEL_ORDER[e.level] >= LEVEL_ORDER.fight_likely,
  );
  list.sort(
    (a, b) =>
      LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level] || b.priority - a.priority,
  );
  return list[0] ?? null;
}

/** Latest event for a camera: open ones first, then the newest start_time. */
export function latestEventFor(
  events: Event[],
  cameraId: string,
): Event | null {
  const mine = events.filter((e) => e.camera_id === cameraId);
  if (!mine.length) return null;
  mine.sort((a, b) => {
    const ao = a.end_time ? 0 : 1;
    const bo = b.end_time ? 0 : 1;
    return bo - ao || Date.parse(b.start_time) - Date.parse(a.start_time);
  });
  return mine[0];
}

/** Current level for a camera: its open incident's level, else calm. */
export function cameraLevel(events: Event[], cameraId: string): Level {
  return openEvents(events)
    .filter((e) => e.camera_id === cameraId)
    .reduce<Level>(
      (m, e) => (LEVEL_ORDER[e.level] > LEVEL_ORDER[m] ? e.level : m),
      "calm",
    );
}

// ── Staff ──

export interface Guard {
  name: string;
  post: GeoPoint;
}

export function onDutyGuards(site: Site | undefined): Guard[] {
  return (site?.staff ?? [])
    .filter((s) => s.on_duty && s.post)
    .map((s) => ({ name: s.name, post: s.post as GeoPoint }));
}

export function nearestGuard(
  guards: Guard[],
  to: GeoPoint,
): { guard: Guard; metres: number } | null {
  let best: { guard: Guard; metres: number } | null = null;
  for (const g of guards) {
    const m = haversine(g.post, to);
    if (!best || m < best.metres) best = { guard: g, metres: m };
  }
  return best;
}

/** Round metres to the nearest 10 (minimum 10). */
export function roundTen(m: number): number {
  return Math.max(10, Math.round(m / 10) * 10);
}

// ── Patrol plan ──

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** "Mon–Thu" → 4, "Sun–Thu" → 5, "Fri" → 1, "Mon, Wed" → 2. */
export function countDays(days: string): number {
  const parts = days
    .toLowerCase()
    .split(/,|\/|&| and /)
    .map((p) => p.trim())
    .filter(Boolean);
  let n = 0;
  for (const p of parts) {
    const [a, b] = p
      .split(/\s*[–—-]\s*/)
      .map((s) => DAYS.indexOf(s.trim().slice(0, 3)));
    if (a < 0) continue;
    if (b === undefined || b < 0) n += 1;
    else n += ((b - a + 7) % 7) + 1;
  }
  return n || 1;
}

/** "13:00–14:00" → 1, "22:00–00:30" → 2.5. */
export function countHours(hours: string): number {
  const m = hours.match(/(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/);
  if (!m) return 1;
  const a = +m[1] * 60 + +m[2];
  let b = +m[3] * 60 + +m[4];
  if (b <= a) b += 24 * 60;
  return (b - a) / 60;
}

export interface PlanPost {
  id: string; // "P/01"
  location: string;
  when: string; // "MON–THU 13:00–14:00"
  incidents4w: number;
  avoidedPerWeek: number;
  hoursPerWeek: number;
  rationale: string;
  geo: GeoPoint;
  buildingId: string | null;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** One post per plan slot, placed at the seed's patrol post for that location (else at its camera). */
export function planPosts(
  plan: PatrolPlan | undefined,
  seed: CampusSeed | undefined,
  cameras: Camera[],
  buildings: Building[],
): PlanPost[] {
  if (!plan) return [];
  const seedPosts = seed?.patrol_posts ?? [];
  const out: PlanPost[] = [];
  plan.slots.forEach((s, i) => {
    const sp = seedPosts.find((p) => norm(p.location) === norm(s.location));
    const cam = cameras.find(
      (c) => c.geo && norm(c.location) === norm(s.location),
    );
    const geo =
      sp?.geo ?? (cam?.geo ? { lat: cam.geo.lat, lng: cam.geo.lng } : null);
    if (!geo) return;
    out.push({
      id: `P/${String(i + 1).padStart(2, "0")}`,
      location: s.location,
      when: `${s.days} ${s.hours}`.toUpperCase(),
      incidents4w: s.incidents_4w,
      avoidedPerWeek: s.expected_avoided_per_week,
      hoursPerWeek: countDays(s.days) * countHours(s.hours),
      rationale: s.rationale,
      geo,
      buildingId: buildingAt([geo.lng, geo.lat], buildings)?.id ?? null,
    });
  });
  return out;
}
