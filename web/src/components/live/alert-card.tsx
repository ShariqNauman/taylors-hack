"use client";

import Link from "next/link";
import type { Camera, Site } from "@/lib/types";
import {
  etaText,
  fmtTime,
  isAlarmLevel,
  LEVEL_THEME,
  secondsBetween,
  zoneLabel,
  zoneRisk,
} from "@/lib/format";
import { fmtDistance, staffDistance } from "@/lib/geo";
import { cn } from "@/lib/utils";
import { LevelPill } from "@/components/chrome/level-pill";
import { TypeChip } from "@/components/chrome/type-chip";
import { CampusCompactSlot } from "./campus-compact-slot";
import type { LiveEvent } from "./use-live-feed";

export function AlertCard({
  event,
  camera,
  site,
  now,
  pulsing,
  compact3d,
  onPush,
  onConfirm,
  onDismiss,
  onUndo,
}: {
  event: LiveEvent | null;
  camera?: Camera;
  site?: Site;
  now: Date;
  pulsing: boolean;
  /** Renders the compact 3D campus; defaults to the slot. */
  compact3d?: React.ReactNode;
  onPush: (e: LiveEvent) => void;
  onConfirm: (e: LiveEvent) => void;
  onDismiss: (e: LiveEvent) => void;
  onUndo: (e: LiveEvent) => void;
}) {
  if (!event) {
    return (
      <section
        aria-label="Current alert"
        className="flex flex-col gap-3.5 rounded-[2px] border-2 border-line bg-white p-5"
      >
        <div>
          <LevelPill level="calm" size="xl" />
        </div>
        <div className="ee-display text-[44px]">No build-up</div>
        <p className="text-[22px] font-medium leading-snug">
          No active incidents on any camera.
        </p>
        <div className="rounded-[2px] border border-dashed border-line-strong bg-white px-3.5 py-3 text-[16px] text-ink-2">
          Nothing to do. Chats, hugs and high-fives stay calm by design.
        </div>
      </section>
    );
  }

  const theme = LEVEL_THEME[event.level];
  const isCalm = event.level === "calm";
  const decided = event.status === "confirmed" || event.status === "dismissed";
  const pushed = !!event.pushed_to;
  const etaLeft =
    event.eta_seconds != null
      ? event.eta_seconds - (now.getTime() - event.etaAt) / 1000
      : null;
  const risk = zoneRisk(site, event.zone_type);
  const zone = zoneLabel(site, event.zone_type);
  const nearest = event.nearest_staff ?? "Person on duty";
  const dist = fmtDistance(staffDistance(site, event.nearest_staff, camera));
  const ack = secondsBetween(event.pushed_at, event.acked_at);
  const nearestState =
    event.status === "confirmed"
      ? `Confirmed real${pushed ? " · on the way" : ""}`
      : pushed
        ? `Pushed at ${fmtTime(event.pushed_at!)}${ack != null ? ` · tapped On my way in ${ack} s` : ""}`
        : isCalm
          ? "On patrol"
          : "Not pushed; tense is silent";
  const where = `WHERE · ${event.location.toUpperCase()}${event.nearest_staff ? ` · ${event.nearest_staff.toUpperCase()}${dist ? ` ${dist.toUpperCase()} AWAY` : ""}` : ""}`;

  const steps = [
    {
      n: "01",
      label: "DETECT",
      on: !isCalm,
      when: isCalm ? "Watching" : `from ${fmtTime(event.start_time)}`,
    },
    {
      n: "02",
      label: "EXPLAIN",
      on: !isCalm,
      when: isCalm ? "Waiting" : "Reason ready",
    },
    {
      n: "03",
      label: "PUSH",
      on: pushed,
      when: pushed
        ? `${event.pushed_to} · ${fmtTime(event.pushed_at!)}`
        : event.level === "tense"
          ? "Silent at tense"
          : "Waiting",
    },
    {
      n: "04",
      label: "CONFIRM",
      on: decided,
      when:
        event.status === "confirmed"
          ? "Real"
          : event.status === "dismissed"
            ? "False alarm"
            : "Waiting",
    },
  ];

  return (
    <section
      aria-label="Current alert"
      className={cn(
        "flex flex-col gap-3.5 rounded-[2px] border-2 p-5 transition-colors duration-300",
        pulsing && "ee-pulse",
      )}
      style={{ background: theme.tint, borderColor: theme.border }}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <LevelPill level={event.level} size="xl" />
        {!isCalm && <TypeChip type={event.type} size="lg" />}
      </div>
      <div className="ee-display text-[40px] sm:text-[44px]" aria-live="polite">
        {etaText(event.level, etaLeft)}
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-[30px] font-extrabold leading-[1.1]">
          {event.location}
        </h2>
        <span className="font-mono text-[13px] uppercase text-ink-2">
          {event.camera_id} · {zone}
          {risk != null ? ` · RISK ${risk.toFixed(1)}` : ""} ·{" "}
          {event.people_count} PEOPLE · P {event.priority.toFixed(2)}
        </span>
      </div>
      <p className="text-[22px] font-medium leading-[1.35]">{event.reason}</p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2">
        <div className="flex flex-col gap-1 rounded-[2px] border border-line bg-white px-3.5 py-3">
          <span className="ee-label">Do this</span>
          <span className="text-[19px] font-extrabold leading-tight">
            {event.action}
          </span>
        </div>
        <div className="flex flex-col gap-1 rounded-[2px] border border-line bg-white px-3.5 py-3">
          <span className="ee-label">Person on duty</span>
          <span className="text-[19px] font-extrabold">
            {nearest}{" "}
            {dist && (
              <span className="text-[14px] font-medium text-ink-2">{dist}</span>
            )}
          </span>
          <span className="text-[13px] text-ink-2">{nearestState}</span>
        </div>
      </div>

      {compact3d ??
        (!isCalm && (
          <CampusCompactSlot cameraId={event.camera_id} whereText={where} />
        ))}

      <ol
        aria-label="Progress"
        className="m-0 grid list-none grid-cols-4 gap-1 p-0"
      >
        {steps.map((s) => (
          <li
            key={s.n}
            className="flex flex-col gap-0.5 border-t-[3px] pt-1.5"
            style={{ borderColor: s.on ? "#0B0D10" : "#DCDFE4" }}
          >
            <span
              className="font-mono text-[11px] font-bold"
              style={{ color: s.on ? "#0B0D10" : "#5D6672" }}
            >
              {s.n} {s.label}
            </span>
            <span className="text-[12px] text-ink-2">{s.when}</span>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[14px] font-bold">
        <Link
          href={`/incidents?id=${encodeURIComponent(event.incident_id)}`}
          className="text-signal"
        >
          Open the case
        </Link>
        <Link
          href={`/cameras?cam=${encodeURIComponent(event.camera_id)}`}
          className="text-signal"
        >
          Camera and 3D campus
        </Link>
        {event.nearest_staff && (
          <Link
            href={`/push?staff=${encodeURIComponent(event.nearest_staff)}`}
            className="text-signal"
          >
            {event.nearest_staff}&apos;s phone screen
          </Link>
        )}
      </div>

      {!isCalm && !decided && !pushed && (
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => onPush(event)}
            className="min-h-[60px] rounded-[2px] bg-signal px-2 text-[19px] font-extrabold text-white"
          >
            Push {nearest} now
          </button>
          <button
            type="button"
            onClick={() => onDismiss(event)}
            className="min-h-[60px] rounded-[2px] border-2 border-ink bg-white text-[19px] font-extrabold text-ink"
          >
            Dismiss
          </button>
        </div>
      )}
      {!isCalm && !decided && pushed && (
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => onConfirm(event)}
            className="min-h-[60px] rounded-[2px] bg-ink px-2 text-[19px] font-extrabold text-white"
          >
            Confirm: real
          </button>
          <button
            type="button"
            onClick={() => onDismiss(event)}
            className="min-h-[60px] rounded-[2px] border-2 border-ink bg-white px-2 text-[19px] font-extrabold text-ink"
          >
            Dismiss: false alarm
          </button>
        </div>
      )}
      {decided && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-[2px] border-2 border-ink bg-white px-3.5 py-3">
          <span className="text-[18px] font-extrabold">
            {event.status === "confirmed"
              ? "Confirmed: real incident"
              : "Dismissed: false alarm"}
          </span>
          <span className="text-[13px] text-ink-2">
            Saved as a label for this camera.
          </span>
          <button
            type="button"
            onClick={() => onUndo(event)}
            className="ml-auto min-h-10 rounded-[2px] border border-line-strong bg-white px-3.5 text-[14px] font-bold"
          >
            Undo
          </button>
        </div>
      )}
      {isCalm && (
        <div className="rounded-[2px] border border-dashed border-line-strong bg-white px-3.5 py-3 text-[16px] text-ink-2">
          Nothing to do. Chats, hugs and high-fives stay calm by design.
        </div>
      )}
      {isAlarmLevel(event.level) &&
        event.eta_seconds == null &&
        event.level === "fight_likely" && (
          <span className="sr-only">
            No ETA from the model for this incident.
          </span>
        )}
    </section>
  );
}
