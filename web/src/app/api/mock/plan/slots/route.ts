import { NextResponse } from "next/server";
import { newSlot, nextSlotId } from "@/lib/plan-rules";
import { updateStore } from "@/lib/server/local-store";
import { allSlotIds } from "@/lib/server/mock-plan";
import type { SlotCreate } from "@/lib/types";

/** Mock POST /plan/slots: "+ Add a post" (same rules as lib/plan-rules.ts). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<SlotCreate>;
  if (!body.location || !body.days || !body.hours)
    return NextResponse.json({ detail: "Send location, days and hours." }, { status: 422 });
  const ids = await allSlotIds();
  const slot = await updateStore((s) => {
    const id = nextSlotId([...ids, ...Object.keys(s.newSlots)]);
    const created = newSlot(id, { source: "manual", zone_type: "other", ...body } as SlotCreate, new Date().toISOString());
    s.newSlots[id] = created;
    return created;
  });
  return NextResponse.json(slot, { status: 201 });
}
