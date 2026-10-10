import type { IncidentType, Level, Site, Status } from "./types";

export const MYT_TZ = "Asia/Kuala_Lumpur";

/** "22:41:07" in Malaysia time. */
export function fmtTime(iso: string | Date, withSeconds = true): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: MYT_TZ,
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hour12: false,
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "Sat 10 Oct, 22:41" in Malaysia time. */
export function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: MYT_TZ,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** "SAT 10 OCT" style mono fragment. */
export function fmtDayDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: MYT_TZ,
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(new Date(iso));
}

/** "just now", "12 s ago", "4 min ago", "3 h ago", "3 days ago". */
export function fmtRelative(iso: string, now: Date = new Date()): string {
  const diff = Math.max(0, now.getTime() - new Date(iso).getTime());
  const s = Math.round(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

/** "Black for 3 days" / "Black for 5 h". Floors, so a 3-day-old camera reads 3 days all day. */
export function fmtBlackFor(iso: string, now: Date = new Date()): string {
  const h = Math.max(
    1,
    Math.floor((now.getTime() - new Date(iso).getTime()) / 3_600_000),
  );
  if (h < 24) return `Black for ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "Black for 1 day" : `Black for ${d} days`;
}

/** Seconds between two ISO stamps, or null. */
export function secondsBetween(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  if (!a || !b) return null;
  const d = (Date.parse(b) - Date.parse(a)) / 1000;
  return Number.isFinite(d) ? Math.max(0, Math.round(d)) : null;
}

// ── Levels: colour means severity, and only severity. Every level has a glyph and a word. ──

export const LEVEL_ORDER: Record<Level, number> = {
  calm: 0,
  tense: 1,
  fight_likely: 2,
  fight: 3,
};

export const LEVEL_LABEL: Record<Level, string> = {
  calm: "Calm",
  tense: "Tense",
  fight_likely: "Fight likely",
  fight: "Fight",
};

/** 24 px viewBox, filled. */
export const LEVEL_GLYPH: Record<Level, string> = {
  calm: "M12 4a8 8 0 1 1-0.01 0z",
  tense: "M12 3 22 20H2z",
  fight_likely: "M12 2 22 12 12 22 2 12z",
  fight: "M8 2h8l6 6v8l-6 6H8l-6-6V8z",
};

export interface LevelTheme {
  pillBg: string;
  pillFg: string;
  pillBorder: string;
  tint: string;
  border: string;
  box: string;
  boxFg: string;
  cell: string;
}

export const LEVEL_THEME: Record<Level, LevelTheme> = {
  calm: {
    pillBg: "#E4F3EA",
    pillFg: "#17663D",
    pillBorder: "#9FD3B4",
    tint: "#FFFFFF",
    border: "#DCDFE4",
    box: "#3FB27A",
    boxFg: "#06140C",
    cell: "#9FD3B4",
  },
  tense: {
    pillBg: "#F5B323",
    pillFg: "#1A1200",
    pillBorder: "#E5A41C",
    tint: "#FFF8E6",
    border: "#E5A41C",
    box: "#F5B323",
    boxFg: "#1A1200",
    cell: "#F5B323",
  },
  fight_likely: {
    pillBg: "#C8241B",
    pillFg: "#FFFFFF",
    pillBorder: "#C8241B",
    tint: "#FDEDEB",
    border: "#C8241B",
    box: "#FF5A4F",
    boxFg: "#1A0503",
    cell: "#C8241B",
  },
  fight: {
    pillBg: "#7F1310",
    pillFg: "#FFFFFF",
    pillBorder: "#7F1310",
    tint: "#FBE3E0",
    border: "#7F1310",
    box: "#FF8A80",
    boxFg: "#1A0503",
    cell: "#7F1310",
  },
};

/** Alarm fires only at fight_likely and above (two-tier). */
export function isAlarmLevel(level: Level): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER.fight_likely;
}

// ── Types: outlined ink chips with an icon, never coloured. ──

export const TYPE_LABEL: Record<IncidentType, string> = {
  fight: "Fight",
  cornering: "Cornering",
  crowd: "Crowd gathering",
  play: "Play / sports",
};

// ── Status ──

export const STATUS_LABEL: Record<Status, string> = {
  new: "New",
  pushed: "Pushed",
  confirmed: "Confirmed",
  dismissed: "Dismissed",
  resolved: "Resolved",
};

export const STATUS_STYLE: Record<Status, string> = {
  new: "bg-white text-ink border-ink",
  pushed: "bg-signal-tint text-signal-ink border-[#A9B6F2]",
  confirmed: "bg-ink text-white border-ink",
  dismissed: "bg-ground text-ink-2 border-line",
  resolved: "bg-white text-ink-2 border-line-strong",
};

/** The API may send `false_alarm`; display it as dismissed. */
export function normaliseStatus(s: string): Status {
  if (s === "false_alarm" || s === "acknowledged")
    return s === "false_alarm" ? "dismissed" : "pushed";
  if (s in STATUS_LABEL) return s as Status;
  return "new";
}

// ── Zones ──

/** Zone label from the site table; falls back to a humanised zone_type. */
export function zoneLabel(site: Site | undefined, zone_type: string): string {
  const z = site?.zones.find((z) => z.zone_type === zone_type);
  if (z) return z.label;
  return zone_type.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function zoneRisk(
  site: Site | undefined,
  zone_type: string,
): number | undefined {
  return site?.zones.find((z) => z.zone_type === zone_type)?.risk;
}

/** "Fight likely in ~6 s" / "Fight in progress" / "No build-up" / "Watching · no ETA". */
export function etaText(level: Level, eta: number | null | undefined): string {
  if (level === "fight") return "Fight in progress";
  if (level === "calm") return "No build-up";
  if (eta != null) return `Fight likely in ~${Math.max(0, Math.round(eta))} s`;
  return "Watching · no ETA";
}

export function fmtPct(x: number | undefined | null, digits = 0): string {
  if (x == null) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Heatmap ramp, counts 0 to 5+. Blue means a count, never a risk level. */
export const HEAT_RAMP = [
  "#FFFFFF",
  "#DDE3FB",
  "#AFBDF3",
  "#6E86E8",
  "#3653DC",
  "#1F35B3",
];
export function heatColour(count: number): { bg: string; fg: string } {
  const i = Math.max(0, Math.min(5, Math.round(count)));
  return { bg: HEAT_RAMP[i], fg: i >= 4 ? "#FFFFFF" : "#0B0D10" };
}

/** Patrol hours per week parsed from "Mon–Thu" and "13:00–14:00". */
export function patrolHoursPerWeek(days: string, hours: string): number {
  const DAY = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const d = days.toLowerCase().replace(/\s/g, "");
  let nDays = 1;
  const m = d.match(/^([a-z]{3})[–-]([a-z]{3})$/);
  if (m) {
    const a = DAY.indexOf(m[1]);
    const b = DAY.indexOf(m[2]);
    if (a >= 0 && b >= 0) nDays = ((b - a + 7) % 7) + 1;
  } else if (d.includes(",")) {
    nDays = d.split(",").length;
  }
  const h = hours.match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/);
  let span = 1;
  if (h) {
    const start = parseInt(h[1]) + parseInt(h[2]) / 60;
    const end = parseInt(h[3]) + parseInt(h[4]) / 60;
    span = Math.max(0.5, (end - start + 24) % 24 || 1);
  }
  return nDays * span;
}

/** Does a patrol "days" string ("Mon–Thu", "Fri", "Sun–Thu") include a weekday (0 = Mon)? */
export function daysInclude(days: string, weekday: number): boolean {
  const DAY = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const d = days.toLowerCase().replace(/\s/g, "");
  const m = d.match(/^([a-z]{3})[–-]([a-z]{3})$/);
  if (m) {
    const a = DAY.indexOf(m[1]);
    const b = DAY.indexOf(m[2]);
    if (a < 0 || b < 0) return false;
    return (weekday - a + 7) % 7 <= (b - a + 7) % 7;
  }
  return d.split(",").some((x) => DAY.indexOf(x.slice(0, 3)) === weekday);
}

/** Weekday (0 = Mon) of a date in Malaysia time. */
export function mytWeekday(d: Date = new Date()): number {
  const w = new Intl.DateTimeFormat("en-GB", {
    timeZone: MYT_TZ,
    weekday: "short",
  }).format(d);
  return WEEKDAY_SHORT.indexOf(w);
}
