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

/** Per-request timeout before a screen falls back to mock data. */
const API_TIMEOUT_MS = 4000;

type MockName =
  "site" | "cameras" | "events" | "replay" | "hotspots" | "plan" | "proof";

function mockUrl(name: MockName): string {
  return `/api/mock/${name}`;
}

async function getJson<T>(path: string, mock: MockName): Promise<T> {
  if (!usingMock) {
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
export function getEvents(since?: string): Promise<Event[]> {
  const q = since ? `?since=${encodeURIComponent(since)}` : "";
  return getJson<Event[]>(`/events${q}`, "events");
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
