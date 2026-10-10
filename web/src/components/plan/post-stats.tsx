"use client";

// Folded statistics: "Why these times" and "Did the posts work?", all counted from the incident log.
import { useState } from "react";
import { cn } from "@/lib/utils";
import { coverage, dateOnly, DAY_SHORT, hh, myt, postIncidents, startHour } from "@/lib/posts";
import type { Event } from "@/lib/types";
import type { RosterPost } from "./post-roster";

const DAY_MS = 86_400_000;

export function statsFor(posts: RosterPost[], events: Event[], end: number) {
  const why = posts.map(({ slot, rank }) => {
    const { all, win, hits } = postIncidents(events, slot, end);
    const h = startHour(slot.hours);
    const counts = Array.from({ length: 17 }, (_, i) => all.filter((e) => myt(e.start_time).hour === i + 7).length);
    const extra = hits.length < win.length ? `, ${hits.length} of them on the post days` : "";
    return {
      slot,
      rank,
      h,
      counts,
      headline: all.length
        ? `${win.length} of ${all.length} incident${all.length === 1 ? "" : "s"} here happened between ${hh(h)} and ${hh(h + 1)}${extra}.`
        : "No confirmed incidents here in the last 28 days.",
      dates: hits.length ? `Dates: ${hits.map((e) => `${DAY_SHORT[myt(e.start_time).wd]} ${dateOnly(e.start_time)}`).join(", ")}.` : "",
      win: win.length,
      all: all.length,
    };
  });
  const weekStarts = [3, 2, 1, 0].map((k) => end - (k + 1) * 7 * DAY_MS);
  let covered = 0;
  let postDays = 0;
  const work = posts.map(({ slot, rank }) => {
    const { hits } = postIncidents(events, slot, end);
    const weeks = weekStarts.map((from) => hits.filter((e) => { const t = Date.parse(e.start_time); return t > from && t <= from + 7 * DAY_MS; }).length);
    const cov = coverage(slot, end - 7 * DAY_MS, end);
    covered += cov.covered.length;
    postDays += cov.days.length;
    // A post needs a couple of post days before "last week" says anything about it.
    const isNew = !!slot.since && Date.parse(slot.since) > end - 2 * DAY_MS;
    const before = (weeks[0] + weeks[1] + weeks[2]) / 3;
    const last = weeks[3];
    const uncovered = hits.filter((e) => Date.parse(e.start_time) > end - 7 * DAY_MS && !cov.covered.includes(myt(e.start_time).key)).length;
    const text = isNew
      ? "New post. Results start next week."
      : `${last === 0 ? "No incidents" : `${last} incident${last === 1 ? "" : "s"}`} at the post hour last week, against ${before.toFixed(1)} a week in the 3 weeks before. A guard checked in on ${cov.covered.length} of ${cov.days.length} post days.`;
    const verdict = isNew ? "" : uncovered ? "Cover every post day." : last < before ? "Working. Keep it." : last > before ? "Not working yet. Check where the guard stands." : "Too early to say.";
    return { slot, rank, weeks, text, verdict, isNew };
  });
  const top = [...why].sort((a, b) => b.win - a.win)[0];
  const summary = [
    top && top.all ? `${top.win} of ${top.all} incidents at ${top.slot.location} happened at ${hh(top.h)}.` : "",
    postDays ? `Last week the posts were covered on ${covered} of ${postDays} days.` : "",
  ].filter(Boolean).join(" ");
  return { why, work, summary, weekLabels: weekStarts.map((t, i) => (i === 3 ? "Last week" : dateOnly(t + DAY_MS))) };
}

