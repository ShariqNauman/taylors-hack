"use client";

// The 3D campus (deck.gl). Loaded lazily through ./index.tsx; never import this
// file directly from a page.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import DeckGL from "@deck.gl/react";
import {
  AmbientLight,
  DirectionalLight,
  FlyToInterpolator,
  LightingEffect,
  WebMercatorViewport,
  type MapViewState,
  type PickingInfo,
} from "@deck.gl/core";
import { ColumnLayer, GeoJsonLayer, PathLayer } from "@deck.gl/layers";
import { Tile3DLayer } from "@deck.gl/geo-layers";
import { PathStyleExtension } from "@deck.gl/extensions";
import { cn } from "@/lib/utils";
import type { Camera } from "@/lib/types";
import {
  DEFAULT_BUILDINGS_URL,
  SEED_URL,
  azimuth,
  buildBuildings,
  cameraLevel,
  currentAlarm,
  fitZoom,
  latestEventFor,
  nearestGuard,
  onDutyGuards,
  planPosts,
  ringsBounds,
  roundTen,
  sourceKind,
  type Bounds,
  type Building,
  type CampusFeature,
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
import { COLORS, LIGHT, baseForTop, hex } from "./theme";
import type { Campus3DProps } from "./types";

const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const GOOGLE_ROOT = "https://tile.googleapis.com/v1/3dtiles/root.json";
const TILE_TIMEOUT_MS = 5000;

const HOME_BEARING = 90; // east up: the campus's north–south long axis runs across the screen
const HOME_PITCH = 50;
const COMPACT_PITCH = 45;
const NARROW = 640;

type Sel = { kind: "cam"; id: string } | { kind: "post"; id: string } | null;
type Layer = "cameras" | "plan";
type GlState = "unknown" | "webgl" | "none";
type TileState = "off" | "loading" | "ready" | "failed";
type View = MapViewState;

const fetchJson = <T,>(url: string): Promise<T> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json() as Promise<T>;
  });

