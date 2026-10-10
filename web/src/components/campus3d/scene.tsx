"use client";

// The diorama: a floating slab cut along the real campus boundary, buildings
// built in code from the OpenStreetMap footprints (floor bands, ribbon
// windows, floating roofs, fins), the recessed lake, pitches, roads, car
// parks with cars, trees and lamp posts. Nothing is drawn outside the boundary.
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Edges, Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { alongLine, bounds, clipLine, offsetPoly, pointInPoly, type GroundFeature, type LocalCampus, type XY } from "./geo";

// ── Palette: muted, so the UI's red alarm and blue posts stay the loudest colours ──
export const M = {
  lawn: "#B9CFA3",
  lawnDark: "#A8C193",
  soil: "#C8A98B",
  paving: "#E4E1D8",
  road: "#B4B2AC",
  roadDash: "#F0EEE8",
  parking: "#C6C4BE",
  bay: "#E6E4DE",
  water: "#CBDDEA",
  shore: "#E8E2D2",
  pitchGrass: "#A6C98E",
  pitchLine: "#F4F6F2",
  court: "#B8C6A4",
  wall: "#F1F0EC",
  band: "#FAFAF8",
  glass: "#6E7A88",
  glassDark: "#505A66",
  roof: "#F6F6F3",
  roofEdge: "#E3E3DD",
  column: "#E2E2DC",
  fin: "#EFEFEA",
  plant: "#DCDCD6",
  red: "#B5473F",
  trunk: "#8B6B4E",
  canopy: ["#8FB577", "#7FA86A", "#9CBF84", "#86AC6E"],
  lamp: "#D9D9D3",
  car: ["#C9CED6", "#9AA3AE", "#D8D3C6", "#8E9BA8", "#B9BEC4", "#C7B9A8"],
  selectedTint: "#DCE3FA",
  alarmTint: "#F6CFCB",
  alarmLine: "#C8241B",
  routeBlue: "#2742D9",
  column3d: "#3653DC",
} as const;

export const FLOOR_H = 4;

/** Per-building design, from reference.md. Unknown ids fall back to the seed height. */
const SPEC: Record<string, { floors: number; floorH?: number; style: "ribbon" | "podium" | "hall"; fins?: boolean; overhang?: number; plant?: boolean; tower?: { floors: number; floorH: number } }> = {
  blockab: { floors: 5, style: "ribbon", overhang: 3.5, plant: true },
  blockc: { floors: 9, style: "ribbon", fins: true, overhang: 2.5, plant: true },
  blockd: { floors: 8, style: "ribbon", fins: true, overhang: 2.5, plant: true },
  blocke: { floors: 9, style: "ribbon", fins: true, overhang: 2.5, plant: true },
  syopz: { floors: 3, style: "podium", overhang: 2, tower: { floors: 6, floorH: 3.2 } },
  sports: { floors: 2, floorH: 5, style: "hall", overhang: 3 },
};

/** Building heights the overlays use (pin/label anchors). */
export function buildingHeight(id: string, fallback: number): number {
  const s = SPEC[id];
  if (!s) return fallback;
  const base = s.floors * (s.floorH ?? FLOOR_H);
  return s.tower ? base + s.tower.floors * s.tower.floorH : base;
}

// ── Geometry helpers (local metres: x east, y north → world x, −z; height → world y) ──

export const toWorld = (p: XY, h = 0): [number, number, number] => [p[0], h, -p[1]];

function shapeOf(pts: XY[], holes: XY[][] = []): THREE.Shape {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  return s;
}

/** Extrude a footprint upward from y0 by `h` metres. */
function slab(pts: XY[], h: number, y0 = 0, opts: Partial<THREE.ExtrudeGeometryOptions> = {}, holes: XY[][] = []): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shapeOf(pts, holes), { depth: h, bevelEnabled: false, ...opts });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

function flat(pts: XY[], y: number, holes: XY[][] = []): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(shapeOf(pts, holes));
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

function box(w: number, h: number, d: number, at: [number, number, number], rotY = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateY(rotY);
  g.translate(at[0], at[1], at[2]);
  return g;
}