export function PostStats({ posts, events, end, assumption }: { posts: RosterPost[]; events: Event[]; end: number; assumption: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"why" | "work">("why");
  const s = statsFor(posts, events, end);
  return (
    <section aria-label="Numbers behind this plan" className="flex flex-col gap-3 rounded-[2px] border border-line bg-[#F7F8FA] px-4 py-3.5">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center justify-between gap-2.5 text-left">
        <span className="flex flex-col gap-0.5">
          <span className="ee-label text-[12px]">STATISTICS · OPTIONAL</span>
          <span className="text-[20px] font-extrabold">The numbers behind this plan</span>
          <span className="text-[14px] text-ink-2">{s.summary}</span>
        </span>
        <span className="flex-none text-[15px] font-extrabold text-signal">{open ? "Hide" : "Show the numbers"}</span>
      </button>
      {open && (
        <>
          <div role="group" aria-label="Which numbers" className="inline-flex self-start overflow-hidden rounded-[2px] border border-line-strong">
            {(["why", "work"] as const).map((t) => (
              <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)} className={cn("min-h-[38px] px-3.5 text-[14px] font-bold", t === "work" && "border-l border-line-strong", tab === t ? "bg-ink text-white" : "bg-white")}>
                {t === "why" ? "Why these times" : "Did the posts work?"}
              </button>
            ))}
          </div>
          {tab === "why" ? (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr))]">
              {s.why.map((w) => {
                const max = Math.max(1, ...w.counts);
                return (
                  <div key={w.slot.id ?? w.slot.location} className="flex flex-col gap-2.5 rounded-[2px] border border-line bg-white p-3.5">
                    <span className="flex items-center gap-2.5">
                      <span className="inline-flex size-7 flex-none items-center justify-center rounded-full bg-signal font-extrabold text-white">{w.rank}</span>
                      <span className="text-[16px] font-extrabold">{w.slot.location}</span>
                    </span>
                    <span className="text-[17px] leading-snug font-extrabold">{w.headline}</span>
                    <div className="flex h-[100px] items-end gap-[3px] border-b-2 border-ink pt-[18px]" aria-label={`Incidents by hour, 07:00 to 23:00, at ${w.slot.location}`} role="img">
                      {w.counts.map((n, i) => (
                        <span key={i} title={`${hh(i + 7)}: ${n}`} className="relative min-h-[2px] flex-1 rounded-t-[1px]" style={{ height: `${Math.round((n / max) * 100)}%`, background: i + 7 === w.h ? "#2742D9" : "#C9CED6" }}>
                          {n > 0 && <span className="absolute -top-[18px] right-0 left-0 text-center text-[12px] font-extrabold">{n}</span>}
                        </span>
                      ))}
                    </div>
                    <div className="-mt-1.5 flex gap-[3px]" aria-hidden="true">
                      {w.counts.map((_, i) => {
                        const h = i + 7;
                        const show = h === w.h || h % 3 === 1;
                        return <span key={i} className={cn("flex-1 text-center font-mono text-[10px]", h === w.h ? "font-extrabold text-signal-ink" : "text-muted-ink")}>{show ? String(h).padStart(2, "0") : ""}</span>;
                      })}
                    </div>
                    {w.dates && <span className="text-[13px] leading-snug text-muted-ink">{w.dates}</span>}
                    <span className="text-[13px] leading-snug text-ink-2">
                      If a guard is there: about {w.slot.expected_avoided_per_week.toFixed(2)} incidents avoided a week ({w.slot.incidents_4w} in 4 weeks × 0.6 ÷ 4).
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr))]">
              {s.work.map((r) => (
                <div key={r.slot.id ?? r.slot.location} className="flex flex-col gap-2.5 rounded-[2px] border border-line bg-white p-3.5">
                  <span className="flex items-center gap-2.5">
                    <span className="inline-flex size-7 flex-none items-center justify-center rounded-full bg-signal font-extrabold text-white">{r.rank}</span>
                    <span className="text-[16px] font-extrabold">{r.slot.location}</span>
                  </span>
                  <div className="flex h-[100px] items-end gap-2.5 border-b-2 border-ink pt-[22px]" role="img" aria-label={`Incidents at the post hour per week: ${r.weeks.join(", ")}`}>
                    {r.weeks.map((n, i) => (
                      <span key={i} className="relative min-h-[3px] flex-1 rounded-t-[1px]" style={{ height: `${Math.round((n / Math.max(3, ...r.weeks)) * 100)}%`, background: i === 3 && !r.isNew ? "#2742D9" : "#C9CED6" }}>
                        <span className="ee-display absolute -top-5 right-0 left-0 text-center text-[18px]">{n}</span>
                      </span>
                    ))}
                  </div>
                  <div className="-mt-1.5 flex gap-2.5" aria-hidden="true">
                    {s.weekLabels.map((l, i) => (
                      <span key={l} className={cn("flex-1 text-center text-[12px]", i === 3 && !r.isNew ? "font-extrabold text-signal-ink" : "text-muted-ink")}>{l}</span>
                    ))}
                  </div>
                  <span className="text-[14px] leading-snug">{r.text}</span>
                  {r.verdict && <span className="text-[14px] font-extrabold text-signal-ink">{r.verdict}</span>}
                </div>
              ))}
            </div>
          )}
          <p className="m-0 rounded-[2px] border border-dashed border-ink bg-white px-3.5 py-2.5 text-[14px]">
            <span className="font-extrabold">Assumption: </span>
            {assumption} Counts are confirmed or resolved incidents from the incident log, 28 days up to this morning&rsquo;s check.
          </p>
        </>
      )}
    </section>
  );
}