function hasWebGL2(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

function grow(b: Bounds, p: { lat: number; lng: number }): Bounds {
  return {
    minLng: Math.min(b.minLng, p.lng),
    maxLng: Math.max(b.maxLng, p.lng),
    minLat: Math.min(b.minLat, p.lat),
    maxLat: Math.max(b.maxLat, p.lat),
  };
}

function viewFor(
  b: Bounds,
  w: number,
  h: number,
  pitch: number,
  fill: number,
  maxZoom: number,
  bearing = HOME_BEARING,
): MapViewState {
  // A pitched view squeezes depth, so the box can be taller than the screen.
  const depthStretch = 1 / Math.max(0.45, Math.cos((pitch * Math.PI) / 180));
  return {
    longitude: (b.minLng + b.maxLng) / 2,
    latitude: (b.minLat + b.maxLat) / 2,
    zoom: Math.min(maxZoom, fitZoom(b, w, h * depthStretch, bearing, fill)),
    pitch,
    bearing,
    minZoom: 14.5,
    maxZoom: 20.5,
    maxPitch: 70,
  };
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
  selectedPostLocation,
  height,
}: Campus3DProps) {
  const h = height ?? (compact ? 240 : 560);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [gl, setGl] = useState<GlState>("unknown");

  // ── Data ──
  const buildingsUrl = site?.campus?.buildings || DEFAULT_BUILDINGS_URL;
  const { data: geo } = useSWR<CampusGeoJson>(buildingsUrl, fetchJson, {
    revalidateOnFocus: false,
  });
  const { data: seed } = useSWR<CampusSeed>(
    mode === "plan" || !compact ? SEED_URL : null,
    fetchJson,
    { revalidateOnFocus: false },
  );

  const geoCams = useMemo(() => cameras.filter((c) => c.geo), [cameras]);
  const { buildings, cameraBuilding } = useMemo(
    () => buildBuildings(geo, geoCams),
    [geo, geoCams],
  );
  const byId = useMemo(
    () => new Map(buildings.map((b) => [b.id, b])),
    [buildings],
  );
  const posts = useMemo(
    () => planPosts(plan, seed, geoCams, buildings),
    [plan, seed, geoCams, buildings],
  );
  const guards = useMemo(() => onDutyGuards(site), [site]);
  const alarm = useMemo(() => currentAlarm(events ?? []), [events]);
  const allBounds = useMemo(
    () =>
      geo?.features.length
        ? ringsBounds(geo.features.map((f) => f.geometry.coordinates[0]))
        : null,
    [geo],
  );

  // ── Layer and selection (props seed state; the user can change it) ──
  const [layer, setLayer] = useState<Layer>(mode);
  const [prevMode, setPrevMode] = useState(mode);
  const [sel, setSel] = useState<Sel>(
    !compact && selectedCameraId ? { kind: "cam", id: selectedCameraId } : null,
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
  const [prevPostProp, setPrevPostProp] = useState<string | undefined>();
  if (selectedPostLocation !== prevPostProp && !compact) {
    const p = posts.find((q) => q.location === selectedPostLocation);
    if (p || !selectedPostLocation) setPrevPostProp(selectedPostLocation);
    if (p) {
      setLayer("plan");
      setSel({ kind: "post", id: p.id });
    }
  }
  const camLayer = compact || layer === "cameras";

  // The camera the compact view is about: the focused one, else the alarming one.
  const targetCam: Camera | null = useMemo(() => {
    const id = focusCameraId ?? alarm?.camera_id;
    return geoCams.find((c) => c.camera_id === id) ?? null;
  }, [focusCameraId, alarm, geoCams]);
  const alarmCamId = camLayer ? (alarm?.camera_id ?? null) : null;
  const alarmBuildingId = alarmCamId
    ? (cameraBuilding[alarmCamId] ?? null)
    : null;

  // Route: nearest on-duty post → alarming camera (compact: → focused camera).
  const routeCam = compact
    ? targetCam
    : alarmCamId
      ? (geoCams.find((c) => c.camera_id === alarmCamId) ?? null)
      : null;
  const routeGuard = useMemo(
    () =>
      routeCam?.geo && camLayer ? nearestGuard(guards, routeCam.geo) : null,
    [routeCam, guards, camLayer],
  );
  const route = useMemo<[number, number][] | null>(
    () =>
      routeCam?.geo && routeGuard
        ? [
            [routeGuard.guard.post.lng, routeGuard.guard.post.lat],
            [routeCam.geo.lng, routeCam.geo.lat],
          ]
        : null,
    [routeCam, routeGuard],
  );

  // ── Size and WebGL ──
  useEffect(() => {
    setGl(hasWebGL2() ? "webgl" : "none");
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setW(Math.round(e.contentRect.width)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = w > 0 && w < NARROW;
  const flat = gl === "none";
  const homePitch = flat ? 0 : HOME_PITCH;
  const compactPitch = flat ? 0 : COMPACT_PITCH;

  // ── View state ──
  const homeView = useCallback((): MapViewState | null => {
    if (!allBounds || !w) return null;
    if (!narrow) return viewFor(allBounds, w, h, homePitch, 0.8, 19);
    // On a phone the screen is tall, so the long axis runs up the screen, and the
    // campus fits between the wrapped controls at the top and bottom.
    const top = 130;
    const bottom = 120;
    const avail = Math.max(120, h - top - bottom);
    const v = viewFor(allBounds, w, avail, homePitch, 0.72, 19, 0);
    const vp = new WebMercatorViewport({ ...v, width: w, height: h });
    const [lng, lat] = vp.unproject([w / 2, h / 2 - (top + avail / 2 - h / 2)]);
    return { ...v, longitude: lng, latitude: lat };
  }, [allBounds, w, h, homePitch, narrow]);

  const buildingView = useCallback(
    (
      b: Building,
      extra: { lat: number; lng: number }[],
      pitch: number,
      fill: number,
      bearing = HOME_BEARING,
    ) => {
      if (!w) return null;
      let bb = b.bounds;
      for (const p of extra) bb = grow(bb, p);
      return viewFor(bb, w, h, pitch, fill, 19.6, bearing);
    },
    [w, h],
  );

  const focusView = useCallback((): MapViewState | null => {
    if (!targetCam?.geo || (!focusCameraId && !compact)) return null;
    const b = byId.get(cameraBuilding[targetCam.camera_id] ?? "");
    const extra = [targetCam.geo];
    if (compact && routeGuard) extra.push(routeGuard.guard.post);
    // Compact: turn the map so the guard sits below the camera and the route runs up the screen.
    const bearing =
      compact && routeGuard
        ? azimuth(routeGuard.guard.post, targetCam.geo)
        : HOME_BEARING;
    if (!b) {
      const p = targetCam.geo;
      const d = 0.0004;
      return viewFor(
        {
          minLng: p.lng - d,
          maxLng: p.lng + d,
          minLat: p.lat - d,
          maxLat: p.lat + d,
        },
        w,
        h,
        compact ? compactPitch : homePitch,
        0.7,
        19.6,
        bearing,
      );
    }
    return buildingView(
      b,
      extra,
      compact ? compactPitch : homePitch,
      compact ? 0.6 : 0.5,
      bearing,
    );
  }, [
    targetCam,
    focusCameraId,
    compact,
    byId,
    cameraBuilding,
    routeGuard,
    buildingView,
    w,
    h,
    compactPitch,
    homePitch,
  ]);

  const [view, setView] = useState<View | null>(null);
  const touched = useRef(false);
  const fitKey = `${gl}|${w}x${h}|${allBounds ? 1 : 0}|${compact ? (focusCameraId ?? alarm?.camera_id ?? "") : (focusCameraId ?? "")}|${routeGuard?.guard.name ?? ""}`;
  const [prevFitKey, setPrevFitKey] = useState("");
  if (fitKey !== prevFitKey && w && allBounds) {
    // Fit on first size, on resize (until the user moves the view) and always in compact.
    const next = focusView() ?? homeView();
    if (next && (compact || !touched.current || !view)) {
      setPrevFitKey(fitKey);
      setView(next);
    } else if (next) {
      setPrevFitKey(fitKey);
    }
  }

  const flyTo = useCallback((target: MapViewState) => {
    touched.current = true;
    const ms = reducedMotion() ? 0 : 800;
    setView({
      ...target,
      ...(ms
        ? {
            transitionDuration: ms,
            transitionInterpolator: new FlyToInterpolator(),
          }
        : {}),
    });
  }, []);

  const nudge = useCallback(
    (patch: (v: MapViewState) => Partial<MapViewState>) => {
      touched.current = true;
      setView((v) => (v ? { ...v, ...patch(v), transitionDuration: 0 } : v));
    },
    [],
  );

  // ── Google Photorealistic 3D Tiles (only with a key, never in compact) ──
  const wantTiles = !!GOOGLE_KEY && !compact && gl === "webgl";
  const [tiles, setTiles] = useState<TileState>(wantTiles ? "loading" : "off");
  const [credits, setCredits] = useState<string[]>([]);
  useEffect(() => {
    if (!wantTiles) return;
    const t = setTimeout(
      () => setTiles((s) => (s === "ready" ? s : "failed")),
      TILE_TIMEOUT_MS,
    );
    return () => clearTimeout(t);
  }, [wantTiles]);
  const tilesLive = wantTiles && tiles !== "failed";
  const tilesReady = tilesLive && tiles === "ready";

  // ── Projection for HTML overlays ──
  const viewport = useMemo(() => {
    if (!view || !w) return null;
    return new WebMercatorViewport({
      width: w,
      height: h,
      longitude: view.longitude,
      latitude: view.latitude,
      zoom: view.zoom,
      pitch: flat ? 0 : view.pitch,
      bearing: view.bearing,
    });
  }, [view, w, h, flat]);
  const project = useCallback(
    (lng: number, lat: number, z = 0): [number, number] => {
      if (!viewport) return [-9999, -9999];
      const p = viewport.project([lng, lat, flat ? 0 : z]);
      return [p[0], p[1]];
    },
    [viewport, flat],
  );
  const onScreen = (p: [number, number]) =>
    p[0] > -60 && p[0] < w + 60 && p[1] > -40 && p[1] < h + 40;

  // ── Picking ──
  const pickBuilding = useCallback(
    (id: string) => {
      if (compact) return;
      if (layer === "plan") {
        const p = posts.find((q) => q.buildingId === id);
        setSel(p ? { kind: "post", id: p.id } : null);
      } else {
        const cam = geoCams.find((c) => cameraBuilding[c.camera_id] === id);
        setSel(cam ? { kind: "cam", id: cam.camera_id } : null);
      }
    },
    [compact, layer, posts, geoCams, cameraBuilding],
  );

  const selectedBuildingId =
    sel?.kind === "cam"
      ? (cameraBuilding[sel.id] ?? null)
      : sel?.kind === "post"
        ? (posts.find((p) => p.id === sel.id)?.buildingId ?? null)
        : null;

  // ── deck.gl layers ──
  const lighting = useMemo(
    () =>
      new LightingEffect({
        ambient: new AmbientLight({
          color: [255, 255, 255],
          intensity: LIGHT.ambient,
        }),
        top: new DirectionalLight({
          color: [255, 255, 255],
          intensity: LIGHT.top,
          direction: [0, 0, -1],
        }),
        side: new DirectionalLight({
          color: [255, 255, 255],
          intensity: LIGHT.side,
          direction: [1, 0.35, 0],
        }),
      }),
    [],
  );

  const layers = useMemo(() => {
    if (gl !== "webgl" || !geo) return [];
    const ground = geo.features.filter((f) => f.properties.kind !== "building");
    const blds = geo.features.filter((f) => f.properties.kind === "building");
    const idOf = (f: CampusFeature) => {
      const i = blds.indexOf(f);
      return f.properties.id ?? `b${f.properties.osm_way ?? i}`;
    };
    const flatParams = {
      depthWriteEnabled: false,
      depthCompare: "always" as const,
    };
    const out = [];
    if (tilesLive) {
      out.push(
        new Tile3DLayer({
          id: "google-3d-tiles",
          data: GOOGLE_ROOT,
          loadOptions: { fetch: { headers: { "X-GOOG-API-KEY": GOOGLE_KEY } } },
          onTileLoad: (tile: {
            content?: { gltf?: { asset?: { copyright?: string } } };
          }) => {
            setTiles("ready");
            const c = tile.content?.gltf?.asset?.copyright;
            if (c)
              setCredits((prev) => {
                const next = new Set(prev);
                c.split(";").forEach((s) => s.trim() && next.add(s.trim()));
                return next.size === prev.length ? prev : [...next];
              });
          },
          onTileError: () => setTiles((s) => (s === "ready" ? s : "failed")),
        }),
      );
    }
    if (!tilesReady) {
      out.push(
        new GeoJsonLayer<CampusFeature["properties"]>({
          id: "ground",
          data: { type: "FeatureCollection", features: ground } as never,
          filled: true,
          stroked: true,
          getFillColor: (f) =>
            f.properties.kind === "water"
              ? hex(COLORS.water)
              : f.properties.kind === "pitch"
                ? hex(COLORS.pitch)
                : hex(COLORS.ground),
          getLineColor: (f) =>
            f.properties.kind === "water"
              ? hex(COLORS.waterLine)
              : f.properties.kind === "pitch"
                ? hex(COLORS.pitchLine)
                : hex(COLORS.campusLine),
          lineWidthUnits: "pixels",
          getLineWidth: 1.5,
          parameters: flatParams,
        }),
      );
    }
    out.push(
      new GeoJsonLayer<CampusFeature["properties"]>({
        id: "buildings",
        data: { type: "FeatureCollection", features: blds } as never,
        extruded: true,
        wireframe: !tilesReady,
        filled: true,
        pickable: !compact,
        getElevation: (f) => f.properties.height_m_estimate ?? 12,
        getFillColor: (f) => {
          const id = idOf(f as CampusFeature);
          if (tilesReady)
            return id === alarmBuildingId
              ? hex(COLORS.alarmTop, 110)
              : [255, 255, 255, 1];
          if (id === alarmBuildingId) return baseForTop(COLORS.alarmTop);
          if (id === selectedBuildingId) return baseForTop(COLORS.selectedTop);
          return hex("#C9D0D9");
        },
        getLineColor: (f) => {
          const id = idOf(f as CampusFeature);
          if (id === alarmBuildingId) return hex(COLORS.alarmLine);
          if (id === selectedBuildingId) return hex(COLORS.selectedLine);
          return hex(COLORS.edge);
        },
        material: {
          ambient: 1,
          diffuse: 1,
          shininess: 1,
          specularColor: [0, 0, 0],
        },
        updateTriggers: {
          getFillColor: [alarmBuildingId, selectedBuildingId, tilesReady],
          getLineColor: [alarmBuildingId, selectedBuildingId],
        },
      }),
    );
    if (!compact && layer === "plan" && posts.length) {
      out.push(
        new ColumnLayer<PlanPost>({
          id: "plan-columns",
          data: posts,
          diskResolution: 24,
          radius: 5,
          extruded: true,
          pickable: true,
          getPosition: (p) => [p.geo.lng, p.geo.lat],
          getElevation: (p) => p.incidents4w * 9,
          getFillColor: baseForTop("#3653DC"),
          material: {
            ambient: 1,
            diffuse: 1,
            shininess: 1,
            specularColor: [0, 0, 0],
          },
        }),
      );
    }
    if (route) {
      out.push(
        new PathLayer<{ path: [number, number, number][] }>({
          id: "route",
          data: [{ path: route.map(([x, y]) => [x, y, 1]) }],
          getPath: (d: { path: [number, number, number][] }) => d.path,
          getColor: hex(COLORS.route),
          widthUnits: "pixels",
          getWidth: 3,
          capRounded: true,
          extensions: [new PathStyleExtension({ dash: true })],
          getDashArray: [3, 2],
          dashJustified: true,
          parameters: flatParams,
        } as never),
      );
    }
    return out;
  }, [
    gl,
    geo,
    tilesLive,
    tilesReady,
    compact,
    alarmBuildingId,
    selectedBuildingId,
    layer,
    posts,
    route,
  ]);

  const onDeckClick = useCallback(
    (info: PickingInfo) => {
      if (compact || !info.layer) return;
      if (info.layer.id === "buildings" && info.object) {
        const f = info.object as CampusFeature;
        const blds = (geo?.features ?? []).filter(
          (x) => x.properties.kind === "building",
        );
        const i = blds.findIndex(
          (x) => x.properties.osm_way === f.properties.osm_way,
        );
        pickBuilding(f.properties.id ?? `b${f.properties.osm_way ?? i}`);
      } else if (info.layer.id === "plan-columns" && info.object) {
        setSel({ kind: "post", id: (info.object as PlanPost).id });
      }
    },
    [compact, geo, pickBuilding],
  );

  // ── Overlays ──
  const camsIn = (bid: string) =>
    geoCams.filter((c) => cameraBuilding[c.camera_id] === bid);
  const liveCamIn = (bid: string) =>
    camsIn(bid).find((c) => sourceKind(c) === "live");

  const jumps = useMemo(() => {
    const withCams = buildings.filter((b) =>
      geoCams.some((c) => cameraBuilding[c.camera_id] === b.id),
    );
    withCams.sort((a, b) => b.centroid[1] - a.centroid[1]);
    return withCams.map((b) => {
      const live = geoCams.find(
        (c) => cameraBuilding[c.camera_id] === b.id && sourceKind(c) === "live",
      );
      return { id: b.id, label: live ? live.location.split(",")[0] : b.name };
    });
  }, [buildings, geoCams, cameraBuilding]);

  const jump = (bid: string | null) => {
    if (!bid) {
      const v = homeView();
      if (v) flyTo(v);
      return;
    }
    const b = byId.get(bid);
    if (!b) return;
    const v = buildingView(b, [], view?.pitch ?? homePitch, 0.5);
    if (v) flyTo({ ...v, bearing: view?.bearing ?? HOME_BEARING });
    if (layer === "plan") {
      const p = posts.find((q) => q.buildingId === bid);
      setSel(p ? { kind: "post", id: p.id } : null);
    } else {
      const c = camsIn(bid)[0];
      setSel(c ? { kind: "cam", id: c.camera_id } : null);
    }
  };

  const shownCams = compact
    ? targetCam
      ? [targetCam]
      : []
    : camLayer
      ? geoCams
      : [];
  const shownGuards = compact
    ? routeGuard
      ? [routeGuard.guard]
      : []
    : camLayer
      ? guards
      : [];

  const selCam =
    sel?.kind === "cam"
      ? (geoCams.find((c) => c.camera_id === sel.id) ?? null)
      : null;
  const selPost =
    sel?.kind === "post" ? (posts.find((p) => p.id === sel.id) ?? null) : null;

  const compactLabel =
    compact && targetCam
      ? `WHERE · ${targetCam.location.toUpperCase()}${
          routeGuard
            ? ` · ${routeGuard.guard.name.toUpperCase()} ~${roundTen(routeGuard.metres)} M AWAY`
            : ""
        }`
      : null;

  const credit = tilesReady
    ? `GOOGLE${credits.length ? " · " + credits.join(" · ").toUpperCase() : ""}`
    : `FOOTPRINTS © OPENSTREETMAP CONTRIBUTORS · HEIGHTS ESTIMATED${
        compact
          ? ""
          : flat
            ? " · TOP-DOWN, 3D NOT AVAILABLE HERE"
            : " · DRAG TO ROTATE"
      }`;

  const ready = !!view && !!viewport && !!geo;

  return (
    <div
      ref={wrapRef}
      className="relative w-full select-none overflow-hidden rounded-[2px] border border-line"
      style={{
        height: h,
        background: COLORS.background,
        touchAction: compact ? "auto" : "none",
      }}
      role="region"
      aria-label={
        compact
          ? `Campus map: ${targetCam?.location ?? "campus"}`
          : `3D view of ${site?.name ?? "the campus"} with ${layer === "plan" ? "patrol posts and hotspot columns" : "camera pins"}`
      }
    >
      {ready && gl === "webgl" && (
        <DeckGL
          viewState={view as MapViewState}
          onViewStateChange={({ viewState, interactionState }) => {
            if (
              interactionState?.isDragging ||
              interactionState?.isPanning ||
              interactionState?.isRotating ||
              interactionState?.isZooming
            )
              touched.current = true;
            setView(viewState as View);
          }}
          controller={
            compact
              ? false
              : {
                  dragMode: "rotate",
                  touchRotate: true,
                  inertia: false,
                  keyboard: true,
                }
          }
          layers={layers}
          effects={[lighting]}
          onClick={onDeckClick}
          onError={() => setGl("none")}
          getCursor={({ isDragging, isHovering }) =>
            compact
              ? "default"
              : isDragging
                ? "grabbing"
                : isHovering
                  ? "pointer"
                  : "grab"
          }
          width={w}
          height={h}
        />
      )}
      {ready && flat && geo && (
        <FlatMap
          geo={geo}
          width={w}
          height={h}
          project={project}
          alarmBuildingId={alarmBuildingId}
          selectedBuildingId={selectedBuildingId}
          columns={!compact && layer === "plan" ? posts.map((p) => p.geo) : []}
          route={route}
          onBuilding={pickBuilding}
        />
      )}
      {!ready && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="ee-label text-muted-foreground">
            Loading campus map
          </span>
        </div>
      )}

      {ready && (
        <div className="pointer-events-none absolute inset-0">
          {!compact &&
            !narrow &&
            buildings.map((b) => {
              const p = project(b.centroid[0], b.centroid[1], b.height + 3);
              if (!onScreen(p)) return null;
              const live = camLayer ? liveCamIn(b.id) : undefined;
              const n = camLayer ? camsIn(b.id).length : 0;
              const name = b.name.toUpperCase();
              const text = live
                ? `${live.location.split(",")[0].toUpperCase()} · ${name} · LIVE`
                : n
                  ? `${name} · ${n} CAM`
                  : name;
              return (
                <BuildingLabel
                  key={b.id}
                  text={text}
                  pos={p}
                  selected={b.id === selectedBuildingId}
                  alarm={!!live || b.id === alarmBuildingId}
                  onClick={() => pickBuilding(b.id)}
                />
              );
            })}
          {shownGuards.map((g) => {
            const p = project(g.post.lng, g.post.lat, 0);
            return onScreen(p) ? (
              <GuardChip key={g.name} name={g.name} pos={p} />
            ) : null;
          })}
          {shownCams.map((c) => {
            const p = project(c.geo!.lng, c.geo!.lat, c.geo!.alt_m ?? 6);
            if (!onScreen(p)) return null;
            const id = c.camera_id;
            return (
              <CameraPin
                key={id}
                camera={c}
                kind={sourceKind(c)}
                pos={p}
                alarming={id === alarm?.camera_id}
                selected={sel?.kind === "cam" && sel.id === id}
                onClick={() =>
                  compact
                    ? (onOpenCamera ?? onSelectCamera)?.(id)
                    : setSel({ kind: "cam", id })
                }
              />
            );
          })}
          {!compact &&
            layer === "plan" &&
            posts.map((q) => {
              const p = project(q.geo.lng, q.geo.lat, q.incidents4w * 9 + 4);
              return onScreen(p) ? (
                <PostPin
                  key={q.id}
                  post={q}
                  pos={p}
                  selected={sel?.kind === "post" && sel.id === q.id}
                  onClick={() => setSel({ kind: "post", id: q.id })}
                />
              ) : null;
            })}
        </div>
      )}

      {compactLabel && (
        <span className="absolute left-2 top-2 max-w-[calc(100%-16px)] border border-line bg-white px-1.5 py-0.5 font-mono text-[11px] font-bold">
          {compactLabel}
        </span>
      )}
      {compact && ready && (
        <span className="absolute bottom-1 right-1 bg-white/85 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
          {credit}
        </span>
      )}

      {!compact && ready && (
        <>
          <div
            className={cn(
              "pointer-events-none absolute left-3 top-3 flex flex-col gap-2",
              narrow || !(selCam || selPost) ? "right-3" : "right-[364px]",
            )}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <LayerToggle
                layer={layer}
                onChange={(l) => {
                  setLayer(l);
                  setSel(null);
                }}
              />
              {!narrow && (
                <span className="border border-line bg-white/90 px-2 py-[3px] font-mono text-[11px] font-bold uppercase">
                  {site?.name ?? "Campus"}
                </span>
              )}
            </div>
            <div
              role="group"
              aria-label="Jump to a building"
              className="flex flex-wrap gap-1"
            >
              {[
                ...jumps,
                { id: null as string | null, label: "Whole campus" },
              ].map((j) => (
                <button
                  key={j.id ?? "all"}
                  type="button"
                  onClick={() => jump(j.id)}
                  className="pointer-events-auto min-h-[30px] rounded-[2px] border border-line-strong bg-white/95 px-[9px] text-[12px] font-bold text-ink"
                >
                  {j.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2">
            <NavControls
              bearing={view?.bearing ?? 0}
              canTilt={!flat}
              onRotate={(d) =>
                nudge((v) => ({ bearing: (v.bearing ?? 0) + d }))
              }
              onTop={() =>
                nudge((v) => ({ pitch: Math.max(0, (v.pitch ?? 0) - 12) }))
              }
              onTilt={() =>
                nudge((v) => ({ pitch: Math.min(70, (v.pitch ?? 0) + 12) }))
              }
              onZoom={(d) =>
                nudge((v) => ({
                  zoom: Math.max(14.5, Math.min(20.5, v.zoom + d)),
                }))
              }
              onReset={() => {
                const v = homeView();
                if (v) flyTo(v);
                touched.current = false;
              }}
              onNorth={() => nudge(() => ({ bearing: 0 }))}
            />
            <div className="flex flex-col items-end gap-1">
              {!narrow && camLayer && <Legend />}
              <span className="bg-white/85 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {credit}
              </span>
            </div>
          </div>

          {selCam && (
            <CameraCard
              camera={selCam}
              kind={sourceKind(selCam)}
              buildingName={
                byId.get(cameraBuilding[selCam.camera_id] ?? "")?.name ?? null
              }
              event={latestEventFor(events ?? [], selCam.camera_id)}
              level={cameraLevel(events ?? [], selCam.camera_id)}
              sheet={narrow}
              onClose={() => setSel(null)}
              onOpen={
                onOpenCamera ? () => onOpenCamera(selCam.camera_id) : undefined
              }
              onDetails={
                onSelectCamera
                  ? () => onSelectCamera(selCam.camera_id)
                  : undefined
              }
            />
          )}
          {selPost && (
            <PostCard
              post={selPost}
              sheet={narrow}
              onClose={() => setSel(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
