"use client";

import type { LiveEvent } from "./use-live-feed";
import { HowItWorks } from "@/components/chrome/how-it-works";
import { fmtTime, LEVEL_THEME, TYPE_LABEL } from "@/lib/format";
import { LevelPill } from "@/components/chrome/level-pill";

export function Queue({
  events,
  selectedId,
  onSelect,
}: {
  events: LiveEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section
      aria-labelledby="queue-h"
      className="flex flex-col gap-2 rounded-[2px] border border-line bg-white p-3.5"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="queue-h" className="ee-display text-[24px]">
          Active now
        </h2>
        <HowItWorks>
          <span>Active now lists every camera above calm, highest priority first. Priority = severity × confidence × zone risk × people; zone risk comes from this site&apos;s zone table.</span>
          <span>Tense stays on this screen and rings nobody. Fight likely or fight pushes one guard, at most 3 fight-likely pushes a shift.</span>
          <span>EarlyEye sees 12 body points per person, never faces. The meters show the signals the model leans on most.</span>
          <span>A guard&apos;s &ldquo;Nothing there&rdquo; is a hint; the desk still decides. Every Yes or No is saved as a label for that camera.</span>
        </HowItWorks>
      </div>
      {events.length === 0 ? (
        <p className="py-2 text-[15px] text-ink-2">
          Nothing above calm on any camera.
        </p>
      ) : (
        events.map((e, i) => {
          const on = e.incident_id === selectedId;
          const t = LEVEL_THEME[e.level];
          return (
            <button
              key={e.incident_id}
              type="button"
              onClick={() => onSelect(e.incident_id)}
              aria-pressed={on}
              className="grid w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 rounded-[2px] px-3 py-2.5 text-left text-ink"
              style={{
                background: on ? t.tint : "#FFFFFF",
                border: on ? `2px solid ${t.border}` : "1px solid #DCDFE4",
              }}
            >
              <span className="row-span-2 font-mono text-[16px] font-bold">
                {i + 1}
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <LevelPill level={e.level} size="sm" className="shrink-0" />
                <span className="truncate text-[15px] font-extrabold">
                  {e.location}
                </span>
              </span>
              <span className="font-mono text-[16px] font-bold">
                {e.priority.toFixed(2)}
              </span>
              <span className="text-[13px] text-ink-2">
                {TYPE_LABEL[e.type]} · since {fmtTime(e.start_time)}
                {e.pushed_to ? ` · pushed to ${e.pushed_to}` : ""}
                {e.status === "confirmed" ? " · confirmed" : ""}
              </span>
              <span />
            </button>
          );
        })
      )}
    </section>
  );
}
