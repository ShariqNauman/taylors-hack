import { NextResponse } from "next/server";
import { vapidKeys } from "@/lib/server/webpush";

/** Demo server: GET /push/key (the API serves the same route on Render). */
export async function GET() {
  return NextResponse.json({ public_key: (await vapidKeys()).publicKey });
}
