/**
 * Plain-language words for the Incidents page (brief §6.3, "Words to use").
 * Everything here is for a guard or a security manager: no scores, no codes, no model terms.
 */
import type { Camera, Event, IncidentType, Level, Status } from "./types";
import { MYT_TZ, secondsBetween } from "./format";

export type Bucket = "decide" | "real" | "false";

export function bucketOf(s: Status | string): Bucket {
  if (s === "new" || s === "pushed") return "decide";
  if (s === "confirmed" || s === "resolved") return "real";
  return "false"; // dismissed, false_alarm
}

export const STATUS_WORDS: Record<string, string> = {
  new: "Needs a decision",
  pushed: "Needs a decision",
  confirmed: "Real · open",
  resolved: "Real · closed",
  dismissed: "False alarm",
  false_alarm: "False alarm",
};

/** Ink, grey or white only: colour means severity, never status. */
export const STATUS_CHIP_STYLE: Record<string, string> = {
  new: "bg-white text-ink border-ink",
  pushed: "bg-white text-ink border-ink",
  confirmed: "bg-ink text-white border-ink",
  resolved: "bg-white text-ink-2 border-line-strong",
  dismissed: "bg-ground text-ink-2 border-line",
  false_alarm: "bg-ground text-ink-2 border-line",
};

export const TYPE_WORDS: Record<IncidentType, string> = {
  fight: "Fight",
  cornering: "Someone cornered",
  crowd: "Crowd gathering",
  play: "Rough play",
};

export const LEVEL_NOTE: Record<Level, string> = {
  calm: "Highest level reached. Nothing to see.",
  tense: "Highest level reached. Shown on the desk only, no alarm.",
  fight_likely: "Highest level reached. The alarm sounded.",
  fight: "Highest level reached. The alarm sounded.",
};

/** "at the Grand Hall", "on the Block C stairwell", "in U Residence, corridor L3". */
export function placePhrase(location: string): string {
  const l = location.trim();
  if (/corridor|residence|hostel|block [a-z]$/i.test(l)) return `in ${l}`;
  if (/(stairwell|pitch|court|landing|stairs)$/i.test(l)) return `on the ${l}`;
  return `at the ${l}`;
}

/** "Fight at the Grand Hall". */
export function caseTitle(e: Pick<Event, "type" | "location">): string {
  return `${TYPE_WORDS[e.type]} ${placePhrase(e.location)}`;
}

/** The camera's plain name: "Grand Hall webcam", "Block C stairwell camera". */
export function cameraName(c: Camera | undefined, location: string): string {
  if (c?.source === "live") return `${location} webcam`;
  return `${location} camera`;
}

/** "Block B, level 2, stage left", from the camera, if known. */
export function buildingLine(c: Camera | undefined): string | null {
  if (!c?.geo?.building) return null;
  return c.geo.floor ? `${c.geo.building}, ${c.geo.floor}` : c.geo.building;
}

/** What the guard reported, in their words on the phone. */
export const OUTCOME_WORDS: Record<NonNullable<Event["outcome"]>, string> = {
  sorted: "Sorted, nobody hurt",
  hurt: "Sorted, someone hurt",
  backup: "Needed backup",
  nothing: "Nothing there",
};

/** "Aiman replied in 4 s · Sorted, nobody hurt" / "Alarm sent to Aiman, no reply recorded" / "Desk screen only, no alarm". */
export function guardLine(e: Event, nameOf: (call: string) => string = (c) => c): string {
  if (!e.pushed_to) return "Desk screen only, no alarm";
  const who = nameOf(e.pushed_to);
  const s = secondsBetween(e.pushed_at, e.acked_at);
  const out = e.outcome ? ` · ${OUTCOME_WORDS[e.outcome]}` : "";
  return s != null
    ? `${who} replied in ${s} s${out}`
    : `Alarm sent to ${who}, no reply recorded${out}`;
}

const fmt = (o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: MYT_TZ, ...o });
/** "14:31" */
export const hm = (iso: string) =>
  fmt({ hour: "2-digit", minute: "2-digit", hour12: false }).format(
    new Date(iso),
  );
/** "Sat 10 Oct" */
export const dayShort = (iso: string) =>
  fmt({ weekday: "short", day: "numeric", month: "short" })
    .format(new Date(iso))
    .replace(",", "");
/** "Saturday 10 October 2026" */
export const dayLong = (iso: string) =>
  fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" })
    .format(new Date(iso))
    .replace(",", "");
/** Local calendar day key in Malaysia time. */
export const dayKey = (iso: string | Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: MYT_TZ }).format(
    typeof iso === "string" ? new Date(iso) : iso,
  );
/** Hour of day in Malaysia time. */
export const hourOf = (iso: string) =>
  parseInt(fmt({ hour: "2-digit", hour12: false }).format(new Date(iso)), 10) %
  24;

/** "TODAY · SAT 10 OCT", "YESTERDAY · FRI 9 OCT", "THU 8 OCT". */
export function dayHeading(iso: string, now: Date): string {
  const k = dayKey(iso);
  const label = dayShort(iso).toUpperCase();
  if (k === dayKey(now)) return `TODAY · ${label}`;
  if (k === dayKey(new Date(now.getTime() - 86_400_000)))
    return `YESTERDAY · ${label}`;
  return label;
}

const pad = (n: number) => String(n).padStart(2, "0");

export interface RepeatPlace {
  location: string;
  count: number;
  /** "13:00 and 14:00" */
  hours: string;
}

/**
 * The hotspot rule in plain terms: 3 or more real incidents at one place within the last 4 weeks.
 * Hours run from the earliest hour to one past the latest.
 */
export function repeatPlaces(events: Event[], now: Date): RepeatPlace[] {
  const since = now.getTime() - 28 * 86_400_000;
  const by = new Map<string, Event[]>();
  for (const e of events) {
    if (bucketOf(e.status) !== "real" || Date.parse(e.start_time) < since)
      continue;
    by.set(e.location, [...(by.get(e.location) ?? []), e]);
  }
  const out: RepeatPlace[] = [];
  for (const [location, list] of by) {
    if (list.length < 3) continue;
    const hrs = list.map((e) => hourOf(e.start_time));
    out.push({
      location,
      count: list.length,
      hours: `${pad(Math.min(...hrs))}:00 and ${pad((Math.max(...hrs) + 1) % 24)}:00`,
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** What to do next, by type (brief §6.3). */
export const NEXT_STEPS: Record<IncidentType, string[]> = {
  fight: [
    "Make sure everyone involved is safe, and get first aid if anyone is hurt.",
    "Write down who was involved in your own records.",
    "If students were involved, send the summary to Student Affairs.",
  ],
  cornering: [
    "Check on the person who was cornered.",
    "Write down who was involved in your own records.",
    "If students were involved, send the summary to Student Affairs.",
  ],
  crowd: [
    "Check that the crowd has cleared.",
    "If it keeps happening at the same time, add a patrol on the Plan page.",
  ],
  play: ["No follow-up needed."],
};
