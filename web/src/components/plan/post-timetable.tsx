"use client";

// Section 3: seven days, one row per post. Starts at today; slide back to earlier weeks (what really
// happened: the guards' check-ins) or forward to later ones (who is assigned). Arrows, swipe or ← →.
import { useRef, useState } from "react";
import { DAY_SHORT, hm, myt, type Person, slotDays, startHour } from "@/lib/posts";
import { cn } from "@/lib/utils";
import type { RosterPost } from "./post-roster";

const DAY_MS = 86_400_000;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EARLIEST = -8; // weeks back (the history the plan is built from)
const LATEST = 3; // weeks ahead

export function PostTimetable({
  posts,
  people,
  now,
  renderHead,
}: {
  posts: RosterPost[];
  people: Person[];
  now: number;
  /** The section heading, given this view's title ("When: the next 7 days", "When: 27 Sep – 3 Oct"). */
  renderHead?: (title: string) => React.ReactNode;
}) {
  const [week, setWeek] = useState(0);
  const go = (d: number) => setWeek((w) => Math.max(EARLIEST, Math.min(LATEST, w + d)));
  const today = myt(now);
  const days = Array.from({ length: 7 }, (_, i) => {
    const t = now + (week * 7 + i) * DAY_MS;
    const p = myt(t);
    return { i, t, wd: p.wd, key: p.key, today: p.key === today.key, day: `${p.day} ${MON[p.month]}`, label: p.key === today.key ? "Today" : DAY_SHORT[p.wd] };
  });
  const range = `${days[0].day} – ${days[6].day}`;
  const title = week === 0 ? "When: the next 7 days" : `When: ${range}`;
  const first = (call: string) => people.find((p) => p.id === call)?.first ?? call;

  // Swipe (touch or pen): right = earlier, left = later.
  const touch = useRef<{ x: number; y: number } | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {renderHead?.(title)}
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Which week">
          <button type="button" onClick={() => go(-1)} disabled={week <= EARLIEST} className="min-h-10 rounded-[2px] border border-line-strong bg-white px-3 text-[14px] font-bold disabled:opacity-40">
            ← Earlier
          </button>
          {week !== 0 && (
            <button type="button" onClick={() => setWeek(0)} className="min-h-10 rounded-[2px] bg-ink px-3 text-[14px] font-bold text-white">
              Today
            </button>
          )}
          <button type="button" onClick={() => go(1)} disabled={week >= LATEST} className="min-h-10 rounded-[2px] border border-line-strong bg-white px-3 text-[14px] font-bold disabled:opacity-40">
            Later →
          </button>
        </div>
      </div>
      <div
        className="overflow-x-auto outline-none"
        tabIndex={0}
        aria-label={`Guard posts, ${range}. Left and right arrow keys change the week.`}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          go(e.key === "ArrowLeft" ? -1 : 1);
        }}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse") touch.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          const t = touch.current;
          touch.current = null;
          if (!t) return;
          const dx = e.clientX - t.x;
          if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(e.clientY - t.y)) go(dx > 0 ? -1 : 1);
        }}
      >
        <div className="grid min-w-[900px] gap-1.5" style={{ gridTemplateColumns: "230px repeat(7, minmax(0, 1fr))" }} role="table" aria-label={`Guard posts, ${range}`}>
          <span role="columnheader" />
          {days.map((d) => (
            <span key={d.key} role="columnheader" className={d.today ? "flex flex-col border-b-2 border-ink bg-ink px-1.5 py-1 text-white" : "flex flex-col border-b-2 border-ink px-1.5 py-1"}>
              <span className="text-[15px] font-extrabold">{d.label}</span>
              <span className="font-mono text-[12px]">{d.today ? `${DAY_SHORT[d.wd]} ${d.day}` : d.day}</span>
            </span>
          ))}
          {posts.map(({ slot, rank }) => {
            const g = people.find((p) => p.id === slot.assigned_to);
            const ds = slotDays(slot.days);
            const sinceKey = slot.since ? myt(slot.since).key : "";
            return (
              <div key={slot.id ?? slot.location} role="row" className="contents">
                <span role="rowheader" className="flex items-center gap-2.5 py-1.5">
                  <span className="inline-flex size-[30px] flex-none items-center justify-center rounded-full bg-signal font-extrabold text-white">{rank}</span>
                  <span className="text-[15px] leading-tight font-extrabold">{slot.location}</span>
                </span>
                {days.map((d) => {
                  const off = <span key={d.key} role="cell" className="min-h-[58px] rounded-[2px] border border-[#F1F2F4] bg-[#F7F8FA]" />;
                  if (!ds.includes(d.wd)) return off;
                  if (sinceKey && d.key < sinceKey)
                    return (
                      <span key={d.key} role="cell" className="flex min-h-[58px] items-center rounded-[2px] border border-[#F1F2F4] bg-[#F7F8FA] px-2 text-[12px] text-muted-ink">
                        Not a post yet
                      </span>
                    );
                  const over = d.key < today.key || (d.today && startHour(slot.hours) < today.hour);
                  if (over) {
                    // What really happened: the first check-in at this post that day.
                    const ci = (slot.checkins ?? []).filter((c) => myt(c.at).key === d.key).sort((a, b) => a.at.localeCompare(b.at))[0];
                    return (
                      <span
                        key={d.key}
                        role="cell"
                        className={cn(
                          "flex min-h-[58px] flex-col justify-center gap-0.5 rounded-[2px] px-2 py-1.5",
                          ci ? "border border-signal bg-signal-tint text-signal-ink" : "border border-dashed border-line-strong bg-white text-muted-ink",
                        )}
                      >
                        <span className="font-mono text-[13px] font-bold">{slot.hours}</span>
                        <span className="text-[14px] font-extrabold">{ci ? `✓ ${first(ci.staff)} ${hm(ci.at)}` : "No check-in"}</span>
                      </span>
                    );
                  }
                  return (
                    <span
                      key={d.key}
                      role="cell"
                      className={
                        g
                          ? "flex min-h-[58px] flex-col justify-center gap-0.5 rounded-[2px] border border-signal bg-signal px-2 py-1.5 text-white"
                          : "flex min-h-[58px] flex-col justify-center gap-0.5 rounded-[2px] border-2 border-dashed border-ink bg-white px-2 py-1.5"
                      }
                    >
                      <span className="font-mono text-[13px] font-bold">{slot.hours}</span>
                      <span className="text-[14px] font-extrabold">{g ? g.first : "Nobody yet"}</span>
                    </span>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
