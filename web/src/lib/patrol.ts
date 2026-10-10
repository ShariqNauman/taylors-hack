// Patrol plan logic shared by /plan and the /push idle screen: this week's dates,
// the real incidents behind each post, the shift fit check, the suggestion rule and
// the assignments (plan.slots[].assigned_to, else this browser's localStorage).

import { useMemo, useSyncExternalStore } from "react";
import { normaliseStatus, WEEKDAY_SHORT } from "./format";
import type {
  Event,
  PatrolPlan,
  PatrolReview,
  PatrolSlot,
  Staff,
} from "./types";

const DAY_MS = 86_400_000;
const MYT_OFFSET_MS = 8 * 3_600_000; // Malaysia has no DST
const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

export const DAY_FULL = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
export const DAY_PLURAL = DAY_FULL.map((d) => `${d}s`);

/** Calendar day in Malaysia time, as a UTC-midnight timestamp, plus weekday (0 = Mon) and hour. */
export function mytDay(iso: string | number): {
  day: number;
  wd: number;
  hour: number;
} {
  const t = (typeof iso === "number" ? iso : Date.parse(iso)) + MYT_OFFSET_MS;
  const day = Math.floor(t / DAY_MS) * DAY_MS;
  const wd = (new Date(day).getUTCDay() + 6) % 7;
  return { day, wd, hour: new Date(t).getUTCHours() };
}

/** "7 Oct" */
export const fmtDM = (day: number) => {
  const d = new Date(day);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
/** "Wed 7 Oct" */
export const fmtWDM = (day: number) =>
  `${WEEKDAY_SHORT[(new Date(day).getUTCDay() + 6) % 7]} ${fmtDM(day)}`;
export const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

export interface Week {
  /** Monday of the week being planned (UTC-midnight timestamp of the MYT date). */
  start: number;
  /** Dates of Mon…Sun this week. */
  days: number[];
  /** The 28 days of history the plan counts, ending when the plan was built. */
  since: number;
  until: number;
  key: string; // "2026-10-12", for localStorage
}

/** The week a plan built on `generated_at` is for: that Monday if built on a Monday, else the next one. */
export function planWeek(generatedAt: string): Week {
  const { day, wd } = mytDay(generatedAt);
  const start = day + (wd === 0 ? 0 : 7 - wd) * DAY_MS;
  const until = Date.parse(generatedAt);
  return {
    start,
    days: Array.from({ length: 7 }, (_, i) => start + i * DAY_MS),
    since: until - 28 * DAY_MS,
    until,
    key: new Date(start).toISOString().slice(0, 10),
  };
}

/** "Mon–Thu", "Sun–Thu", "Fri", "Mon, Wed" → weekday indexes (0 = Mon), in the slot's own order. */
export function parseDays(days: string): number[] {
  const DAY = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const d = days.toLowerCase().replace(/\s/g, "");
  const m = d.match(/^([a-z]{3})[a-z]*[–-]([a-z]{3})[a-z]*$/);
  if (m) {
    const a = DAY.indexOf(m[1]);
    const b = DAY.indexOf(m[2]);
    if (a >= 0 && b >= 0)
      return Array.from(
        { length: ((b - a + 7) % 7) + 1 },
        (_, i) => (a + i) % 7,
      );
  }
  return d
    .split(",")
    .map((x) => DAY.indexOf(x.slice(0, 3)))
    .filter((x) => x >= 0);
}

/** "13:00–14:00" → [13, 14]; "23:00–01:00" → [23, 25]. */
export function parseHours(hours: string): [number, number] {
  const m = hours.match(/(\d{1,2}):\d{2}\s*[–-]\s*(\d{1,2}):\d{2}/);
  if (!m) return [0, 1];
  const a = parseInt(m[1]);
  let b = parseInt(m[2]);
  if (b <= a) b += 24;
  return [a, b];
}

export interface Incident {
  id: string;
  location: string;
  zone_type: string;
  type: Event["type"];
  day: number;
  wd: number;
  hour: number;
  time: string; // "13:47"
}

/** Real incidents only (confirmed or resolved), in the plan's 28 days, oldest first. False alarms never count. */
export function realIncidents(events: Event[], week: Week): Incident[] {
  return events
    .filter((e) => {
      const s = normaliseStatus(e.status);
      const t = Date.parse(e.start_time);
      return (
        (s === "confirmed" || s === "resolved") &&
        t >= week.since &&
        t <= week.until
      );
    })
    .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time))
    .map((e) => {
      const { day, wd, hour } = mytDay(e.start_time);
      const t = e.start_time.match(/T(\d{2}:\d{2})/)?.[1] ?? hh(hour);
      return {
        id: e.incident_id,
        location: e.location,
        zone_type: e.zone_type,
        type: e.type,
        day,
        wd,
        hour,
        time: t,
      };
    });
}

