// Shared demo store for the local Next server (no API, no database).
// Every browser that opens this server (the laptop, and a phone on the same Wi-Fi at
// http://<laptop-ip>:3000) reads and writes the same file, so a tap on one shows on the
// other within one poll. It is not the database: the UI says "Saved on this computer".
// File: web/.local-store.json (git-ignored). On Vercel it lives in /tmp, per instance.
import { promises as fs } from "fs";
import path from "path";
import type { Checkin, Event, PatrolSlot, StatusPatch } from "@/lib/types";

export interface LocalStore {
  /** Human fields set by the desk or a guard's phone (PATCH /events/:id). */
  events: Record<string, StatusPatch>;
  /** Whole incidents the desk pushed (live webcam, replay demo, backup), like POST /events. */
  added: Record<string, Event>;
  slots: Record<string, Partial<PatrolSlot>>;
  /** Posts added by hand on this server (POST /plan/slots). */
  newSlots: Record<string, PatrolSlot>;
  checkins: Record<string, Checkin[]>;
  /** Guard app: Start my shift / End my shift. */
  staff: Record<string, { on_duty: boolean }>;
  /** Web Push: phones registered for alarms with the app closed, by endpoint. */
  pushSubs: Record<string, { staff: string; endpoint: string; subscription: unknown }>;
}

const FILE =
  process.env.EE_LOCAL_STORE ??
  (process.env.VERCEL
    ? "/tmp/earlyeye-local-store.json"
    : path.join(process.cwd(), ".local-store.json"));

const empty = (): LocalStore => ({ events: {}, added: {}, slots: {}, newSlots: {}, checkins: {}, staff: {}, pushSubs: {} });
let cache: LocalStore | null = null;
let queue: Promise<unknown> = Promise.resolve();

export async function readStore(): Promise<LocalStore> {
  if (cache) return cache;
  try {
    cache = { ...empty(), ...JSON.parse(await fs.readFile(FILE, "utf8")) };
  } catch {
    cache = empty();
  }
  return cache!;
}

/** Serialised read-modify-write, so two quick taps never lose one. */
export function updateStore<T>(fn: (s: LocalStore) => T): Promise<T> {
  const run = queue.then(async () => {
    const s = await readStore();
    const out = fn(s);
    try {
      await fs.writeFile(FILE, JSON.stringify(s, null, 1));
    } catch {
      // read-only filesystem: keep it in memory for this server process
    }
    return out;
  });
  queue = run.catch(() => undefined);
  return run;
}
