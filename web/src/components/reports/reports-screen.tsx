"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  getCameras,
  getEvents,
  getPatrolPlan,
  getSite,
  usingMock,
} from "@/lib/api";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/chrome/page-shell";
import {
  buildFacts,
  dayWords,
  downloadReportPdf,
  postReportSummary,
  todayKey,
  type Period,
  type ReportSummary,
} from "@/lib/report";

const CHIP_DASHED =
  "inline-flex min-h-7 items-center rounded-[2px] border border-dashed border-line-strong bg-white px-2 font-mono text-[11px] font-bold tracking-[0.06em] text-ink-2";

export function ReportsScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const period: Period = params.get("period") === "weekly" ? "weekly" : "daily";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "")
    ? params.get("date")!
    : todayKey();
  const apiDown = useAppStore((s) => s.apiDown);
  const synthetic = usingMock || apiDown;

  const { data: events } = useSWR(["events", "full"], () => getEvents(), {
    refreshInterval: 30_000,
  });
  const { data: cameras } = useSWR("cameras", getCameras, {
    refreshInterval: 30_000,
  });
  const { data: plan } = useSWR("plan", getPatrolPlan, {
    revalidateOnFocus: false,
  });
  const { data: site } = useSWR("site", getSite, { revalidateOnFocus: false });

  const { facts } = useMemo(
    () =>
      buildFacts({
        period,
        date,
        events: events ?? [],
        cameras,
        plan,
        site,
        synthetic,
      }),
    [period, date, events, cameras, plan, site, synthetic],
  );
  const factsKey = JSON.stringify(facts);
  const [result, setResult] = useState<{
    key: string;
    summary: ReportSummary;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const summary = result?.key === factsKey ? result.summary : null;

  const setQuery = (patch: Record<string, string>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) q.set(k, v);
    router.replace(`/reports?${q}`, { scroll: false });
  };

  const generate = async () => {
    setBusy(true);
    const s = await postReportSummary(facts);
    setResult({ key: factsKey, summary: s });
    setBusy(false);
  };

  const lastDay = new Date(Date.parse(facts.end) - 1).toISOString();
  const range =
    period === "daily"
      ? dayWords(facts.start)
      : `${dayWords(facts.start)} to ${dayWords(lastDay)}`;
  const stats: [string, string][] = [
    [String(facts.incidents), "incidents"],
    [String(facts.alarms), "alarms"],
    [String(facts.confirmed + facts.resolved), "real"],
    [String(facts.dismissed), "false alarms"],
    [String(facts.open), "still open"],
    [
      facts.median_response_s != null ? `${facts.median_response_s} s` : "—",
      "median response",
    ],
  ];

  return (
    <PageShell
      kicker="Daily and weekly"
      title="Reports"
      subtitle="Everything that happened, written up by AI from the dashboard's own numbers, as a PDF."
      headerRight={
        synthetic ? (
          <span className={CHIP_DASHED}>SYNTHETIC HISTORY · 8 WEEKS</span>
        ) : undefined
      }
    >
      <section className="flex flex-wrap items-end gap-3 rounded-[2px] border border-line bg-white p-4">
        <div role="group" aria-label="Report period" className="flex">
          {(["daily", "weekly"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => setQuery({ period: p })}
              className={cn(
                "min-h-11 border px-4 text-[15px] font-bold first:rounded-l-[2px] last:rounded-r-[2px]",
                period === p
                  ? "border-ink bg-ink text-white"
                  : "border-line-strong bg-white",
              )}
            >
              {p === "daily" ? "Daily" : "Weekly"}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-[13px] font-bold">
          {period === "daily" ? "Day" : "Week ending"}
          <input
            type="date"
            value={date}
            max={todayKey()}
            onChange={(ev) =>
              ev.target.value && setQuery({ date: ev.target.value })
            }
            className="min-h-11 rounded-[2px] border border-line-strong bg-white px-3 font-mono text-[15px]"
          />
        </label>
        <button
          type="button"
          onClick={generate}
          disabled={busy || !events}
          className="min-h-11 rounded-[2px] bg-ink px-5 text-[16px] font-extrabold text-white disabled:opacity-50"
        >
          {busy
            ? "Writing the summary…"
            : summary
              ? "Write it again"
              : "Generate report"}
        </button>
        <button
          type="button"
          onClick={() => summary && downloadReportPdf(facts, summary)}
          disabled={!summary}
          className="min-h-11 rounded-[2px] border-2 border-ink bg-white px-5 text-[16px] font-extrabold disabled:border-line-strong disabled:text-muted-ink"
        >
          Download PDF
        </button>
        {busy && (
          <span className="text-[13px] text-ink-2">
            The AI service can take up to 30 s to wake up.
          </span>
        )}
      </section>

      <section className="flex flex-col gap-4 rounded-[2px] border border-line bg-white p-5">
        <div className="flex flex-col gap-1">
          <span className="ee-label">
            {period === "daily" ? "Daily report" : "Weekly report"}
          </span>
          <h2 className="text-[26px] font-extrabold leading-tight">{range}</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 min-[1100px]:grid-cols-6">
          {stats.map(([v, k]) => (
            <div
              key={k}
              className="flex flex-col rounded-[2px] border border-line px-3 py-2"
            >
              <span className="font-mono text-[26px] font-bold">{v}</span>
              <span className="text-[13px] text-ink-2">{k}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 rounded-[2px] border border-line bg-raised p-4">
          <span className="ee-label">Summary</span>
          {summary ? (
            <>
              {summary.text
                .split(/\n+/)
                .filter(Boolean)
                .map((line, i) => (
                  <p
                    key={i}
                    className={cn(
                      "m-0 text-[16px] leading-relaxed",
                      line.trim() === "Actions:" && "font-extrabold",
                      line.trim().startsWith("- ") && "pl-4",
                    )}
                  >
                    {line.trim().startsWith("- ")
                      ? `• ${line.trim().slice(2)}`
                      : line}
                  </p>
                ))}
              <span className="text-[12px] text-muted-ink">
                {summary.model === "offline-template"
                  ? "Written from a fixed template: the AI service could not be reached."
                  : `Written by ${summary.model} from the numbers on this page only.`}
              </span>
            </>
          ) : (
            <p className="m-0 text-[15px] text-ink-2">
              {facts.incidents
                ? "Press Generate report to have the summary written, then download the PDF."
                : "No incidents in this period. You can still generate the report."}
            </p>
          )}
        </div>

        <div className="grid gap-4 min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="flex flex-col gap-2">
            <span className="ee-label">Where</span>
            {facts.by_location.length ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[15px]">
                {facts.by_location.map((c) => (
                  <li
                    key={c.label}
                    className="flex justify-between border-b border-line py-1"
                  >
                    <span>{c.label}</span>
                    <span className="font-mono font-bold">{c.count}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 text-[15px] text-ink-2">
                Nothing in this period.
              </p>
            )}
            <span className="ee-label mt-2">Cameras</span>
            <p className="m-0 text-[15px]">
              {facts.black_cameras.length
                ? facts.black_cameras.join("; ")
                : "All cameras sent pictures."}
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <span className="ee-label">
              {facts.incidents > facts.top_incidents.length
                ? `Incidents · top ${facts.top_incidents.length} of ${facts.incidents} by severity`
                : "Incidents"}
            </span>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-[14px]">
                <thead>
                  <tr className="border-b-2 border-ink">
                    {["When", "Where", "Level", "Decision", "Guard said"].map(
                      (h) => (
                        <th
                          key={h}
                          className="py-1.5 pr-3 font-mono text-[11px] uppercase tracking-[0.06em]"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {facts.top_incidents.map((i) => (
                    <tr
                      key={i.incident_id}
                      className="border-b border-line align-top"
                    >
                      <td className="py-1.5 pr-3 font-mono text-[12px]">
                        {i.time}
                      </td>
                      <td className="py-1.5 pr-3">{i.location}</td>
                      <td className="py-1.5 pr-3">{i.level}</td>
                      <td className="py-1.5 pr-3">{i.status}</td>
                      <td className="py-1.5 pr-3">{i.outcome ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
