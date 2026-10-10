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
  buildingAt,
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
} from "./model";
import {
  BuildingLabel,
  CameraCard,
  CameraPin,
  GuardChip,
  LayerToggle,
  Legend,
  NavControls,
} from "./overlays";
import { FlatMap } from "./flat-map";
import { hasWebGL } from "./webgl";
import { COLORS } from "./theme";
import type { Campus3DProps, PostView } from "./types";
import { GROUND_URL, geoToLocal, localise, parseGround, type GroundCollection, type XY } from "./geo";
import { CameraRig, FOV, focusView, homeView, type FlyRequest, type RigApi, type View } from "./rig";
import { buildingHeight, CampusScene, floorY, roofYAt } from "./scene";
import { discRadius, PostInfoCard, PostMarker3D, PostsLegend, PostTag, type PlacedPost } from "./posts-layer";

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

/** Building names on the plan layer, as on the 2D map. */
const PLAN_NAMES: Record<string, string> = {
  blockab: "Block A & B",
  blockc: "Block C",
  blockd: "Block D",
  blocke: "Block E",
  syopz: "Syopz Mall · U Residence above",
  sports: "Sports centre",
};

const fetchJson = <T,>(url: string): Promise<T> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json() as Promise<T>;
  });

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
  posts: postsProp,
  selectedPostId,
  onSelectPost,
  visibleCameraIds,
  lockLayer = false,
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

  // ── Guard posts: the page's `posts` when given, else derived from `plan` as before ──
  const viewPosts = useMemo<PostView[]>(() => {
    if (postsProp) return postsProp;
    return posts.map((p) => {
      const rank = Number(p.id.replace(/^P\//, ""));
      const slot = plan?.slots?.[rank - 1];
      return {
        id: p.id,
        rank,
        status: "active" as const,
        place: p.location,
        daysLabel: slot?.days ?? p.when,
        hours: slot?.hours ?? "",
        geo: p.geo,
        incidents28d: p.incidents4w,
        guard: null,
      };
    });
  }, [postsProp, posts, plan]);
  const placedPosts = useMemo<PlacedPost[]>(
    () =>
      viewPosts.map((p) => {
        const bid = buildingAt([p.geo.lng, p.geo.lat], buildings, 0)?.id ?? null;
        const at = geoToLocal(p.geo);
        const fp = local?.buildings.find((b) => b.id === bid);
        // On an upper floor: the real height, with a disc on the ground and a line up.
        // Indoors on the ground floor: on the roof, the 3D twin of the 2D map's circle over the building.
        const upper = !!p.floor && p.floor > 0;
        const roof = !upper && bid && fp ? roofYAt(bid, fp.pts, at) : 0;
        const y = upper ? floorY(bid, p.floor) : roof;
        const side: "left" | "right" = local && at[0] > (local.extent.minX + local.extent.maxX) / 2 ? "left" : "right";
        return { ...p, at, buildingId: bid, y, discY: upper ? 0 : roof, side };
      }),
    [viewPosts, buildings, local],
  );

  // ── Layer and selection (props seed state; the user can change it) ──
  const [layer, setLayer] = useState<Layer>(!compact && selectedPostId && !selectedCameraId ? "plan" : mode);
  const [prevMode, setPrevMode] = useState(mode);
  const [sel, setSel] = useState<Sel>(
    compact ? null : selectedCameraId ? { kind: "cam", id: selectedCameraId } : selectedPostId ? { kind: "post", id: selectedPostId } : null,
  );
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
  const [prevPostProp, setPrevPostProp] = useState(selectedPostId);
  if (selectedPostId !== prevPostProp) {
    setPrevPostProp(selectedPostId);
    if (!compact) {
      if (selectedPostId) {
        setLayer("plan");
        setSel({ kind: "post", id: selectedPostId });
      } else if (sel?.kind === "post") setSel(null);
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

  const rig = useRef<RigApi>(null);
  const [fly, setFly] = useState<FlyRequest | null>(null);
  const requestFly = useCallback((view: Partial<View>) => setFly((f) => ({ id: (f?.id ?? 0) + 1, view })), []);
  const flyToBuilding = useCallback(
    (at: XY, buildingId: string | null | undefined) => requestFly(focusView(at, heightOf(buildingId), aspect, false)),
    [requestFly, heightOf, aspect],
  );
  const [bearing, setBearing] = useState(0);

  // Opening view on the plan layer: every active and suggested post, about 45° tilt, lake in front.
  const postsHome = useMemo<View | null>(() => {
    if (!placedPosts.length || !w) return null;
    const pad = Math.max(...placedPosts.map((p) => discRadius(p.incidents28d))) + 45;
    const xs = placedPosts.map((p) => p.at[0]);
    const ys = placedPosts.map((p) => p.at[1]);
    const v = homeView({ minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minY: Math.min(...ys) - pad, maxY: Math.max(...ys) + pad + 40 }, aspect);
    return { ...v, distance: v.distance * 1.12 };
  }, [placedPosts, w, aspect]);
  const showAllPosts = useCallback(() => {
    if (postsHome) requestFly(postsHome);
  }, [postsHome, requestFly]);
  const flyToPost = useCallback(
    (p: PlacedPost) => requestFly(focusView(p.at, Math.max(p.y, 8), aspect, false)),
    [requestFly, aspect],
  );
  const selectPost = useCallback(
    (id: string) => {
      if (compact) return;
      setLayer("plan");
      setSel({ kind: "post", id });
      onSelectPost?.(id);
      const p = placedPosts.find((q) => q.id === id);
      if (p) flyToPost(p);
    },
    [compact, onSelectPost, placedPosts, flyToPost],
  );
  // The page picked a post (a row in "Who is going?" or a timetable block): fly to it.
  const flownPost = useRef<string | null>(null);
  useEffect(() => {
    if (compact || !selectedPostId || flownPost.current === selectedPostId) return;
    const p = placedPosts.find((q) => q.id === selectedPostId);
    if (!p) return;
    flownPost.current = selectedPostId;
    flyToPost(p);
  }, [compact, selectedPostId, placedPosts, flyToPost]);
  useEffect(() => {
    if (!selectedPostId) flownPost.current = null;
  }, [selectedPostId]);

  const planOpening = !compact && mode === "plan" && !!postsHome;
  const initial = compact ? compactView : planOpening ? postsHome : home;
  const initialKey = compact ? `compact:${targetCam?.camera_id ?? "none"}:${routeGuard?.guard.name ?? ""}` : planOpening ? "posts" : "home";

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
        const p = placedPosts.find((q) => q.buildingId === id);
        if (p) selectPost(p.id);
        else setSel(null);
      } else {
        const cams = geoCams.filter((c) => cameraBuilding[c.camera_id] === id);
        const cam = cams.find((c) => c.camera_id === alarmCamId) ?? cams.find((c) => sourceKind(c) === "live") ?? cams[0];
        setSel(cam ? { kind: "cam", id: cam.camera_id } : null);
      }
    },
    [compact, layer, placedPosts, selectPost, geoCams, cameraBuilding, alarmCamId],
  );

  const selectedBuildingId =
    sel?.kind === "cam" ? (cameraBuilding[sel.id] ?? null) : sel?.kind === "post" ? (placedPosts.find((p) => p.id === sel.id)?.buildingId ?? null) : null;

  const [occluderMap, setOccluderMap] = useState<Map<string, THREE.Object3D>>(new Map());
  const registerOccluders = useCallback((meshes: Map<string, THREE.Object3D>) => setOccluderMap(meshes), []);
  const occluders = useMemo<React.RefObject<THREE.Object3D>[]>(() => [...occluderMap.values()].map((m) => ({ current: m })), [occluderMap]);
  /** A post inside a building is drawn through its own walls, so only the other buildings hide its tag. */
  const occludersExcept = useCallback(
    (id: string | null) => [...occluderMap.entries()].filter(([k]) => k !== id).map(([, m]) => ({ current: m }) as React.RefObject<THREE.Object3D>),
    [occluderMap],
  );

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
      const p = placedPosts.find((q) => q.buildingId === b?.id);
      if (p) {
        setSel({ kind: "post", id: p.id });
        onSelectPost?.(p.id);
      } else setSel(null);
    } else {
      const c = cam ?? (b ? camsIn(b.id)[0] : undefined);
      setSel(c ? { kind: "cam", id: c.camera_id } : null);
    }
  };

  const shownCams = compact ? (targetCam ? [targetCam] : []) : camLayer ? geoCams.filter((c) => !visibleCameraIds || visibleCameraIds.includes(c.camera_id)) : [];
  const headings = useMemo(() => new Map((seed?.cameras ?? []).filter((c) => c.heading_deg != null).map((c) => [c.camera_id, c.heading_deg!])), [seed]);
  /** Pick a camera pin: open its card here and tell the page (grid and detail panel follow). */
  const pickCamera = (id: string) => {
    if (compact) return onOpenCamera?.(id);
    setSel({ kind: "cam", id });
    onSelectCamera?.(id);
  };
  const shownGuards = compact ? (routeGuard ? [routeGuard.guard] : []) : camLayer ? guards : [];
  const selCam = sel?.kind === "cam" ? (geoCams.find((c) => c.camera_id === sel.id) ?? null) : null;
  const selPost = sel?.kind === "post" ? (placedPosts.find((p) => p.id === sel.id) ?? null) : null;

  const compactLabel = compact
    ? targetCam
      ? `WHERE · ${[targetCam.location, [targetCam.geo?.building?.replace(/\s*\(.*\)\s*$/, "").replace(/,.*$/, ""), targetCam.geo?.floor?.split(",")[0]].filter(Boolean).join(" ")].filter(Boolean).join(", ").toUpperCase()}${
          routeGuard ? ` · ${routeGuard.guard.name.toUpperCase()} ~${roundTen(routeGuard.metres)} M AWAY` : ""
        }`
      : `WHERE · ${(alarm?.location ?? "THIS CAMERA").toUpperCase()} · NOT ON THE MAP YET`
    : null;

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
      aria-label={compact ? `Campus model: ${targetCam?.location ?? "campus"}` : `3D model of ${site?.name ?? "the campus"} with ${layer === "plan" ? "the guard posts, numbered" : "camera pins"}`}
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
          />
          {!compact &&
            camLayer &&
            shownCams.map((c) => {
              const hd = headings.get(c.camera_id);
              if (hd == null || !c.geo) return null;
              const kind = sourceKind(c);
              return (
                <ViewCone
                  key={`cone-${c.camera_id}`}
                  at={geoToLocal(c.geo)}
                  y={pinAlt(c) - 3}
                  heading={hd}
                  colour={c.camera_id === alarm?.camera_id ? "#C8241B" : "#0B0D10"}
                  opacity={kind === "black" ? 0.05 : c.camera_id === alarm?.camera_id ? 0.24 : sel?.kind === "cam" && sel.id === c.camera_id ? 0.24 : 0.16}
                />
              );
            })}
          {!compact &&
            layer === "plan" &&
            placedPosts.map((p) => <PostMarker3D key={p.id} post={p} selected={sel?.kind === "post" && sel.id === p.id} onPick={() => selectPost(p.id)} />)}

          {/* HTML overlays anchored to 3D points. The overlays centre themselves on [0,0] inside each anchor. */}
          {!compact &&
            !narrow &&
            buildings.map((b) => {
              const live = camLayer ? liveCamIn(b.id) : undefined;
              const n = camLayer ? camsIn(b.id).length : 0;
              const name = (layer === "plan" ? (PLAN_NAMES[b.id] ?? b.name) : b.name).toUpperCase();
              const text = live ? `${live.location.split(",")[0].toUpperCase()} · ${name} · LIVE` : n ? `${name} · ${n} CAM` : name;
              return (
                <Html key={b.id} position={anchor({ lng: b.centroid[0], lat: b.centroid[1] }, heightOf(b.id) + 7)} zIndexRange={[12, 8]} style={{ pointerEvents: "none" }}>
                  <BuildingLabel text={text} pos={ZERO} selected={b.id === selectedBuildingId} alarm={!!live || b.id === alarmBuildingId} onClick={() => pickBuilding(b.id)} />
                </Html>
              );
            })}
          {shownGuards.map((g) => (
            <Html key={g.name} position={anchor(g.post, 1.5)} occlude={occluders} zIndexRange={[14, 10]} style={{ pointerEvents: "none" }}>
              <GuardChip guard={g} pos={ZERO} />
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
                onClick={() => pickCamera(c.camera_id)}
              />
            </Html>
          ))}
          {!compact &&
            layer === "plan" &&
            placedPosts.map((p) => (
              <Html key={p.id} position={[p.at[0], p.status === "suggested" ? p.discY + 2 : p.y + 9, -p.at[1]]} occlude={occludersExcept(p.buildingId)} zIndexRange={[22, 16]} style={{ pointerEvents: "none" }}>
                <PostTag post={p} selected={sel?.kind === "post" && sel.id === p.id} onClick={() => selectPost(p.id)} />
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
            columns={!compact && layer === "plan" ? viewPosts.map((p) => p.geo) : []}
            route={routeCam?.geo && routeGuard ? [[routeGuard.guard.post.lng, routeGuard.guard.post.lat], [routeCam.geo.lng, routeCam.geo.lat]] : null}
            onBuilding={pickBuilding}
          />
          <div className="pointer-events-none absolute inset-0">
            {shownGuards.map((g) => (
              <GuardChip key={g.name} guard={g} pos={flatProject(g.post.lng, g.post.lat)} />
            ))}
            {shownCams.map((c) => (
              <CameraPin
                key={c.camera_id}
                camera={c}
                kind={sourceKind(c)}
                pos={flatProject(c.geo!.lng, c.geo!.lat)}
                alarming={c.camera_id === alarm?.camera_id}
                selected={sel?.kind === "cam" && sel.id === c.camera_id}
                onClick={() => pickCamera(c.camera_id)}
              />
            ))}
            {!compact &&
              layer === "plan" &&
              placedPosts.map((p) => {
                const [x, y] = flatProject(p.geo.lng, p.geo.lat);
                return (
                  <div key={p.id} className="absolute" style={{ left: x, top: y }}>
                    <PostTag post={p} selected={sel?.kind === "post" && sel.id === p.id} onClick={() => selectPost(p.id)} />
                  </div>
                );
              })}
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
            {!lockLayer && (
              <LayerToggle
                layer={layer}
                onChange={(l) => {
                  setLayer(l);
                  setSel(null);
                }}
              />
            )}
            <span className="border border-line bg-white/90 px-2 py-[3px] font-mono text-[11px] font-bold">{(site?.name ?? "Taylor's University Lakeside Campus").toUpperCase()}</span>
          </div>
          <div role="group" aria-label="Jump to a building" className="pointer-events-auto flex flex-wrap gap-1">
            {layer === "plan" && placedPosts.length > 0 && (
              <button type="button" onClick={showAllPosts} className="min-h-[30px] rounded-[2px] border border-ink bg-ink px-2 text-[12px] font-bold text-white">
                Show all posts
              </button>
            )}
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
          <PostInfoCard post={selPost} sheet={narrow} onClose={() => setSel(null)} />
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
        <div className={cn("pointer-events-none absolute right-3 z-30 flex max-w-[calc(100%-24px)] flex-col items-end gap-1", narrow ? "bottom-[100px]" : w < 780 ? "bottom-[58px]" : "bottom-3")}>
          {camLayer ? <Legend /> : <PostsLegend />}
          <span className={cn("bg-white/85 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground")}>{CREDIT.toUpperCase()}</span>
        </div>
      )}
      {ready && compact && (
        <span className="absolute bottom-1 right-1.5 z-30 bg-white/80 px-1 font-mono text-[9px] text-muted-foreground">{CREDIT.toUpperCase()}</span>
      )}
    </div>
  );
}

/** What a camera sees, estimated: a flat translucent fan on its building's roof, drawn over the model. */
function ViewCone({ at, y, heading, colour, opacity }: { at: XY; y: number; heading: number; colour: string; opacity: number }) {
  const geom = useMemo(() => {
    const half = (32 * Math.PI) / 180;
    // CircleGeometry angles run from +x towards +y; after rotateX(−90°) +y is north, so compass h is 90° − h.
    const g = new THREE.CircleGeometry(30, 24, (Math.PI / 2 - (heading * Math.PI) / 180) - half, 2 * half);
    g.rotateX(-Math.PI / 2);
    return g;
  }, [heading]);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <mesh geometry={geom} position={[at[0], y, -at[1]]} renderOrder={18}>
      <meshBasicMaterial color={colour} transparent opacity={opacity} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

export { COLORS };

