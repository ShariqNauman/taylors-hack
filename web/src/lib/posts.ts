// Standing guard posts: pure helpers for the Plan page and the guard app.
// Rules follow the handoff (design/canvas/L3Plan.dc.html) and api/services/plan_logic.py.
import { daysInclude, MYT_TZ } from "./format";
import type { Checkin, Event, PatrolSlot, Staff } from "./types";

export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;
export const REAL = new Set(["confirmed", "resolved"]);

/** Malaysia-time parts of an instant. */
export function myt(d: Date | string | number) {
  const t = new Date(d).getTime() + 8 * 3_600_000;
  const x = new Date(t);
  return {
    wd: (x.getUTCDay() + 6) % 7, // 0 = Mon
    hour: x.getUTCHours(),
    minute: x.getUTCMinutes(),
    day: x.getUTCDate(),
    month: x.getUTCMonth(),
    key: x.toISOString().slice(0, 10), // YYYY-MM-DD in MYT
  };
}
export const hh = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;
/** "Sat 10 Oct" */
export function dayDate(d: Date | string | number): string {
  const p = myt(d);
  return `${DAY_SHORT[p.wd]} ${p.day} ${MON[p.month]}`;
}
export const dateOnly = (d: Date | string | number) => {
  const p = myt(d);
  return `${p.day} ${MON[p.month]}`;
};
export const hm = (d: Date | string | number) => {
  const p = myt(d);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};
void MYT_TZ;

/** Start hour of "13:00–14:00". */
export function startHour(hours: string): number {
  const m = hours.match(/(\d{1,2}):\d{2}/);
  return m ? parseInt(m[1]) : 0;
}
export function slotDays(days: string): number[] {
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => daysInclude(days.replace(/\s*&\s*|\s+and\s+/g, ", "), d));
}
/** [1,3] → "Tue & Thu" (joiner " and " for sentences); ranges stay "Mon–Thu". */
export function daysLabel(days: string, joiner = " & "): string {
  const ds = slotDays(days);
  if (ds.length === 2 && !/[–-]/.test(days)) return `${DAY_SHORT[ds[0]]}${joiner}${DAY_SHORT[ds[1]]}`;
  return days;
}

// ── Team ──

export interface Person {
  id: string; // call sign
  name: string; // display name, or the call sign
  first: string;
  photo_url?: string | null;
  role: string; // "Security guard"
  shiftLabel: string;
  days: number[];
  from: number;
  to: number; // may be > 24 (ends after midnight)
  zone_type: string;
}
const hourOf = (s: string) => parseInt(s.split(":")[0]) || 0;
const ROLE: Record<string, string> = { guard: "Security guard", warden: "Hostel warden", supervisor: "Supervisor" };

/** "Aiman Hakimi" → "Aiman"; three-part Chinese names put the family name first: "Tan Wei Jie" → "Wei Jie". */
function firstName(full?: string | null): string | null {
  if (!full) return null;
  const w = full.trim().split(/\s+/);
  return w.length === 3 ? `${w[1]} ${w[2]}` : w[0];
}

export function team(staff: Staff[] | undefined): Person[] {
  return (staff ?? []).map((s) => {
    const from = s.shift ? hourOf(s.shift.from) : 0;
    let to = s.shift ? hourOf(s.shift.to) : 24;
    if (to <= from) to += 24;
    const name = s.display_name || s.name;
    return {
      id: s.name,
      name,
      first: firstName(s.display_name) ?? s.name,
      photo_url: s.photo_url,
      role: ROLE[s.role ?? ""] ?? (s.role || "Staff"),
      shiftLabel: s.shift?.label ?? "Shift not set",
      days: s.shift?.days ?? [0, 1, 2, 3, 4, 5, 6],
      from,
      to,
      zone_type: s.zone_type,
    };
  });
}

/** On shift at this instant (handles shifts that end after midnight). */
export function onShift(p: Person, now: Date | number): boolean {
  const n = myt(now);
  if (p.days.includes(n.wd) && n.hour >= p.from && n.hour < p.to) return true;
  const prev = (n.wd + 6) % 7;
  return p.to > 24 && p.days.includes(prev) && n.hour < p.to - 24;
}

