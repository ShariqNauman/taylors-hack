import type {
  Camera,
  Event,
  Hotspot,
  PatrolPlan,
  Proof,
  Site,
  StatusPatch,
} from "./types";
import { useAppStore } from "./store/app-store";

/**
 * Base URL of the FastAPI service. When unset, every call goes to
 * /api/mock/<name>, which serves /public/mock/<name>.json. When set but the
 * API is unreachable, we fall back to the mock as well, so every screen
 * renders with the API down.
 */
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export const usingMock = API_URL === "";

/** Live webcam edge on the demo laptop (edge/earlyeye_edge.py). Used only on site. */
export const EDGE_URL = (
  process.env.NEXT_PUBLIC_EDGE_URL ?? "http://127.0.0.1:8765"
).replace(/\/$/, "");

/** What edge/earlyeye_edge.py serves at /live.json. */
export interface EdgeLive {
  camera_id: string;
  source: "live" | "recorded";
  fake?: boolean;
  level: string;
  score: number;
  people_count: number;
  updated_at: string;
  snapshot?: {
    t: string;
    people: { id: number; kp: [number, number, number][] }[];
  };
  incident: Event | null;
}

/** On site only: the edge's current state. Never called from the remote view. */
export async function getEdgeLive(edgeUrl: string): Promise<EdgeLive | null> {
  try {
    const r = await fetch(`${edgeUrl.replace(/\/$/, "")}/live.json`, {
      cache: "no-store",
      signal: AbortSignal.timeout(800),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as EdgeLive;
    if (j.incident) j.incident = normaliseEvent(j.incident);
    return j;
  } catch {
    return null;
  }
}

/** On site only: incident IDs that have a recording in edge/clips/ on this laptop. */
export async function getEdgeClips(edgeUrl: string): Promise<string[]> {
  try {
    const r = await fetch(`${edgeUrl.replace(/\/$/, "")}/clips`, {
      cache: "no-store",
      signal: AbortSignal.timeout(800),
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { incident_ids?: string[] };
    return j.incident_ids ?? [];
  } catch {
    return [];
  }
}

/** Per-request timeout before a screen falls back to mock data. */
const API_TIMEOUT_MS = 4000;

type MockName =
  "site" | "cameras" | "events" | "replay" | "hotspots" | "plan" | "proof";

function mockUrl(name: MockName): string {
  return `/api/mock/${name}`;
}

/**
 * Which resources come from the API. Default: only the live loop (events + labels).
 * Site, cameras, plan, hotspots and proof come from the repo (public/mock, which holds
 * the demo site's seed and the model team's model/proof.json), because the API on main
 * still serves an older seed and placeholder proof numbers.
 * Set NEXT_PUBLIC_API_RESOURCES="events,site,cameras,plan,hotspots,proof" to read all of them.
 */
const API_RESOURCES = new Set(
  (process.env.NEXT_PUBLIC_API_RESOURCES ?? "events")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean),
);

async function getJson<T>(path: string, mock: MockName): Promise<T> {
  if (!usingMock && API_RESOURCES.has(mock)) {
    try {
      const r = await fetch(`${API_URL}${path}`, {
        cache: "no-store",
        // A cold Render instance can hang for 30 s or more; fall back to mock instead.
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      if (r.ok) {
        useAppStore.getState().setApiDown(false);
        return (await r.json()) as T;
      }
    } catch {
      // fall through to mock
    }
    useAppStore.getState().setApiDown(true);
  }
  const r = await fetch(mockUrl(mock), { cache: "no-store" });
  if (!r.ok) throw new Error(`mock ${mock} failed: ${r.status}`);
  return (await r.json()) as T;
}

export const getSite = () => getJson<Site>("/site", "site");
export const getCameras = () => getJson<Camera[]>("/cameras", "cameras");
export const getHotspots = () => getJson<Hotspot[]>("/hotspots", "hotspots");
export const getPatrolPlan = () => getJson<PatrolPlan>("/plan", "plan");
export const getProof = () => getJson<Proof>("/proof", "proof");
export const getReplay = () => getJson<Event[]>("/replay", "replay");

/** GET /events?since=. The API filters by start_time only (brief §11), so callers also poll without `since`. */
export async function getEvents(since?: string): Promise<Event[]> {
  const q = since ? `?since=${encodeURIComponent(since)}` : "";
  const list = await getJson<Event[]>(`/events${q}`, "events");
  return list.map(normaliseEvent);
}

const LEVELS = new Set(["calm", "tense", "fight_likely", "fight"]);
/**
 * The live detector (model/live_detector.py) speaks CALM / TENSE / FIGHT. Accept that
 * vocabulary and "fight likely" spellings so a bridge can forward it unchanged.
 */
function normaliseEvent(e: Event): Event {
  const raw = String(e.level ?? "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const level = (LEVELS.has(raw) ? raw : "tense") as Event["level"];
  return level === e.level ? e : { ...e, level };
}

export class PatchError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * PATCH /events/:id. On mock the route echoes the patch. With the API down the
 * patch is kept locally (resolves). A 4xx from a live API rejects with PatchError
 * so the caller can say "saved on this phone only".
 */
export async function patchEvent(
  incident_id: string,
  patch: StatusPatch,
): Promise<StatusPatch> {
  const url = usingMock
    ? `${mockUrl("events")}/${encodeURIComponent(incident_id)}`
    : `${API_URL}/events/${encodeURIComponent(incident_id)}`;
  let r: Response;
  try {
    r = await fetch(url, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS * 2),
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  } catch {
    if (!usingMock) useAppStore.getState().setApiDown(true);
    return patch; // API down: treat as applied locally
  }
  if (r.ok) return (await r.json()) as StatusPatch;
  throw new PatchError(r.status, `PATCH ${incident_id} failed: ${r.status}`);
}

/** Back-compat alias. */
export const patchStatus = patchEvent;

/** Merge a fresh list over a known list by incident_id (newer wins). */
export function mergeEvents(base: Event[], incoming: Event[]): Event[] {
  const map = new Map(base.map((e) => [e.incident_id, e]));
  for (const e of incoming)
    map.set(e.incident_id, { ...map.get(e.incident_id), ...e });
  return [...map.values()];
}
