// Local metres around the campus centre, polygon helpers, and the ground
// features (roads, car parks, lawns) that the diorama draws from OpenStreetMap.
import type { GeoPoint } from "@/lib/types";
import type { Building, CampusGeoJson, Ring } from "./model";

/** Campus centre, Taylor's University Lakeside Campus (OSM way 210350320). */
export const CENTER: GeoPoint = { lat: 3.0631104, lng: 101.6169899 };
const M_PER_DEG_LAT = 111_320;
const K_LNG = Math.cos((CENTER.lat * Math.PI) / 180);

/** [east, north] metres from the campus centre. */
export type XY = [x: number, y: number];

export function toLocal(lng: number, lat: number): XY {
  return [(lng - CENTER.lng) * M_PER_DEG_LAT * K_LNG, (lat - CENTER.lat) * M_PER_DEG_LAT];
}

export function geoToLocal(p: { lat: number; lng: number }): XY {
  return toLocal(p.lng, p.lat);
}

export function ringToLocal(ring: Ring): XY[] {
  const pts = ring.map(([lng, lat]) => toLocal(lng, lat));
  // Drop the closing duplicate; three.js Shape closes itself.
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.01) pts.pop();
  return pts;
}

export function signedArea(pts: XY[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return a / 2;
}

/** Counter-clockwise order, which three.js Shape and our side-face winding expect. */
export function ccw(pts: XY[]): XY[] {
  return signedArea(pts) < 0 ? [...pts].reverse() : pts;
}

export function centroid(pts: XY[]): XY {
  const a = signedArea(pts);
  if (Math.abs(a) < 1e-6) return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    cx += (pts[j][0] + pts[i][0]) * f;
    cy += (pts[j][1] + pts[i][1]) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function pointInPoly(p: XY, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

export function bounds(pts: XY[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Inset (negative) or outset a polygon by `d` metres along vertex bisectors. Good enough for parapets and kerbs. */
export function offsetPoly(pts: XY[], d: number): XY[] {
  const n = pts.length;
  const out: XY[] = [];
  const sign = signedArea(pts) >= 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const e1 = norm([p1[0] - p0[0], p1[1] - p0[1]]);
    const e2 = norm([p2[0] - p1[0], p2[1] - p1[1]]);
    const n1: XY = [e1[1] * sign, -e1[0] * sign];
    const n2: XY = [e2[1] * sign, -e2[0] * sign];
    const bis: XY = [n1[0] + n2[0], n1[1] + n2[1]];
    const len = Math.hypot(bis[0], bis[1]);
    if (len < 1e-6) {
      out.push([p1[0] + n1[0] * d, p1[1] + n1[1] * d]);
      continue;
    }
    const cosHalf = (bis[0] * n1[0] + bis[1] * n1[1]) / len;
    const k = Math.min(3, 1 / Math.max(0.3, cosHalf));
    out.push([p1[0] + (bis[0] / len) * d * k, p1[1] + (bis[1] / len) * d * k]);
  }
  return out;
}

function norm(v: XY): XY {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}

/** Resample a polyline every `step` metres, returning points and tangent angles. */
export function alongLine(pts: XY[], step: number, phase = 0): { p: XY; angle: number }[] {
  const out: { p: XY; angle: number }[] = [];
  let carry = phase;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-6) continue;
    const angle = Math.atan2(y1 - y0, x1 - x0);
    let t = carry;
    while (t <= len) {
      out.push({ p: [x0 + ((x1 - x0) * t) / len, y0 + ((y1 - y0) * t) / len], angle });
      t += step;
    }
    carry = t - len;
  }
  return out;
}

/** Clip a polyline to a polygon, keeping only the inside parts. */
export function clipLine(pts: XY[], poly: XY[]): XY[][] {
  const parts: XY[][] = [];
  let cur: XY[] = [];
  const steps = 4;
  for (let i = 0; i < pts.length - 1; i++) {
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const p: XY = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
      if (pointInPoly(p, poly)) cur.push(p);
      else if (cur.length) {
        parts.push(cur);
        cur = [];
      }
    }
  }
  const last = pts[pts.length - 1];
  if (last && pointInPoly(last, poly)) cur.push(last);
  if (cur.length > 1) parts.push(cur);
  return parts.filter((p) => p.length > 1);
}

// ── Ground features from /campus/taylors-lakeside-ground.geojson ──

export const GROUND_URL = "/campus/taylors-lakeside-ground.geojson";

export type GroundKind = "road" | "parking_aisle" | "footway" | "parking" | "grass" | "tree_row";

export interface GroundFeature {
  kind: GroundKind;
  name?: string | null;
  highway?: string | null;
  pts: XY[];
  closed: boolean;
}

export interface GroundCollection {
  type: "FeatureCollection";
  attribution?: string;
  features: {
    properties: { kind: GroundKind; name?: string | null; highway?: string | null };
    geometry: { type: "LineString"; coordinates: Ring } | { type: "Polygon"; coordinates: Ring[] };
  }[];
}

export function parseGround(fc: GroundCollection): GroundFeature[] {
  return fc.features.map((f) => {
    const closed = f.geometry.type === "Polygon";
    const ring = f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.coordinates;
    const pts = closed ? ccw(ringToLocal(ring)) : ring.map(([lng, lat]) => toLocal(lng, lat));
    return { kind: f.properties.kind, name: f.properties.name, highway: f.properties.highway, pts, closed };
  });
}

/** Local-metre version of the campus footprints. */
export interface LocalCampus {
  boundary: XY[];
  buildings: { id: string; name: string; height: number; pts: XY[]; center: XY }[];
  water: XY[][];
  pitches: { name: string | null; pts: XY[] }[];
  extent: { minX: number; minY: number; maxX: number; maxY: number };
}

export function localise(geo: CampusGeoJson, buildings: Building[]): LocalCampus {
  const byKind = (k: string) => geo.features.filter((f) => f.properties.kind === k);
  const campusRing = byKind("campus")[0]?.geometry.coordinates[0];
  const boundary = campusRing ? ccw(ringToLocal(campusRing)) : [];
  const blds = buildings.map((b) => {
    const pts = ccw(ringToLocal(b.ring));
    return { id: b.id, name: b.name, height: b.height, pts, center: centroid(pts) };
  });
  const water = byKind("water").map((f) => ccw(ringToLocal(f.geometry.coordinates[0])));
  const pitches = byKind("pitch").map((f) => ({ name: f.properties.name ?? null, pts: ccw(ringToLocal(f.geometry.coordinates[0])) }));
  return { boundary, buildings: blds, water, pitches, extent: bounds(boundary.length ? boundary : blds.flatMap((b) => b.pts)) };
}
