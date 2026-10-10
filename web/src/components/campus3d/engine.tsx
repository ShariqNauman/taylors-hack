"use client";

// The 3D campus engine: deck.gl with Google Photorealistic 3D Tiles when a key
// exists, the OpenStreetMap footprints extruded otherwise, and a flat SVG when
// WebGL is missing. Loaded with next/dynamic, so it never touches the first paint.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { FlyToInterpolator, WebMercatorViewport, type MapViewState, type PickingInfo, type Position } from "@deck.gl/core";
import { ColumnLayer, GeoJsonLayer, PathLayer } from "@deck.gl/layers";
import { Tile3DLayer } from "@deck.gl/geo-layers";
import { PathStyleExtension, _TerrainExtension as TerrainExtension, type PathStyleExtensionProps } from "@deck.gl/extensions";
import { Tiles3DLoader } from "@loaders.gl/3d-tiles";
import "./campus3d.css";
import {
  alarmEvent,
  guardsOnDuty,
  nearestGuard,
  OSM_CREDIT,
  placeCameras,
  placePosts,
  roughMetres,
  shortFloor,
  useCampusAssets,
} from "./campus-data";
import { Credits, JumpChips, LayerToggle, Legend, ViewButtons } from "./controls";
import { CameraCard, PostCard } from "./info-card";
import { BuildingLabel, CameraPin, Chip, GuardChip, PostPin, type Px } from "./overlays";
import { C, FONT, hex } from "./tokens";
import type {
  Building,
  CampusCamera,
  CampusEvent,
  CampusGeo,
  CampusSite,
  GeoPoint,
  Mode,
  PatrolPlan,
  PlacedCamera,
  PlacedPost,
  SiteView,
} from "./types";

export interface Campus3DProps {
  mode: Mode;
  /** Live card: locked view, no controls, no info card. */
  compact?: boolean;
  /** Compact and deep links: frame this camera's building. */
  focusCameraId?: string;
  /** Plan deep link (`?slot=P/01`): open this post's card. */
  focusPostId?: string;
  cameras?: CampusCamera[];
  site?: CampusSite;
  events?: CampusEvent[];
  plan?: PatrolPlan;
  /** Called with the camera id when the card's buttons are used. */
  onOpenCamera?: (id: string) => void;
  /** On-site desk or remote link. The remote link never loads an edge_url. Default remote. */
  view?: SiteView;
  /** Google 3D Tiles are used when true and NEXT_PUBLIC_GOOGLE_MAPS_API_KEY exists. Never in compact. Default true. */
  allowTiles?: boolean;
  /** Overrides the seed's ground_alt_m_estimate (metres the pins are lifted over the tiles). Tuning aid. */
  groundAltOverride?: number;
  className?: string;
}

const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const TILESET_URL = "https://tile.googleapis.com/v1/3dtiles/root.json";
/** Footprints show while tiles load; give up 5 s after the tileset JSON arrives (the key works then), 20 s at most. */
const TILE_TIMEOUT_MS = 5000;
const TILE_HARD_TIMEOUT_MS = 20000;
const HOME_PITCH = 50;
const HOME_BEARING = 90; // the north–south long axis runs across the screen
const FOCUS_ZOOM = 18.0;
const FLY_MS = 800;
const MIN_PITCH = 0;
const MAX_PITCH = 72;
const MIN_ZOOM = 15.5;
const MAX_ZOOM = 20.5;

type Sel = { kind: "camera"; id: string } | { kind: "post"; id: string } | null;
type TilesState = "off" | "loading" | "on" | "failed";

interface Jump {
  label: string;
  buildingId?: string;
  cameraId?: string;
  postLocation?: string;
}
const JUMPS: Jump[] = [
  { label: "Grand Hall", buildingId: "blockab", cameraId: "CAM-AU-01" },
  { label: "Block C", buildingId: "blockc" },
  { label: "Syopz Mall", buildingId: "syopz", cameraId: "CAM-CT-04", postLocation: "Syopz Mall food court" },
  { label: "U Residence", buildingId: "syopz", cameraId: "CAM-HC-01", postLocation: "U Residence, corridor L3" },
  { label: "Sports centre", buildingId: "sports" },
  { label: "Whole campus" },
];

// ── Small hooks ──

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width > 0 && r.height > 0) setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
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

