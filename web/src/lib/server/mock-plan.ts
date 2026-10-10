import { promises as fs } from "fs";
import path from "path";
import { applySlotOverrides } from "@/lib/plan-rules";
import type { PatrolPlan, PatrolSlot } from "@/lib/types";
import { readStore } from "./local-store";

/** public/mock/plan.json with the shared demo store applied (ended posts included). */
export async function mockSlot(id: string): Promise<PatrolSlot | null> {
  const plan = JSON.parse(
    await fs.readFile(path.join(process.cwd(), "public", "mock", "plan.json"), "utf8"),
  ) as PatrolPlan;
  const s = plan.slots.find((x) => x.id === id);
  if (!s) return null;
  const store = await readStore();
  return { ...s, ...store.slots[id] };
}

export async function withStore(plan: PatrolPlan): Promise<PatrolPlan> {
  const store = await readStore();
  return { ...plan, slots: applySlotOverrides(plan.slots, store.slots, store.checkins) };
}