export interface Post {
  key: string; // stable across sorts and weeks: location|days|hours
  rank: number; // 1-based, by incidents (the plan's own order breaks ties)
  slot: PatrolSlot;
  place: string;
  zoneType: string | null;
  days: number[]; // weekday indexes, Mon first
  daysLabel: string;
  hours: string;
  from: number;
  to: number;
  hoursWeek: number;
  hits: Incident[];
  incidents: number;
  prevent: number; // a month: round(incidents × 0.6)
  perHour: number; // incidents × 0.6 ÷ hours a week
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function buildPosts(
  plan: PatrolPlan | undefined,
  incidents: Incident[],
  events: Event[],
): Post[] {
  if (!plan) return [];
  const posts = plan.slots.slice(0, 3).map((slot, i) => {
    const days = parseDays(slot.days).sort((a, b) => a - b);
    const [from, to] = parseHours(slot.hours);
    const hits = incidents.filter(
      (x) =>
        norm(x.location) === norm(slot.location) &&
        days.includes(x.wd) &&
        x.hour >= from &&
        x.hour < to,
    );
    const zoneType =
      events.find((e) => norm(e.location) === norm(slot.location))
        ?.zone_type ?? null;
    const hoursWeek = days.length * (to - from);
    return {
      key: `${slot.location}|${slot.days}|${slot.hours}`,
      rank: 0,
      order: i,
      slot,
      place: slot.location,
      zoneType,
      days,
      daysLabel: slot.days,
      hours: slot.hours,
      from,
      to,
      hoursWeek,
      hits,
      incidents: hits.length,
      prevent: Math.round(hits.length * 0.6),
      perHour: hoursWeek ? (hits.length * 0.6) / hoursWeek : 0,
    };
  });
  return posts
    .sort((a, b) => b.incidents - a.incidents || a.order - b.order)
    .map((p, i) => {
      const { order, ...post } = p;
      void order;
      return { ...post, rank: i + 1 };
    });
}

// ── Who goes ──

export type Assignments = Record<string, string>; // post key → staff name

export interface Fit {
  ok: boolean;
  note: string;
}

const overlaps = (a: Post, b: Post) =>
  a.days.some((d) => b.days.includes(d)) && a.from < b.to && b.from < a.to;

export function fitFor(
  person: Staff,
  post: Post,
  posts: Post[],
  assign: Assignments,
): Fit {
  const sh = person.shift;
  if (sh) {
    const missing = post.days.filter((d) => !sh.days.includes(d));
    if (missing.length)
      return {
        ok: false,
        note: `Not working on ${missing.map((d) => WEEKDAY_SHORT[d]).join(", ")}`,
      };
    if (post.from < sh.from)
      return { ok: false, note: `Shift starts at ${hh(sh.from)}` };
    if (post.to > sh.to)
      return { ok: false, note: `Shift ends at ${hh(sh.to)}` };
  }
  const clash = posts.find(
    (o) => o.key !== post.key && assign[o.key] === person.name && overlaps(o, post),
  );
  if (clash) return { ok: false, note: `Already at post ${clash.rank} then` };
  if (!sh) return { ok: true, note: "No shift on file" };
  return {
    ok: true,
    note:
      post.hoursWeek === 1
        ? "On shift for the whole hour"
        : `On shift for all ${post.hoursWeek} hours`,
  };
}

export const hoursOf = (name: string, posts: Post[], assign: Assignments) =>
  posts
    .filter((p) => assign[p.key] === name)
    .reduce((a, p) => a + p.hoursWeek, 0);

/** A free person whose base zone matches the post, then the fewest hours this week. */
export function suggest(
  post: Post,
  posts: Post[],
  staff: Staff[],
  assign: Assignments,
): Staff | null {
  const ok = staff.filter((g) => fitFor(g, post, posts, assign).ok);
  ok.sort(
    (a, b) =>
      Number(b.zone_type === post.zoneType) -
        Number(a.zone_type === post.zoneType) ||
      hoursOf(a.name, posts, assign) - hoursOf(b.name, posts, assign),
  );
  return ok[0] ?? null;
}

/** "Day shift · Mon–Sat 07:00–15:00" */
export function shiftText(s: Staff): string {
  const sh = s.shift;
  if (!sh) return "No shift on file";
  const d = [...sh.days].sort((a, b) => a - b);
  const run = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  const days =
    d.length === 7
      ? "every day"
      : run && d.length > 1
        ? `${WEEKDAY_SHORT[d[0]]}–${WEEKDAY_SHORT[d[d.length - 1]]}`
        : d.map((x) => WEEKDAY_SHORT[x]).join(", ");
  return `${sh.label} · ${days} ${hh(sh.from)}–${hh(sh.to)}`;
}

// ── Assignment storage: plan.slots[].assigned_to wins; else this browser ──

const LS_KEY = "earlyeye.plan.assignments.v1";
const listeners = new Set<() => void>();

function readRaw(): string {
  try {
    return localStorage.getItem(LS_KEY) ?? "{}";
  } catch {
    return "{}";
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === LS_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** Assignments for one week: { [weekKey]: { [postKey]: name } } in localStorage. */
export function useLocalAssignments(
  weekKey: string | null,
): [Assignments, (postKey: string, name: string | null) => void] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "{}");
  const all = useMemo(() => {
    try {
      return JSON.parse(raw) as Record<string, Assignments>;
    } catch {
      return {};
    }
  }, [raw]);
  const week = useMemo(
    () => (weekKey ? (all[weekKey] ?? {}) : {}),
    [all, weekKey],
  );
  const set = (postKey: string, name: string | null) => {
    if (!weekKey) return;
    const next = { ...all, [weekKey]: { ...week } };
    if (name) next[weekKey][postKey] = name;
    else delete next[weekKey][postKey];
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      // private mode: nothing to keep
    }
    listeners.forEach((l) => l());
  };
  return [week, set];
}

