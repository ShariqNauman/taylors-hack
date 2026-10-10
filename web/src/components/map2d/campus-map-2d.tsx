"use client";

// The 2D campus map shared by Plan ("Where are the posts?") and Cameras: the real
// Taylor's Lakeside drawn as SVG from the OpenStreetMap GeoJSON, north up, like a
// wayfinding map. Ground and buildings use muted real-world colours; only the UI
// marks use signal colours (posts and guards blue, LIVE / REC / NO SIGNAL pins,
// red only for the camera that is alarming now). No tiles, no images, no three.js.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Maximize2, Minus, Plus } from "lucide-react";
import type { Camera, Event, Site } from "@/lib/types";
import { team } from "@/lib/posts";
import { cn } from "@/lib/utils";
import { geoToLocal, type GroundCollection, type XY } from "@/components/campus3d/geo";
import { DEFAULT_BUILDINGS_URL, SEED_URL, currentAlarm, sourceKind, type CampusGeoJson } from "@/components/campus3d/model";
import { CameraPin, SOURCE_DOT } from "@/components/campus3d/overlays";
import { Avatar, PostsLegend, PostTag, type PlacedPost } from "@/components/campus3d/post-tags";
import type { PostView } from "@/components/campus3d/types";
import { buildBase, buildingAtPoint, conePath, toGeo, type Base2D } from "./geometry";

const GROUND_URL = "/campus/taylors-lakeside-ground.geojson";

/** Map palette: muted real-world colours for the ground and buildings. */
const C = {
  outside: "#ECEEF1",
  base: "#F7F4EC",
  baseEdge: "#E3DCCB",
  lawn: "#CFE3C2",
  lawnEdge: "#B5D1A4",
  treeA: "#8DB580",
  treeB: "#6F9E62",
  lake: "#BFD9EE",
  shore: "#8FB5D9",
  wave: "#E3EEF8",
  pitch: "#D7EBCF",
  court: "#CFE0C4",
  pitchEdge: "#B5D1A4",
  road: "#FFFFFF",
  roadEdge: "#CBD2DA",
  parking: "#E4E6EA",
  bay: "#FFFFFF",
  footway: "#D9CBB5",
  roof: "#FFFFFF",
  roofEdge: "#AEB6C0",
  glass: "#4F5B69",
  fin: "#C6CCD4",
  redFin: "#B8706A",
  shadow: "rgb(28 38 52 / 0.26)",
  ink: "#0B0D10",
  signal: "#2742D9",
  alarm: "#C8241B",
} as const;

type Seed = { cameras?: { camera_id: string; heading_deg?: number; heading_estimated?: boolean }[] };
type View = { k: number; tx: number; ty: number };

const fetchJson = <T,>(url: string): Promise<T> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json() as Promise<T>;
  });

export interface CampusMap2DProps {
  layer: "posts" | "cameras";
  /** Height in px. Default: fits the campus to the width, 380–640 px. */
  height?: number;
  site?: Site;
  // ── Posts (Plan) ──
  posts?: PostView[];
  selectedPostId?: string;
  onSelectPost?: (id: string) => void;
  /** "+ Add a post" is open: clicking empty map picks a point. */
  picking?: boolean;
  /** The point picked so far (drawn as a dashed pin). When omitted, the map keeps its own. */
  pickedPoint?: { lat: number; lng: number } | null;
  onPickPoint?: (p: { lat: number; lng: number }) => void;
  // ── Cameras ──
  cameras?: Camera[];
  events?: Event[];
  /** Only these camera ids get a pin (the page's filter chips). Default: all. */
  visibleCameraIds?: string[];
  selectedCameraId?: string;
  onSelectCamera?: (id: string) => void;
}

