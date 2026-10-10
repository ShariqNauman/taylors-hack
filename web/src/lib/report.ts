// Daily / weekly report: numbers from the dashboard's own data, words from POST /report/summary
// (Claude on the API), a PDF built in the browser. Nothing here invents a number.
import type { Camera, Event, PatrolPlan, Site } from "@/lib/types";
import { API_URL } from "@/lib/api";
import {
  LEVEL_LABEL,
  MYT_TZ,
  normaliseStatus,
  secondsBetween,
  TYPE_LABEL,
} from "@/lib/format";
import { dayKey, OUTCOME_WORDS, STATUS_WORDS } from "@/lib/plain";

export type Period = "daily" | "weekly";

/** The deployed API holds the Claude key. Mock mode still asks it, then falls back to the template. */
export const REPORT_API_URL =
  API_URL || "https://earl-eye-backend.onrender.com";

export interface ReportCount {
  label: string;
  count: number;
}
export interface ReportIncident {
  incident_id: string;
  time: string;
  location: string;
  level: string;
  type: string;
  status: string;
  outcome: string | null;
}
export interface ReportFacts {
  site: string;
  period: Period;
  start: string;
  end: string;
  data_source: "live" | "synthetic history";
  incidents: number;
  alarms: number;
  fights: number;
  confirmed: number;
  dismissed: number;
  resolved: number;
  open: number;
  guard_alerts: number;
  median_response_s: number | null;
  by_location: ReportCount[];
  by_type: ReportCount[];
  outcomes: ReportCount[];
  black_cameras: string[];
  patrol: string[];
  top_incidents: ReportIncident[];
}
export interface ReportSummary {
  text: string;
  model: string;
  generated_at: string;
}

