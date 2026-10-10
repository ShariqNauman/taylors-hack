import { NextResponse } from "next/server";
import { slotUpdate } from "@/lib/plan-rules";
import { updateStore } from "@/lib/server/local-store";
import { mockSlot } from "@/lib/server/mock-plan";
import type { SlotPatch } from "@/lib/types";

/** Mock PATCH /plan/slots/:id ({status}, {assigned_to}, {seen_at}), same rules as the API. */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const current = await mockSlot(id);
  if (!current) return NextResponse.json({ detail: `Post ${id} not found` }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as SlotPatch;
  const patch: SlotPatch = {};
  if (body.status === "active" || body.status === "suggested" || body.status === "ended")
    patch.status = body.status;
  if ("assigned_to" in body) patch.assigned_to = body.assigned_to ?? null;
  if (typeof body.seen_at === "string") patch.seen_at = body.seen_at;
  if (!Object.keys(patch).length)
    return NextResponse.json({ detail: "Send status, assigned_to or seen_at." }, { status: 422 });
  const update = slotUpdate(current, patch, new Date().toISOString());
  await updateStore((s) => (s.slots[id] = { ...s.slots[id], ...update }));
  return NextResponse.json({ ...current, ...update });
}
