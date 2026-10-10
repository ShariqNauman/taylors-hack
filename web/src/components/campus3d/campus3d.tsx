"use client";

// The 3D campus: a stylised diorama of the real Taylor's Lakeside Campus built
// in code from the OpenStreetMap footprints (three.js via react-three-fiber).
// Loaded lazily through ./index.tsx; never import this file directly from a page.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { cn } from "@/lib/utils";
import type { Camera } from "@/lib/types";
import {
  DEFAULT_BUILDINGS_URL,
  SEED_URL,
  buildBuildings,
  cameraLevel,
  currentAlarm,
  latestEventFor,
  nearestGuard,
  onDutyGuards,
  planPosts,
  roundTen,
  sourceKind,
  type CampusGeoJson,
  type CampusSeed,
  type PlanPost,
} from "./model";
import {
  BuildingLabel,
  CameraCard,
  CameraPin,
  GuardChip,
  LayerToggle,
  Legend,
  NavControls,
  PostCard,
  PostPin,
} from "./overlays";
import { FlatMap } from "./flat-map";
import { COLORS } from "./theme";
import type { Campus3DProps } from "./types";
import { GROUND_URL, geoToLocal, localise, parseGround, type GroundCollection, type XY } from "./geo";
import { CameraRig, FOV, focusView, homeView, type FlyRequest, type RigApi, type View } from "./rig";
import { buildingHeight, CampusScene } from "./scene";

export const CREDIT = "Stylised model · footprints © OpenStreetMap contributors";
const NARROW = 640;
const SKY = "linear-gradient(180deg, #E9EFF7 0%, #F3F5F8 55%, #E8EAEE 100%)";

type Sel = { kind: "cam"; id: string } | { kind: "post"; id: string } | null;
type Layer = "cameras" | "plan";
type GlState = "unknown" | "webgl" | "none";

/** Jump chips: fixed order from the brief; each resolves to a footprint id (and a camera to select). */
const JUMPS: { label: string; buildingId?: string; cameraId?: string }[] = [
  { label: "Grand Hall", buildingId: "blockab", cameraId: "CAM-AU-01" },
  { label: "Block C", buildingId: "blockc" },
  { label: "Syopz Mall", buildingId: "syopz", cameraId: "CAM-CT-04" },
  { label: "U Residence", buildingId: "syopz", cameraId: "CAM-HC-01" },
  { label: "Sports centre", buildingId: "sports" },
  { label: "Whole campus" },
];

const fetchJson = <T,>(url: string): Promise<T> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json() as Promise<T>;
  });

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