const fmt = (o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: MYT_TZ, hour12: false, ...o });
/** "Sat 10 Oct 22:14" */
export const whenShort = (iso: string) =>
  fmt({
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(iso))
    .replace(",", "");
/** "Saturday 10 October 2026" */
export const dayWords = (iso: string) =>
  fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" })
    .format(new Date(iso))
    .replace(",", "");

/** Malaysia-time day window. `date` is YYYY-MM-DD; weekly = the 7 days ending on that date. */
export function periodWindow(
  period: Period,
  date: string,
): { start: string; end: string } {
  const end = new Date(`${date}T00:00:00+08:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (period === "daily" ? 1 : 7));
  const iso = (d: Date) =>
    `${new Date(d.getTime() + 8 * 3_600_000).toISOString().slice(0, 19)}+08:00`;
  return { start: iso(start), end: iso(end) };
}

export const todayKey = () => dayKey(new Date());

const counts = (xs: string[]): ReportCount[] =>
  Object.entries(
    xs.reduce<Record<string, number>>(
      (m, x) => ((m[x] = (m[x] ?? 0) + 1), m),
      {},
    ),
  )
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

const LEVEL_RANK: Record<string, number> = {
  calm: 0,
  tense: 1,
  fight_likely: 2,
  fight: 3,
};

export function buildFacts(args: {
  period: Period;
  date: string;
  events: Event[];
  cameras?: Camera[];
  plan?: PatrolPlan;
  site?: Site;
  synthetic: boolean;
}): { facts: ReportFacts; rows: Event[] } {
  const { start, end } = periodWindow(args.period, args.date);
  const t0 = Date.parse(start);
  const t1 = Date.parse(end);
  const rows = args.events
    .map((e) => ({ ...e, status: normaliseStatus(e.status) }))
    .filter((e) => e.level !== "calm")
    .filter((e) => {
      const t = Date.parse(e.start_time);
      return t >= t0 && t < t1;
    })
    .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
  const alarms = rows.filter(
    (e) => e.level === "fight_likely" || e.level === "fight",
  );
  const resp = rows
    .map((e) => secondsBetween(e.pushed_at, e.acked_at))
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);
  const top = [...rows]
    .sort(
      (a, b) =>
        LEVEL_RANK[b.level] - LEVEL_RANK[a.level] ||
        b.priority - a.priority ||
        Date.parse(a.start_time) - Date.parse(b.start_time),
    )
    .slice(0, 15);
  const facts: ReportFacts = {
    site: args.site?.name ?? "Taylor's Lakeside",
    period: args.period,
    start,
    end,
    data_source: args.synthetic ? "synthetic history" : "live",
    incidents: rows.length,
    alarms: alarms.length,
    fights: rows.filter((e) => e.level === "fight").length,
    confirmed: rows.filter((e) => e.status === "confirmed").length,
    dismissed: rows.filter((e) => e.status === "dismissed").length,
    resolved: rows.filter((e) => e.status === "resolved").length,
    open: rows.filter((e) => e.status === "new" || e.status === "pushed")
      .length,
    guard_alerts: rows.filter((e) => !!e.pushed_at).length,
    median_response_s: resp.length ? resp[Math.floor(resp.length / 2)] : null,
    by_location: counts(rows.map((e) => e.location)),
    by_type: counts(rows.map((e) => TYPE_LABEL[e.type] ?? e.type)),
    outcomes: counts(
      rows.filter((e) => e.outcome).map((e) => OUTCOME_WORDS[e.outcome!]),
    ),
    black_cameras: (args.cameras ?? [])
      .filter((c) => c.black_since || c.online === false)
      .map(
        (c) =>
          `${c.camera_id} ${c.location}${c.black_since ? `, no picture since ${whenShort(c.black_since)}` : ", offline"}`,
      ),
    patrol: (args.plan?.slots ?? []).map(
      (s) => `${s.location}, ${s.days} ${s.hours}`,
    ),
    top_incidents: top.map((e) => ({
      incident_id: e.incident_id,
      time: whenShort(e.start_time),
      location: e.location,
      level: LEVEL_LABEL[e.level],
      type: TYPE_LABEL[e.type] ?? e.type,
      status: STATUS_WORDS[e.status] ?? e.status,
      outcome: e.outcome ? OUTCOME_WORDS[e.outcome] : null,
    })),
  };
  return { facts, rows };
}

/** Same shape as the API's template, for when the API can't be reached at all. */
export function offlineSummary(f: ReportFacts): string {
  const where =
    f.by_location
      .slice(0, 3)
      .map((c) => `${c.label} (${c.count})`)
      .join(", ") || "no location";
  const lines = [
    `${f.incidents} incidents ${f.period === "daily" ? "on this day" : "this week"}, ${f.alarms} of them alarms (${f.fights} fights). Most were at ${where}.`,
    `The desk confirmed ${f.confirmed}, dismissed ${f.dismissed} and resolved ${f.resolved}; ${f.open} still open. Guards were alerted ${f.guard_alerts} times${f.median_response_s != null ? `; median response ${f.median_response_s} s` : ""}.`,
    "Actions:",
  ];
  if (f.black_cameras[0]) lines.push(`- Repair ${f.black_cameras[0]}.`);
  if (f.open)
    lines.push(
      `- Close or label the ${f.open} open incident${f.open === 1 ? "" : "s"}.`,
    );
  if (f.patrol[0]) lines.push(`- Keep the patrol: ${f.patrol[0]}.`);
  if (f.data_source !== "live")
    lines.unshift("These numbers are demo data (synthetic history).");
  return lines.join("\n");
}

export async function postReportSummary(
  facts: ReportFacts,
): Promise<ReportSummary> {
  try {
    const r = await fetch(`${REPORT_API_URL}/report/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(facts),
      cache: "no-store",
      // Render's free tier can take ~30 s to wake up.
      signal: AbortSignal.timeout(45_000),
    });
    if (r.ok) return (await r.json()) as ReportSummary;
  } catch {
    // fall through to the template
  }
  return {
    text: offlineSummary(facts),
    model: "offline-template",
    generated_at: new Date().toISOString(),
  };
}

// ── PDF ──

