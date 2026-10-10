// The 2D campus map's drawing data, built once from the OpenStreetMap GeoJSON.
// Pure functions, no React and no three.js. Units are local metres around the
// campus centre (campus3d/geo.ts): SVG x = east, SVG y = −north, so north is up.
import type { CampusGeoJson } from "@/components/campus3d/model";
import {
  CENTER,
  alongLine,
  bounds,
  ccw,
  centroid,
  clipLine,
  offsetPoly,
  parseGround,
  pointInPoly,
  ringToLocal,
  type GroundCollection,
  type XY,
} from "@/components/campus3d/geo";

const M_PER_DEG = 111_320;
const K_LNG = Math.cos((CENTER.lat * Math.PI) / 180);

/** Local metres back to lat/lng (inverse of campus3d/geo toLocal). */
export function toGeo(p: XY): { lat: number; lng: number } {
  return { lat: CENTER.lat + p[1] / M_PER_DEG, lng: CENTER.lng + p[0] / (M_PER_DEG * K_LNG) };
}

const f1 = (v: number) => (Math.round(v * 10) / 10).toString();
const pt = (p: XY) => `${f1(p[0])} ${f1(-p[1])}`;
export const ringD = (pts: XY[]) => (pts.length ? `M${pts.map(pt).join("L")}Z` : "");
const lineD = (pts: XY[]) => (pts.length > 1 ? `M${pts.map(pt).join("L")}` : "");

/** Smallest enclosing rectangle over the polygon's edge directions: centre, long-axis angle, sizes. */
export function orientedRect(pts: XY[]): { c: XY; angle: number; long: number; short: number } {
  let best = { area: Infinity, c: [0, 0] as XY, angle: 0, long: 0, short: 0 };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const cs = Math.cos(-ang);
    const sn = Math.sin(-ang);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, y] of pts) {
      const u = x * cs - y * sn;
      const v = x * sn + y * cs;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const du = maxU - minU;
    const dv = maxV - minV;
    if (du * dv < best.area) {
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      // rotate the centre back
      const c: XY = [cu * Math.cos(ang) - cv * Math.sin(ang), cu * Math.sin(ang) + cv * Math.cos(ang)];
      best = du >= dv ? { area: du * dv, c, angle: ang, long: du, short: dv } : { area: du * dv, c, angle: ang + Math.PI / 2, long: dv, short: du };
    }
  }
  return { c: best.c, angle: best.angle, long: best.long, short: best.short };
}

/** A point in a rectangle's frame (u along the long axis, v across) to local metres. */
function rectPt(r: { c: XY; angle: number }, u: number, v: number): XY {
  const cs = Math.cos(r.angle);
  const sn = Math.sin(r.angle);
  return [r.c[0] + u * cs - v * sn, r.c[1] + u * sn + v * cs];
}

/** Deterministic pseudo-random numbers, so trees land in the same place on every render. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

// ── Buildings, per campus3d/reference.md ──

/** Label pill text. Floor counts only where Taylor's facilities page confirms them. */
export const BUILDING_LABEL: Record<string, string> = {
  blockab: "BLOCK A & B · Grand Hall",
  blockc: "BLOCK C · 9 floors",
  blockd: "BLOCK D · 8 floors",
  blocke: "BLOCK E · 9 floors",
  syopz: "SYOPZ MALL · U Residence above",
  sports: "SPORTS CENTRE",
};

/** Floating-roof overhang in metres, as in campus3d/scene.tsx. */
const OVERHANG: Record<string, number> = { blockab: 3.5, blockc: 2.5, blockd: 2.5, blocke: 2.5, syopz: 2, sports: 3 };
/** Vertical white fins on the long faces: Blocks C, D, E (photo). */
const FINS = new Set(["blockc", "blockd", "blocke"]);

export interface Building2D {
  id: string;
  name: string;
  label: string;
  pts: XY[];
  center: XY;
  roof: string; // the floating roof plate, slightly larger than the footprint
  glass: string; // footprint line: the dark glass seen under the roof edge
  fins: string | null;
  tower: { roof: string; glass: string; fin: string } | null; // U Residence on the Syopz podium
}