export function CampusMap2D(props: CampusMap2DProps) {
  const { layer, site } = props;
  const url = site?.campus?.buildings || DEFAULT_BUILDINGS_URL;
  const { data: geo } = useSWR<CampusGeoJson>(url, fetchJson, { revalidateOnFocus: false });
  const { data: ground } = useSWR<GroundCollection>(GROUND_URL, fetchJson, { revalidateOnFocus: false, shouldRetryOnError: false });
  const { data: seed } = useSWR<Seed>(layer === "cameras" ? SEED_URL : null, fetchJson, { revalidateOnFocus: false });
  const base = useMemo(() => (geo ? buildBase(geo, ground) : null), [geo, ground]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const ext = base?.extent;
  const aspect = ext ? (ext.maxY - ext.minY) / (ext.maxX - ext.minX) : 1.4;
  const h = props.height ?? (w ? Math.round(Math.min(640, Math.max(380, (w - 32) * aspect + 32))) : 520);

  return (
    <div className="flex w-full flex-col gap-2.5">
      <div ref={wrapRef} className="relative w-full overflow-hidden rounded-[2px] border border-line" style={{ height: h, background: C.outside }}>
        {base && w > 0 ? (
          <MapCanvas {...props} base={base} w={w} h={h} seed={seed} />
        ) : (
          <div className="absolute inset-0 grid place-items-center" aria-busy="true">
            <span className="ee-label text-muted-foreground">Drawing the campus map</span>
          </div>
        )}
      </div>
      {layer === "posts" ? <PostsLegend /> : <CamerasLegend />}
    </div>
  );
}

function fitView(ext: Base2D["extent"], w: number, h: number): View {
  const pad = 22;
  const right = w < 560 ? 50 : pad; // keep the campus clear of the zoom buttons on a phone
  const k = Math.min((w - pad - right) / (ext.maxX - ext.minX), (h - 2 * pad - 24) / (ext.maxY - ext.minY));
  const cx = (ext.minX + ext.maxX) / 2;
  const cy = (ext.minY + ext.maxY) / 2;
  return { k, tx: (w - right + pad) / 2 - cx * k, ty: h / 2 - 8 + cy * k };
}

function MapCanvas({
  layer,
  base,
  w,
  h,
  seed,
  site,
  posts = [],
  selectedPostId,
  onSelectPost,
  picking,
  pickedPoint,
  onPickPoint,
  cameras = [],
  events = [],
  visibleCameraIds,
  selectedCameraId,
  onSelectCamera,
}: CampusMap2DProps & { base: Base2D; w: number; h: number; seed?: Seed }) {
  const fit = useMemo(() => fitView(base.extent, w, h), [base, w, h]);
  const [view, setView] = useState<View>(fit);
  const [hover, setHover] = useState<string | null>(null);
  const [ownPick, setOwnPick] = useState<{ lat: number; lng: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  /** Keep at least 80 px of the campus on screen. Zoom limits are applied by zoomAt. */
  const clamp = useCallback(
    (v: View): View => {
      const e = base.extent;
      const tx = Math.min(w - 80 - e.minX * v.k, Math.max(80 - e.maxX * v.k, v.tx));
      const ty = Math.min(h - 80 + e.maxY * v.k, Math.max(80 + e.minY * v.k, v.ty));
      return { k: v.k, tx, ty };
    },
    [w, h, base],
  );

  // Refit when the box changes size.
  const [prevFit, setPrevFit] = useState(fit);
  if (prevFit !== fit) {
    setPrevFit(fit);
    setView(fit);
  }

  const toScreen = useCallback((p: XY, v: View = view): [number, number] => [v.tx + p[0] * v.k, v.ty - p[1] * v.k], [view]);
  const zoomAt = useCallback(
    (factor: number, sx = w / 2, sy = h / 2) =>
      setView((v) => {
        const k = Math.min(fit.k * 10, Math.max(fit.k * 0.8, v.k * factor));
        const f = k / v.k;
        return clamp({ k, tx: sx - (sx - v.tx) * f, ty: sy - (sy - v.ty) * f });
      }),
    [w, h, fit, clamp],
  );

  // ── Selection: centre on the selected item when it is off screen (and on mount, e.g. after the 3D view). ──
  const selPoint = useMemo<XY | null>(() => {
    if (layer === "posts") {
      const p = posts.find((q) => q.id === selectedPostId);
      return p ? geoToLocal(p.geo) : null;
    }
    const c = cameras.find((q) => q.camera_id === selectedCameraId);
    return c?.geo ? geoToLocal(c.geo) : null;
  }, [layer, posts, selectedPostId, cameras, selectedCameraId]);
  const selKey = layer === "posts" ? selectedPostId : selectedCameraId;
  const centred = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!selKey || !selPoint || centred.current === selKey) return;
    centred.current = selKey;
    const v = viewRef.current;
    const [sx, sy] = [v.tx + selPoint[0] * v.k, v.ty - selPoint[1] * v.k];
    if (sx > w * 0.12 && sx < w * 0.88 && sy > h * 0.12 && sy < h * 0.88) return;
    setView(clamp({ k: v.k, tx: w / 2 - selPoint[0] * v.k, ty: h / 2 + selPoint[1] * v.k }));
  }, [selKey, selPoint, w, h, clamp]);

  // ── Pan, pinch, wheel, click ──
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; startX: number; startY: number; dist?: number }>({ moved: false, startX: 0, startY: 0 });
  const local = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) gesture.current = { moved: false, startX: p.x, startY: p.y };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.dist = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.current.moved = true;
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.current.dist) zoomAt(d / gesture.current.dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      gesture.current.dist = d;
      return;
    }
    if (!gesture.current.moved && Math.hypot(p.x - gesture.current.startX, p.y - gesture.current.startY) < 4) return;
    gesture.current.moved = true;
    setView((v) => clamp({ ...v, tx: v.tx + p.x - prev.x, ty: v.ty + p.y - prev.y }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0 || gesture.current.moved) return;
    // A click on the map, not a drag.
    const p = local(e);
    const v = viewRef.current;
    const at: XY = [(p.x - v.tx) / v.k, (v.ty - p.y) / v.k];
    if (picking) {
      const g = toGeo(at);
      setOwnPick(g);
      onPickPoint?.(g);
      return;
    }
    const b = buildingAtPoint(base, at);
    if (!b) return;
    if (layer === "posts") {
      const post = posts.find((q) => buildingAtPoint(base, geoToLocal(q.geo))?.id === b.id);
      if (post) onSelectPost?.(post.id);
    } else {
      const inB = cameras.filter((c) => c.geo && buildingAtPoint(base, geoToLocal(c.geo))?.id === b.id && (!visibleCameraIds || visibleCameraIds.includes(c.camera_id)));
      const cam = inB.find((c) => sourceKind(c) === "live") ?? inB[0];
      if (cam) onSelectCamera?.(cam.camera_id);
    }
  };
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0018), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = 60;
    const pan = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (pan) {
      e.preventDefault();
      setView((v) => clamp({ ...v, tx: v.tx + pan[0], ty: v.ty + pan[1] }));
    } else if (e.key === "+" || e.key === "=") zoomAt(1.3);
    else if (e.key === "-") zoomAt(1 / 1.3);
    else if (e.key === "0") setView(fit);
  };

  // ── Layer data ──
  const alarmId = layer === "cameras" ? (currentAlarm(events)?.camera_id ?? null) : null;
  const headings = useMemo(() => new Map((seed?.cameras ?? []).filter((c) => c.heading_deg != null).map((c) => [c.camera_id, c.heading_deg!])), [seed]);
  const shownCams = useMemo(
    () => (layer === "cameras" ? cameras.filter((c) => c.geo && (!visibleCameraIds || visibleCameraIds.includes(c.camera_id))) : []),
    [layer, cameras, visibleCameraIds],
  );
  const guards = useMemo(
    () =>
      layer === "cameras"
        ? (site?.staff ?? [])
            .filter((s) => s.on_duty && s.post)
            .map((s) => {
              const person = team([s])[0];
              return { id: s.name, at: geoToLocal(s.post!), guard: { first: person.first, name: person.name, call_sign: s.name, photo_url: s.photo_url ?? undefined } };
            })
        : [],
    [layer, site],
  );
  const pick = pickedPoint === undefined ? ownPick : pickedPoint;

  /** Zoomed out (or a phone): pins show only the camera id, guards only their picture, names drop their subtitle. */
  const short = view.k < 0.95;
  const narrowBox = w < 560;

  // Screen-space marks, nudged apart so pins, pictures, tags and building names never cover each other
  // or the map's own controls.
  const marks = useMemo(() => {
    type Mark = { key: string; x: number; y: number; bw: number; bh: number; dy: number; ax: number; ay: number; side?: "left" | "right"; lx?: number };
    const out: Mark[] = [
      // furniture: north arrow + zoom + Fit all (top right), scale bar (bottom left), credit (bottom right)
      { key: "ui:nav", x: w - 44, y: 96, bw: 84, bh: 192, dy: 0, ax: 0, ay: 0 },
      { key: "ui:scale", x: 60, y: h - 22, bw: 120, bh: 44, dy: 0, ax: 0, ay: 0 },
      { key: "ui:credit", x: w - 100, y: h - 12, bw: 200, bh: 24, dy: 0, ax: 0, ay: 0 },
    ];
    const scr = (p: XY): [number, number] => [view.tx + p[0] * view.k, view.ty - p[1] * view.k];
    const hits = (l: number, r: number, t: number, b: number) =>
      l < 2 || r > w - 2 ||
      out.some((m) => l < m.x + m.bw / 2 && r > m.x - m.bw / 2 && t < m.y + m.dy + m.bh / 2 && b > m.y + m.dy - m.bh / 2);
    /** Keep a box inside the map, horizontally. */
    const keepIn = (cx: number, bw: number) => Math.min(w - 4 - bw / 2, Math.max(4 + bw / 2, cx));
    const place = (key: string, p: XY, bw: number, bh: number, tries: [number, number][], clampX = false) => {
      const [x, y] = scr(p);
      const cand = tries.map(([tx, ty]) => [clampX ? keepIn(x + tx, bw) : x + tx, ty] as [number, number]);
      // Never drop a mark: when every spot is taken, fall back to its own position.
      const [cx, dy] = cand.find(([px, ty]) => !hits(px - bw / 2, px + bw / 2, y + ty - bh / 2, y + ty + bh / 2)) ?? [clampX ? keepIn(x, bw) : x, 0];
      out.push({ key, x: cx, y, bw, bh, dy, ax: x, ay: y });
    };
    /** Candidate offsets, nearest first. */
    const offsets = (xs: number[], ys: number[]) =>
      xs.flatMap((dx) => ys.map((dy) => [dx, dy] as [number, number])).sort((a, b) => Math.hypot(a[0], a[1] * 2) - Math.hypot(b[0], b[1] * 2));
    if (layer === "posts") {
      // Post tags stay on their post and pick the free side; names move around them.
      const order = [...posts].sort((a, b) => Number(b.id === selectedPostId) - Number(a.id === selectedPostId));
      for (const p of order) {
        const [x, y] = scr(geoToLocal(p.geo));
        const floor = p.floor && p.floor > 0 ? ` · L${p.floor}` : "";
        const text = p.status === "suggested" ? "Suggested" : p.guard ? `${p.rank} · ${p.guard.first}${floor}` : `Nobody yet${floor}`;
        const bw = 36 + (p.guard && p.status !== "suggested" ? 28 : 12) + text.length * 7.6 + 12 + (p.onNow ? 58 : 0);
        const boxAt = (side: "left" | "right") => (side === "right" ? x - 15 + bw / 2 : x + 15 - bw / 2);
        const pref: ("left" | "right")[] = x > w - bw - 10 ? ["left", "right"] : ["right", "left"];
        // Beside the post first; if both sides are taken, above or below it with a leader line.
        const cand = [0, -36, 36, -72, 72, -108, 108].flatMap((dy) => pref.map((sd) => [sd, dy] as const));
        const [side, dy] = cand.find(([sd, ty]) => !hits(boxAt(sd) - bw / 2, boxAt(sd) + bw / 2, y + ty - 16, y + ty + 16)) ?? [pref[0], 0];
        out.push({ key: `post:${p.id}`, x: boxAt(side), y, bw, bh: 32, dy, ax: x, ay: y, side, lx: x });
      }
    }
    if (layer === "cameras") {
      const order = [...shownCams].sort((a, b) => Number(b.camera_id === alarmId) - Number(a.camera_id === alarmId) || Number(b.camera_id === selectedCameraId) - Number(a.camera_id === selectedCameraId));
      const PIN = offsets([0], [0, -34, 34, -68, 68, -102, 102]);
      for (const c of order) {
        const kind = sourceKind(c);
        const id = c.camera_id.replace(/^CAM-/, "");
        const label = short ? id : `${id} · ${kind === "live" ? "LIVE" : kind === "recorded" ? "REC" : "NO SIGNAL"}`;
        place(c.camera_id, geoToLocal(c.geo!), label.length * 7 + 40, 32, PIN);
      }
      for (const g of guards) place(`guard:${g.id}`, g.at, short ? 32 : g.guard.first.length * 7 + 46, 32, PIN);
    }
    for (const b of base.buildings) {
      const text = narrowBox ? b.label.split(" · ")[0] : b.label;
      const bw = text.length * (short ? 6 : 6.6) + 20;
      const at: XY = b.id === "syopz" ? [b.center[0], b.center[1] - 14] : b.center;
      place(`lbl:${b.id}`, at, bw, 22, offsets([0, -60, 60, -120, 120], [0, 22, -22, 44, -44, 66, -66]), true);
    }
    return new Map(out.map((m) => [m.key, m]));
  }, [layer, posts, selectedPostId, shownCams, guards, view, alarmId, selectedCameraId, base, w, h, short, narrowBox]);

  const discScale = Math.min(1.4, Math.max(0.75, view.k / 0.95));
  const scaleBar = 50 * view.k;

  return (
    <>
      <svg
        ref={svgRef}
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`Map of Taylor's Lakeside campus, north up, with ${layer === "posts" ? "the guard posts numbered" : "the camera pins"}. Drag to pan, wheel or pinch to zoom.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn("absolute inset-0 block outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal", picking ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing")}
        style={{ touchAction: "none" }}
      >
        <Defs />
        {/* Shadows: the same roofs, 3 px south-east whatever the zoom. */}
        <g transform={`translate(${view.tx + 3} ${view.ty + 3}) scale(${view.k})`} filter="url(#m2d-soft)">
          <Shadows base={base} />
        </g>
        <g transform={`translate(${view.tx} ${view.ty}) scale(${view.k})`}>
          <Ground base={base} />
          <Buildings base={base} onHover={setHover} />
          {hover && <HoverOutline base={base} id={hover} />}
          {layer === "cameras" &&
            shownCams.map((c) => {
              const hd = headings.get(c.camera_id);
              if (hd == null) return null;
              const kind = sourceKind(c);
              const alarming = c.camera_id === alarmId;
              const sel = c.camera_id === selectedCameraId;
              return (
                <path
                  key={`cone-${c.camera_id}`}
                  d={conePath(geoToLocal(c.geo!), hd)}
                  fill={kind === "black" ? "none" : alarming ? C.alarm : C.ink}
                  fillOpacity={alarming ? 0.22 : sel ? 0.18 : 0.1}
                  stroke={alarming ? C.alarm : C.ink}
                  strokeOpacity={kind === "black" ? 0.6 : 0.4}
                  strokeWidth={1}
                  strokeDasharray={kind === "black" ? "4 3" : undefined}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="none"
                />
              );
            })}
        </g>

        {/* Screen-space marks: post discs, leader lines, the picked point. */}
        {layer === "posts" &&
          posts.map((p) => {
            const [x, y] = toScreen(geoToLocal(p.geo));
            const r = (14 + Math.max(p.incidents28d, 2) * 4) * discScale;
            const sel = p.id === selectedPostId;
            const dashed = p.status === "suggested" || !p.guard;
            return (
              <circle
                key={`disc-${p.id}`}
                cx={x}
                cy={y}
                r={r}
                fill={C.signal}
                fillOpacity={sel ? 0.28 : 0.16}
                stroke={sel ? C.ink : C.signal}
                strokeWidth={sel ? 3 : 2}
                strokeDasharray={dashed ? "6 4" : undefined}
                pointerEvents="none"
              />
            );
          })}
        {[...marks.values()]
          .filter((m) => m.dy !== 0 && !m.key.startsWith("lbl:"))
          .map((m) => (
            <g key={`lead-${m.key}`} pointerEvents="none">
              <line x1={m.ax} y1={m.ay} x2={m.lx ?? m.x} y2={m.y + m.dy} stroke={C.ink} strokeOpacity={0.55} strokeWidth={1.2} />
              <circle cx={m.ax} cy={m.ay} r={3} fill={C.ink} />
            </g>
          ))}
        {pick && (() => {
          const [x, y] = toScreen(geoToLocal(pick));
          return (
            <g pointerEvents="none">
              <circle cx={x} cy={y} r={18} fill="#FFFFFF" fillOpacity={0.9} stroke={C.signal} strokeWidth={2} strokeDasharray="5 4" />
              <path d={`M${x - 7} ${y}h14M${x} ${y - 7}v14`} stroke={C.signal} strokeWidth={2.5} strokeLinecap="round" />
            </g>
          );
        })()}
      </svg>

      {/* HTML marks: real buttons, keyboard-reachable, with visible focus. */}
      <div className="pointer-events-none absolute inset-0">
        {base.buildings.map((b) => {
          const m = marks.get(`lbl:${b.id}`);
          if (!m || m.x < -80 || m.x > w + 80 || m.y < -20 || m.y > h + 20) return null;
          const [name, sub] = narrowBox ? [b.label.split(" · ")[0]] : b.label.split(" · ");
          return (
            <span
              key={`lbl-${b.id}`}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border bg-white/95 px-2 py-[1px] text-ink-2 shadow-[0_1px_1px_rgb(11_13_16/0.08)]",
                view.k < 1.05 ? "text-[10.5px]" : "text-[11.5px]",
                hover === b.id ? "border-ink text-ink" : "border-line-strong",
              )}
              style={{ left: m.x, top: m.y + m.dy }}
            >
              <b className="font-extrabold tracking-[0.02em] text-ink">{name}</b>
              {sub && <span> · {sub}</span>}
            </span>
          );
        })}
        {base.lakeLabel && (() => {
          const [x, y] = toScreen(base.lakeLabel);
          return (
            <span className="absolute -translate-x-1/2 -translate-y-1/2 font-mono text-[12px] font-bold italic tracking-[0.2em] text-[#4F7BA6]" style={{ left: x, top: y }}>
              LAKE
            </span>
          );
        })()}

        {layer === "posts" &&
          posts.map((p) => {
            const [x, y] = toScreen(geoToLocal(p.geo));
            const m = marks.get(`post:${p.id}`);
            const placed: PlacedPost = { ...p, at: geoToLocal(p.geo), y: 0, discY: 0, buildingId: null, side: m?.side ?? "right" };
            return (
              <div key={p.id} className="absolute" style={{ left: x, top: y + (m?.dy ?? 0) }}>
                <PostTag post={placed} selected={p.id === selectedPostId} onClick={() => onSelectPost?.(p.id)} />
              </div>
            );
          })}

        {layer === "cameras" &&
          guards.map((g) => {
            const m = marks.get(`guard:${g.id}`);
            if (!m) return null;
            return (
              <span
                key={g.id}
                role="img"
                aria-label={`${g.guard.name}, ${g.id}, on duty at this post`}
                title={`${g.guard.name} · ${g.id} · on duty`}
                className={cn("absolute inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-full border-2 border-signal bg-white p-[1px] text-[12px] font-extrabold text-signal-ink", !short && "pr-2")}
                style={{ left: m.x, top: m.y + m.dy, boxShadow: "0 1px 2px rgb(11 13 16 / 0.25)" }}
              >
                <Avatar guard={g.guard} size={24} />
                {!short && g.guard.first}
              </span>
            );
          })}
        {layer === "cameras" &&
          shownCams.map((c) => {
            const m = marks.get(c.camera_id);
            if (!m) return null;
            return (
              <CameraPin
                key={c.camera_id}
                camera={c}
                kind={sourceKind(c)}
                pos={[m.x, m.y + m.dy]}
                alarming={c.camera_id === alarmId}
                selected={c.camera_id === selectedCameraId}
                short={short}
                onClick={() => onSelectCamera?.(c.camera_id)}
              />
            );
          })}
      </div>

      {/* Furniture: north arrow, zoom buttons, scale bar, credit. */}
      <div className="pointer-events-none absolute right-2.5 top-2.5 flex flex-col items-center gap-2">
        <svg width="34" height="40" viewBox="0 0 34 40" role="img" aria-label="North is up">
          <circle cx="17" cy="15" r="14" fill="#FFFFFF" stroke={C.roofEdge} />
          <path d="M17 4 L23 21 L17 17 L11 21 Z" fill={C.ink} />
          <text x="17" y="39" textAnchor="middle" fontSize="11" fontWeight="800" fill={C.ink}>N</text>
        </svg>
        <div role="group" aria-label="Zoom" className="pointer-events-auto flex flex-col overflow-hidden rounded-[2px] border border-line-strong bg-white shadow-sm">
          <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.4)} className="inline-flex size-9 items-center justify-center text-ink hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal">
            <Plus className="size-4" strokeWidth={2.6} aria-hidden />
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.4)} className="inline-flex size-9 items-center justify-center border-t border-line text-ink hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal">
            <Minus className="size-4" strokeWidth={2.6} aria-hidden />
          </button>
        </div>
        <button type="button" onClick={() => setView(fit)} className="pointer-events-auto inline-flex min-h-8 items-center gap-1 rounded-[2px] border border-line-strong bg-white px-2 text-[12px] font-bold text-ink shadow-sm hover:bg-raised focus-visible:outline-2 focus-visible:outline-signal">
          <Maximize2 className="size-3.5" strokeWidth={2.4} aria-hidden />
          Fit all
        </button>
      </div>
      {picking && (
        <span className="pointer-events-none absolute left-1/2 top-2.5 -translate-x-1/2 rounded-[2px] border border-signal bg-signal-tint px-2.5 py-1 text-[13px] font-bold text-signal-ink">
          Click the map where the new post goes
        </span>
      )}
      <div className="pointer-events-none absolute bottom-2 left-2.5 flex flex-col gap-0.5">
        <span className="font-mono text-[11px] font-bold text-ink">50 m</span>
        <svg width={scaleBar + 2} height="8" aria-hidden="true">
          <rect x="1" y="1" width={scaleBar} height="6" fill="#FFFFFF" stroke={C.ink} strokeWidth="1.2" />
          <rect x="1" y="1" width={scaleBar / 2} height="6" fill={C.ink} />
        </svg>
      </div>
      <span className="pointer-events-none absolute bottom-1.5 right-2 bg-white/85 px-1 font-mono text-[10px] text-muted-foreground">© OpenStreetMap contributors</span>
    </>
  );
}

function Defs() {
  return (
    <defs>
      <filter id="m2d-soft" x="-10%" y="-10%" width="120%" height="120%">
        <feGaussianBlur stdDeviation="1.1" />
      </filter>
      <filter id="m2d-edge" x="-5%" y="-5%" width="110%" height="110%">
        <feGaussianBlur stdDeviation="3" />
      </filter>
      <symbol id="m2d-tree-a" viewBox="-3 -3 6 6" overflow="visible">
        <circle r="2.6" fill={C.treeA} stroke={C.treeB} strokeWidth="0.45" />
        <circle cx="-0.7" cy="-0.8" r="0.9" fill="#A4C798" />
      </symbol>
      <symbol id="m2d-tree-b" viewBox="-3 -3 6 6" overflow="visible">
        <circle r="2.6" fill={C.treeB} stroke="#5F8B53" strokeWidth="0.45" />
        <circle cx="-0.7" cy="-0.8" r="0.9" fill={C.treeA} />
      </symbol>
    </defs>
  );
}

/** Building roofs as one soft shadow layer. */
const Shadows = memo(function Shadows({ base }: { base: Base2D }) {
  return (
    <g fill={C.shadow}>
      {base.buildings.map((b) => (
        <g key={b.id}>
          <path d={b.roof} />
          {b.tower && <path d={b.tower.roof} />}
        </g>
      ))}
    </g>
  );
});

/** Everything on the ground. Static per campus, so it is drawn once and only the transform changes. */
const Ground = memo(function Ground({ base }: { base: Base2D }) {
  return (
    <g>
      {/* Campus: cream base with a soft edge. */}
      <path d={base.boundary} fill={C.baseEdge} filter="url(#m2d-edge)" transform="translate(0 1.5)" />
      <path d={base.boundary} fill={C.base} stroke={C.baseEdge} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {base.grass.map((d, i) => (
        <path key={`g${i}`} d={d} fill={C.lawn} stroke={C.lawnEdge} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
      {base.parking.map((p, i) => (
        <g key={`pk${i}`}>
          <defs>
            <pattern id={`m2d-bays-${i}`} patternUnits="userSpaceOnUse" width="2.6" height="13" patternTransform={`rotate(${p.angle.toFixed(1)})`}>
              <path d="M0 0.8V5.8M0 7.2V12.2" stroke={C.bay} strokeWidth="0.22" />
            </pattern>
          </defs>
          <path d={p.d} fill={C.parking} stroke="#D3D7DD" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path d={p.d} fill={`url(#m2d-bays-${i})`} />
        </g>
      ))}
      {/* Roads: edges, then white fill, then the dashed centre line. */}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {base.roads.map((r) => (
          <path key={`re${r.w}`} d={r.d} stroke={C.roadEdge} strokeWidth={r.w + 1.4} />
        ))}
        {base.roads.map((r) => (
          <path key={`rf${r.w}`} d={r.d} stroke={C.road} strokeWidth={r.w} />
        ))}
        {base.roads
          .filter((r) => r.dash)
          .map((r) => (
            <path key={`rd${r.w}`} d={r.d} stroke={C.roadEdge} strokeWidth={0.3} strokeDasharray="3 4" strokeLinecap="butt" />
          ))}
        {base.footway && <path d={base.footway} stroke={C.footway} strokeWidth={1.6} strokeDasharray="2.2 1.6" strokeLinecap="butt" />}
      </g>
      {/* Lake and pond. */}
      {base.water.map((wtr, i) => (
        <path key={`w${i}`} d={wtr.d} fill={C.lake} stroke={C.shore} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      ))}
      {base.waves && <path d={base.waves} fill="none" stroke={C.wave} strokeWidth={0.7} strokeLinecap="round" />}
      {base.stairs && <path d={base.stairs} fill="none" stroke="#D2C7B2" strokeWidth={1.6} />}
      {/* Pitches and courts with white lines. */}
      {base.pitches.map((p, i) => (
        <g key={`p${i}`}>
          <path d={p.d} fill={p.tennis ? C.court : C.pitch} stroke={C.pitchEdge} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path d={p.lines} fill="none" stroke="#FFFFFF" strokeWidth={1.1} vectorEffect="non-scaling-stroke" />
        </g>
      ))}
      {/* Trees: one <use> each. */}
      {base.trees.map((t, i) => (
        <use key={`t${i}`} href={t.v ? "#m2d-tree-b" : "#m2d-tree-a"} x={t.x - 3 * t.s} y={-t.y - 3 * t.s} width={6 * t.s} height={6 * t.s} />
      ))}
    </g>
  );
});

