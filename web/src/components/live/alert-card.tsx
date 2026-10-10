"use client";

import Link from "next/link";
import type { Camera, Outcome, Site } from "@/lib/types";
import {
  etaText,
  fmtTime,
  isAlarmLevel,
  LEVEL_LABEL,
  LEVEL_THEME,
  secondsBetween,
  zoneLabel,
  zoneRisk,
} from "@/lib/format";
import { whereLine } from "@/lib/people";
import { hm } from "@/lib/posts";
import { cn } from "@/lib/utils";
import type { PeopleApi } from "@/hooks/use-people";
import { PersonTag } from "@/components/chrome/person-tag";
import { Avatar } from "@/components/plan/avatar";
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
  people,
  calmForS,
  handled,
  onPush,
  onPushBackup,
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
  /** The team: pictures, names, and who is nearest right now. */
  people: PeopleApi;
  /** Seconds this camera has been calm (null = not calm / unknown). */
  calmForS: number | null;
  /** The guard reported back within the last 2 minutes: the card stays as "Handled". */
  handled: boolean;
  onPush: (e: LiveEvent, to?: string | null) => void;
  /** Send another guard (no answer in 20 s, or Need backup). */
  onPushBackup?: (e: LiveEvent, name: string) => void;
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
  // Who: the guard already pushed, else the nearest person on duty right now
  // (checked in at a post counts as standing there; otherwise their base).
  const ranked = people.nearest(camera);
  const targetCall = event.pushed_to ?? ranked[0]?.person.id ?? event.nearest_staff ?? null;
  const target = people.person(targetCall);
  const targetWhere = ranked.find((w) => w.person.id === targetCall);
  const first = target?.first ?? targetCall ?? "The guard";
  const ack = secondsBetween(event.pushed_at, event.acked_at);
  const there = secondsBetween(event.acked_at, event.arrived_at);
  const pushedFor = event.pushed_at ? (now.getTime() - Date.parse(event.pushed_at)) / 1000 : 0;
  const noAnswer = pushed && !event.acked_at && pushedFor >= 20 && event.status === "pushed";
  const OUTCOME: Record<Outcome, string> = { sorted: "Sorted, nobody hurt", hurt: "Sorted, someone hurt", backup: "Needs backup", nothing: "Nothing there" };
  // "camera agrees: calm" only after 30 s of calm (backend handoff rule 4).
  const cameraLine =
    calmForS != null && calmForS >= 30
      ? "camera agrees: calm"
      : event.level === "calm" || event.end_time
        ? `camera calm for ${Math.max(0, Math.round(calmForS ?? 0))} s`
        : `camera still sees ${LEVEL_LABEL[event.level].toLowerCase()}`;
  const next = people.nearest(camera, [event.pushed_to, targetCall])[0] ?? null;
  const nextGuard = next ? { call: next.person.id, first: next.person.first, line: whereLine(next) } : null;
  const guardLine = !pushed
    ? null
    : event.outcome
      ? `${first}: ${OUTCOME[event.outcome]}${event.outcome !== "backup" ? ` · ${cameraLine}` : ""}`
      : event.arrived_at
        ? `${first} is there${there != null ? ` · ${there} s` : ""}`
        : event.acked_at
          ? `${first} on the way${ack != null ? ` · ${ack} s` : ""}`
          : `${first} alerted${targetWhere?.metres != null ? `, ~${Math.max(10, Math.round(targetWhere.metres / 10) * 10)} m away` : ""}`;
  const nearestState =
    event.status === "confirmed"
      ? `Confirmed real${pushed ? " · on the way" : ""}`
      : pushed
        ? `Pushed at ${fmtTime(event.pushed_at!)}`
        : isCalm
          ? "On patrol"
          : event.level === "tense"
            ? "Not pushed; tense is silent"
            : "Not pushed yet · use Push now";
  const where = `WHERE · ${event.location.toUpperCase()}${targetCall ? ` · ${first.toUpperCase()}${targetWhere?.metres != null ? ` ~${Math.max(10, Math.round(targetWhere.metres / 10) * 10)} M AWAY` : ""}` : ""}`;

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
      {event.outcome === "backup" && (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[2px] bg-[#C8241B] px-3.5 py-3 text-white">
          <span className="flex flex-[1_1_240px] flex-col">
            <span className="font-mono text-[12px] font-bold tracking-[0.08em]">NEED BACKUP</span>
            <span className="text-[19px] font-extrabold">{first} is at {event.location} and needs help.</span>
            <span className="text-[14px]">{nextGuard ? `Next nearest: ${nextGuard.line}.` : "Nobody else is on duty. Call the security lead."}</span>
          </span>
          {nextGuard && onPushBackup ? (
            <button type="button" onClick={() => onPushBackup(event, nextGuard.call)} className="min-h-12 rounded-[2px] bg-white px-4 text-[16px] font-extrabold text-[#C8241B]">
              Send {nextGuard.first}
            </button>
          ) : nextGuard ? (
            <span className="text-[15px] font-extrabold">Call {nextGuard.first} by radio</span>
          ) : null}
        </div>
      )}
      {handled && event.outcome && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[2px] border-2 border-ink bg-white px-3.5 py-2.5">
          <span className="font-mono text-[12px] font-bold tracking-[0.08em]">HANDLED</span>
          <span className="text-[16px] font-extrabold">
            {first} reported {OUTCOME[event.outcome].toLowerCase()}
            {event.outcome_at ? ` at ${hm(event.outcome_at)}` : ""}
          </span>
          <span className="text-[14px] text-ink-2">{cameraLine}</span>
        </div>
      )}
      {event.outcome === "nothing" && !decided && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[2px] border-2 border-dashed border-ink bg-white px-3.5 py-3">
          <span className="flex-[1_1_220px] text-[17px] font-extrabold">Guard found nothing · Mark as false alarm?</span>
          <button type="button" onClick={() => onDismiss(event)} className="min-h-11 rounded-[2px] bg-ink px-4 text-[16px] font-extrabold text-white">
            Dismiss: false alarm
          </button>
          <span className="basis-full text-[13px] text-ink-2">The guard&rsquo;s answer is a hint. The desk still decides.</span>
        </div>
      )}
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
        <div className="flex flex-col gap-1.5 rounded-[2px] border border-line bg-white px-3.5 py-3">
          <span className="ee-label">Person on duty</span>
          <PersonTag person={target} call={targetCall} size={40} className="text-[18px]" sub={targetWhere ? whereLine(targetWhere) : null} />
          <span className="text-[13px] text-ink-2">{nearestState}</span>
        </div>
      </div>

      {guardLine && (
        <div className="flex flex-col gap-1.5 rounded-[2px] border border-line bg-white px-3.5 py-3" aria-live="polite">
          <span className="ee-label">Guard&rsquo;s phone</span>
          <ol className="m-0 grid list-none grid-cols-4 gap-1 p-0" aria-label="Guard progress">
            {[
              ["Alerted", true],
              ["On the way", !!event.acked_at],
              ["There", !!event.arrived_at],
              ["Reported", !!event.outcome],
            ].map(([l, on]) => (
              <li key={l as string} className="border-t-[3px] pt-1 text-[12px] font-bold" style={{ borderColor: on ? "#2742D9" : "#DCDFE4", color: on ? "#1F35B3" : "#5D6672" }}>
                {l}
              </li>
            ))}
          </ol>
          <span className="text-[19px] font-extrabold">{guardLine}</span>
          {noAnswer && (
            <span className="flex flex-wrap items-center gap-2 text-[15px]">
              <span className="font-bold">No answer in 20 s.{nextGuard ? ` Next nearest: ${nextGuard.line}.` : " Nobody else is on duty."}</span>
              {nextGuard && onPushBackup ? (
                <button type="button" onClick={() => onPushBackup(event, nextGuard.call)} className="min-h-10 rounded-[2px] bg-signal px-3 text-[14px] font-extrabold text-white">
                  Push {nextGuard.first} now
                </button>
              ) : nextGuard ? (
                <span>Call {nextGuard.first} by radio.</span>
              ) : null}
            </span>
          )}
        </div>
      )}

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
        {targetCall && (
          <Link
            href={`/guard?staff=${encodeURIComponent(targetCall)}`}
            className="text-signal"
          >
            {first}&apos;s phone screen
          </Link>
        )}
      </div>

      {!isCalm && !decided && !pushed && (
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => onPush(event, targetCall)}
            className="inline-flex min-h-[60px] items-center justify-center gap-2 rounded-[2px] bg-signal px-2 text-[19px] font-extrabold text-white"
          >
            <Avatar person={target} size={30} />
            Push {first} now
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
      {(!isCalm || pushed) && !decided && pushed && event.outcome !== "nothing" && (
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
      {isCalm && !pushed && (
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
