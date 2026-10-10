import type { IncidentType, Level, Site, Status } from "./types";

export const MYT_TZ = "Asia/Kuala_Lumpur";

/** "22:41:07" in Malaysia time. */
export function fmtTime(iso: string, withSeconds = true): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: MYT_TZ,
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hour12: false,
  }).format(new Date(iso));
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

/** "black for 3 days" / "black for 5 h". */
export function fmtBlackFor(iso: string, now: Date = new Date()): string {
  const h = Math.max(1, Math.round((now.getTime() - new Date(iso).getTime()) / 3_600_000));
  if (h < 24) return `black for ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "black for 1 day" : `black for ${d} days`;
}

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

/** Tailwind classes for the big level pill. Green / amber / red only. */
export const LEVEL_PILL: Record<Level, string> = {
  calm: "bg-green-600 text-white",
  tense: "bg-amber-500 text-black",
  fight_likely: "bg-red-600 text-white",
  fight: "bg-red-700 text-white",
};

/** Subtle tint for rows and cards. */
export const LEVEL_TINT: Record<Level, string> = {
  calm: "bg-green-50 border-green-200",
  tense: "bg-amber-50 border-amber-300",
  fight_likely: "bg-red-50 border-red-300",
  fight: "bg-red-100 border-red-400",
};

export const LEVEL_DOT: Record<Level, string> = {
  calm: "bg-green-500",
  tense: "bg-amber-500",
  fight_likely: "bg-red-500",
  fight: "bg-red-700",
};

export const TYPE_LABEL: Record<IncidentType, string> = {
  fight: "Fight",
  cornering: "Cornering",
  crowd: "Crowd gathering",
  play: "Play / sports",
};

export const TYPE_CHIP: Record<IncidentType, string> = {
  fight: "bg-red-100 text-red-900 border-red-300",
  cornering: "bg-purple-100 text-purple-900 border-purple-300",
  crowd: "bg-blue-100 text-blue-900 border-blue-300",
  play: "bg-slate-100 text-slate-800 border-slate-300",
};

export const STATUS_LABEL: Record<Status, string> = {
  new: "New",
  pushed: "Pushed",
  confirmed: "Confirmed",
  dismissed: "Dismissed",
  resolved: "Resolved",
};

export const STATUS_CHIP: Record<Status, string> = {
  new: "bg-slate-100 text-slate-800 border-slate-300",
  pushed: "bg-amber-100 text-amber-900 border-amber-300",
  confirmed: "bg-red-100 text-red-900 border-red-300",
  dismissed: "bg-slate-100 text-slate-500 border-slate-200",
  resolved: "bg-green-100 text-green-900 border-green-300",
};

/** Alarm fires only at fight_likely and above (two-tier). */
export function isAlarmLevel(level: Level): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER.fight_likely;
}

/** Zone label from the site table; falls back to a humanised zone_type. */
export function zoneLabel(site: Site | undefined, zone_type: string): string {
  const z = site?.zones.find((z) => z.zone_type === zone_type);
  if (z) return z.label;
  return zone_type.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function zoneRisk(site: Site | undefined, zone_type: string): number | undefined {
  return site?.zones.find((z) => z.zone_type === zone_type)?.risk;
}

/** "fight likely in ~6 s" */
export function fmtEta(eta: number | null | undefined): string | null {
  if (eta == null) return null;
  return `fight likely in ~${Math.round(eta)} s`;
}

export function fmtPct(x: number | undefined, digits = 0): string {
  if (x == null) return "–";
  return `${(x * 100).toFixed(digits)}%`;
}

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
