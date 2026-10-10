import type {
  Camera,
  Event,
  Hotspot,
  PatrolPlan,
  Proof,
  Site,
  StatusPatch,
} from "./types";

/**
 * Base URL of the FastAPI service. When unset, every call goes to
 * /api/mock/<name>, which serves /public/mock/<name>.json. When set but the
 * API is unreachable, we fall back to the mock as well, so every screen
 * renders with the API down.
 */
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export const usingMock = API_URL === "";

type MockName =
  | "site"
  | "cameras"
  | "events"
  | "replay"
  | "hotspots"
  | "plan"
  | "proof";

function mockUrl(name: MockName): string {
  return `/api/mock/${name}`;
}

async function getJson<T>(path: string, mock: MockName): Promise<T> {
  if (!usingMock) {
    try {
      const r = await fetch(`${API_URL}${path}`, { cache: "no-store" });
      if (r.ok) return (await r.json()) as T;
    } catch {
      // fall through to mock
    }
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

export function getEvents(since?: string): Promise<Event[]> {
  const q = since ? `?since=${encodeURIComponent(since)}` : "";
  return getJson<Event[]>(`/events${q}`, "events");
}

/** PATCH /events/:id. On mock the route just echoes the patch back. */
export async function patchStatus(
  incident_id: string,
  patch: StatusPatch,
): Promise<StatusPatch> {
  const url = usingMock
    ? `${mockUrl("events")}/${encodeURIComponent(incident_id)}`
    : `${API_URL}/events/${encodeURIComponent(incident_id)}`;
  try {
    const r = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (r.ok) return (await r.json()) as StatusPatch;
  } catch {
    // API down: treat as applied locally
  }
  return patch;
}

/** SWR keys + fetchers for client components. */
export const swrKeys = {
  site: "site",
  cameras: "cameras",
  events: "events",
  replay: "replay",
  hotspots: "hotspots",
  plan: "plan",
  proof: "proof",
} as const;

export const swrFetchers: Record<keyof typeof swrKeys, () => Promise<unknown>> = {
  site: getSite,
  cameras: getCameras,
  events: () => getEvents(),
  replay: getReplay,
  hotspots: getHotspots,
  plan: getPatrolPlan,
  proof: getProof,
};