/** Merge geometries of mixed kinds (extrusions are non-indexed, boxes and cylinders are indexed). */
function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  const ok = list.filter(Boolean).map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    for (const name of Object.keys(n.attributes)) if (name !== "position" && name !== "normal") n.deleteAttribute(name);
    return n;
  });
  if (!ok.length) return null;
  const out = mergeGeometries(ok, false);
  ok.forEach((g) => g.dispose());
  return out;
}

/** A ribbon of quads along a polyline, `w` metres wide, at height y. */
function ribbon(pts: XY[], w: number, y: number): THREE.BufferGeometry | null {
  if (pts.length < 2) return null;
  const pos: number[] = [];
  const idx: number[] = [];
  const half = w / 2;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l;
    pos.push(p[0] + nx * half, y, -(p[1] + ny * half), p[0] - nx * half, y, -(p[1] - ny * half));
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ── Building generator ──

export interface BuiltBuilding {
  id: string;
  name: string;
  center: XY;
  height: number;
  pts: XY[];
  body: THREE.BufferGeometry; // glass band volume: the pick target
  bands: THREE.BufferGeometry | null; // white floor bands + parapet
  roof: THREE.BufferGeometry | null; // floating roof slab + columns
  fins: THREE.BufferGeometry | null;
  extras: { geometry: THREE.BufferGeometry; colour: string }[];
}

function buildBuilding(b: LocalCampus["buildings"][number]): BuiltBuilding {
  const spec = SPEC[b.id] ?? { floors: Math.max(1, Math.round(b.height / FLOOR_H)), style: "ribbon" as const, overhang: 2 };
  const fh = spec.floorH ?? FLOOR_H;
  const H = spec.floors * fh;
  const inner = offsetPoly(b.pts, -0.35);
  const outer = offsetPoly(b.pts, 0.2);
  const extras: { geometry: THREE.BufferGeometry; colour: string }[] = [];

  // Body: the glass/wall volume. Ribbon style reads as dark glass between the white bands.
  const body = slab(inner, H, 0.05);

  // Floor bands and parapet.
  const bandParts: THREE.BufferGeometry[] = [];
  if (spec.style !== "hall") {
    for (let i = 0; i <= spec.floors; i++) bandParts.push(slab(outer, i === spec.floors ? 1.1 : 0.55, i * fh));
  } else {
    bandParts.push(slab(outer, H * 0.72, 0.05)); // mostly solid wall with a glass strip under the roof
    bandParts.push(slab(outer, 0.8, H - 0.8));
  }
  // Apron: a paved plinth around the footprint.
  extras.push({ geometry: slab(offsetPoly(b.pts, 3), 0.12, 0), colour: M.paving });

  // Floating roof: a flat slab above the parapet on slim columns.
  const over = spec.overhang ?? 2;
  const roofY = H + 1.5;
  const roofParts: THREE.BufferGeometry[] = [slab(offsetPoly(b.pts, over), 0.6, roofY)];
  const colPts = offsetPoly(b.pts, -1.2);
  for (const p of colPts) {
    const c = new THREE.CylinderGeometry(0.28, 0.28, 1.6, 8);
    c.translate(p[0], H + 0.8, -p[1]);
    roofParts.push(c);
  }
  // Plant room on the roof.
  if (spec.plant) {
    const bx = bounds(b.pts);
    const c = b.center;
    const w = Math.min(10, (bx.maxX - bx.minX) * 0.35);
    const d = Math.min(7, (bx.maxY - bx.minY) * 0.3);
    extras.push({ geometry: box(w, 2.6, d, [c[0], roofY + 0.6 + 1.3, -c[1]]), colour: M.plant });
  }

  // Vertical fins on the long faces (Blocks C, D, E in the photo).
  let fins: THREE.BufferGeometry | null = null;
  if (spec.fins) {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < b.pts.length; i++) {
      const a = b.pts[i];
      const c = b.pts[(i + 1) % b.pts.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      if (len < 14) continue;
      const ang = Math.atan2(c[1] - a[1], c[0] - a[0]);
      const nx = -Math.sin(ang) * -1; // outward for a CCW polygon is to the right of the edge
      const ny = Math.cos(ang) * -1;
      const n = Math.floor(len / 6);
      for (let k = 1; k < n; k++) {
        const t = (k * 6) / len;
        const x = a[0] + (c[0] - a[0]) * t + nx * 0.75;
        const y = a[1] + (c[1] - a[1]) * t + ny * 0.75;
        parts.push(box(1.1, H - 1, 0.3, [x, H / 2 + 0.5, -y], -ang));
      }
    }
    fins = merge(parts);
  }

  // Syopz podium + U Residence tower + the red fin wall on the lake side.
  if (spec.tower) {
    const bx = bounds(b.pts);
    const tw = { minX: bx.minX + 5, maxX: bx.maxX - 5, minY: bx.maxY - 62, maxY: bx.maxY - 6 };
    const towerPts: XY[] = [
      [tw.minX, tw.minY],
      [tw.maxX, tw.minY],
      [tw.maxX, tw.maxY],
      [tw.minX, tw.maxY],
    ];
    const th = spec.tower.floors * spec.tower.floorH;
    extras.push({ geometry: slab(offsetPoly(towerPts, -0.3), th, H + 0.6), colour: M.glass });
    const tb: THREE.BufferGeometry[] = [];
    for (let i = 0; i <= spec.tower.floors; i++) tb.push(slab(towerPts, i === spec.tower.floors ? 1.0 : 0.5, H + 0.6 + i * spec.tower.floorH));
    const tbands = merge(tb);
    if (tbands) extras.push({ geometry: tbands, colour: M.band });
    extras.push({ geometry: slab(offsetPoly(towerPts, 1.2), 0.5, H + 0.6 + th + 0.9), colour: M.roof });
    // Red fin: tall thin wall on the east (lake-side) face, south end of the tower.
    extras.push({ geometry: box(1.4, th + 6, 9, [tw.maxX + 0.9, H + (th + 6) / 2 - 1, -(tw.minY + 8)]), colour: M.red });
    // Dark shopfront band at ground level.
    extras.push({ geometry: slab(offsetPoly(b.pts, 0.25), 3.2, 0.3), colour: M.glassDark });
  }

  return {
    id: b.id,
    name: b.name,
    center: b.center,
    height: spec.tower ? H + 0.6 + spec.tower.floors * spec.tower.floorH : H,
    pts: b.pts,
    body,
    bands: merge(bandParts),
    roof: merge(roofParts),
    fins,
    extras,
  };
}

// ── Ground, lake, pitches, roads, parking ──

interface GroundBuild {
  base: THREE.BufferGeometry; // slab with lake holes
  water: THREE.BufferGeometry | null;
  shore: THREE.BufferGeometry | null;
  pitches: { fill: THREE.BufferGeometry; lines: Float32Array; colour: string }[];
  roads: THREE.BufferGeometry | null;
  footways: THREE.BufferGeometry | null;
  dashes: THREE.Matrix4[];
  parking: THREE.BufferGeometry | null;
  bays: THREE.Matrix4[];
  cars: { m: THREE.Matrix4; colour: string }[];
  trees: { m: THREE.Matrix4; colour: string }[];
  lamps: THREE.Matrix4[];
  stairs: THREE.BufferGeometry | null;
}

const BASE_DEPTH = 10;

function buildGround(campus: LocalCampus, ground: GroundFeature[]): GroundBuild {
  const boundary = campus.boundary;
  const inside = (p: XY) => pointInPoly(p, boundary);
  const inBuilding = (p: XY) => campus.buildings.some((b) => pointInPoly(p, offsetPoly(b.pts, 4)));
  const inWater = (p: XY) => campus.water.some((w) => pointInPoly(p, offsetPoly(w, 2)));
  const free = (p: XY) => inside(p) && !inBuilding(p) && !inWater(p);

  // Floating base with the lake cut out of it; soft bevel on the top edge.
  const base = new THREE.ExtrudeGeometry(shapeOf(boundary, campus.water), {
    depth: BASE_DEPTH,
    bevelEnabled: true,
    bevelThickness: 1.4,
    bevelSize: 1.4,
    bevelSegments: 3,
  });
  base.rotateX(-Math.PI / 2);
  base.translate(0, -(BASE_DEPTH + 1.4), 0);

  const water = merge(campus.water.map((w) => flat(w, -1.0)));
  const shore = merge(campus.water.map((w) => flat(offsetPoly(w, 2.6), 0.03, [w])));

  // Pitches with line markings.
  const pitches = campus.pitches.map((p) => {
    const tennis = /tennis/i.test(p.name ?? "");
    const bx = bounds(p.pts);
    const y = 0.08;
    const cx = (bx.minX + bx.maxX) / 2;
    const cy = (bx.minY + bx.maxY) / 2;
    const long = bx.maxY - bx.minY >= bx.maxX - bx.minX; // long axis north-south?
    const seg: number[] = [];
    const L = (a: XY, b: XY) => seg.push(a[0], y, -a[1], b[0], y, -b[1]);
    const r: XY[] = [
      [bx.minX + 1, bx.minY + 1],
      [bx.maxX - 1, bx.minY + 1],
      [bx.maxX - 1, bx.maxY - 1],
      [bx.minX + 1, bx.maxY - 1],
    ];
    for (let i = 0; i < 4; i++) L(r[i], r[(i + 1) % 4]);
    if (long) L([bx.minX + 1, cy], [bx.maxX - 1, cy]);
    else L([cx, bx.minY + 1], [cx, bx.maxY - 1]);
    if (tennis) {
      // service lines
      if (long) {
        L([bx.minX + 1, cy + 6.4], [bx.maxX - 1, cy + 6.4]);
        L([bx.minX + 1, cy - 6.4], [bx.maxX - 1, cy - 6.4]);
      } else {
        L([cx + 6.4, bx.minY + 1], [cx + 6.4, bx.maxY - 1]);
        L([cx - 6.4, bx.minY + 1], [cx - 6.4, bx.maxY - 1]);
      }
    } else {
      // centre circle
      const n = 24;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        L([cx + Math.cos(a0) * 6, cy + Math.sin(a0) * 6], [cx + Math.cos(a1) * 6, cy + Math.sin(a1) * 6]);
      }
    }
    return { fill: flat(p.pts, 0.05), lines: new Float32Array(seg), colour: tennis ? M.court : M.pitchGrass };
  });

  // Roads, aisles and footways clipped to the boundary.
  const roadParts: THREE.BufferGeometry[] = [];
  const footParts: THREE.BufferGeometry[] = [];
  const dashes: THREE.Matrix4[] = [];
  const lamps: THREE.Matrix4[] = [];
  const treeList: { m: THREE.Matrix4; colour: string }[] = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const placeTree = (p: XY, scale = 1) => {
    if (!free(p)) return;
    const s = scale * (0.8 + rnd() * 0.5);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(p[0], 0, -p[1]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI), new THREE.Vector3(s, s, s));
    treeList.push({ m, colour: M.canopy[Math.floor(rnd() * M.canopy.length)] });
  };
  for (const f of ground) {
    if (f.closed) continue;
    const w = f.kind === "footway" ? 2 : f.kind === "parking_aisle" ? 4 : f.highway === "unclassified" ? 6.5 : 5;
    for (const part of clipLine(f.pts, boundary)) {
      const g = ribbon(part, w, 0.1);
      if (!g) continue;
      (f.kind === "footway" ? footParts : roadParts).push(g);
      if (w >= 5) {
        for (const { p, angle } of alongLine(part, 7, 3)) {
          dashes.push(new THREE.Matrix4().compose(new THREE.Vector3(p[0], 0.16, -p[1]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle), new THREE.Vector3(1, 1, 1)));
        }
        for (const { p, angle } of alongLine(part, 34, 12)) {
          const nx = -Math.sin(angle);
          const ny = Math.cos(angle);
          const q: XY = [p[0] + nx * (w / 2 + 1.2), p[1] + ny * (w / 2 + 1.2)];
          if (free(q)) lamps.push(new THREE.Matrix4().makeTranslation(q[0], 0, -q[1]));
        }
        for (const { p, angle } of alongLine(part, 21, 5)) {
          const nx = -Math.sin(angle);
          const ny = Math.cos(angle);
          placeTree([p[0] - nx * (w / 2 + 4), p[1] - ny * (w / 2 + 4)], 0.9);
          if (rnd() > 0.5) placeTree([p[0] + nx * (w / 2 + 4.5), p[1] + ny * (w / 2 + 4.5)], 0.9);
        }
      }
    }
  }
  // Trees around the lake shore.
  for (const w of campus.water) {
    const ring = offsetPoly(w, 7);
    for (const { p } of alongLine([...ring, ring[0]], 11, 2)) placeTree(p, 1.1);
  }
  // A few trees scattered on the lawns.
  const ex = campus.extent;
  for (let i = 0; i < 260; i++) {
    const p: XY = [ex.minX + rnd() * (ex.maxX - ex.minX), ex.minY + rnd() * (ex.maxY - ex.minY)];
    if (free(p) && !ground.some((f) => !f.closed && f.pts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 9))) placeTree(p, 1);
  }

  // Car parks: slab, bay lines and cars.
  const parkingParts: THREE.BufferGeometry[] = [];
  const bays: THREE.Matrix4[] = [];
  const cars: { m: THREE.Matrix4; colour: string }[] = [];
  for (const f of ground) {
    if (f.kind !== "parking") continue;
    const pts = f.pts.filter(inside);
    if (pts.length < 3) continue;
    parkingParts.push(flat(f.pts, 0.12));
    const bx = bounds(f.pts);
    const rowGap = 12;
    for (let y = bx.minY + 4; y < bx.maxY - 4; y += rowGap) {
      for (let x = bx.minX + 2; x < bx.maxX - 2; x += 2.7) {
        const p: XY = [x, y];
        if (!pointInPoly(p, offsetPoly(f.pts, -2)) || !inside(p)) continue;
        bays.push(new THREE.Matrix4().makeTranslation(x - 1.35, 0.17, -y));
        if (rnd() < 0.62) {
          const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0.17, -y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() < 0.5 ? 0 : Math.PI), new THREE.Vector3(1, 1, 1));
          cars.push({ m, colour: M.car[Math.floor(rnd() * M.car.length)] });
        }
      }
    }
  }

  // Lake stair at the north end of the lake (site plan): stepped terraces down to the water.
  let stairs: THREE.BufferGeometry | null = null;
  if (campus.water.length) {
    const lake = campus.water.reduce((a, b) => (bounds(a).maxY > bounds(b).maxY ? a : b));
    const bx = bounds(lake);
    const top = lake.filter((p) => p[1] > bx.maxY - 6);
    if (top.length >= 2) {
      const xs = top.map((p) => p[0]);
      const x0 = Math.min(...xs) + 2;
      const x1 = Math.max(...xs) - 2;
      const y0 = bx.maxY;
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 4; i++) parts.push(box(x1 - x0, 0.45, 2.2, [(x0 + x1) / 2, 0.22 + i * 0.45, -(y0 + 1.1 + i * 2.2)]));
      stairs = merge(parts);
    }
  }

  return {
    base,
    water,
    shore,
    pitches,
    roads: merge(roadParts),
    footways: merge(footParts),
    dashes,
    parking: merge(parkingParts),
    bays,
    cars,
    trees: treeList,
    lamps,
    stairs,
  };
}