/** Buildings in the real colours from campus3d/reference.md: white roofs, dark glass under the roof edge. */
const Buildings = memo(function Buildings({ base, onHover }: { base: Base2D; onHover: (id: string | null) => void }) {
  return (
    <g>
      {base.buildings.map((b) => (
        <g key={b.id} onPointerEnter={() => onHover(b.id)} onPointerLeave={() => onHover(null)} className="cursor-pointer">
          <path d={b.roof} fill={C.roof} stroke={C.roofEdge} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <path d={b.glass} fill="none" stroke={C.glass} strokeOpacity={0.55} strokeWidth={1.2} strokeDasharray="5 2" vectorEffect="non-scaling-stroke" />
          {b.fins && <path d={b.fins} stroke={C.fin} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
          {b.tower && (
            <>
              <path d={b.tower.roof} fill={C.roof} stroke={C.roofEdge} strokeWidth={1.2} vectorEffect="non-scaling-stroke" filter="drop-shadow(0 0 1.2px rgb(28 38 52 / 0.35))" />
              <path d={b.tower.glass} fill="none" stroke={C.glass} strokeOpacity={0.55} strokeWidth={1.2} strokeDasharray="5 2" vectorEffect="non-scaling-stroke" />
              <path d={b.tower.fin} fill={C.redFin} />
            </>
          )}
        </g>
      ))}
    </g>
  );
});

function HoverOutline({ base, id }: { base: Base2D; id: string }) {
  const b = base.buildings.find((x) => x.id === id);
  if (!b) return null;
  return <path d={b.roof} fill="#EEF1F5" fillOpacity={0.55} stroke={C.ink} strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />;
}

function CamerasLegend() {
  const dot = (c: string, t: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex size-[20px] items-center justify-center rounded-full" style={{ background: c }}>
        <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h12v10H3zM15 10l6-3v10l-6-3" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinejoin="round" /></svg>
      </span>
      {t}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2 text-[14px] text-ink-2">
      {dot(SOURCE_DOT.live, "Live webcam")}
      {dot(SOURCE_DOT.recorded, "Recording")}
      {dot(SOURCE_DOT.black, "No signal")}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block size-[20px] rounded-full border-2 border-[#C8241B] bg-white" />
        Alarm now
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block size-[20px] rounded-full border-2 border-signal bg-signal-tint" />
        Guard on duty
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="26" height="18" viewBox="0 0 26 18" aria-hidden="true"><path d="M2 9 L24 1 A22 22 0 0 1 24 17 Z" fill="#0B0D10" fillOpacity="0.1" stroke="#0B0D10" strokeOpacity="0.35" /></svg>
        What it sees, estimated
      </span>
    </div>
  );
}
