import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";

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
  const data = JSON.parse(await fs.readFile(file, "utf8"));
  return NextResponse.json(rebase(name, data), {
    headers: { "Cache-Control": "no-store" },
  });
}