function useClock(enabled: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

// ── View maths ──

const M_PER_DEG_LAT = 111_320;

/** Zoom and centre that fit the campus bounds at this bearing, with the long axis across the width. */
function fitView(geo: CampusGeo, w: number, h: number, bearing: number, pad = 24): Pick<MapViewState, "longitude" | "latitude" | "zoom"> {
  const [[minLng, minLat], [maxLng, maxLat]] = geo.bounds;
  const lat0 = (minLat + maxLat) / 2;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const corners = [
    [0, 0],
    [(maxLng - minLng) * M_PER_DEG_LAT * k, 0],
    [(maxLng - minLng) * M_PER_DEG_LAT * k, (maxLat - minLat) * M_PER_DEG_LAT],
    [0, (maxLat - minLat) * M_PER_DEG_LAT],
  ];
  const b = (bearing * Math.PI) / 180;
  const us = corners.map(([x, y]) => x * Math.cos(b) - y * Math.sin(b));
  const vs = corners.map(([x, y]) => x * Math.sin(b) + y * Math.cos(b));
  const spanU = Math.max(...us) - Math.min(...us);
  const spanV = Math.max(...vs) - Math.min(...vs);
  const mpp = Math.max(spanU / Math.max(80, w - 2 * pad), spanV / Math.max(80, h - 2 * pad));
  // deck.gl zoom is on 512-px tiles: 78 271.52 m/px at zoom 0 on the equator.
  const zoom = Math.log2((78_271.52 * k) / mpp);
  return { longitude: (minLng + maxLng) / 2, latitude: lat0, zoom };
}

function compactZoom(w: number): number {
  // About 150 m across a 420 px card.
  return Math.min(19.2, Math.max(16.8, 17.7 + Math.log2(Math.max(200, w) / 420)));
}

// ── Engine ──

export default function Campus3DEngine({
  mode: modeProp,
  compact = false,
  focusCameraId,
  focusPostId,
  cameras,
  site,
  events,
  plan,
  onOpenCamera,
  view = "remote",
  allowTiles = true,
  groundAltOverride,
  className,
}: Campus3DProps) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const reduced = useReducedMotion();
  const { seed, geo, error } = useCampusAssets();
  const [webgl, setWebgl] = useState<boolean | null>(null);
  useEffect(() => setWebgl(hasWebGL()), []);

  const [mode, setMode] = useState<Mode>(modeProp);
  useEffect(() => setMode(modeProp), [modeProp]);

  const [viewState, setViewState] = useState<MapViewState | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [tiles, setTiles] = useState<TilesState>("off");
  const [credits, setCredits] = useState("");
  const now = useClock(!compact);

  // ── Data placed on the map ──
  const placed = useMemo<PlacedCamera[]>(
    () => (seed && geo ? placeCameras(cameras, seed, geo, events) : []),
    [cameras, seed, geo, events],
  );
  const posts = useMemo<PlacedPost[]>(() => (seed && geo ? placePosts(plan, seed, geo) : []), [plan, seed, geo]);
  const guards = useMemo(() => (seed ? guardsOnDuty(site?.staff, seed) : []), [site?.staff, seed]);
  const alarm = useMemo(() => alarmEvent(events), [events]);
  const alarmCam = useMemo(() => (alarm ? (placed.find((p) => p.id === alarm.camera_id) ?? null) : null), [alarm, placed]);
  const focusCam = useMemo(
    () => (focusCameraId ? (placed.find((p) => p.id === focusCameraId) ?? null) : null),
    [focusCameraId, placed],
  );
  const compactCam = compact ? (focusCam ?? alarmCam) : null;
  const routeCam = compact ? compactCam : mode === "cameras" ? alarmCam : null;
  const near = useMemo(() => (routeCam ? nearestGuard(guards, routeCam.geo) : null), [guards, routeCam]);
  const alarmBuildingId = mode === "cameras" ? (alarmCam?.buildingId ?? null) : null;
  const selCam = sel?.kind === "camera" ? (placed.find((p) => p.id === sel.id) ?? null) : null;
  const selPost = sel?.kind === "post" ? (posts.find((p) => p.id === sel.id) ?? null) : null;
  const selBuildingId = selCam?.buildingId ?? selPost?.buildingId ?? null;
  const groundAlt = groundAltOverride ?? seed?.campus.ground_alt_m_estimate ?? 0;

  // ── Tiles: wanted only with a key, outside compact, on WebGL ──
  const tilesWanted = allowTiles && !compact && !!GOOGLE_KEY && webgl === true;
  useEffect(() => {
    if (!tilesWanted) {
      setTiles("off");
      return;
    }
    setTiles("loading");
    tilesStartedAt.current = performance.now();
    tilesetAt.current = 0;
    const giveUp = () =>
      setTiles((s) => {
        if (s === "loading") console.warn(`[campus3d] no Google tile ${Math.round(performance.now() - tilesStartedAt.current)} ms after start, showing footprints`);
        return s === "loading" ? "failed" : s;
      });
    const hard = setTimeout(giveUp, TILE_HARD_TIMEOUT_MS);
    const soft = setInterval(() => {
      if (tilesetAt.current && performance.now() - tilesetAt.current > TILE_TIMEOUT_MS) {
        clearInterval(soft);
        giveUp();
      }
    }, 500);
    return () => {
      clearTimeout(hard);
      clearInterval(soft);
    };
  }, [tilesWanted]);
  const tilesOn = tiles === "on";
  const tilesLayer = tiles === "loading" || tiles === "on";
  const liftAlt = tilesOn ? groundAlt : 0;

  // ── Initial view ──
  const homeView = useCallback((): MapViewState | null => {
    if (!geo || !size) return null;
    if (compact) {
      if (!compactCam) return { ...fitView(geo, size.w, size.h, HOME_BEARING, 16), pitch: 50, bearing: HOME_BEARING };
      return { longitude: compactCam.geo.lng, latitude: compactCam.geo.lat, zoom: compactZoom(size.w), pitch: 55, bearing: HOME_BEARING };
    }
    return { ...fitView(geo, size.w, size.h, HOME_BEARING), pitch: HOME_PITCH, bearing: HOME_BEARING };
  }, [geo, size, compact, compactCam]);

  useEffect(() => {
    if (viewState) return;
    const v = homeView();
    if (v) setViewState(v);
  }, [viewState, homeView]);

  // Compact: keep the view locked on the focused camera when it changes.
  const compactKey = compactCam?.id ?? "";
  useEffect(() => {
    if (!compact) return;
    const v = homeView();
    if (v) setViewState(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, compactKey, size?.w]);

  const flyTo = useCallback(
    (target: Partial<MapViewState>) => {
      setViewState((v) =>
        v
          ? {
              ...v,
              ...target,
              transitionDuration: reduced ? 0 : FLY_MS,
              transitionInterpolator: new FlyToInterpolator(),
            }
          : v,
      );
    },
    [reduced],
  );

  // Deep link: preselect and frame the focused camera once, in full mode.
  const focusedOnce = useRef<string | null>(null);
  useEffect(() => {
    if (compact || !focusCam || !viewState || focusedOnce.current === focusCam.id) return;
    focusedOnce.current = focusCam.id;
    setSel({ kind: "camera", id: focusCam.id });
    flyTo({ longitude: focusCam.geo.lng, latitude: focusCam.geo.lat, zoom: FOCUS_ZOOM });
  }, [compact, focusCam, viewState, flyTo]);

  const focusedPostOnce = useRef<string | null>(null);
  useEffect(() => {
    if (compact || mode !== "plan" || !focusPostId || !viewState) return;
    const q = posts.find((p) => p.id.toLowerCase() === focusPostId.toLowerCase());
    if (!q || focusedPostOnce.current === q.id) return;
    focusedPostOnce.current = q.id;
    setSel({ kind: "post", id: q.id });
    flyTo({ longitude: q.geo.lng, latitude: q.geo.lat, zoom: FOCUS_ZOOM });
  }, [compact, mode, focusPostId, posts, viewState, flyTo]);

  // ── Projection for the HTML overlays ──
  const viewport = useMemo(() => {
    if (!size || !viewState) return null;
    return new WebMercatorViewport({
      width: size.w,
      height: size.h,
      longitude: viewState.longitude,
      latitude: viewState.latitude,
      zoom: viewState.zoom,
      pitch: viewState.pitch ?? 0,
      bearing: viewState.bearing ?? 0,
    });
  }, [size, viewState]);

  const flat = useMemo(() => {
    // Flat top-down projection for the no-WebGL view: metres to pixels, north up.
    if (!geo || !size) return null;
    const [[minLng, minLat], [maxLng, maxLat]] = geo.bounds;
    const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
    const wM = (maxLng - minLng) * M_PER_DEG_LAT * k;
    const hM = (maxLat - minLat) * M_PER_DEG_LAT;
    const s = Math.min((size.w - 24) / wM, (size.h - 24) / hM);
    const ox = (size.w - wM * s) / 2;
    const oy = (size.h - hM * s) / 2;
    return (lng: number, lat: number): [number, number] => [
      ox + (lng - minLng) * M_PER_DEG_LAT * k * s,
      oy + (maxLat - lat) * M_PER_DEG_LAT * s,
    ];
  }, [geo, size]);

  const project = useCallback(
    (g: GeoPoint, alt = 0): Px => {
      if (!size) return null;
      let x: number;
      let y: number;
      if (webgl === false) {
        if (!flat) return null;
        [x, y] = flat(g.lng, g.lat);
      } else {
        if (!viewport) return null;
        [x, y] = viewport.project([g.lng, g.lat, liftAlt + alt]);
      }
      if (x < -80 || y < -80 || x > size.w + 80 || y > size.h + 80) return null;
      return [x, y];
    },
    [size, webgl, flat, viewport, liftAlt],
  );

  // ── Selection helpers ──
  const camsIn = useCallback((buildingId: string) => placed.filter((p) => p.buildingId === buildingId), [placed]);
  const postsIn = useCallback((buildingId: string) => posts.filter((p) => p.buildingId === buildingId), [posts]);
  const pickBuilding = useCallback(
    (buildingId: string) => {
      if (compact) return;
      if (mode === "plan") {
        const q = postsIn(buildingId)[0];
        setSel(q ? { kind: "post", id: q.id } : null);
      } else {
        const cams = camsIn(buildingId);
        const pick = cams.find((c) => c.id === alarmCam?.id) ?? cams.find((c) => c.kind === "live") ?? cams[0];
        setSel(pick ? { kind: "camera", id: pick.id } : null);
      }
    },
    [compact, mode, postsIn, camsIn, alarmCam],
  );

  const jump = useCallback(
    (i: number) => {
      const j = JUMPS[i];
      if (!j.buildingId) {
        const v = homeView();
        if (v) flyTo(v);
        setSel(null);
        return;
      }
      const b = geo?.buildings.find((x) => x.id === j.buildingId);
      const cam = j.cameraId ? placed.find((p) => p.id === j.cameraId) : undefined;
      const target: GeoPoint = cam?.geo ?? (b ? { lng: b.centroid[0], lat: b.centroid[1] } : seed!.campus.center);
      flyTo({ longitude: target.lng, latitude: target.lat, zoom: FOCUS_ZOOM });
      if (mode === "plan") {
        const q =
          (j.postLocation && posts.find((p) => p.slot.location.toLowerCase() === j.postLocation!.toLowerCase())) ||
          postsIn(j.buildingId)[0];
        setSel(q ? { kind: "post", id: q.id } : null);
      } else {
        const c = cam ?? camsIn(j.buildingId)[0];
        setSel(c ? { kind: "camera", id: c.id } : null);
      }
    },
    [homeView, flyTo, geo, placed, seed, mode, posts, postsIn, camsIn],
  );

  // ── deck.gl layers ──
  const buildingsFC = useMemo(
    () =>
      geo
        ? {
            type: "FeatureCollection" as const,
            features: geo.buildings.map((b) => ({
              type: "Feature" as const,
              properties: { id: b.id, height: b.height },
              geometry: { type: "Polygon" as const, coordinates: [b.ring] },
            })),
          }
        : null,
    [geo],
  );
  const groundFC = useCallback(
    (rings: [number, number][][]) => ({
      type: "FeatureCollection" as const,
      features: rings.map((ring) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [ring] } })),
    }),
    [],
  );

  const tileLoaded = useRef(false);
  const tilesStartedAt = useRef(0);
  const tilesetAt = useRef(0);
  const layers = useMemo(() => {
    if (!geo || !buildingsFC) return [];
    const out: unknown[] = [];
    const terrain = tilesOn ? { extensions: [new TerrainExtension()], terrainDrawMode: "offset" as const } : {};

    if (tilesLayer) {
      out.push(
        new Tile3DLayer({
          id: "google-3d-tiles",
          data: TILESET_URL,
          loaders: [Tiles3DLoader],
          loadOptions: { fetch: { headers: { "X-GOOG-API-KEY": GOOGLE_KEY } } },
          operation: "terrain+draw",
          onTilesetLoad: (tileset) => {
            tilesetAt.current = performance.now();
            console.info(`[campus3d] Google tileset loaded after ${Math.round(tilesetAt.current - tilesStartedAt.current)} ms`);
            tileset.options.onTraversalComplete = (selected) => {
              const set = new Set<string>();
              for (const t of selected) {
                const copyright: string | undefined = t.content?.gltf?.asset?.copyright;
                copyright?.split(";").forEach((c) => c.trim() && set.add(c.trim()));
              }
              setCredits([...set].join("; "));
              return selected;
            };
          },
          onTileLoad: () => {
            if (!tileLoaded.current) console.info(`[campus3d] first Google tile loaded after ${Math.round(performance.now() - tilesStartedAt.current)} ms`);
            tileLoaded.current = true;
            setTiles((s) => (s === "loading" ? "on" : s));
          },
          onTileError: (_tile, url, message) => {
            console.warn("[campus3d] Google tile error", url, message);
            if (!tileLoaded.current) setTiles("failed");
          },
        }),
      );
    }

    if (!tilesOn) {
      if (geo.campus) {
        out.push(
          new GeoJsonLayer({
            id: "campus",
            data: groundFC([geo.campus]),
            filled: true,
            stroked: true,
            getFillColor: hex(C.raised),
            getLineColor: hex(C.lineStrong),
            lineWidthMinPixels: 1.5,
            lineWidthMaxPixels: 1.5,
            extensions: [new PathStyleExtension({ dash: true, highPrecisionDash: true })],
            getDashArray: [6, 4],
            dashJustified: true,
          }),
        );
      }
      out.push(
        new GeoJsonLayer({
          id: "water",
          data: groundFC(geo.water),
          filled: true,
          stroked: true,
          getFillColor: hex(C.water),
          getLineColor: hex(C.waterLine),
          lineWidthMinPixels: 1.5,
          lineWidthMaxPixels: 1.5,
        }),
        new GeoJsonLayer({
          id: "pitches",
          data: groundFC(geo.pitches.map((p) => p.ring)),
          filled: true,
          stroked: true,
          getFillColor: hex(C.pitch),
          getLineColor: hex(C.pitchLine),
          lineWidthMinPixels: 1.5,
          lineWidthMaxPixels: 1.5,
        }),
      );
    }

    // Footprints: the fallback buildings, or an invisible pick target over Google's tiles.
    out.push(
      new GeoJsonLayer({
        id: "buildings",
        data: buildingsFC,
        extruded: true,
        wireframe: true,
        filled: true,
        stroked: false,
        pickable: !compact,
        getElevation: (f: { properties: { height: number } }) => f.properties.height,
        getFillColor: (f: { properties: { id: string } }) => {
          const id = f.properties.id;
          if (id === alarmBuildingId) return hex(C.likelyTint, tilesOn ? 150 : 255);
          if (id === selBuildingId) return hex(C.signalTint, tilesOn ? 120 : 255);
          return tilesOn ? [255, 255, 255, 2] : hex(C.buildingTop);
        },
        getLineColor: (f: { properties: { id: string } }) => {
          const id = f.properties.id;
          if (id === alarmBuildingId) return hex(C.likely);
          if (id === selBuildingId) return hex(C.signal);
          return tilesOn ? [0, 0, 0, 0] : hex(C.buildingLine);
        },
        lineWidthMinPixels: 1,
        material: { ambient: 0.72, diffuse: 0.5, shininess: 6, specularColor: [30, 30, 30] },
        onClick: (info: PickingInfo<{ properties: { id: string } }>) => {
          if (info.object) pickBuilding(info.object.properties.id);
          return true;
        },
        updateTriggers: { getFillColor: [alarmBuildingId, selBuildingId, tilesOn], getLineColor: [alarmBuildingId, selBuildingId, tilesOn] },
        ...terrain,
      }),
    );

    if (mode === "plan" && !compact) {
      out.push(
        new ColumnLayer<PlacedPost>({
          id: "columns",
          data: posts,
          diskResolution: 4,
          angle: 45,
          radius: 5,
          extruded: true,
          pickable: true,
          getPosition: (d) => [d.geo.lng, d.geo.lat],
          getElevation: (d) => d.slot.incidents_4w * 9,
          getFillColor: (d) => (d.id === selPost?.id ? hex(C.signalInk) : hex(C.column)),
          getLineColor: hex(C.signalInk),
          material: { ambient: 0.7, diffuse: 0.5, shininess: 6, specularColor: [30, 30, 30] },
          onClick: (info) => {
            if (info.object) setSel({ kind: "post", id: info.object.id });
            return true;
          },
          updateTriggers: { getFillColor: [selPost?.id] },
          ...terrain,
        }),
      );
    }

    if (routeCam && near) {
      out.push(
        new PathLayer<{ path: Position[] }, PathStyleExtensionProps<{ path: Position[] }>>({
          id: "route",
          data: [
            {
              path: [
                [near.guard.post.lng, near.guard.post.lat, 0.5],
                [routeCam.geo.lng, routeCam.geo.lat, routeCam.geo.alt_m ?? 0],
              ],
            },
          ],
          getPath: (d) => d.path,
          getColor: hex(C.signal),
          getWidth: 3,
          widthUnits: "pixels",
          extensions: [new PathStyleExtension({ dash: true, highPrecisionDash: true }), ...(tilesOn ? [new TerrainExtension()] : [])],
          getDashArray: [8, 6],
          dashJustified: true,
          ...(tilesOn ? { terrainDrawMode: "offset" as const } : {}),
        }),
      );
    }
    return out;
  }, [geo, buildingsFC, groundFC, tilesLayer, tilesOn, compact, alarmBuildingId, selBuildingId, pickBuilding, mode, posts, selPost?.id, routeCam, near]);

  // ── Derived overlay content ──
  const visibleCams = compact ? (compactCam ? [compactCam] : []) : mode === "cameras" ? placed : [];
  const visibleGuards = compact ? (near ? [near.guard] : []) : mode === "cameras" ? guards : [];
  const liveCam = placed.find((p) => p.kind === "live");

  const labelFor = (b: Building): string => {
    const base = b.name.split(" @")[0].toUpperCase();
    const hostel = b.contains?.some((s) => /U Residence/i.test(s)) ? " · U RESIDENCE ABOVE" : "";
    if (mode === "plan") {
      const n = postsIn(b.id).length;
      return `${base}${hostel}${n ? ` · ${n} POST${n > 1 ? "S" : ""}` : ""}`;
    }
    const cams = camsIn(b.id);
    if (liveCam && liveCam.buildingId === b.id) return `${liveCam.location.toUpperCase()} · ${base} · LIVE`;
    return `${base}${hostel}${cams.length ? ` · ${cams.length} CAM` : ""}`;
  };

  const whereLabel = (() => {
    if (!compactCam) {
      const ev = events?.find((e) => e.camera_id === focusCameraId) ?? alarm;
      return `WHERE · ${(ev?.location ?? "THIS CAMERA").toUpperCase()} · NOT ON THE MAP YET`;
    }
    const place = [compactCam.location, [compactCam.building, compactCam.floor ? shortFloor(compactCam.floor) : ""].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");
    const guard = near ? ` · ${near.guard.name} ~${roughMetres(near.metres)} M AWAY` : "";
    return `WHERE · ${place}${guard}`.toUpperCase();
  })();

  const creditText = tilesOn
    ? `${OSM_CREDIT} (pick targets)`
    : `${OSM_CREDIT} · ${geo?.buildings.some((b) => b.heightEstimated) ? "heights estimated · " : ""}drag to rotate`;

  const containerStyle: React.CSSProperties = {
    position: "relative",
    width: "100%",
    aspectRatio: compact ? "16 / 10" : "1200 / 640",
    minHeight: compact ? 200 : 360,
    maxHeight: compact ? 320 : "72vh",
    background: C.mapBg,
    border: `1px solid ${C.line}`,
    borderRadius: 2,
    overflow: "hidden",
    fontFamily: FONT.sans,
    color: C.ink,
    userSelect: "none",
  };

  const ready = !!(geo && seed && size && viewState);
  const aria = `3D view of ${seed?.campus.name ?? "the campus"} with ${mode === "plan" ? "patrol posts and hotspot columns" : "camera pins"}`;

  return (
    <div ref={ref} className={className} style={containerStyle} role="region" aria-label={aria}>
      {error && (
        <p style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontFamily: FONT.mono, fontSize: 12, color: C.muted, margin: 0 }}>
          CAMPUS FOOTPRINTS DID NOT LOAD
        </p>
      )}
      {!ready && !error && (
        <p style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontFamily: FONT.mono, fontSize: 12, color: C.muted, margin: 0 }}>
          LOADING THE CAMPUS…
        </p>
      )}

      {ready && webgl === false && geo && flat && <FlatSvg geo={geo} flat={flat} w={size!.w} h={size!.h} alarmBuildingId={alarmBuildingId} selBuildingId={selBuildingId} onPick={pickBuilding} />}

      {ready && webgl && (
        <div style={{ position: "absolute", inset: 0 }}>
          <DeckGL
            viewState={{ ...viewState!, minPitch: MIN_PITCH, maxPitch: MAX_PITCH, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM }}
            onViewStateChange={({ viewState: v }) => setViewState(v as MapViewState)}
            controller={
              compact
                ? false
                : {
                    dragMode: "rotate",
                    dragPan: true,
                    dragRotate: true,
                    scrollZoom: { smooth: false },
                    touchRotate: true,
                    keyboard: false,
                    inertia: false,
                  }
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            layers={layers as any}
            getCursor={({ isDragging, isHovering }) => (compact ? "default" : isDragging ? "grabbing" : isHovering ? "pointer" : "grab")}
            onClick={(info: PickingInfo) => {
              if (!info.object && !compact) setSel(null);
            }}
            onError={(err) => {
              console.warn("[campus3d] deck.gl error", err);
              if (tiles === "loading") setTiles("failed");
            }}
          />
        </div>
      )}

      {/* Overlay plane: real buttons projected onto the map. */}
      {ready && (
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {!compact &&
            geo!.buildings.map((b) => (
              <BuildingLabel
                key={b.id}
                text={labelFor(b)}
                px={project({ lng: b.centroid[0], lat: b.centroid[1] }, b.height + 3)}
                selected={b.id === selBuildingId}
                live={mode === "cameras" && !!liveCam && liveCam.buildingId === b.id}
                onPick={() => pickBuilding(b.id)}
              />
            ))}
          {visibleGuards.map((g) => (
            <GuardChip key={g.name} name={g.name} px={project(g.post)} />
          ))}
          {visibleCams.map((cam) => (
            <CameraPin
              key={cam.id}
              cam={cam}
              px={project(cam.geo, cam.geo.alt_m ?? 0)}
              selected={!compact && sel?.kind === "camera" && sel.id === cam.id}
              alarming={!!alarmCam && alarmCam.id === cam.id}
              onPick={(id) => !compact && setSel({ kind: "camera", id })}
            />
          ))}
          {mode === "plan" &&
            !compact &&
            posts.map((p) => (
              <PostPin
                key={p.id}
                post={p}
                px={project(p.geo, p.slot.incidents_4w * 9 + 4)}
                selected={sel?.kind === "post" && sel.id === p.id}
                onPick={(id) => setSel({ kind: "post", id })}
              />
            ))}
        </div>
      )}

      {/* Top-left: layer toggle, site name, jump chips. */}
      {!compact && (
        <div style={{ position: "absolute", left: 12, top: 12, display: "flex", flexDirection: "column", gap: 8, maxWidth: "calc(100% - 24px)", zIndex: 4 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <LayerToggle
              mode={mode}
              onChange={(m) => {
                setMode(m);
                setSel(null);
              }}
            />
            <Chip>{(seed?.campus.name ?? "").toUpperCase()}</Chip>
            {tiles === "loading" && <Chip style={{ borderStyle: "dashed" }}>LOADING GOOGLE 3D TILES…</Chip>}
            {tiles === "failed" && <Chip style={{ borderStyle: "dashed" }}>FOOTPRINT VIEW · TILES DID NOT LOAD</Chip>}
          </div>
          <JumpChips jumps={JUMPS} onJump={jump} />
        </div>
      )}

      {compact && (
        <Chip style={{ position: "absolute", left: 8, top: 8, zIndex: 4 }}>{whereLabel}</Chip>
      )}

      {/* Info card. */}
      {!compact && selCam && (
        <CameraCard cam={selCam} view={view} now={now} onClose={() => setSel(null)} onOpenCamera={onOpenCamera} />
      )}
      {!compact && selPost && (
        <PostCard
          post={selPost}
          cameraId={placed.find((p) => p.location.toLowerCase() === selPost.slot.location.toLowerCase())?.id}
          onClose={() => setSel(null)}
        />
      )}

      {/* Bottom-left: view buttons. Bottom-right: legend and credits. */}
      {!compact && viewState && (
        <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 4, maxWidth: "calc(100% - 24px)" }}>
          {webgl ? (
            <ViewButtons
              bearing={viewState.bearing ?? 0}
              onRotate={(deg) => setViewState((v) => (v ? { ...v, bearing: (v.bearing ?? 0) + deg, transitionDuration: 0 } : v))}
              onTilt={(dir) =>
                setViewState((v) =>
                  v ? { ...v, pitch: Math.max(MIN_PITCH, Math.min(MAX_PITCH, (v.pitch ?? 0) + (dir === "top" ? -15 : 15))), transitionDuration: 0 } : v,
                )
              }
              onZoom={(d) => setViewState((v) => (v ? { ...v, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom + d)), transitionDuration: 0 } : v))}
              onReset={() => {
                const v = homeView();
                if (v) flyTo(v);
              }}
            />
          ) : (
            <Chip style={{ borderStyle: "dashed" }}>FLAT VIEW · WEBGL IS OFF IN THIS BROWSER</Chip>
          )}
        </div>
      )}
      {!compact && (
        <div style={{ position: "absolute", right: 12, bottom: 12, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, zIndex: 4, maxWidth: "calc(100% - 24px)" }}>
          <Legend mode={mode} />
          <Credits text={creditText} google={tilesOn ? credits : null} />
        </div>
      )}
      {compact && (
        <span style={{ position: "absolute", right: 6, bottom: 4, fontFamily: FONT.mono, fontSize: 9, color: C.muted, background: "rgba(255,255,255,0.8)", padding: "1px 4px" }}>
          {OSM_CREDIT.toUpperCase()}
        </span>
      )}
    </div>
  );
}

