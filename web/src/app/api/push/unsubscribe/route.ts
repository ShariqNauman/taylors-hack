import { NextResponse } from "next/server";
import { updateStore } from "@/lib/server/local-store";

/** Demo server: POST /push/unsubscribe {endpoint}. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (b.endpoint) await updateStore((s) => delete s.pushSubs[b.endpoint!]);
  return NextResponse.json({ endpoint: b.endpoint, removed: true });
}