export interface Base2D {
  extent: { minX: number; minY: number; maxX: number; maxY: number };
  boundary: string;
  grass: string[];
  water: { d: string; lake: boolean }[];
  waves: string;
  stairs: string;
  pitches: { d: string; lines: string; tennis: boolean }[];
  roads: { w: number; d: string; dash: boolean }[];
  footway: string;
  parking: { d: string; angle: number; c: XY }[];
  trees: { x: number; y: number; s: number; v: 0 | 1 }[];
  buildings: Building2D[];
  lakeLabel: XY | null;
}

const roadWidth = (kind: string, highway?: string | null) =>
  kind === "footway" ? 2 : kind === "parking_aisle" ? 4 : highway === "unclassified" ? 6.5 : 5;

export function buildBase(geo: CampusGeoJson, groundFc: GroundCollection | undefined): Base2D {
  const byKind = (k: string) => geo.features.filter((f) => f.properties.kind === k);
  const campusRing = byKind("campus")[0]?.geometry.coordinates[0];
  const boundary = campusRing ? ccw(ringToLocal(campusRing)) : [];
  const ground = groundFc ? parseGround(groundFc) : [];

  const waterPolys = byKind("water").map((f) => ({ pts: ccw(ringToLocal(f.geometry.coordinates[0])), lake: f.properties.name === "Lake" }));
  const blds = byKind("building").map((f, i) => {
    const pts = ccw(ringToLocal(f.geometry.coordinates[0]));
    const id = f.properties.id ?? `b${f.properties.osm_way ?? i}`;
    return { id, name: f.properties.name ?? "", pts, center: centroid(pts) };
  });

  // Buildings
  const buildings: Building2D[] = blds.map((b) => {
    const roof = offsetPoly(b.pts, OVERHANG[b.id] ?? 2);
    let fins: string | null = null;
    if (FINS.has(b.id)) {
      let d = "";
      for (let i = 0; i < b.pts.length; i++) {
        const a = b.pts[i];
        const c = b.pts[(i + 1) % b.pts.length];
        const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (len < 14) continue;
        const ang = Math.atan2(c[1] - a[1], c[0] - a[0]);
        const nx = Math.sin(ang); // outward normal of a CCW polygon: right of the edge
        const ny = -Math.cos(ang);
        for (let k = 1; k < Math.floor(len / 6); k++) {
          const t = (k * 6) / len;
          const p: XY = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
          d += `M${pt([p[0] + nx * 0.4, p[1] + ny * 0.4])}L${pt([p[0] + nx * 2.1, p[1] + ny * 2.1])}`;
        }
      }
      fins = d || null;
    }
    let tower: Building2D["tower"] = null;
    if (b.id === "syopz") {
      // Same rectangle as the tower in campus3d/scene.tsx (north half of the podium).
      const bx = bounds(b.pts);
      const tw = { minX: bx.minX + 5, maxX: bx.maxX - 5, minY: bx.maxY - 62, maxY: bx.maxY - 6 };
      const rect: XY[] = [[tw.minX, tw.minY], [tw.maxX, tw.minY], [tw.maxX, tw.maxY], [tw.minX, tw.maxY]];
      const fx = tw.maxX + 0.9;
      const fy = tw.minY + 8;
      tower = {
        roof: ringD(offsetPoly(rect, 1.2)),
        glass: ringD(rect),
        // The red fin wall on the lake side, south end of the tower (photo).
        fin: ringD([[fx - 0.7, fy - 4.5], [fx + 0.7, fy - 4.5], [fx + 0.7, fy + 4.5], [fx - 0.7, fy + 4.5]]),
      };
    }
    return { id: b.id, name: b.name, label: BUILDING_LABEL[b.id] ?? b.name.toUpperCase(), pts: b.pts, center: b.center, roof: ringD(roof), glass: ringD(b.pts), fins, tower };
  });

  // Roads, aisles and footway, clipped to the campus, merged into one path per width.
  const roadsByW = new Map<number, { d: string; dash: boolean }>();
  const roadSamples: { p: XY; r: number }[] = [];
  let footway = "";
  for (const f of ground) {
    if (f.closed) continue;
    const w = roadWidth(f.kind, f.highway);
    for (const part of clipLine(f.pts, boundary)) {
      if (f.kind === "footway") footway += lineD(part);
      else {
        const cur = roadsByW.get(w) ?? { d: "", dash: w >= 5 };
        cur.d += lineD(part);
        roadsByW.set(w, cur);
      }
      for (const { p } of alongLine(part, 3)) roadSamples.push({ p, r: w / 2 + 2.5 });
    }
  }
  const roads = [...roadsByW.entries()].sort((a, b) => a[0] - b[0]).map(([w, v]) => ({ w, ...v }));

  // Car parks: the bay stripes run across the long axis of each car park.
  const parking = ground
    .filter((f) => f.kind === "parking" && f.closed)
    .map((f) => {
      const r = orientedRect(f.pts);
      return { d: ringD(f.pts), angle: (-r.angle * 180) / Math.PI, c: r.c };
    });

  const grassPolys = ground.filter((f) => f.kind === "grass" && f.closed).map((f) => f.pts);

  // Pitches with white line markings.
  const pitches = byKind("pitch").map((f) => {
    const pts = ccw(ringToLocal(f.geometry.coordinates[0]));
    const tennis = /tennis/i.test(f.properties.name ?? "");
    const r = orientedRect(pts);
    const L = r.long / 2 - 0.6;
    const S = r.short / 2 - 0.6;
    const seg = (u0: number, v0: number, u1: number, v1: number) => `M${pt(rectPt(r, u0, v0))}L${pt(rectPt(r, u1, v1))}`;
    let lines = `M${[rectPt(r, -L, -S), rectPt(r, L, -S), rectPt(r, L, S), rectPt(r, -L, S)].map(pt).join("L")}Z`;
    if (tennis) {
      // One doubles court (23.77 × 10.97 m), scaled to the footprint.
      const k = Math.min(1, (2 * L) / 23.77);
      const single = Math.max(0, S - 1.37 * k);
      const svc = 6.4 * k;
      lines += seg(0, -S, 0, S); // net
      lines += seg(-L, -single, L, -single) + seg(-L, single, L, single);
      lines += seg(-svc, -single, -svc, single) + seg(svc, -single, svc, single);
      lines += seg(-svc, 0, svc, 0);
    } else {
      // Football: halfway line and centre circle, scaled to this small pitch.
      lines += seg(0, -S, 0, S);
      const cr = Math.min(9.15, S * 0.45);
      const c = rectPt(r, 0, 0);
      lines += `M${f1(c[0] + cr)} ${f1(-c[1])}a${f1(cr)} ${f1(cr)} 0 1 0 ${f1(-2 * cr)} 0a${f1(cr)} ${f1(cr)} 0 1 0 ${f1(2 * cr)} 0`;
      const box = Math.min(5, L * 0.22);
      const bw = S * 0.55;
      lines += `M${pt(rectPt(r, -L, -bw))}L${pt(rectPt(r, -L + box, -bw))}L${pt(rectPt(r, -L + box, bw))}L${pt(rectPt(r, -L, bw))}`;
      lines += `M${pt(rectPt(r, L, -bw))}L${pt(rectPt(r, L - box, -bw))}L${pt(rectPt(r, L - box, bw))}L${pt(rectPt(r, L, bw))}`;
    }
    return { d: ringD(pts), lines, tennis };
  });

  // Lake: faint wave lines along its long axis, and the stepped lake stair at its north end.
  const lake = waterPolys.find((w) => w.lake)?.pts ?? waterPolys[0]?.pts;
  let waves = "";
  let stairs = "";
  let lakeLabel: XY | null = null;
  if (lake) {
    const r = orientedRect(lake);
    lakeLabel = r.c;
    for (const [u, v] of [[-0.28, 0.18], [0.05, -0.2], [0.3, 0.15]] as const) {
      const c = rectPt(r, u * r.long, v * r.short);
      if (!pointInPoly(c, lake)) continue;
      const [x, y] = [c[0], -c[1]];
      waves += `M${f1(x - 8)} ${f1(y)}q2 -1.6 4 0t4 0t4 0t4 0`;
    }
    const bx = bounds(lake);
    const top = lake.filter((p) => p[1] > bx.maxY - 6);
    if (top.length >= 2) {
      const xs = top.map((p) => p[0]);
      const x0 = Math.min(...xs) + 2;
      const x1 = Math.max(...xs) - 2;
      for (let i = 0; i < 4; i++) {
        const y = bx.maxY + 1.1 + i * 2.2;
        stairs += `M${pt([x0, y])}L${pt([x1, y])}`;
      }
    }
  }

  // Trees: on the lawns and along the lake shore, never on a road, a building or the water.
  const inBuilding = (p: XY) => blds.some((b) => pointInPoly(p, offsetPoly(b.pts, 4)));
  const inWater = (p: XY) => waterPolys.some((w) => pointInPoly(p, offsetPoly(w.pts, 2)));
  const nearRoad = (p: XY) => roadSamples.some((s) => Math.hypot(s.p[0] - p[0], s.p[1] - p[1]) < s.r);
  const inPitch = (p: XY) => pitches.length > 0 && byKind("pitch").some((f) => pointInPoly(p, offsetPoly(ccw(ringToLocal(f.geometry.coordinates[0])), 2)));
  const free = (p: XY) => (boundary.length === 0 || pointInPoly(p, boundary)) && !inBuilding(p) && !inWater(p) && !nearRoad(p) && !inPitch(p);
  const rnd = rng(11);
  const trees: Base2D["trees"] = [];
  const put = (p: XY, s: number) => {
    if (!free(p)) return;
    if (trees.some((t) => Math.hypot(t.x - p[0], t.y - p[1]) < 5)) return;
    trees.push({ x: p[0], y: p[1], s, v: rnd() < 0.55 ? 0 : 1 });
  };
  for (const g of grassPolys) {
    const bx = bounds(g);
    const step = 12;
    for (let y = bx.minY + step / 2; y < bx.maxY; y += step)
      for (let x = bx.minX + step / 2; x < bx.maxX; x += step) {
        const p: XY = [x + (rnd() - 0.5) * 7, y + (rnd() - 0.5) * 7];
        if (pointInPoly(p, offsetPoly(g, -1.5)) && rnd() < 0.7) put(p, 0.8 + rnd() * 0.5);
      }
  }
  for (const w of waterPolys) {
    const ring = offsetPoly(w.pts, w.lake ? 6.5 : 5);
    for (const { p } of alongLine([...ring, ring[0]], w.lake ? 10 : 9, 3)) put(p, 0.9 + rnd() * 0.4);
  }

  return {
    extent: bounds(boundary.length ? boundary : blds.flatMap((b) => b.pts)),
    boundary: ringD(boundary),
    grass: grassPolys.map(ringD),
    water: waterPolys.map((w) => ({ d: ringD(w.pts), lake: w.lake })),
    waves,
    stairs,
    pitches,
    roads,
    footway,
    parking,
    trees,
    buildings,
    lakeLabel,
  };
}

/** Which building footprint holds a point (local metres). */
export function buildingAtPoint(base: Base2D, p: XY): Building2D | null {
  return base.buildings.find((b) => pointInPoly(p, b.pts)) ?? null;
}

/** A view cone as an SVG path: apex at the camera, `half` degrees each side of the compass heading. */
export function conePath(at: XY, headingDeg: number, range = 30, half = 32): string {
  const a0 = ((headingDeg - half) * Math.PI) / 180;
  const a1 = ((headingDeg + half) * Math.PI) / 180;
  const p0: XY = [at[0] + Math.sin(a0) * range, at[1] + Math.cos(a0) * range];
  const p1: XY = [at[0] + Math.sin(a1) * range, at[1] + Math.cos(a1) * range];
  return `M${pt(at)}L${pt(p0)}A${range} ${range} 0 0 1 ${pt(p1)}Z`;
}