// ── Components ──

function Instanced({ geometry, matrices, colour, colours, castShadow = false }: { geometry: THREE.BufferGeometry; matrices: THREE.Matrix4[]; colour?: string; colours?: string[]; castShadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    if (colours) {
      const c = new THREE.Color();
      colours.forEach((hex, i) => mesh.setColorAt(i, c.set(hex)));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices, colours]);
  if (!matrices.length) return null;
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, matrices.length]} castShadow={castShadow} receiveShadow frustumCulled={false}>
      <meshStandardMaterial color={colours ? "#ffffff" : colour} roughness={0.95} metalness={0} />
    </instancedMesh>
  );
}

const TREE_GEOM = (() => {
  const trunk = new THREE.CylinderGeometry(0.22, 0.3, 2.4, 6);
  trunk.translate(0, 1.2, 0);
  return trunk;
})();
const CANOPY_GEOM = (() => {
  const g = new THREE.IcosahedronGeometry(2.4, 1);
  g.scale(1, 1.15, 1);
  g.translate(0, 4.2, 0);
  return g;
})();
const LAMP_GEOM = (() => {
  const post = new THREE.CylinderGeometry(0.08, 0.11, 5.5, 6);
  post.translate(0, 2.75, 0);
  const head = new THREE.BoxGeometry(0.7, 0.3, 0.4);
  head.translate(0.2, 5.5, 0);
  return merge([post, head]) as THREE.BufferGeometry;
})();
const CAR_GEOM = (() => {
  const body = new THREE.BoxGeometry(1.8, 0.7, 4.2);
  body.translate(0, 0.5, 0);
  const cabin = new THREE.BoxGeometry(1.6, 0.6, 2.2);
  cabin.translate(0, 1.1, -0.2);
  return merge([body, cabin]) as THREE.BufferGeometry;
})();
const DASH_GEOM = (() => {
  const g = new THREE.BoxGeometry(2.2, 0.06, 0.25);
  return g;
})();
const BAY_GEOM = (() => new THREE.BoxGeometry(0.14, 0.05, 5))();

