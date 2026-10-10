"use client";

import { cn } from "@/lib/utils";
import type { Event } from "@/lib/types";
import {
  fmtRelative,
  LEVEL_DOT,
  LEVEL_LABEL,
  TYPE_CHIP,
  TYPE_LABEL,
} from "@/lib/format";

export function Queue({
  events,
  selectedId,
  onSelect,
  now,
}: {
  events: Event[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  now: Date;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-lg font-semibold">Queue</h2>
        <span className="text-sm text-slate-500">
          {events.length} active · sorted by priority
        </span>
      </header>
      {events.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">
          Nothing above calm on any camera.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {events.map((e) => (
            <li key={e.incident_id}>
              <button
                type="button"
                onClick={() => onSelect(e.incident_id)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50",
                  selectedId === e.incident_id && "bg-slate-100",
                )}
              >
                <span
                  className={cn(
                    "size-3 shrink-0 rounded-full",
                    LEVEL_DOT[e.level],
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    {e.location}
                  </span>
                  <span className="block truncate text-sm text-slate-500">
                    {LEVEL_LABEL[e.level]}
                    {e.eta_seconds != null && e.level !== "fight"
                      ? ` · ~${Math.round(e.eta_seconds)} s`
                      : ""}
                    {" · "}
                    {fmtRelative(e.start_time, now)}
                    {e.pushed_to ? ` · pushed to ${e.pushed_to}` : ""}
                  </span>
                </span>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-xs font-medium",
                    TYPE_CHIP[e.type],
                  )}
                >
                  {TYPE_LABEL[e.type]}
                </span>
                <span className="w-12 text-right font-mono text-sm tabular-nums">
                  {e.priority.toFixed(2)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
