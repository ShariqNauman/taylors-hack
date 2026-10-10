"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Camera, HandoverBrief, HandoverFacts } from "@/lib/types";
import { postHandover } from "@/lib/api";
import { fmtBlackFor, fmtTime, LEVEL_LABEL } from "@/lib/format";
import { cameraKind } from "@/lib/camera-meta";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import type { LiveEvent } from "./use-live-feed";

export function HandoverDrawer({
  open,
  onOpenChange,
  now,
  pushes,
  budget,
  events,
  cameras,
  patrolToday,
  nameOf,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  now: Date;
  pushes: number;
  budget: number;
  events: LiveEvent[];
  cameras: Camera[];
  patrolToday?: string | null;
  /** "Aiman Hakimi (Guard B)" from a call sign. */
  nameOf?: (call: string | null | undefined) => string;
}) {
  const [copied, setCopied] = useState(false);
  const { facts, open_, unlabelled, black, lines } = buildFacts({
    now,
    pushes,
    budget,
    events,
    cameras,
    patrolToday,
    nameOf,
  });

  // The written brief is an enhancement: the facts above never wait for it.
  const [brief, setBrief] = useState<HandoverBrief | null>(null);
  const [writing, setWriting] = useState(false);
  const [briefError, setBriefError] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const stop = () => {
    ctrl.current?.abort();
    ctrl.current = null;
    setWriting(false);
  };
  useEffect(() => () => ctrl.current?.abort(), []);
  const writeBrief = async () => {
    stop();
    const c = new AbortController();
    ctrl.current = c;
    setWriting(true);
    setBriefError(false);
    try {
      const b = await postHandover(facts, c.signal);
      if (!c.signal.aborted) {
        setBrief(b);
        setCopied(false); // what is shown changed, so "copied" no longer applies
      }
    } catch {
      if (!c.signal.aborted) setBriefError(true);
    } finally {
      if (ctrl.current === c) {
        ctrl.current = null;
        setWriting(false);
      }
    }
  };

  const summary = [
    `Shift handover · ${fmtTime(now)}`,
    `Pushes used: ${pushes}/${budget}`,
    `Incidents still open: ${open_.length}`,
    `Alerts with no label: ${unlabelled.length}`,
    `Cameras black: ${black.length}`,
    ...lines.map((l) => `- ${l}`),
  ].join("\n");

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setCopied(false);
          stop();
          setBrief(null);
          setBriefError(false);
        }
      }}
    >
      <SheetContent
        side="right"
        className="w-[440px] max-w-full gap-3.5 data-[side=right]:w-full data-[side=right]:sm:w-[440px] overflow-y-auto rounded-none border-line bg-white p-[22px] shadow-none transition-none data-[side=right]:sm:max-w-[440px]"
      >
        <span className="ee-label text-[12px]">
          Shift handover · desk 1 · {fmtTime(now)}
        </span>
        <SheetTitle className="ee-display text-[44px]">End of shift</SheetTitle>
        <SheetDescription className="sr-only">
          Summary of this shift for the next operator.
        </SheetDescription>
        <div className="grid grid-cols-2 gap-2">
          {[
            [`${pushes}/${budget}`, "pushes used"],
            [String(open_.length), "incidents still open"],
            [String(unlabelled.length), "alerts with no label"],
          ].map(([v, l]) => (
            <div
              key={l}
              className="flex flex-col gap-0.5 rounded-[2px] border border-line bg-raised p-3"
            >
              <span className="font-mono text-[26px] font-bold">{v}</span>
              <span className="text-[12px] text-ink-2">{l}</span>
            </div>
          ))}
          <div className="flex flex-col gap-0.5 rounded-[2px] bg-ink p-3 text-white">
            <span className="font-mono text-[26px] font-bold">
              {black.length}
            </span>
            <span className="text-[12px]">
              {black.length === 1 ? "camera black" : "cameras black"}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2" aria-live="polite">
          <button
            type="button"
            onClick={writeBrief}
            disabled={writing}
            className="min-h-11 self-start rounded-[2px] border-2 border-ink bg-white px-3.5 text-[14px] font-extrabold text-ink disabled:opacity-60"
          >
            {writing
              ? "Writing the brief…"
              : briefError
                ? "Couldn't write it. Try again"
                : brief
                  ? "Write it again"
                  : "Write the brief"}
          </button>
          {briefError && (
            <span className="sr-only">
              The brief could not be written just now. The facts below are
              complete; copy them instead.
            </span>
          )}
          {brief && (
            <div className="flex flex-col gap-1.5 rounded-[2px] border border-line bg-raised p-3">
              <span className="ee-label">Handover brief</span>
              <p className="m-0 text-[15px] leading-[1.5]">{brief.text}</p>
              <span className="text-[11px] leading-snug text-muted-ink">
                Numbers computed from the shift log.{" "}
                {brief.model.startsWith("claude")
                  ? "Wording by Claude."
                  : "Wording by the offline template (the writing service was not reachable)."}{" "}
                Nothing is sent to anyone — copy it into your handover.
              </span>
            </div>
          )}
        </div>
        <span className="ee-label text-[12px]">
          Hand over{brief ? " · the facts behind it" : ""}
        </span>
        <ul className="m-0 flex flex-col gap-2 pl-[18px] text-[15px] leading-[1.45]">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/incidents?status=open"
            className="inline-flex min-h-11 items-center rounded-[2px] border border-ink px-3.5 text-[14px] font-extrabold text-ink no-underline"
          >
            Label open alerts
          </Link>
          {black[0] && (
            <Link
              href={`/cameras?cam=${encodeURIComponent(black[0].camera_id)}`}
              className="inline-flex min-h-11 items-center rounded-[2px] border border-line-strong px-3.5 text-[14px] font-bold text-ink no-underline"
            >
              Report the black camera
            </Link>
          )}
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(brief ? brief.text : summary);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
          className="min-h-[52px] rounded-[2px] bg-signal text-[16px] font-extrabold text-white"
        >
          {copied
            ? brief
              ? "Brief copied"
              : "Summary copied"
            : brief
              ? "Copy brief"
              : "Copy summary"}
        </button>
        <span className="text-[12px] text-muted-ink">
          {brief
            ? "Copies the written brief for the next operator or the group chat."
            : "Copies a plain-text summary for the next operator or the group chat."}
        </span>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The shift facts, computed here and only here (the brief never counts anything itself).
 * Pure: same inputs, same facts. Also returns the pieces the drawer renders.
 */
