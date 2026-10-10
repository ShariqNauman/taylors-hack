import { NextResponse } from "next/server";
import { updateStore } from "@/lib/server/local-store";
import { mockSlot } from "@/lib/server/mock-plan";

/** Mock POST /plan/slots/:id/checkins {staff}: the guard is at the post. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const current = await mockSlot(id);
  if (!current) return NextResponse.json({ detail: `Post ${id} not found` }, { status: 404 });
  if (current.status !== "active")
    return NextResponse.json({ detail: "Only an active post takes check-ins." }, { status: 409 });
  const body = (await req.json().catch(() => ({}))) as { staff?: string; at?: string };
  if (!body.staff) return NextResponse.json({ detail: "Send staff." }, { status: 422 });
  const c = { staff: body.staff, at: body.at ?? new Date().toISOString() };
  await updateStore((s) => (s.checkins[id] = [...(s.checkins[id] ?? []), c]));
  return NextResponse.json({ ...current, checkins: [...(current.checkins ?? []), c] }, { status: 201 });
}