// ── Flat top-down footprints, for browsers without WebGL ──

function FlatSvg({
  geo,
  flat,
  w,
  h,
  alarmBuildingId,
  selBuildingId,
  onPick,
}: {
  geo: CampusGeo;
  flat: (lng: number, lat: number) => [number, number];
  w: number;
  h: number;
  alarmBuildingId: string | null;
  selBuildingId: string | null;
  onPick: (id: string) => void;
}) {
  const d = (ring: [number, number][]) => "M" + ring.map(([x, y]) => flat(x, y).map((n) => n.toFixed(1)).join(" ")).join("L") + "Z";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ position: "absolute", inset: 0 }} aria-hidden="true">
      <rect width={w} height={h} fill={C.mapBg} />
      {geo.campus && <path d={d(geo.campus)} fill={C.raised} stroke={C.lineStrong} strokeWidth="1.5" strokeDasharray="6 4" />}
      {geo.water.map((r, i) => (
        <path key={`w${i}`} d={d(r)} fill={C.water} stroke={C.waterLine} strokeWidth="1.5" />
      ))}
      {geo.pitches.map((p, i) => (
        <path key={`p${i}`} d={d(p.ring)} fill={C.pitch} stroke={C.pitchLine} strokeWidth="1.5" />
      ))}
      {geo.buildings.map((b) => (
        <path
          key={b.id}
          d={d(b.ring)}
          fill={b.id === alarmBuildingId ? C.likelyTint : b.id === selBuildingId ? C.signalTint : C.buildingTop}
          stroke={b.id === alarmBuildingId ? C.likely : b.id === selBuildingId ? C.signal : C.buildingLine}
          strokeWidth="1.2"
          style={{ cursor: "pointer", pointerEvents: "auto" }}
          onClick={() => onPick(b.id)}
        />
      ))}
    </svg>
  );
}