export interface Fit {
  ok: boolean;
  note: string;
}
/** Can this person take this post? Reasons are the design's words. */
export function fit(p: Person, slot: PatrolSlot, others: PatrolSlot[]): Fit {
  const ds = slotDays(slot.days);
  const h = startHour(slot.hours);
  const missing = ds.filter((d) => !p.days.includes(d));
  if (missing.length) return { ok: false, note: `Not working on ${missing.map((d) => DAY_SHORT[d]).join(", ")}` };
  if (h < p.from) return { ok: false, note: `Shift starts at ${hh(p.from)}` };
  if (h + 1 > p.to) return { ok: false, note: `Shift ends at ${hh(p.to)}` };
  const clash = others.find(
    (o) => o.id !== slot.id && o.assigned_to === p.id && startHour(o.hours) === h && slotDays(o.days).some((d) => ds.includes(d)),
  );
  if (clash) return { ok: false, note: `Already at post ${rankOf(others, clash)} then` };
  return { ok: true, note: `On shift then · ${p.shiftLabel}` };
}

/** Best free person: works nearby first, then the fewest posts. */
export function suggestPerson(people: Person[], slot: PatrolSlot, posts: PatrolSlot[]): Person | null {
  const load = (id: string) => posts.filter((o) => o.assigned_to === id).length;
  const ok = people.filter((p) => fit(p, slot, posts).ok);
  ok.sort((a, b) => Number(b.zone_type === slot.zone_type) - Number(a.zone_type === slot.zone_type) || load(a.id) - load(b.id));
  return ok[0] ?? null;
}

// ── Posts ──

/** Active posts ranked by avoided per week (team decision), then suggestions. */
export function activePosts(slots: PatrolSlot[]): PatrolSlot[] {
  return slots
    .filter((s) => (s.status ?? "active") === "active")
    .sort((a, b) => b.expected_avoided_per_week - a.expected_avoided_per_week);
}
export function rankOf(active: PatrolSlot[], s: PatrolSlot): number {
  const i = activePosts(active).findIndex((x) => x.id === s.id);
  return i < 0 ? active.length + 1 : i + 1;
}
export const slotKey = (s: PatrolSlot) => s.id ?? s.location;

/** The 7 days shown: today plus the next six. */
export function rollingWeek(now: Date | number) {
  const start = new Date(now).getTime();
  return Array.from({ length: 7 }, (_, i) => {
    const t = start + i * DAY_MS;
    const p = myt(t);
    return { i, t, wd: p.wd, key: p.key, label: i === 0 ? "Today" : DAY_SHORT[p.wd], date: i === 0 ? `${DAY_SHORT[p.wd]} ${p.day} ${MON[p.month]}` : `${p.day} ${MON[p.month]}` };
  });
}

/** The next post that starts after now (within the 7-day view). */
export function nextPost(posts: PatrolSlot[], now: Date | number) {
  const n = myt(now);
  for (const d of rollingWeek(now)) {
    const today = posts
      .filter((s) => slotDays(s.days).includes(d.wd) && (d.i > 0 || startHour(s.hours) > n.hour))
      .sort((a, b) => startHour(a.hours) - startHour(b.hours));
    if (today.length) return { slot: today[0], day: d.i === 0 ? "Today" : d.i === 1 ? "Tomorrow" : DAY_SHORT[d.wd] };
  }
  return null;
}

/** Is this post's hour running right now? */
export function postOnNow(s: PatrolSlot, now: Date | number): boolean {
  const n = myt(now);
  return slotDays(s.days).includes(n.wd) && startHour(s.hours) === n.hour;
}

/** "U Residence, corridor L3" → 3 */
export function floorOf(location: string): number | undefined {
  const m = location.match(/\bL(\d{1,2})\b/);
  return m ? parseInt(m[1]) : undefined;
}

// ── Statistics (from the incident log; never hand-written numbers) ──

/** Real incidents (confirmed or resolved) at this post's place in the 28 days up to `end`. */
export function postIncidents(events: Event[], s: PatrolSlot, end: number) {
  const from = end - 28 * DAY_MS;
  const h = startHour(s.hours);
  const ds = slotDays(s.days);
  const all = events.filter((e) => {
    const t = Date.parse(e.start_time);
    return e.location === s.location && REAL.has(e.status) && t >= from && t <= end;
  });
  const win = all.filter((e) => myt(e.start_time).hour === h);
  const hits = win.filter((e) => ds.includes(myt(e.start_time).wd));
  return { all, win, hits };
}

/** Post days between `from` and `to`, and how many had a check-in. */
export function coverage(s: PatrolSlot, from: number, to: number) {
  const ds = slotDays(s.days);
  const sinceKey = s.since ? myt(s.since).key : "";
  const days: string[] = [];
  for (let t = from; t <= to; t += DAY_MS) {
    const p = myt(t);
    if (ds.includes(p.wd) && p.key >= sinceKey && !days.includes(p.key)) days.push(p.key);
  }
  const checked = new Set((s.checkins ?? []).map((c: Checkin) => myt(c.at).key));
  return { days, covered: days.filter((k) => checked.has(k)) };
}
