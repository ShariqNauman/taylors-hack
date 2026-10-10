"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Event, Site } from "@/lib/types";
import {
  fmtEta,
  fmtTime,
  LEVEL_LABEL,
  LEVEL_PILL,
  LEVEL_TINT,
  STATUS_CHIP,
  STATUS_LABEL,
  TYPE_CHIP,
  TYPE_LABEL,
  zoneLabel,
  zoneRisk,
} from "@/lib/format";

export function AlertCard({
  event,
  site,
  busy,
  onConfirm,
  onDismiss,
}: {
  event: Event | null;
  site?: Site;
  busy?: boolean;
  onConfirm: (e: Event) => void;
  onDismiss: (e: Event) => void;
}) {
  if (!event) {
    return (
      <section
        className={cn(
          "flex min-h-[520px] flex-col justify-between rounded-2xl border-2 p-8",
          LEVEL_TINT.calm,
        )}
        aria-live="polite"
      >
        <div>
          <LevelPill level="calm" />
          <p className="mt-8 text-3xl font-semibold text-slate-800">
            No active incidents
          </p>
          <p className="mt-2 text-xl text-slate-600">
            All cameras scored calm. The queue is empty.
          </p>
        </div>
        <p className="text-sm text-slate-500">
          Tense is silent. An alarm sounds only at fight likely or above.
        </p>
      </section>
    );
  }

  const eta =
    event.level === "tense" || event.level === "fight_likely"
      ? fmtEta(event.eta_seconds)
      : null;
  const risk = zoneRisk(site, event.zone_type);
  const labelled = event.status === "confirmed" || event.status === "dismissed";

  return (
    <section
      className={cn(
        "flex min-h-[520px] flex-col gap-6 rounded-2xl border-2 p-6 transition-colors duration-300 sm:p-8",
        LEVEL_TINT[event.level],
      )}
      aria-live="assertive"
    >
      <div className="flex flex-wrap items-center gap-3">
        <LevelPill level={event.level} />
        <span
          className={cn(
            "rounded-full border px-3 py-1 text-base font-semibold",
            TYPE_CHIP[event.type],
          )}
        >
          {TYPE_LABEL[event.type]}
        </span>
        <span
          className={cn(
            "rounded-full border px-3 py-1 text-sm font-medium",
            STATUS_CHIP[event.status],
          )}
        >
          {STATUS_LABEL[event.status]}
          {event.pushed_to ? ` · ${event.pushed_to}` : ""}
        </span>
        <span className="ml-auto font-mono text-sm text-slate-500">
          {event.incident_id} · {event.camera_id} · {fmtTime(event.start_time)}
        </span>
      </div>

      {eta && (
        <p
          className={cn(
            "text-3xl font-bold sm:text-4xl",
            event.level === "fight_likely" ? "text-red-700" : "text-amber-700",
          )}
        >
          {eta}
        </p>
      )}

      <div>
        <p className="text-3xl font-bold leading-tight sm:text-4xl">
          {event.location}
        </p>
        <p className="mt-1 text-lg text-slate-600">
          {zoneLabel(site, event.zone_type)}
          {risk != null && ` · zone risk ${risk.toFixed(1)}`}
          {` · ${event.people_count} people`}
          {` · priority ${event.priority.toFixed(2)}`}
        </p>
      </div>

      <p className="text-2xl leading-snug text-slate-800">{event.reason}</p>

      <div className="rounded-xl bg-white/70 p-4">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
          Action
        </p>
        <p className="text-xl font-semibold">{event.action}</p>
        <p className="mt-1 text-base text-slate-600">
          Nearest person:{" "}
          <span className="font-semibold text-slate-900">
            {event.nearest_staff ?? "none on duty"}
          </span>
        </p>
      </div>

      {event.level !== "calm" && (
        <div className="mt-auto flex flex-wrap gap-3">
          <Button
            size="lg"
            disabled={busy || labelled}
            onClick={() => onConfirm(event)}
            className="h-14 flex-1 bg-red-600 text-lg font-semibold text-white hover:bg-red-700"
          >
            Confirm
          </Button>
          <Button
            size="lg"
            variant="outline"
            disabled={busy || labelled}
            onClick={() => onDismiss(event)}
            className="h-14 flex-1 border-slate-400 bg-white text-lg font-semibold"
          >
            Dismiss
          </Button>
        </div>
      )}
    </section>
  );
}

export function LevelPill({ level }: { level: Event["level"] }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-6 py-2 text-[40px] font-bold leading-none tracking-tight transition-colors duration-300 sm:text-5xl",
        LEVEL_PILL[level],
      )}
    >
      {LEVEL_LABEL[level]}
    </span>
  );
}
