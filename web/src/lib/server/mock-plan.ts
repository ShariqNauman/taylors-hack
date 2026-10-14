import { promises as fs } from "fs";
import path from "path";
import { applySlotOverrides } from "@/lib/plan-rules";
import type { PatrolPlan, PatrolSlot } from "@/lib/types";
import { readStore } from "./local-store";

export async function mockPlanFile(): Promise<PatrolPlan> {
  return JSON.parse(
    await fs.readFile(path.join(process.cwd(), "public", "mock", "plan.json"), "utf8"),
  ) as PatrolPlan;
}

/** A post from public/mock/plan.json or added on this server, with the shared demo store applied. */
export async function mockSlot(id: string): Promise<PatrolSlot | null> {
  const plan = await mockPlanFile();
  const store = await readStore();
  const s = plan.slots.find((x) => x.id === id) ?? store.newSlots[id];
  if (!s) return null;
  return { ...s, ...store.slots[id] };
}

export async function allSlotIds(): Promise<string[]> {
  const plan = await mockPlanFile();
  const store = await readStore();
  return [...plan.slots.map((s) => s.id ?? ""), ...Object.keys(store.newSlots)];
}

export async function withStore(plan: PatrolPlan): Promise<PatrolPlan> {
  const store = await readStore();
  return {
    ...plan,
    slots: applySlotOverrides([...plan.slots, ...Object.values(store.newSlots)], store.slots, store.checkins),
  };
}
