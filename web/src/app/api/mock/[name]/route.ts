import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { readStore, updateStore } from "@/lib/server/local-store";
import { withStore } from "@/lib/server/mock-plan";
import type { Event, PatrolPlan, Site } from "@/lib/types";

const ALLOWED = new Set([
  "site",
  "cameras",
  "events",
  "replay",
  "hotspots",
  "plan",
  "proof",
]);

/** The instant the mock files were generated against (scripts/gen-mock.mjs NOW). */
const MOCK_NOW = Date.parse("2026-10-10T14:30:00+08:00");
const DAY = 86_400_000;
const BUCKET = 15 * 60_000;

function toMyt(ms: number): string {
  const d = new Date(ms + 8 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+08:00`;
}

type Json = Record<string, unknown>;

/**
 * Runtime adjustments so the deployed mock never goes stale (brief §10):
 * - cameras: online ones heard from a second ago; the black one black since now − 3 days.
 * - events: open incidents and anything from this shift keep their age relative to now.
 */
function rebase(name: string, data: unknown): unknown {
  const now = Date.now();
  // Stable within a 15-minute bucket, so open incidents keep a fixed start time between polls.
  const anchor = Math.floor(now / BUCKET) * BUCKET;
  const shift = anchor - MOCK_NOW;
  if (name === "cameras" && Array.isArray(data)) {
    return data.map((c: Json) =>
      c.black_since
        ? {
            ...c,
            black_since: toMyt(now - 3 * DAY),
            last_frame_at: toMyt(now - 3 * DAY),
          }
        : {
            ...c,
            last_frame_at: toMyt(now - 1000 - Math.floor(Math.random() * 1500)),
          },
    );
  }
  if (name === "events" && Array.isArray(data)) {
    const move = (v: unknown) =>
      typeof v === "string" && v ? toMyt(Date.parse(v) + shift) : v;
    return data.map((e: Json) => {
      const start = Date.parse(String(e.start_time));
      const recent = MOCK_NOW - start < 3 * 3_600_000 && start <= MOCK_NOW;
      if (e.end_time !== null && !recent) return e;
      return {
        ...e,
        start_time: move(e.start_time),
        end_time: move(e.end_time),
        pushed_at: move(e.pushed_at),
        acked_at: move(e.acked_at),
      };
    });
  }
  return data;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name } = await ctx.params;
  if (!ALLOWED.has(name)) {
    return NextResponse.json({ error: "unknown mock" }, { status: 404 });
  }
  const file = path.join(process.cwd(), "public", "mock", `${name}.json`);
  let data = rebase(name, JSON.parse(await fs.readFile(file, "utf8")));
  // Shared demo store: labels and guard taps made on any device that uses this server.
  if (name === "events" && Array.isArray(data)) {
    const { events, added } = await readStore();
    const extra = Object.values(added);
    const ids = new Set(extra.map((e) => e.incident_id));
    data = [...(data as Json[]).filter((e) => !ids.has(String(e.incident_id))), ...(extra as unknown as Json[])].map((e) => {
      const o = events[String(e.incident_id)];
      return o ? { ...e, ...o } : e;
    });
  }
  if (name === "site") {
    const { staff } = await readStore();
    const site = data as Site;
    data = { ...site, staff: site.staff?.map((s) => (staff[s.name] ? { ...s, ...staff[s.name] } : s)) };
  }
  if (name === "plan") data = await withStore(data as PatrolPlan);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Shared demo store writes that the API does with its own routes:
 * - POST /api/mock/events {event, reset?}: the desk pushed an incident (like POST /events).
 *   reset clears earlier guard taps on that id (the replay demo restarting).
 * - POST /api/mock/staff {name, on_duty}: Start my shift / End my shift.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ name: string }> },
) {
  const { name } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (name === "events") {
    const e = body.event as Event | undefined;
    if (!e?.incident_id) return NextResponse.json({ detail: "Send event." }, { status: 422 });
    await updateStore((s) => {
      const base = body.reset ? undefined : s.added[e.incident_id];
      s.added[e.incident_id] = { ...base, ...e, acked_at: null, arrived_at: null, outcome: null, outcome_at: null };
      if (body.reset) delete s.events[e.incident_id];
    });
    return NextResponse.json(e, { status: 201 });
  }
  if (name === "staff") {
    if (typeof body.name !== "string" || typeof body.on_duty !== "boolean")
      return NextResponse.json({ detail: "Send name and on_duty." }, { status: 422 });
    await updateStore((s) => (s.staff[body.name as string] = { on_duty: body.on_duty as boolean }));
    return NextResponse.json({ name: body.name, on_duty: body.on_duty });
  }
  return NextResponse.json({ error: "unknown mock" }, { status: 404 });
}
