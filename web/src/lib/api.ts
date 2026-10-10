import type {
  Camera,
  HandoverBrief,
  HandoverFacts,
  CameraPatch,
  Event,
  Hotspot,
  PatrolPlan,
  Proof,
  PatrolSlot,
  Site,
  SlotCreate,
  SlotPatch,
  StatusPatch,
} from "./types";
import { useAppStore } from "./store/app-store";

/**
 * Base URL of the FastAPI service. When unset, every call goes to
 * /api/mock/<name>, which serves /public/mock/<name>.json. When set but the
 * API is unreachable, we fall back to the mock as well, so every screen
 * renders with the API down.
 */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

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

/** Events (and so guard pushes) come from the API, not the laptop's demo store. */
export const API_RESOURCES_HAS_EVENTS = API_RESOURCES.has("events");

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
/**
 * GET /proof. Test results are the same for every site, so ask the backend even in demo mode
 * (it serves model/proof.json); the bundled copy is the fallback. `source` says which one answered.
 */
export async function getProof(): Promise<Proof & { source: "api" | "bundled" }> {
  try {
    const r = await fetch(`${API_URL || "https://earl-eye-backend.onrender.com"}/proof`, {
      cache: "no-store",
      signal: AbortSignal.timeout(API_TIMEOUT_MS * 3),
    });
    if (r.ok) return { ...((await r.json()) as Proof), source: "api" };
  } catch {
    // fall through to the bundled copy
  }
  const r = await fetch(mockUrl("proof"), { cache: "no-store" });
  if (!r.ok) throw new Error(`mock proof failed: ${r.status}`);
  return { ...((await r.json()) as Proof), source: "bundled" };
}
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

/** Where a write landed: the team's API (database) or this demo server's shared store. */
export type SavedWhere = "api" | "this-computer";

/**
 * Plan writes go to the API when the plan is read from it (NEXT_PUBLIC_API_RESOURCES has
 * "plan"); otherwise, or when the API is down or lacks the route, to the local server's
 * shared store (/api/mock/plan/…), which every device on this server sees.
 * A 409 / 422 from either rejects with PatchError.
 */
async function planWrite(
  path: string,
  method: "PATCH" | "POST",
  body: unknown,
): Promise<{ slot: PatrolSlot; saved: SavedWhere }> {
  const init = (): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(API_TIMEOUT_MS * 2),
  });
  if (!usingMock && API_RESOURCES.has("plan")) {
    try {
      const r = await fetch(`${API_URL}${path}`, init());
      if (r.ok) return { slot: (await r.json()) as PatrolSlot, saved: "api" };
      if (r.status === 409 || r.status === 422)
        throw new PatchError(r.status, `${method} ${path} failed: ${r.status}`);
      // 404 / 405 / 503 / 5xx: the API has no plan routes yet, or its table is missing
    } catch (e) {
      if (e instanceof PatchError) throw e;
      useAppStore.getState().setApiDown(true);
    }
  }
  const r = await fetch(`/api/mock${path}`, init());
  if (!r.ok) throw new PatchError(r.status, `${method} ${path} failed: ${r.status}`);
  return { slot: (await r.json()) as PatrolSlot, saved: "this-computer" };
}

/** PATCH /plan/slots/:id: accept / end a post ({status}), pick a guard ({assigned_to}), or {seen_at}. */
export const patchSlot = (id: string, patch: SlotPatch) =>
  planWrite(`/plan/slots/${encodeURIComponent(id)}`, "PATCH", patch);

/** POST /plan/slots: "+ Add a post" (source "manual"). */
export const createSlot = (body: SlotCreate) => planWrite("/plan/slots", "POST", body);

/** POST /plan/slots/:id/checkins: the guard is at the post. */
export const postCheckin = (id: string, staff: string) =>
  planWrite(`/plan/slots/${encodeURIComponent(id)}/checkins`, "POST", {
    staff,
    at: new Date().toISOString(),
  });

/**
 * Without the API (mock data), the desk copies a pushed incident into the local server's shared
 * store so a guard's phone on the same server gets the alarm. With the API, the edge and the API
 * do this, so it's a no-op.
 */