export default function Campus3D({
  mode,
  compact = false,
  focusCameraId,
  cameras,
  site,
  events,
  plan,
  onOpenCamera,
  selectedCameraId,
  onSelectCamera,
  height,
}: Campus3DProps) {
  const h = height ?? (compact ? 240 : 560);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [gl, setGl] = useState<GlState>("unknown");
  const reduced = useReducedMotion();

  // ── Data ──
  const buildingsUrl = site?.campus?.buildings || DEFAULT_BUILDINGS_URL;
  const { data: geo } = useSWR<CampusGeoJson>(buildingsUrl, fetchJson, { revalidateOnFocus: false });
  const { data: seed } = useSWR<CampusSeed>(mode === "plan" || !compact ? SEED_URL : null, fetchJson, { revalidateOnFocus: false });
  const { data: groundFc } = useSWR<GroundCollection>(GROUND_URL, fetchJson, { revalidateOnFocus: false, shouldRetryOnError: false });

  const geoCams = useMemo(() => cameras.filter((c) => c.geo), [cameras]);
  const { buildings, cameraBuilding } = useMemo(() => buildBuildings(geo, geoCams), [geo, geoCams]);
  const byId = useMemo(() => new Map(buildings.map((b) => [b.id, b])), [buildings]);
  const posts = useMemo(() => planPosts(plan, seed, geoCams, buildings), [plan, seed, geoCams, buildings]);
  const guards = useMemo(() => onDutyGuards(site), [site]);
  const alarm = useMemo(() => currentAlarm(events ?? []), [events]);
  const local = useMemo(() => (geo ? localise(geo, buildings) : null), [geo, buildings]);
  const ground = useMemo(() => (groundFc ? parseGround(groundFc) : []), [groundFc]);

  // ── Layer and selection (props seed state; the user can change it) ──
  const [layer, setLayer] = useState<Layer>(mode);
  const [prevMode, setPrevMode] = useState(mode);
  const [sel, setSel] = useState<Sel>(!compact && selectedCameraId ? { kind: "cam", id: selectedCameraId } : null);
  const [prevSelProp, setPrevSelProp] = useState(selectedCameraId);
  if (mode !== prevMode) {
    setPrevMode(mode);
    setLayer(mode);
    setSel(null);
  }
  if (selectedCameraId !== prevSelProp) {
    setPrevSelProp(selectedCameraId);
    if (selectedCameraId && !compact) {
      setLayer("cameras");
      setSel({ kind: "cam", id: selectedCameraId });
    }
  }
  const camLayer = compact || layer === "cameras";

  // The camera the compact view is about: the focused one, else the alarming one.
  const targetCam: Camera | null = useMemo(() => {
    const id = focusCameraId ?? alarm?.camera_id;
    return geoCams.find((c) => c.camera_id === id) ?? null;
  }, [focusCameraId, alarm, geoCams]);
  const alarmCamId = camLayer ? (alarm?.camera_id ?? null) : null;
  const alarmBuildingId = alarmCamId ? (cameraBuilding[alarmCamId] ?? null) : null;

  const routeCam = compact ? targetCam : alarmCamId ? (geoCams.find((c) => c.camera_id === alarmCamId) ?? null) : null;
  const routeGuard = useMemo(() => (routeCam?.geo && camLayer ? nearestGuard(guards, routeCam.geo) : null), [routeCam, guards, camLayer]);

  const heightOf = useCallback(
    (buildingId: string | null | undefined) => {
      const b = buildingId ? byId.get(buildingId) : undefined;
      return b ? buildingHeight(b.id, b.height) : 12;
    },
    [byId],
  );
  /** A pin floats just above its building's roof, so its own walls never hide it; other buildings still can. */
  const pinAlt = useCallback(
    (c: Camera) => {
      const bid = cameraBuilding[c.camera_id];
      return bid ? heightOf(bid) + 3.5 : (c.geo?.alt_m ?? 4);
    },
    [cameraBuilding, heightOf],
  );

  const route = useMemo<[XY, number, XY, number] | null>(() => {
    if (!routeCam?.geo || !routeGuard) return null;
    return [geoToLocal(routeGuard.guard.post), 0.2, geoToLocal(routeCam.geo), pinAlt(routeCam)];
  }, [routeCam, routeGuard, pinAlt]);

  // ── Size and WebGL ──
  useEffect(() => {
    setGl(hasWebGL() ? "webgl" : "none");
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = w > 0 && w < NARROW;
  const flat = gl === "none";
  const aspect = w > 0 ? w / h : 1.8;

  // ── Views ──
  const home = useMemo<View | null>(() => (local && w ? homeView(local.extent, aspect) : null), [local, w, aspect]);
  const compactView = useMemo<View | null>(() => {
    if (!home || !compact) return null;
    if (!targetCam?.geo) return { ...home, polar: 0.85 };
    return { ...home, ...focusView(geoToLocal(targetCam.geo), heightOf(cameraBuilding[targetCam.camera_id]), aspect, true) } as View;
  }, [home, compact, targetCam, heightOf, cameraBuilding, aspect]);
  const initial = compact ? compactView : home;
  const initialKey = compact ? `compact:${targetCam?.camera_id ?? "none"}:${routeGuard?.guard.name ?? ""}` : "home";

  const rig = useRef<RigApi>(null);
  const [fly, setFly] = useState<FlyRequest | null>(null);
  const requestFly = useCallback((view: Partial<View>) => setFly((f) => ({ id: (f?.id ?? 0) + 1, view })), []);
  const flyToBuilding = useCallback(
    (at: XY, buildingId: string | null | undefined) => requestFly(focusView(at, heightOf(buildingId), aspect, false)),
    [requestFly, heightOf, aspect],
  );
  const [bearing, setBearing] = useState(0);

  // Deep link (?cam=): frame the building once per id.
  const framed = useRef<string | null>(null);
  useEffect(() => {
    if (compact || !initial) return;
    const id = focusCameraId ?? selectedCameraId;
    if (!id || framed.current === id) return;
    const c = geoCams.find((x) => x.camera_id === id);
    if (!c?.geo) return;
    framed.current = id;
    flyToBuilding(geoToLocal(c.geo), cameraBuilding[c.camera_id]);
  }, [compact, initial, focusCameraId, selectedCameraId, geoCams, cameraBuilding, flyToBuilding]);

  // ── Picking ──
  const pickBuilding = useCallback(
    (id: string) => {
      if (compact) return;
      if (layer === "plan") {
        const p = posts.find((q) => q.buildingId === id);
        setSel(p ? { kind: "post", id: p.id } : null);
      } else {
        const cams = geoCams.filter((c) => cameraBuilding[c.camera_id] === id);
        const cam = cams.find((c) => c.camera_id === alarmCamId) ?? cams.find((c) => sourceKind(c) === "live") ?? cams[0];
        setSel(cam ? { kind: "cam", id: cam.camera_id } : null);
      }
    },
    [compact, layer, posts, geoCams, cameraBuilding, alarmCamId],
  );

  const selectedBuildingId =
    sel?.kind === "cam" ? (cameraBuilding[sel.id] ?? null) : sel?.kind === "post" ? (posts.find((p) => p.id === sel.id)?.buildingId ?? null) : null;

  const [occluders, setOccluders] = useState<React.RefObject<THREE.Object3D>[]>([]);
  const registerOccluders = useCallback((meshes: THREE.Object3D[]) => setOccluders(meshes.map((m) => ({ current: m }))), []);

  // ── Overlays ──
  const camsIn = (bid: string) => geoCams.filter((c) => cameraBuilding[c.camera_id] === bid);
  const liveCamIn = (bid: string) => camsIn(bid).find((c) => sourceKind(c) === "live");

  const jump = (j: (typeof JUMPS)[number]) => {
    if (!j.buildingId) {
      if (home) requestFly(home);
      setSel(null);
      return;
    }
    const b = byId.get(j.buildingId) ?? buildings.find((x) => x.name.toLowerCase().includes(j.label.toLowerCase()));
    const cam = j.cameraId ? geoCams.find((c) => c.camera_id === j.cameraId) : undefined;
    const at: XY | null = cam?.geo ? geoToLocal(cam.geo) : b ? geoToLocal({ lng: b.centroid[0], lat: b.centroid[1] }) : null;
    if (!at) return;
    flyToBuilding(at, b?.id);
    if (layer === "plan") {
      const p = posts.find((q) => q.buildingId === b?.id);
      setSel(p ? { kind: "post", id: p.id } : null);
    } else {
      const c = cam ?? (b ? camsIn(b.id)[0] : undefined);
      setSel(c ? { kind: "cam", id: c.camera_id } : null);
    }
  };

  const shownCams = compact ? (targetCam ? [targetCam] : []) : camLayer ? geoCams : [];
  const shownGuards = compact ? (routeGuard ? [routeGuard.guard] : []) : camLayer ? guards : [];
  const selCam = sel?.kind === "cam" ? (geoCams.find((c) => c.camera_id === sel.id) ?? null) : null;
  const selPost = sel?.kind === "post" ? (posts.find((p) => p.id === sel.id) ?? null) : null;

  const compactLabel = compact
    ? targetCam
      ? `WHERE · ${[targetCam.location, [targetCam.geo?.building?.replace(/\s*\(.*\)\s*$/, "").replace(/,.*$/, ""), targetCam.geo?.floor?.split(",")[0]].filter(Boolean).join(" ")].filter(Boolean).join(", ").toUpperCase()}${
          routeGuard ? ` · ${routeGuard.guard.name.toUpperCase()} ~${roundTen(routeGuard.metres)} M AWAY` : ""
        }`
      : `WHERE · ${(alarm?.location ?? "THIS CAMERA").toUpperCase()} · NOT ON THE MAP YET`
    : null;

  // Columns stand on the roof when the post is inside a building, so they are never swallowed by it.
  const columnBase = useCallback((p: PlanPost) => (p.buildingId ? heightOf(p.buildingId) + 2.3 : 0), [heightOf]);
  const columns = useMemo(
    () =>
      !compact && layer === "plan"
        ? posts.map((p) => ({ id: p.id, at: geoToLocal(p.geo), base: columnBase(p), height: p.incidents4w * 9, count: p.incidents4w, selected: selPost?.id === p.id, onPick: () => setSel({ kind: "post", id: p.id }) }))
        : [],
    [compact, layer, posts, selPost?.id, columnBase],
  );

  // Flat projector for the no-WebGL map: metres to pixels, north up.
  const flatProject = useMemo(() => {
    if (!local || !w) return null;
    const ex = local.extent;
    const wM = ex.maxX - ex.minX;
    const hM = ex.maxY - ex.minY;
    const s = Math.min((w - 24) / wM, (h - 24) / hM);
    const ox = (w - wM * s) / 2;
    const oy = (h - hM * s) / 2;
    return (lng: number, lat: number): [number, number] => {
      const p = geoToLocal({ lng, lat });
      return [ox + (p[0] - ex.minX) * s, oy + (ex.maxY - p[1]) * s];
    };
  }, [local, w, h]);

  const anchor = (p: { lat: number; lng: number }, alt = 0): [number, number, number] => {
    const q = geoToLocal(p);
    return [q[0], alt, -q[1]];
  };
  const ZERO: [number, number] = [0, 0];
  const ready = !!local && !!geo && w > 0 && !!initial;

  return (
    <div
      ref={wrapRef}
      className="relative w-full select-none overflow-hidden rounded-[2px] border border-line"
      style={{ height: h, background: SKY, touchAction: compact ? "auto" : "none" }}
      role="region"
      aria-label={compact ? `Campus model: ${targetCam?.location ?? "campus"}` : `3D model of ${site?.name ?? "the campus"} with ${layer === "plan" ? "patrol posts and hotspot columns" : "camera pins"}`}
    >
      {ready && gl === "webgl" && local && initial && (
        <Canvas
          frameloop="demand"
          shadows="soft"
          flat
          dpr={[1, 1.75]}
          camera={{ fov: FOV, near: 2, far: 6000, position: [0, 600, 600] }}
          gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
          style={{ position: "absolute", inset: 0 }}
          onPointerMissed={() => {
            if (!compact) setSel(null);
          }}
        >
          <CameraRig ref={rig} fly={fly} initial={initial} initialKey={initialKey} locked={compact} reducedMotion={reduced} onChange={(v) => setBearing((-v.azimuth * 180) / Math.PI)} />
          <CampusScene
            campus={local}
            ground={ground}
            selectedBuildingId={selectedBuildingId}
            alarmBuildingId={alarmBuildingId}
            pulse={!reduced}
            compact={compact}
            onPickBuilding={compact ? undefined : pickBuilding}
            registerOccluders={registerOccluders}
            route={route}
            columns={columns}
          />

          {/* HTML overlays anchored to 3D points. The overlays centre themselves on [0,0] inside each anchor. */}
          {!compact &&
            !narrow &&
            buildings.map((b) => {
              const live = camLayer ? liveCamIn(b.id) : undefined;
              const n = camLayer ? camsIn(b.id).length : 0;
              const name = b.name.toUpperCase();
              const text = live ? `${live.location.split(",")[0].toUpperCase()} · ${name} · LIVE` : n ? `${name} · ${n} CAM` : name;
              return (
                <Html key={b.id} position={anchor({ lng: b.centroid[0], lat: b.centroid[1] }, heightOf(b.id) + 7)} zIndexRange={[12, 8]} style={{ pointerEvents: "none" }}>
                  <BuildingLabel text={text} pos={ZERO} selected={b.id === selectedBuildingId} alarm={!!live || b.id === alarmBuildingId} onClick={() => pickBuilding(b.id)} />
                </Html>
              );
            })}
          {shownGuards.map((g) => (
            <Html key={g.name} position={anchor(g.post, 1.5)} occlude={occluders} zIndexRange={[14, 10]} style={{ pointerEvents: "none" }}>
              <GuardChip name={g.name} pos={ZERO} />
            </Html>
          ))}
          {shownCams.map((c) => (
            <Html key={c.camera_id} position={anchor(c.geo!, pinAlt(c))} occlude={occluders} zIndexRange={[20, 15]} style={{ pointerEvents: "none" }}>
              <CameraPin
                camera={c}
                kind={sourceKind(c)}
                pos={ZERO}
                alarming={c.camera_id === alarm?.camera_id}
                selected={sel?.kind === "cam" && sel.id === c.camera_id}
                onClick={() => (compact ? onOpenCamera?.(c.camera_id) : setSel({ kind: "cam", id: c.camera_id }))}
              />
            </Html>
          ))}
          {!compact &&
            layer === "plan" &&
            posts.map((p) => (
              <Html key={p.id} position={anchor(p.geo, columnBase(p) + p.incidents4w * 9 + 6)} zIndexRange={[20, 15]} style={{ pointerEvents: "none" }}>
                <PostPin post={p} pos={ZERO} selected={sel?.kind === "post" && sel.id === p.id} onClick={() => setSel({ kind: "post", id: p.id })} />
              </Html>
            ))}
        </Canvas>
      )}

      {ready && flat && geo && flatProject && (
        <>
          <FlatMap
            geo={geo}
            width={w}
            height={h}
            project={flatProject}
            alarmBuildingId={alarmBuildingId}
            selectedBuildingId={selectedBuildingId}
            columns={!compact && layer === "plan" ? posts.map((p) => p.geo) : []}
            route={routeCam?.geo && routeGuard ? [[routeGuard.guard.post.lng, routeGuard.guard.post.lat], [routeCam.geo.lng, routeCam.geo.lat]] : null}
            onBuilding={pickBuilding}
          />
          <div className="pointer-events-none absolute inset-0">
            {shownGuards.map((g) => (
              <GuardChip key={g.name} name={g.name} pos={flatProject(g.post.lng, g.post.lat)} />
            ))}
            {shownCams.map((c) => (
              <CameraPin
                key={c.camera_id}
                camera={c}
                kind={sourceKind(c)}
                pos={flatProject(c.geo!.lng, c.geo!.lat)}
                alarming={c.camera_id === alarm?.camera_id}
                selected={sel?.kind === "cam" && sel.id === c.camera_id}
                onClick={() => (compact ? onOpenCamera?.(c.camera_id) : setSel({ kind: "cam", id: c.camera_id }))}
              />
            ))}
            {!compact && layer === "plan" && posts.map((p) => <PostPin key={p.id} post={p} pos={flatProject(p.geo.lng, p.geo.lat)} selected={sel?.kind === "post" && sel.id === p.id} onClick={() => setSel({ kind: "post", id: p.id })} />)}
          </div>
        </>
      )}

      {!ready && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="ee-label text-muted-foreground">Building the campus model</span>
        </div>
      )}

      {/* Chrome: toggle, jump chips, cards, controls, legend, credit. */}
      {ready && !compact && (
        <div className="pointer-events-none absolute left-3 top-3 z-30 flex max-w-[calc(100%-24px)] flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <LayerToggle
              layer={layer}
              onChange={(l) => {
                setLayer(l);
                setSel(null);
              }}
            />
            <span className="border border-line bg-white/90 px-2 py-[3px] font-mono text-[11px] font-bold">{(site?.name ?? "Taylor's University Lakeside Campus").toUpperCase()}</span>
          </div>
          <div role="group" aria-label="Jump to a building" className="pointer-events-auto flex flex-wrap gap-1">
            {JUMPS.map((j) => (
              <button key={j.label} type="button" onClick={() => jump(j)} className="min-h-[30px] rounded-[2px] border border-line-strong bg-white/95 px-2 text-[12px] font-bold text-ink">
                {j.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {ready && compactLabel && (
        <span className="absolute left-2 top-2 z-30 border border-line bg-white px-1.5 py-0.5 font-mono text-[11px] font-bold">{compactLabel}</span>
      )}

      {ready && !compact && selCam && (
        <div className="absolute inset-0 z-40 pointer-events-none">
          <CameraCard
            camera={selCam}
            kind={sourceKind(selCam)}
            buildingName={byId.get(cameraBuilding[selCam.camera_id] ?? "")?.name ?? null}
            event={latestEventFor(events ?? [], selCam.camera_id)}
            level={cameraLevel(events ?? [], selCam.camera_id)}
            sheet={narrow}
            onClose={() => setSel(null)}
            onOpen={onOpenCamera ? () => onOpenCamera(selCam.camera_id) : undefined}
            onDetails={onSelectCamera ? () => onSelectCamera(selCam.camera_id) : undefined}
          />
        </div>
      )}
      {ready && !compact && selPost && (
        <div className="absolute inset-0 z-40 pointer-events-none">
          <PostCard post={selPost} sheet={narrow} onClose={() => setSel(null)} />
        </div>
      )}

      {ready && !compact && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-30 max-w-[calc(100%-24px)]">
          {flat ? (
            <span className="border border-dashed border-line-strong bg-white/90 px-2 py-[3px] font-mono text-[11px] font-bold">FLAT VIEW · WEBGL IS OFF IN THIS BROWSER</span>
          ) : (
            <NavControls
              bearing={bearing}
              onRotate={(deg) => rig.current?.rotate(deg)}
              onTop={() => rig.current?.tilt("top")}
              onTilt={() => rig.current?.tilt("tilt")}
              onZoom={(d) => rig.current?.zoom(d)}
              onReset={() => home && requestFly(home)}
              onNorth={() => requestFly({ azimuth: 0 })}
              canTilt
            />
          )}
        </div>
      )}
      {ready && !compact && (
        <div className="pointer-events-none absolute bottom-3 right-3 z-30 flex max-w-[calc(100%-24px)] flex-col items-end gap-1">
          {camLayer && <Legend />}
          <span className={cn("bg-white/85 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground")}>{CREDIT.toUpperCase()}</span>
        </div>
      )}
      {ready && compact && (
        <span className="absolute bottom-1 right-1.5 z-30 bg-white/80 px-1 font-mono text-[9px] text-muted-foreground">{CREDIT.toUpperCase()}</span>
      )}
    </div>
  );
}

export { COLORS };