export interface SceneProps {
  campus: LocalCampus;
  ground: GroundFeature[];
  selectedBuildingId: string | null;
  alarmBuildingId: string | null;
  pulse: boolean; // animate the alarm outline
  compact: boolean;
  onPickBuilding?: (id: string) => void;
  /** Receives the building pick meshes so pins can be occluded by them. */
  registerOccluders?: (meshes: THREE.Object3D[]) => void;
  route?: [XY, number, XY, number] | null; // guard → camera, with heights
  columns?: { at: XY; base: number; height: number; count: number; selected: boolean; id: string; onPick: () => void }[];
}

export function CampusScene({ campus, ground, selectedBuildingId, alarmBuildingId, pulse, compact, onPickBuilding, registerOccluders, route, columns }: SceneProps) {
  const built = useMemo(() => campus.buildings.map(buildBuilding), [campus]);
  const g = useMemo(() => buildGround(campus, ground), [campus, ground]);
  const bodyRefs = useRef<Map<string, THREE.Mesh>>(new Map());
  useEffect(() => {
    registerOccluders?.([...bodyRefs.current.values()]);
  }, [built, registerOccluders]);
  useEffect(
    () => () => {
      built.forEach((b) => {
        b.body.dispose();
        b.bands?.dispose();
        b.roof?.dispose();
        b.fins?.dispose();
        b.extras.forEach((e) => e.geometry.dispose());
      });
    },
    [built],
  );

  const ex = campus.extent;
  const cx = (ex.minX + ex.maxX) / 2;
  const cz = -(ex.minY + ex.maxY) / 2;
  const span = Math.max(ex.maxX - ex.minX, ex.maxY - ex.minY);

  return (
    <group>
      {/* Lighting: one warm key with soft shadows, a hemisphere fill. */}
      <hemisphereLight args={["#EAF1FA", "#CDBFA6", 0.95]} />
      <directionalLight
        position={[cx + 260, 420, cz + 200]}
        target-position={[cx, 0, cz]}
        intensity={1.9}
        color="#FFF4E4"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.6}
        shadow-camera-left={-span * 0.62}
        shadow-camera-right={span * 0.62}
        shadow-camera-top={span * 0.62}
        shadow-camera-bottom={-span * 0.62}
        shadow-camera-near={10}
        shadow-camera-far={1400}
      />

      {/* Floating base: lawn on top, soil sides, lake cut through it. */}
      <mesh geometry={g.base} receiveShadow castShadow>
        <meshStandardMaterial attach="material-0" color={M.lawn} roughness={1} />
        <meshStandardMaterial attach="material-1" color={M.soil} roughness={1} />
      </mesh>
      <ContactShadow cx={cx} cz={cz} span={span} />

      {g.water && (
        <mesh geometry={g.water} receiveShadow>
          <meshStandardMaterial color={M.water} roughness={0.35} metalness={0.05} />
        </mesh>
      )}
      {g.shore && (
        <mesh geometry={g.shore} receiveShadow>
          <meshStandardMaterial color={M.shore} roughness={1} />
        </mesh>
      )}
      {g.stairs && (
        <mesh geometry={g.stairs} castShadow receiveShadow>
          <meshStandardMaterial color={M.paving} roughness={1} />
        </mesh>
      )}
      {g.pitches.map((p, i) => (
        <group key={i}>
          <mesh geometry={p.fill} receiveShadow>
            <meshStandardMaterial color={p.colour} roughness={1} />
          </mesh>
          <lineSegments>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[p.lines, 3]} />
            </bufferGeometry>
            <lineBasicMaterial color={M.pitchLine} />
          </lineSegments>
        </group>
      ))}
      {g.roads && (
        <mesh geometry={g.roads} receiveShadow>
          <meshStandardMaterial color={M.road} roughness={1} />
        </mesh>
      )}
      {g.footways && (
        <mesh geometry={g.footways} receiveShadow>
          <meshStandardMaterial color={M.paving} roughness={1} />
        </mesh>
      )}
      {g.parking && (
        <mesh geometry={g.parking} receiveShadow>
          <meshStandardMaterial color={M.parking} roughness={1} />
        </mesh>
      )}
      <Instanced geometry={DASH_GEOM} matrices={g.dashes} colour={M.roadDash} />
      <Instanced geometry={BAY_GEOM} matrices={g.bays} colour={M.bay} />
      <Instanced geometry={CAR_GEOM} matrices={g.cars.map((c) => c.m)} colours={g.cars.map((c) => c.colour)} castShadow />
      {!compact && <Instanced geometry={LAMP_GEOM} matrices={g.lamps} colour={M.lamp} />}
      <Instanced geometry={TREE_GEOM} matrices={g.trees.map((t) => t.m)} colour={M.trunk} />
      <Instanced geometry={CANOPY_GEOM} matrices={g.trees.map((t) => t.m)} colours={g.trees.map((t) => t.colour)} castShadow />

      {/* Buildings */}
      {built.map((b) => {
        const alarm = b.id === alarmBuildingId;
        const sel = b.id === selectedBuildingId;
        const bandColour = alarm ? M.alarmTint : sel ? M.selectedTint : M.band;
        return (
          <group key={b.id}>
            <mesh
              geometry={b.body}
              castShadow
              receiveShadow
              ref={(m) => {
                if (m) bodyRefs.current.set(b.id, m);
                else bodyRefs.current.delete(b.id);
              }}
              onClick={(e) => {
                e.stopPropagation();
                onPickBuilding?.(b.id);
              }}
              onPointerOver={() => {
                if (onPickBuilding) document.body.style.cursor = "pointer";
              }}
              onPointerOut={() => {
                document.body.style.cursor = "";
              }}
            >
              <meshStandardMaterial color={M.glass} roughness={0.6} metalness={0.1} />
              {alarm && <AlarmEdges pulse={pulse} />}
            </mesh>
            {b.bands && (
              <mesh geometry={b.bands} castShadow receiveShadow>
                <meshStandardMaterial color={bandColour} roughness={0.9} />
              </mesh>
            )}
            {b.roof && (
              <mesh geometry={b.roof} castShadow receiveShadow>
                <meshStandardMaterial color={alarm ? M.alarmTint : M.roof} roughness={0.9} />
              </mesh>
            )}
            {b.fins && (
              <mesh geometry={b.fins} castShadow receiveShadow>
                <meshStandardMaterial color={M.fin} roughness={0.9} />
              </mesh>
            )}
            {b.extras.map((e, i) => (
              <mesh key={i} geometry={e.geometry} castShadow receiveShadow>
                <meshStandardMaterial color={e.colour} roughness={e.colour === M.glass ? 0.6 : 0.95} />
              </mesh>
            ))}
          </group>
        );
      })}

      {/* Patrol posts (plan layer): a stack of one block per incident on a base plate, with a pole up to the pin. */}
      {columns?.map((c) => (
        <PostStack key={c.id} {...c} />
      ))}

      {/* Dashed route from the nearest guard to the alarming camera */}
      {route && (
        <Line
          points={[toWorld(route[0], route[1] + 0.6), toWorld(route[2], route[3])]}
          color={M.routeBlue}
          lineWidth={3}
          dashed
          dashSize={4}
          gapSize={3}
          depthTest={false}
          depthWrite={false}
          renderOrder={20}
        />
      )}
    </group>
  );
}

