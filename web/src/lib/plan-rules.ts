// Standing-post write rules, shared by the local demo store (server) and the API client.
// Mirrors api/services/plan_logic.py slot_update so the demo behaves like the API.
import type { Checkin, PatrolSlot, SlotPatch } from "./types";

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