export function buildFacts({
  now,
  pushes,
  budget,
  events,
  cameras,
  patrolToday,
  nameOf,
}: {
  now: Date;
  pushes: number;
  budget: number;
  events: LiveEvent[];
  cameras: Camera[];
  patrolToday?: string | null;
  nameOf?: (call: string | null | undefined) => string;
}) {
  const open_ = events
    .filter(
      (e) =>
        e.end_time == null &&
        e.level !== "calm" &&
        e.status !== "dismissed" &&
        e.status !== "resolved",
    )
    .sort((a, b) => b.priority - a.priority);
  const shiftStart = now.getTime() - 8 * 3_600_000;
  const unlabelled = events.filter(
    (e) =>
      e.level !== "calm" &&
      Date.parse(e.start_time) >= shiftStart &&
      e.status !== "confirmed" &&
      e.status !== "dismissed" &&
      e.status !== "resolved",
  );
  const black = cameras.filter((c) => cameraKind(c) === "black");
  const lines: string[] = [
    ...open_
      .slice(0, 2)
      .map(
        (e) =>
          `${e.location}: ${LEVEL_LABEL[e.level].toLowerCase()} since ${fmtTime(e.start_time, false)}, ${e.status === "confirmed" ? "confirmed" : "no label yet"}${e.pushed_to ? `; ${nameOf ? nameOf(e.pushed_to) : e.pushed_to} ${e.outcome ? "reported back" : e.arrived_at ? "is there" : e.acked_at ? "on the way" : "alerted"}` : ""}.`,
      ),
    ...black.map(
      (c) =>
        `${c.camera_id}, ${c.location}, ${c.black_since ? fmtBlackFor(c.black_since, now).toLowerCase() : "no signal"}. Repair not reported yet.`,
    ),
    ...(patrolToday ? [patrolToday] : []),
  ];
  if (!open_.length) lines.unshift("No incident is open.");
  const inShift = events.filter(
    (e) => e.level !== "calm" && Date.parse(e.start_time) >= shiftStart,
  );
  const facts: HandoverFacts = {
    shift_start: new Date(shiftStart).toISOString(),
    now: now.toISOString(),
    pushes,
    budget,
    open: open_.map((e) => ({
      incident_id: e.incident_id,
      location: e.location,
      level: e.level,
      priority: e.priority,
      status: e.status,
    })),
    confirmed: inShift.filter(
      (e) => e.status === "confirmed" || e.status === "resolved",
    ).length,
    dismissed: inShift.filter((e) => e.status === "dismissed").length,
    black_cameras: black.map((c) => ({
      camera_id: c.camera_id,
      location: c.location,
      black_since: c.black_since ?? c.last_frame_at,
    })),
    patrol_today: patrolToday ?? null,
  };
  return { facts, open_, unlabelled, black, lines };
}