/**
 * A patrol post as a readable bar: one 7 m block per incident in the last 4 weeks
 * (so five blocks = five incidents), on a round base plate, with a slim pole up
 * to the pin. Selected posts go darker and get an ink outline.
 */
function PostStack({ at, base, count, height, selected, onPick }: { at: XY; base: number; count: number; height: number; selected: boolean; id: string; onPick: () => void }) {
  const n = Math.max(1, count);
  const step = height / n; // 9 m per incident
  const block = step - 1.6;
  const colour = selected ? "#1F35B3" : M.column3d;
  const x = at[0];
  const z = -at[1];
  return (
    <group
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
      onPointerOver={() => {
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
    >
      {/* base plate */}
      <mesh position={[x, base + 0.4, z]} castShadow receiveShadow>
        <cylinderGeometry args={[7.5, 7.5, 0.8, 32]} />
        <meshStandardMaterial color="#DDE3FB" roughness={0.9} />
      </mesh>
      <mesh position={[x, base + 0.85, z]}>
        <cylinderGeometry args={[6.2, 6.2, 0.3, 32]} />
        <meshStandardMaterial color={colour} roughness={0.8} />
      </mesh>
      {/* one block per incident */}
      {Array.from({ length: n }, (_, i) => (
        <mesh key={i} position={[x, base + 1 + i * step + block / 2, z]} castShadow receiveShadow>
          <boxGeometry args={[6.5, block, 6.5]} />
          <meshStandardMaterial color={colour} roughness={0.75} />
          <Edges threshold={15} color={selected ? "#0B0D10" : "#1F35B3"} lineWidth={1.2} />
        </mesh>
      ))}
      {/* pole up to the pin */}
      <mesh position={[x, base + 1 + height + 1.5, z]}>
        <cylinderGeometry args={[0.25, 0.25, 4, 8]} />
        <meshStandardMaterial color="#FFFFFF" roughness={0.6} />
      </mesh>
      <mesh position={[x, base + 1 + height + 3.6, z]}>
        <sphereGeometry args={[0.9, 12, 10]} />
        <meshStandardMaterial color={colour} roughness={0.6} />
      </mesh>
    </group>
  );
}

/** Pulsing red outline on the alarming building (1 Hz; static under reduced motion). */
function AlarmEdges({ pulse }: { pulse: boolean }) {
  const ref = useRef<React.ComponentRef<typeof Edges>>(null);
  const invalidate = useThree((s) => s.invalidate);
  useFrame(({ clock }) => {
    const mat = ref.current?.material as THREE.Material | undefined;
    if (!mat) return;
    mat.transparent = true;
    mat.opacity = pulse ? 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * Math.PI * 2)) : 1;
    if (pulse) invalidate();
  });
  return <Edges ref={ref} threshold={20} color={M.alarmLine} lineWidth={2.5} />;
}

/** Soft dark disc under the floating base. */
function ContactShadow({ cx, cz, span }: { cx: number; cz: number; span: number }) {
  const texture = useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const grad = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
    grad.addColorStop(0, "rgba(40,45,60,0.35)");
    grad.addColorStop(0.6, "rgba(40,45,60,0.14)");
    grad.addColorStop(1, "rgba(40,45,60,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    return t;
  }, []);
  if (!texture) return null;
  return (
    <mesh position={[cx + 12, -BASE_DEPTH - 22, cz + 10]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[span * 1.35, span * 1.0]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}
