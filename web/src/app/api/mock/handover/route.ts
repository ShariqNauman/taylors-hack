import { NextResponse } from "next/server";
import type { HandoverBrief, HandoverFacts } from "@/lib/types";

/**
 * POST /handover for the deployed demo.
 *
 * The dashboard runs on `public/mock/*.json` because the API is seeded with a
 * different site (its events name cameras the mock wall does not have), so
 * `NEXT_PUBLIC_API_URL` stays unset and `lib/api.ts` routes every call here.
 * The brief is the one thing that does not care whose data it is — it only
 * words the facts the drawer already counted — so when EE_API_URL is set this
 * forwards to the real service and the deployed site gets Claude's wording
 * with none of the data mismatch.
 *
 * EE_API_URL has no NEXT_PUBLIC_ prefix on purpose: it is read on the server,
 * never inlined into the browser bundle. No model key is ever needed here —
 * the key lives on the API, and this only talks to the API.
 *
 * Falls back to the four-sentence string template below whenever the variable
 * is unset or the call fails, and says so in `model`, which the drawer prints.
 */

/** Under the drawer's 25 s abort (HANDOVER_TIMEOUT_MS), over a Render cold start. */
const PROXY_TIMEOUT_MS = 20_000;

async function fromApi(facts: unknown): Promise<HandoverBrief | null> {
  const base = process.env.EE_API_URL?.replace(/\/$/, "");
  if (!base) return null;
  try {
    const r = await fetch(`${base}/handover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(facts),
      cache: "no-store",
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const b = (await r.json()) as HandoverBrief;
    return typeof b?.text === "string" && b.text.trim() ? b : null;
  } catch {
    return null; // cold, slow or down: the template below is already correct
  }
}
const LEVEL: Record<string, string> = {
  calm: "calm",
  tense: "tense",
  fight_likely: "fight likely",
  fight: "a fight",
};

const time = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));

const days = (iso: string, now: string) =>
  Math.max(1, Math.floor((Date.parse(now) - Date.parse(iso)) / 86_400_000));

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function isFacts(x: unknown): x is HandoverFacts {
  const f = x as HandoverFacts;
  return (
    !!f &&
    typeof f.now === "string" &&
    typeof f.pushes === "number" &&
    typeof f.budget === "number" &&
    Array.isArray(f.open) &&
    Array.isArray(f.black_cameras)
  );
}

export async function POST(req: Request) {
  const f = await req.json().catch(() => null);
  if (!isFacts(f)) return NextResponse.json({ error: "expected HandoverFacts" }, { status: 422 });

  const live = await fromApi(f);
  if (live) return NextResponse.json(live, { headers: { "Cache-Control": "no-store" } });

  const s1 =
    `Shift from ${time(f.shift_start)} to ${time(f.now)}: ${plural(f.pushes, "push", "pushes")} used out of ${f.budget}, ` +
    `${plural(f.confirmed, "alert")} confirmed as real and ${plural(f.dismissed, "false alarm")} dismissed.`;

  const top = f.open[0];
  const s2 = !f.open.length
    ? "No incident is open, so the next shift starts clean."
    : f.open.length === 1
      ? `One incident is still open: ${top.location}, ${LEVEL[top.level] ?? top.level}, ${top.status === "confirmed" ? "confirmed and waiting for follow-up" : "not yet labelled"}.`
      : `${f.open.length} incidents are still open; start with ${top.location} (${LEVEL[top.level] ?? top.level}, ${top.status === "confirmed" ? "confirmed" : "not yet labelled"}), the highest priority.`;

  const s3 = !f.black_cameras.length
    ? "Every camera is sending a picture."
    : f.black_cameras.length === 1
      ? `${f.black_cameras[0].location} (${f.black_cameras[0].camera_id}) has been black for ${plural(days(f.black_cameras[0].black_since, f.now), "day")}; the repair is still to be reported.`
      : `${f.black_cameras.length} cameras are black, including ${f.black_cameras[0].location}; report the repairs.`;

  const s4 = f.patrol_today
    ? `${f.patrol_today.replace(/\.$/, "")}, so put one person there on time.`
    : "There is no patrol slot in the plan for today.";

  const brief: HandoverBrief = {
    text: [s1, s2, s3, s4].join(" "),
    model: "offline-template",
    generated_at: new Date().toISOString(),
  };
  return NextResponse.json(brief, { headers: { "Cache-Control": "no-store" } });
}
