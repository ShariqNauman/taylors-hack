import { NextResponse } from "next/server";
import { updateStore } from "@/lib/server/local-store";
import type { StatusPatch } from "@/lib/types";

const FIELDS = [
  "pushed_to",
  "pushed_at",
  "status",
  "staff_note",
  "acked_at",
  "arrived_at",
  "outcome",
  "outcome_at",
] as const;

/**
 * Mock PATCH /events/:id. Kept in the shared demo store (src/lib/server/local-store.ts),
 * so the laptop and a phone on the same server see the same labels and guard taps.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: StatusPatch = {};
  for (const k of FIELDS)
    if (typeof body[k] === "string") (patch as Record<string, string>)[k] = body[k] as string;
  if (!Object.keys(patch).length)
    return NextResponse.json({ detail: "Send status, staff_note, pushed_to, acked_at, arrived_at or outcome." }, { status: 422 });
  const merged = await updateStore((s) => (s.events[id] = { ...s.events[id], ...patch }));
  return NextResponse.json({ incident_id: id, ...merged });
}
