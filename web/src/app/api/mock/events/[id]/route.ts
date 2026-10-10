import { NextResponse } from "next/server";

/** Mock PATCH /events/:id: echoes the patch. No persistence. */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  return NextResponse.json({ incident_id: id, ...body });
}