export async function mirrorEvent(event: Event, reset = false): Promise<void> {
  if (!usingMock) return;
  // The guard's own answers live only in their PATCHes, never in the desk's copy.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { acked_at, arrived_at, outcome, outcome_at, ...desk } = event;
  event = desk as Event;
  try {
    await fetch("/api/mock/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, reset }),
    });
  } catch {
    // the next push tries again
  }
}

/**
 * Start my shift / End my shift. The API on main has no staff route yet, so this goes to the
 * local server's shared store; the desk reads it from GET /site there.
 */
export async function setOnDuty(name: string, on_duty: boolean): Promise<SavedWhere> {
  if (!usingMock) {
    try {
      const r = await fetch(`${API_URL}/staff/${encodeURIComponent(name)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on_duty }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      if (r.ok) return "api";
    } catch {
      // fall through
    }
  }
  try {
    await fetch("/api/mock/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, on_duty }),
    });
  } catch {
    // offline: the phone still works; the desk won't see the change
  }
  return "this-computer";
}

/**
 * PATCH /cameras/:id {zone_type}: the manager moves a camera to another zone
 * ("Make it a sports zone"). Resolves false when there is no API or it refused,
 * so the caller keeps the change in this browser instead.
 */
export async function patchCamera(
  camera_id: string,
  patch: CameraPatch,
): Promise<boolean> {
  if (usingMock) return false;
  try {
    const r = await fetch(
      `${API_URL}/cameras/${encodeURIComponent(camera_id)}`,
      {
        signal: AbortSignal.timeout(API_TIMEOUT_MS * 2),
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    );
    return r.ok;
  } catch {
    useAppStore.getState().setApiDown(true);
    return false;
  }
}

/** Desk sends another guard (API: POST /events/:id/backup → <id>-B pushed to them). */
export async function sendBackup(
  incident_id: string,
  staff: string,
  reason: "need_backup" | "no_answer",
): Promise<void> {
  const r = await fetch(`${API_URL}/events/${encodeURIComponent(incident_id)}/backup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ staff, reason }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS * 2),
  });
  if (!r.ok) throw new PatchError(r.status, `backup ${incident_id} failed: ${r.status}`);
}

/**
 * Demo mode only (no API): start the live demo clean. Clears the shared store's pushes,
 * guard taps and labels from earlier runs. Once per page load (a refresh of Live).
 */
let demoResetDone = false;
export async function resetDemoOnce(): Promise<boolean> {
  if (!usingMock || demoResetDone) return false;
  demoResetDone = true;
  try {
    return (await fetch("/api/mock/reset", { method: "POST" })).ok;
  } catch {
    return false;
  }
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

/** Abort when either signal fires (6 s timeout, drawer closed). */
function anySignal(signals: (AbortSignal | undefined)[]): AbortSignal {
  const list = signals.filter((x): x is AbortSignal => !!x);
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (any) return any(list);
  const ctrl = new AbortController();
  for (const sig of list) {
    if (sig.aborted) ctrl.abort(sig.reason);
    else sig.addEventListener("abort", () => ctrl.abort(sig.reason), { once: true });
  }
  return ctrl.signal;
}

// The API gives Claude 20 s (api/routers/handover.py) and falls back to its own
// template after that, so abort later than the server gives up — at 6 s we aborted
// first every time and never saw the written brief at all.
export const HANDOVER_TIMEOUT_MS = 25_000;

/**
 * POST /handover: words the already-computed shift facts as a short brief.
 * Same discipline as the rest of this file: the API first (when configured),
 * then the local mock route, which assembles the brief without any model.
 * Rejects only if both fail or the caller aborts; the drawer keeps its facts either way.
 */
export async function postHandover(
  facts: HandoverFacts,
  signal?: AbortSignal,
): Promise<HandoverBrief> {
  const body = JSON.stringify(facts);
  const post = (url: string) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal: anySignal([signal, AbortSignal.timeout(HANDOVER_TIMEOUT_MS)]),
    });
  if (!usingMock) {
    try {
      const r = await post(`${API_URL}/handover`);
      if (r.ok) {
        useAppStore.getState().setApiDown(false);
        return (await r.json()) as HandoverBrief;
      }
    } catch (err) {
      if (signal?.aborted) throw err; // drawer closed: stop here
    }
    useAppStore.getState().setApiDown(true);
  }
  const r = await post("/api/mock/handover");
  if (!r.ok) throw new Error(`mock handover failed: ${r.status}`);
  return (await r.json()) as HandoverBrief;
}