/** The API's assigned_to where it sent one, overlaid by this browser's choices. */
export function mergeAssignments(posts: Post[], local: Assignments): Assignments {
  const out: Assignments = {};
  for (const p of posts) {
    if (p.key in local) {
      if (local[p.key]) out[p.key] = local[p.key];
    } else if (p.slot.assigned_to) out[p.key] = p.slot.assigned_to;
  }
  return out;
}

export const apiHasAssignments = (plan: PatrolPlan | undefined) =>
  !!plan?.slots.some((s) => s.assigned_to !== undefined);

// ── "Did last week's plan work?" fallback ──

export interface ReviewRow extends PatrolReview {
  result?: string; // mock only: a plain sentence with the dates
}

/** Synthetic review for last week (Mon 5 – Sun 11 Oct), matching the mock history. */
export const MOCK_REVIEW: ReviewRow[] = [
  {
    location: "Block C stairwell",
    assigned_to: "Guard B",
    covered_days: 4,
    planned_days: 4,
    incidents_during_post: 1,
    baseline_per_week: 1.25,
    verdict: "Working. Keep it.",
    result:
      "One incident, on Mon 5 Oct. Guard B was already on the landing and it was over within a minute.",
  },
  {
    location: "U Residence, corridor L3",
    assigned_to: "Guard C",
    covered_days: 3,
    planned_days: 5,
    incidents_during_post: 1,
    baseline_per_week: 1,
    verdict: "Cover every night this week.",
    result:
      "One fight, on Thu 8 Oct, a night when nobody was posted. None on the covered nights.",
  },
  {
    location: "Syopz Mall food court",
    assigned_to: "Guard A",
    covered_days: 1,
    planned_days: 1,
    incidents_during_post: 1,
    baseline_per_week: 0.75,
    verdict: "Working. Keep it.",
    result:
      "One crowd gathering, on Fri 9 Oct. Guard A was there, and it cleared within a minute.",
  },
];
