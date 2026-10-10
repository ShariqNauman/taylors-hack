// Types the 3D campus reads. They extend the v2 contract in lib/types with the
// v3 optional fields (geo, source, edge_url, snapshot, staff posts). They are
// declared here so the map builds on either contract version; the fields are
// identical to the v3 contract and collapse into lib/types once that lands.
import type { Camera, Event, PatrolPlan, PatrolSlot, Site } from "@/lib/types";

export interface GeoPoint {
  lat: number;
  lng: number;
  alt_m?: number;
}

/** What a pin is: the one live webcam, one of our labelled recordings, or black. */
export type PinKind = "live" | "recorded" | "black";

export interface CampusCamera extends Camera {
  geo?: GeoPoint & { building?: string; floor?: string };
  source?: "live" | "recorded";
  recorded_at?: string; // ISO, +08:00; set for recordings
  edge_url?: string; // on-site view only; the remote link never loads it
  people_count?: number;
}

export interface CampusStaff {
  name: string;
  zone_type: string;
  on_duty: boolean;
  post?: GeoPoint | null;
}

export interface CampusSite extends Site {
  staff?: CampusStaff[];
  campus?: { center: GeoPoint; buildings: string };
}

/** x, y normalised 0–1 in the camera frame; conf 0–1. */
export type Keypoint = [x: number, y: number, conf: number];

/** 12 body keypoints, COCO 5–16, no face points. */
export interface PoseFrame {
  t: string;
  people: { id: number; kp: Keypoint[] }[];
}

export interface CampusEvent extends Event {
  snapshot?: PoseFrame;
  peak_snapshot?: PoseFrame;
}

export type { PatrolPlan, PatrolSlot };

// ── Seed (web/public/campus/campus-3d-seed.json) ──

export interface SeedCamera {
  camera_id: string;
  location: string;
  building: string;
  zone_type: string;
  source: PinKind;
  floor: string;
  geo: GeoPoint;
}

export interface SeedPost {
  slot: string; // "P/01"
  location: string;
  days: string;
  hours: string;
  geo: GeoPoint;
}

export interface CampusSeed {
  campus: {
    name: string;
    osm_way: number;
    center: GeoPoint;
    buildings_geojson: string;
    /** Ellipsoid height of the campus ground, used only to lift pins over Google's 3D tiles. Estimated. */
    ground_alt_m_estimate?: number;
  };
  cameras: SeedCamera[];
  staff: CampusStaff[];
  patrol_posts: SeedPost[];
  sources?: Record<string, string>;
}

// ── Footprints (web/public/campus/taylors-lakeside-campus.geojson) ──

export type Ring = [lng: number, lat: number][];

export interface Building {
  id: string;
  name: string;
  height: number; // height_m_estimate
  heightEstimated: boolean;
  contains?: string[];
  ring: Ring;
  centroid: [lng: number, lat: number];
}

export interface CampusGeo {
  attribution: string;
  buildings: Building[];
  campus: Ring | null;
  water: Ring[];
  pitches: { name: string | null; ring: Ring }[];
  bounds: [[number, number], [number, number]]; // [[minLng, minLat], [maxLng, maxLat]]
}

/** A camera placed on the map: contract camera + seed placement + what is happening there. */
export interface PlacedCamera {
  camera: CampusCamera;
  id: string;
  location: string;
  building: string; // short, e.g. "Block B"
  buildingLong: string; // e.g. "Block B (OSM footprint: Block A and Block B)"
  floor: string;
  geo: GeoPoint;
  kind: PinKind;
  buildingId: string | null;
  event: CampusEvent | null; // the current incident on this camera, if any
}

export interface PlacedPost {
  id: string; // "P/01"
  slot: PatrolSlot;
  geo: GeoPoint;
  buildingId: string | null;
  hoursPerWeek: number;
}

export type Mode = "cameras" | "plan";
export type SiteView = "onsite" | "remote";
