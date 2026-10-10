// Section 3: today plus the next six days, one row per post.
import { myt, type Person, rollingWeek, slotDays, startHour } from "@/lib/posts";
import type { RosterPost } from "./post-roster";

export function PostTimetable({ posts, people, now }: { posts: RosterPost[]; people: Person[]; now: number }) {
  const days = rollingWeek(now);
  const hourNow = myt(now).hour;
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[900px] gap-1.5" style={{ gridTemplateColumns: "230px repeat(7, minmax(0, 1fr))" }} role="table" aria-label="Guard posts, today and the next six days">
        <span role="columnheader" />
        {days.map((d) => (
          <span key={d.key} role="columnheader" className={d.i === 0 ? "flex flex-col border-b-2 border-ink bg-ink px-1.5 py-1 text-white" : "flex flex-col border-b-2 border-ink px-1.5 py-1"}>
            <span className="text-[15px] font-extrabold">{d.label}</span>
            <span className="font-mono text-[12px]">{d.date}</span>
          </span>
        ))}
        {posts.map(({ slot, rank }) => {
          const g = people.find((p) => p.id === slot.assigned_to);
          const ds = slotDays(slot.days);
          return (
            <div key={slot.id ?? slot.location} role="row" className="contents">
              <span role="rowheader" className="flex items-center gap-2.5 py-1.5">
                <span className="inline-flex size-[30px] flex-none items-center justify-center rounded-full bg-signal font-extrabold text-white">{rank}</span>
                <span className="text-[15px] leading-tight font-extrabold">{slot.location}</span>
              </span>
              {days.map((d) => {
                if (!ds.includes(d.wd)) return <span key={d.key} role="cell" className="min-h-[58px] rounded-[2px] border border-[#F1F2F4] bg-[#F7F8FA]" />;
                const past = d.i === 0 && startHour(slot.hours) < hourNow;
                return (
                  <span
                    key={d.key}
                    role="cell"
                    className={
                      g
                        ? `flex min-h-[58px] flex-col justify-center gap-0.5 rounded-[2px] border border-signal px-2 py-1.5 text-white ${past ? "bg-[#93A6EE]" : "bg-signal"}`
                        : "flex min-h-[58px] flex-col justify-center gap-0.5 rounded-[2px] border-2 border-dashed border-ink bg-white px-2 py-1.5"
                    }
                  >
                    <span className="font-mono text-[13px] font-bold">{slot.hours}</span>
                    <span className="text-[14px] font-extrabold">{g ? g.first : "Nobody yet"}</span>
                    {past && <span className="sr-only">(already over)</span>}
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
