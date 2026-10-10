import { NextResponse } from "next/server";
import { updateStore } from "@/lib/server/local-store";

/** Demo server: POST /push/subscribe {staff, subscription}. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { staff?: string; subscription?: { endpoint?: string } };
  const endpoint = b.subscription?.endpoint;
  if (!b.staff || !endpoint?.startsWith("https://"))
    return NextResponse.json({ detail: "Send staff and an https subscription.endpoint." }, { status: 422 });
  await updateStore((s) => (s.pushSubs[endpoint] = { staff: b.staff!, endpoint, subscription: b.subscription }));
  return NextResponse.json({ staff: b.staff, endpoint }, { status: 201 });
}
