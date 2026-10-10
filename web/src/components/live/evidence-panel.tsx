"use client";

import { useEffect, useMemo, useState } from "react";
import type { Camera } from "@/lib/types";
import { fmtTime, isAlarmLevel, LEVEL_LABEL, LEVEL_THEME } from "@/lib/format";
import { lerpFrame, wristTrail } from "@/lib/pose";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils";
import { CameraFrame } from "@/components/skeleton/skeleton-view";
import { CameraFeed } from "@/components/camera/camera-feed";
import { FeatureMeters } from "./feature-meters";
import type { BufferEntry, LiveEvent } from "./use-live-feed";

const pad2 = (n: number) => String(Math.max(0, Math.round(n))).padStart(2, "0");

export function EvidencePanel({
  event,
  camera,
  buffer,
  now,
  synthetic,
  replayDemo,
}: {
  event: LiveEvent | null;
  camera?: Camera;
  buffer: BufferEntry[];
  now: Date;
  synthetic: boolean;
  /** The selected incident is the canned ?replay=1 demo feed. */
  replayDemo: boolean;
}) {
  const view = useAppStore((s) => s.view);
  const [mode, setMode] = useState<"live" | "replay">("live");
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const nowMs = now.getTime();

  // Entries that have "happened" (the replay buffer is known ahead; future cells stay dim).
  const past = useMemo(
    () => buffer.filter((b) => b.at <= nowMs + 1),
    [buffer, nowMs],
  );
  const cells = useMemo(
    () => (replayDemo ? buffer : past).slice(-12),
    [replayDemo, buffer, past],
  );

  // Reset scrub on incident change.
  const id = event?.incident_id;
  useEffect(() => {
    setMode("live");
    setPlaying(false);
  }, [id]);

  // Replay playback: one buffer step per 0.5 s.
  useEffect(() => {
    if (mode !== "replay" || !playing) return;
    const t = setInterval(() => {
      setPos((p) => {
        if (p >= past.length - 1) {
          setPlaying(false);
          return p;
        }
        return p + 1;
      });
    }, 500);
    return () => clearInterval(t);
  }, [mode, playing, past.length]);

  // Current frame.
  let entry: BufferEntry | undefined;
  let frame = event?.snapshot ?? event?.peak_snapshot;
  let liveIndex = past.length - 1;
  if (mode === "replay" && past.length) {
    entry = past[Math.min(pos, past.length - 1)];
    frame = entry.snapshot;
  } else if (past.length) {
    entry = past[past.length - 1];
    if (replayDemo) {
      // Smooth: blend toward the next replay frame by timestamp.
      const next = buffer[past.length];
      const k = next ? (nowMs - entry.at) / Math.max(1, next.at - entry.at) : 1;
      frame = lerpFrame(entry.snapshot, next?.snapshot, k) ?? entry.snapshot;
    } else {
      frame = entry.snapshot ?? frame;
    }
  }
  const level = entry?.level ?? event?.level ?? "calm";
  const score = entry?.score ?? event?.peak_score;
  const trail =
    mode === "live"
      ? wristTrail(past.slice(-3).map((b) => b.snapshot))
      : undefined;
  if (mode === "replay") liveIndex = Math.min(pos, past.length - 1);

  // Marks relative to the first buffered entry.
  const base = buffer[0]?.at ?? 0;
  const firstAt = (pred: (b: BufferEntry) => boolean) => {
    const b = (replayDemo ? buffer : past).find(pred);
    return b ? (b.at - base) / 1000 : null;
  };
  const amber = firstAt((b) => b.level !== "calm");
  const pushed = firstAt((b) => b.pushed);
  const shove = firstAt((b) => b.level === "fight");
  const marks = [
    amber != null ? `AMBER :${pad2(amber)}` : null,
    pushed != null ? `PUSHED :${pad2(pushed)}` : null,
    shove != null ? `SHOVE :${pad2(shove)}` : null,
  ].filter(Boolean);
  const warned =
    replayDemo && amber != null && shove != null
      ? Math.round(shove - amber)
      : null;

  const onsiteStream =
    mode === "live" &&
    !replayDemo &&
    view === "onsite" &&
    !!camera?.edge_url &&
    streaming;
  // A recording is never shown as live (brief §8.1).
  const isRecording = camera?.source === "recorded";
  const lastAt = past[past.length - 1]?.at;
  const ago = lastAt ? Math.max(0, (nowMs - lastAt) / 1000) : null;
  let badge: { text: string; cls: string };
  if (mode === "replay")
    badge = { text: "REPLAY · SCRUB THE LAST 12 S", cls: "bg-ground text-ink" };
  else if (replayDemo)
    badge = {
      text: "RECORDED DEMO FEED · SKELETONS",
      cls: "bg-signal-tint text-signal-ink",
    };
  else if (onsiteStream && isRecording)
    badge = {
      text: camera?.recorded_at
        ? "RECORDING · FILMED ON CAMPUS · LOOP"
        : "RECORDING · SAMPLE CCTV CLIP · LOOP",
      cls: "bg-ground text-ink",
    };
  else if (onsiteStream)
    badge = {
      text: "LIVE VIDEO + OVERLAY · 0.3 S BEHIND",
      cls: "bg-ink text-white",
    };
  else
    badge = {
      text: `LIVE SKELETONS · UPDATED ${ago != null ? ago.toFixed(1) : "—"} S AGO`,
      cls: "bg-signal-tint text-signal-ink",
    };

  const clock = fmtTime(now);
  const hud = {
    topLeft: event
      ? `${event.camera_id} · ${event.location.toUpperCase()}`
      : camera
        ? `${camera.camera_id} · ${camera.location.toUpperCase()}`
        : undefined,
    topRight:
      mode === "replay"
        ? `REPLAY ${fmtTime(new Date(entry?.at ?? nowMs))}`
        : onsiteStream
          ? isRecording
            ? "REC · LOOP"
            : `LIVE ${clock}`
          : replayDemo
            ? `DEMO ${clock}`
            : `SKELETONS ${clock}`,
    topRightDot:
      mode === "replay" || isRecording
        ? "#AEB7C2"
        : onsiteStream
          ? "#FF453A"
          : "#7FE0FF",
    bottomLeft: onsiteStream
      ? undefined
      : "NO PIXELS LEAVE THE SITE · 12 BODY KEYPOINTS PER PERSON",
  };

  const tabBtn = (m: "live" | "replay", label: React.ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => {
        setMode(m);
        setPlaying(false);
        if (m === "replay") setPos(Math.max(0, past.length - 1));
      }}
      className={cn(
        "inline-flex min-h-9 items-center gap-2 px-3.5 font-mono text-[13px] font-bold",
        mode === m ? "bg-ink text-white" : "bg-white text-ink",
      )}
    >
      {label}
    </button>
  );

  return (
    <section
      aria-label="Evidence"
      className="flex min-w-0 flex-col gap-3 rounded-[2px] border border-line bg-white p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Evidence mode"
          className="inline-flex overflow-hidden rounded-[2px] border border-ink [&>button+button]:border-l [&>button+button]:border-ink"
        >
          {tabBtn(
            "live",
            <>
              <span className="size-2 rounded-full bg-[#FF453A]" aria-hidden />
              LIVE
            </>,
          )}
          {tabBtn("replay", "REPLAY")}
        </div>
        <span className="font-mono text-[13px] font-bold">
          {event
            ? `${event.camera_id} · ${event.incident_id}`
            : camera
              ? camera.camera_id
              : "No incident"}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {synthetic && (
            <span className="inline-flex min-h-7 items-center rounded-[1px] border border-dashed border-line-strong px-2 font-mono text-[11px] font-bold">
              SYNTHETIC POSES
            </span>
          )}
          <span
            className={cn(
              "inline-flex min-h-7 items-center rounded-[1px] px-2.5 font-mono text-[12px] font-bold",
              badge.cls,
            )}
          >
            {badge.text}
          </span>
        </span>
      </div>

      <CameraFrame>
        <CameraFeed
          camera={camera}
          frame={frame}
          level={level}
          score={score}
          forceSkeletons={replayDemo || mode === "replay"}
          hud={hud}
          showDistance={!!frame && (frame.people?.length ?? 0) >= 2}
          trail={trail}
          now={now}
          onStreamState={setStreaming}
        />
      </CameraFrame>

      {mode === "replay" && (
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            aria-label="Step back"
            onClick={() => {
              setPlaying(false);
              setPos((p) => Math.max(0, p - 1));
            }}
            className="inline-flex size-10 items-center justify-center rounded-[2px] border border-line-strong bg-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
              <path
                d="M15 5l-7 7 7 7"
                fill="none"
                stroke="#0B0D10"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!playing && pos >= past.length - 1) setPos(0);
              setPlaying((p) => !p);
            }}
            className="inline-flex h-10 min-w-24 items-center justify-center gap-2 rounded-[2px] bg-signal px-3.5 text-[14px] font-extrabold text-white"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
              <path
                d={playing ? "M6 4h4v16H6zM14 4h4v16h-4z" : "M7 4l13 8-13 8z"}
                fill="#FFFFFF"
              />
            </svg>
            {playing ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            aria-label="Step forward"
            onClick={() => {
              setPlaying(false);
              setPos((p) => Math.min(past.length - 1, p + 1));
            }}
            className="inline-flex size-10 items-center justify-center rounded-[2px] border border-line-strong bg-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
              <path
                d="M9 5l7 7-7 7"
                fill="none"
                stroke="#0B0D10"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <span className="font-mono text-[13px] text-ink-2">
            REPLAY · EVENT {pad2(Math.min(pos, past.length - 1) + 1)}/
            {pad2(past.length)}
          </span>
        </div>
      )}

      {cells.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="relative">
            <div
              role="group"
              aria-label="Level timeline"
              className="grid gap-0.5"
              style={{
                gridTemplateColumns: `repeat(${Math.max(12, cells.length)}, minmax(0, 1fr))`,
              }}
            >
              {cells.map((c, i) => {
                const idx = (replayDemo ? buffer : past).indexOf(c);
                const happened = c.at <= nowMs + 1;
                return (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Event ${i + 1}: ${LEVEL_LABEL[c.level]}`}
                    disabled={!happened}
                    onClick={() => {
                      setMode("replay");
                      setPlaying(false);
                      setPos(
                        Math.max(
                          0,
                          past.indexOf(c) >= 0 ? past.indexOf(c) : idx,
                        ),
                      );
                    }}
                    className="h-5 rounded-[1px] p-0 disabled:cursor-default"
                    style={{
                      background: LEVEL_THEME[c.level].cell,
                      opacity: happened ? 1 : 0.3,
                    }}
                  />
                );
              })}
            </div>
            {past.length > 0 && (
              <span
                aria-hidden
                className="absolute -bottom-1 -top-1 w-[3px] bg-ink"
                style={{
                  left: `${((Math.max(0, replayDemo ? liveIndex : cells.indexOf(past[liveIndex])) + 0.5) / Math.max(12, cells.length)) * 100}%`,
                }}
              />
            )}
          </div>
          <div className="flex flex-wrap justify-between gap-2 font-mono text-[12px] text-ink-2">
            <span>
              {marks.length
                ? marks.join(" · ")
                : "NO ESCALATION IN THE LAST 12 S"}
            </span>
            {warned != null && (
              <span className="font-sans text-[14px] font-extrabold text-ink">
                Warned {warned} s before the shove on this replay
              </span>
            )}
          </div>
        </div>
      )}

      <FeatureMeters
        features={entry?.top_features ?? event?.top_features}
        level={level}
      />
      {(entry?.top_features ?? event?.top_features)?.length ? (
        <p className="text-[12px] text-muted-ink">
          The three signals the model leans on most, plus its score.
          {replayDemo || synthetic
            ? " Replay values, not a live model run."
            : ""}{" "}
          Pose: 12 body keypoints per person, no face points.
        </p>
      ) : (
        <p className="text-[12px] text-muted-ink">
          Pose: 12 body keypoints per person, no face points.
        </p>
      )}
      {event && isAlarmLevel(level) && mode === "replay" && (
        <p className="sr-only">
          Scrubbing a past frame; the live level is {LEVEL_LABEL[event.level]}.
        </p>
      )}
    </section>
  );
}
