// Standing-post write rules, shared by the local demo store (server) and the API client.
// Mirrors api/services/plan_logic.py slot_update so the demo behaves like the API.
import type { Checkin, PatrolSlot, SlotCreate, SlotPatch } from "./types";

const EDIT_FIELDS = ["days", "hours", "location", "zone_type", "geo", "tip"] as const;

/** POST /plan/slots: a post the supervisor adds by hand. Active from now. */
export function newSlot(id: string, body: SlotCreate, now: string): PatrolSlot {
  return {
    id,
    location: body.location,
    zone_type: body.zone_type,
    geo: body.geo ?? null,
    days: body.days,
    hours: body.hours,
    tip: body.tip ?? null,
    assigned_to: body.assigned_to ?? null,
    seen_at: null,
    status: "active",
    since: now,
    source: "manual",
    suggestion: null,
    incidents_4w: 0,
    expected_avoided_per_week: 0,
    rationale: "Added by you.",
    checkins: [],
  };
}

/** Next free id: P1, P2, … */
export function nextSlotId(ids: (string | undefined)[]): string {
  const n = ids.map((i) => (i && /^P\d+$/.test(i) ? parseInt(i.slice(1)) : 0));
  return `P${Math.max(0, ...n) + 1}`;
}

export function slotUpdate(
  current: PatrolSlot,
  patch: SlotPatch,
  now: string,
): Partial<PatrolSlot> {
  const out: Partial<PatrolSlot> = {};
  if (patch.status) {
    out.status = patch.status;
    if (patch.status === "active" && current.status !== "active") {
      out.since = now;
      out.suggestion = null;
    }
    if (patch.status === "ended") {
      out.assigned_to = null;
      out.suggestion = null;
      out.ended_at = now;
    }
  }
  if ("assigned_to" in patch) {
    out.assigned_to = patch.assigned_to ?? null;
    if ((patch.assigned_to ?? null) !== (current.assigned_to ?? null))
      out.seen_at = null;
  }
  // Edit: place, days, hours or tip. The guard must see the change again in their app.
  let edited = false;
  for (const k of EDIT_FIELDS) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (JSON.stringify(v ?? null) === JSON.stringify(current[k] ?? null)) continue;
    (out as Record<string, unknown>)[k] = v ?? null;
    edited = true;
  }
  if (edited) {
    out.changed_at = now;
    out.seen_at = null;
  }
  if (patch.seen_at) out.seen_at = patch.seen_at;
  return out;
}

/** Merge stored overrides and extra check-ins into a plan's slots. Ended posts are dropped. */
export function applySlotOverrides(
  slots: PatrolSlot[],
  overrides: Record<string, Partial<PatrolSlot>>,
  checkins: Record<string, Checkin[]>,
): PatrolSlot[] {
  return slots
    .map((s) => {
      if (!s.id) return s;
      const o = overrides[s.id];
      const extra = checkins[s.id] ?? [];
      if (!o && !extra.length) return s;
      return {
        ...s,
        ...o,
        checkins: [...(s.checkins ?? []), ...extra].sort((a, b) =>
          a.at.localeCompare(b.at),
        ),
      };
    })
    .filter((s) => s.status !== "ended");
}