export async function downloadReportPdf(
  facts: ReportFacts,
  summary: ReportSummary,
) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  let y = M;

  const ensure = (h: number) => {
    if (y + h > H - M) {
      doc.addPage();
      y = M;
    }
  };
  const text = (
    s: string,
    size = 10,
    style: "normal" | "bold" = "normal",
    gap = 4,
  ) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    for (const line of doc.splitTextToSize(s, W - 2 * M) as string[]) {
      ensure(size + gap);
      doc.text(line, M, y + size);
      y += size + gap;
    }
  };
  const heading = (s: string) => {
    y += 10;
    ensure(30);
    doc.setDrawColor(11, 13, 16);
    doc.setLineWidth(1);
    doc.line(M, y, W - M, y);
    y += 6;
    text(s.toUpperCase(), 9, "bold", 6);
  };
  const table = (cols: { h: string; w: number }[], rows: string[][]) => {
    const total = cols.reduce((a, c) => a + c.w, 0);
    const xs: number[] = [];
    cols.reduce((x, c) => (xs.push(x), x + (c.w / total) * (W - 2 * M)), M);
    const widths = cols.map((c) => (c.w / total) * (W - 2 * M) - 6);
    const row = (cells: string[], bold: boolean) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(8.5);
      const wrapped = cells.map(
        (c, i) => doc.splitTextToSize(c, widths[i]) as string[],
      );
      const h = Math.max(...wrapped.map((w) => w.length)) * 11 + 4;
      ensure(h);
      wrapped.forEach((w, i) =>
        w.forEach((l, j) => doc.text(l, xs[i], y + 9 + j * 11)),
      );
      y += h;
      doc.setDrawColor(220, 223, 228);
      doc.line(M, y - 2, W - M, y - 2);
    };
    row(
      cols.map((c) => c.h),
      true,
    );
    rows.forEach((r) => row(r, false));
  };

  const periodName =
    facts.period === "daily" ? "Daily report" : "Weekly report";
  const lastDay = new Date(Date.parse(facts.end) - 1).toISOString();
  const range =
    facts.period === "daily"
      ? dayWords(facts.start)
      : `${dayWords(facts.start)} to ${dayWords(lastDay)}`;

  text("EARLYEYE", 9, "bold");
  text(`${periodName} · ${facts.site}`, 20, "bold", 6);
  text(range, 12);
  text(
    `Generated ${whenShort(summary.generated_at)} (Malaysia time) · ${
      facts.data_source === "live"
        ? "Live data"
        : "Demo data: synthetic history, not real incidents"
    }`,
    8.5,
  );

  heading("The numbers");
  table(
    [
      { h: "Incidents", w: 1 },
      { h: "Alarms", w: 1 },
      { h: "Fights", w: 1 },
      { h: "Real", w: 1 },
      { h: "False alarms", w: 1.2 },
      { h: "Still open", w: 1 },
      { h: "Guard alerts", w: 1.2 },
      { h: "Median response", w: 1.4 },
    ],
    [
      [
        String(facts.incidents),
        String(facts.alarms),
        String(facts.fights),
        String(facts.confirmed + facts.resolved),
        String(facts.dismissed),
        String(facts.open),
        String(facts.guard_alerts),
        facts.median_response_s != null
          ? `${facts.median_response_s} s`
          : "No taps",
      ],
    ],
  );

  heading("Summary");
  for (const para of summary.text.split(/\n+/).filter(Boolean)) {
    const isAction = para.trim().startsWith("- ");
    text(
      isAction ? `•  ${para.trim().slice(2)}` : para.trim(),
      10.5,
      para.trim() === "Actions:" ? "bold" : "normal",
      4,
    );
    if (!isAction) y += 4;
  }
  text(
    summary.model === "offline-template"
      ? "Written from a fixed template: the AI service could not be reached."
      : `Written by ${summary.model} from the numbers in this report only.`,
    8,
  );

  if (facts.by_location.length) {
    heading("Where");
    table(
      [
        { h: "Location", w: 4 },
        { h: "Incidents", w: 1 },
      ],
      facts.by_location.map((c) => [c.label, String(c.count)]),
    );
  }
  if (facts.top_incidents.length) {
    heading(
      facts.incidents > facts.top_incidents.length
        ? `Incidents (top ${facts.top_incidents.length} by severity)`
        : "Incidents",
    );
    table(
      [
        { h: "When", w: 1.4 },
        { h: "Where", w: 2 },
        { h: "Level", w: 1 },
        { h: "Type", w: 1.1 },
        { h: "Decision", w: 1.3 },
        { h: "Guard said", w: 1.5 },
        { h: "ID", w: 1.4 },
      ],
      facts.top_incidents.map((i) => [
        i.time,
        i.location,
        i.level,
        i.type,
        i.status,
        i.outcome ?? "-",
        i.incident_id,
      ]),
    );
  }
  heading("Cameras");
  text(
    facts.black_cameras.length
      ? facts.black_cameras.map((c) => `•  ${c}`).join("\n")
      : "All cameras sent pictures.",
    10,
  );
  if (facts.patrol.length) {
    heading("Patrol plan this week");
    text(facts.patrol.map((p) => `•  ${p}`).join("\n"), 10);
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(110, 117, 128);
    doc.text(
      "EarlyEye detects physical aggression and crowding from body keypoints. No video leaves the site.",
      M,
      H - 24,
    );
    doc.text(`${i} / ${pages}`, W - M, H - 24, { align: "right" });
    doc.setTextColor(0, 0, 0);
  }
  const key = facts.start.slice(0, 10);
  doc.save(`earlyeye-${facts.period}-report-${key}.pdf`);
}
