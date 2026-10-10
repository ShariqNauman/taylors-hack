"use client";

// HTML overlays for the 3D campus: pins, chips, info cards, controls.
// Pins are real <button>s positioned in screen pixels by the caller.
import { useState } from "react";
import Link from "next/link";
import { RotateCcw, RotateCw, X } from "lucide-react";
import type { Camera, Event, Level } from "@/lib/types";
import { fmtBlackFor, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store/app-store";
import { LevelPill } from "@/components/chrome/level-pill";
import { SkeletonView } from "@/components/skeleton/skeleton-view";
import type { PlanPost, SourceKind } from "./model";

const MONO = "font-mono text-[11px] font-bold";

export const SOURCE_DOT: Record<SourceKind, string> = {
  live: "#FF453A",
  recorded: "#5D6672",
  black: "#0B0D10",
};

function PersonIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="7" r="4" fill="#FFFFFF" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z" fill="#FFFFFF" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M3 7h12v10H3zM15 10l6-3v10l-6-3"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const at = (p: [number, number]) => ({ left: p[0], top: p[1] });

// ── Pins ──

export function CameraPin({
  camera,
  kind,
  pos,
  alarming,
  selected,
  onClick,
}: {
  camera: Camera;
  kind: SourceKind;
  pos: [number, number];
  alarming: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const tag = kind === "live" ? "LIVE" : kind === "recorded" ? "REC" : "NO SIGNAL";
  const spoken =
    kind === "live" ? "live webcam" : kind === "recorded" ? "recording" : "no signal";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${camera.camera_id}, ${camera.location}, ${spoken}${alarming ? ", alarm" : ""}`}
      aria-pressed={selected}
      className={cn(
        "pointer-events-auto absolute inline-flex min-h-[30px] -translate-x-1/2 -translate-y-1/2 items-center gap-[5px] whitespace-nowrap rounded-full py-0.5 pl-0.5 pr-2",
        MONO,
        selected ? "bg-ink text-white" : "bg-white text-ink",
        alarming
          ? "ee-pulse border-2 border-[#C8241B]"
          : selected
            ? "border-2 border-ink"
            : kind === "black"
              ? "border border-ink"
              : "border border-line-strong",
      )}
      style={at(pos)}
    >
      <span
        className="inline-flex size-6 items-center justify-center rounded-full"
        style={{ background: SOURCE_DOT[kind] }}
      >
        <CameraIcon />
      </span>
      {camera.camera_id.replace(/^CAM-/, "")} · {tag}
    </button>
  );
}

export function GuardChip({ name, pos }: { name: string; pos: [number, number] }) {
  return (
    <span
      className="pointer-events-none absolute inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-signal py-0.5 pl-1 pr-2 text-[11px] font-extrabold text-white"
      style={at(pos)}
    >
      <PersonIcon />
      {name}
    </span>
  );
}

export function PostPin({
  post,
  pos,
  selected,
  onClick,
}: {
  post: PlanPost;
  pos: [number, number];
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Patrol post ${post.id} at ${post.location}, ${post.when}`}
      aria-pressed={selected}
      className={cn(
        "pointer-events-auto absolute inline-flex min-h-[30px] -translate-x-1/2 -translate-y-1/2 items-center gap-[5px] whitespace-nowrap rounded-full border-2 bg-signal py-[3px] pl-[5px] pr-[9px] text-[11px] font-extrabold text-white",
        selected ? "border-ink" : "border-white",
      )}
      style={at(pos)}
    >
      <PersonIcon size={14} />
      {post.id} · {post.when}
    </button>
  );
}

export function BuildingLabel({
  text,
  pos,
  selected,
  alarm,
  onClick,
}: {
  text: string;
  pos: [number, number];
  selected: boolean;
  alarm: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "pointer-events-auto absolute inline-flex -translate-x-1/2 -translate-y-full items-center whitespace-nowrap rounded-[2px] border px-2 py-[3px]",
        MONO,
        selected ? "border-ink bg-ink text-white" : "bg-white/95 text-ink",
        !selected && (alarm ? "border-[#C8241B]" : "border-line-strong"),
      )}
      style={at(pos)}
    >
      {text}
    </button>
  );
}

// ── Info cards ──

function CardShell({
  sheet,
  chip,
  code,
  title,
  sub,
  onClose,
  children,
}: {
  sheet: boolean;
  chip: React.ReactNode;
  code: string;
  title: string;
  sub: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-label={title}
      className={cn(
        "pointer-events-auto absolute flex flex-col gap-2.5 overflow-y-auto border-ink bg-white p-3",
        sheet
          ? "inset-x-0 bottom-0 max-h-[78%] border-t-2"
          : "right-3 top-3 max-h-[calc(100%-24px)] w-[340px] max-w-[calc(100%-24px)] rounded-[2px] border",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 whitespace-nowrap">{chip}</span>
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{code}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-auto inline-flex size-8 shrink-0 items-center justify-center rounded-[2px] border border-line bg-white"
        >
          <X className="size-3.5" strokeWidth={2.4} aria-hidden />
        </button>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="ee-display text-[28px] leading-[0.95]">{title}</span>
        <span className="text-[13px] text-ink-2">{sub}</span>
      </div>
      {children}
    </div>
  );
}

const SOURCE_CHIP: Record<SourceKind, { text: string; bg: string; fg: string; dot: string }> = {
  live: { text: "LIVE WEBCAM", bg: "#0B0D10", fg: "#FFFFFF", dot: "#FF453A" },
  recorded: { text: "RECORDING · LOOP", bg: "#F1F2F4", fg: "#3A414B", dot: "#5D6672" },
  black: { text: "NO SIGNAL", bg: "#0B0D10", fg: "#FFFFFF", dot: "#8B939E" },
};

/**
 * The feed. On site with an edge_url: the edge's MJPEG stream, falling back to
 * skeletons on error. Remote or detecting: skeletons from the latest snapshot,
 * or "N people in view". The remote view never requests an edge_url.
 */
function CameraFeed({
  camera,
  kind,
  event,
  level,
}: {
  camera: Camera;
  kind: SourceKind;
  event: Event | null;
  level: Level;
}) {
  const view = useAppStore((s) => s.view);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const edge = camera.edge_url?.replace(/\/$/, "");
  const streamUrl = edge ? `${edge}/stream.mjpg` : null;
  const place = `${camera.camera_id} · ${camera.location}`.toUpperCase();

  if (kind === "black") {
    return (
      <SkeletonView
        background="black"
        idleText="NO SIGNAL"
        idleSub={camera.black_since ? fmtBlackFor(camera.black_since) : undefined}
        hud={{ topLeft: place }}
        ariaLabel={`${camera.location}: no signal`}
      />
    );
  }

  if (view === "onsite" && streamUrl && failedUrl !== streamUrl) {
    return (
      <div className="relative aspect-video w-full bg-frame">
        {/* eslint-disable-next-line @next/next/no-img-element -- MJPEG stream from the on-site edge */}
        <img
          src={streamUrl}
          alt={`${camera.location} ${kind === "live" ? "live feed" : "recording"}`}
          className="size-full object-cover"
          onError={() => setFailedUrl(streamUrl)}
        />
        <span className="absolute left-2 top-2 font-mono text-[10px] font-bold text-[#ECEFF3]">
          {place}
        </span>
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 font-mono text-[10px] font-bold text-[#ECEFF3]">
          <span className="size-1.5 rounded-full" style={{ background: SOURCE_DOT[kind] }} />
          {kind === "live" ? "LIVE VIDEO" : "REC · LOOP"}
        </span>
      </div>
    );
  }

  const frame = event?.snapshot ?? null;
  const people = camera.people_count ?? event?.people_count;
  return (
    <SkeletonView
      background="remote"
      frame={frame}
      level={level}
      showBox={!!frame && level !== "calm"}
      stroke={4}
      idleText={people != null ? `${people} ${people === 1 ? "person" : "people"} in view` : "Waiting for the edge"}
      idleSub={kind === "recorded" ? "REC · OUR OWN STAGED RECORDING" : undefined}
      hud={{
        topLeft: place,
        topRight: kind === "live" ? "LIVE SKELETONS" : "REC · SKELETONS",
        topRightDot: SOURCE_DOT[kind],
        bottomLeft: "NO PIXELS LEAVE THE SITE",
      }}
      ariaLabel={`${camera.location} skeleton view`}
    />
  );
}

const BTN_PRIMARY =
  "inline-flex min-h-10 items-center rounded-[2px] bg-ink px-3 text-[13px] font-extrabold text-white";
const BTN_SECONDARY =
  "inline-flex min-h-10 items-center rounded-[2px] border border-line-strong bg-white px-3 text-[13px] font-bold text-ink";

export function CameraCard({
  camera,
  kind,
  buildingName,
  event,
  level,
  sheet,
  onClose,
  onOpen,
  onDetails,
}: {
  camera: Camera;
  kind: SourceKind;
  buildingName: string | null;
  event: Event | null;
  level: Level;
  sheet: boolean;
  onClose: () => void;
  onOpen?: () => void;
  onDetails?: () => void;
}) {
  const chip = SOURCE_CHIP[kind];
  const people = camera.people_count ?? event?.people_count;
  const sub = [camera.geo?.building ?? buildingName, camera.geo?.floor].filter(Boolean).join(" · ");
  return (
    <CardShell
      sheet={sheet}
      code={camera.camera_id}
      title={camera.location}
      sub={sub}
      onClose={onClose}
      chip={
        <span
          className={cn("inline-flex items-center gap-1.5 rounded-[1px] px-2 py-0.5", MONO)}
          style={{ background: chip.bg, color: chip.fg }}
        >
          <span className="size-[7px] rounded-full" style={{ background: chip.dot }} />
          {chip.text}
        </span>
      }
    >
      <CameraFeed key={camera.camera_id} camera={camera} kind={kind} event={event} level={level} />
      {kind === "recorded" && (
        <span className="text-[12px] text-ink-2">
          {camera.recorded_at
            ? `Recording made ${fmtDateTime(camera.recorded_at)}, looping`
            : "Our own labelled recording, looping"}
        </span>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {kind === "black" ? (
          <span className={cn("inline-flex items-center rounded-[1px] border border-ink bg-ink px-2 py-0.5 uppercase text-white", "text-[12px] font-extrabold")}>
            No signal
          </span>
        ) : (
          <LevelPill level={level} size="sm" />
        )}
        <span className="text-[13px] text-ink-2">
          {kind === "black"
            ? "People in view unknown"
            : people != null
              ? `${people} ${people === 1 ? "person" : "people"} in view`
              : "People in view unknown"}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {kind !== "black" && onOpen && (
          <button type="button" className={BTN_PRIMARY} onClick={onOpen}>
            {kind === "live" ? "Open live view" : "Play recording in Live"}
          </button>
        )}
        {onDetails && (
          <button type="button" className={BTN_SECONDARY} onClick={onDetails}>
            Camera details
          </button>
        )}
      </div>
    </CardShell>
  );
}

export function PostCard({
  post,
  sheet,
  onClose,
}: {
  post: PlanPost;
  sheet: boolean;
  onClose: () => void;
}) {
  const hrs = Number.isInteger(post.hoursPerWeek) ? `${post.hoursPerWeek} h` : `${post.hoursPerWeek.toFixed(1)} h`;
  return (
    <CardShell
      sheet={sheet}
      code={post.when}
      title={post.location}
      sub={`Place one person here · ${post.when.toLowerCase()}`}
      onClose={onClose}
      chip={
        <span className={cn("inline-flex items-center gap-1.5 rounded-[1px] bg-signal px-2 py-0.5 text-white", MONO)}>
          <span className="size-[7px] rounded-full bg-white" />
          PATROL POST {post.id}
        </span>
      }
    >
      <div className="grid grid-cols-3 gap-1.5">
        <div className="flex flex-col gap-0.5 border border-line bg-raised p-2">
          <span className="font-mono text-[20px] font-bold">{post.incidents4w}</span>
          <span className="text-[11px] text-ink-2">in 4 weeks</span>
        </div>
        <div className="flex flex-col gap-0.5 border border-[#A9B6F2] bg-signal-tint p-2">
          <span className="font-mono text-[20px] font-bold text-signal-ink">{post.avoidedPerWeek.toFixed(2)}</span>
          <span className="text-[11px] text-signal-ink">avoided a week</span>
        </div>
        <div className="flex flex-col gap-0.5 border border-line bg-raised p-2">
          <span className="font-mono text-[20px] font-bold">{hrs}</span>
          <span className="text-[11px] text-ink-2">hours a week</span>
        </div>
      </div>
      <span className="text-[13px] leading-[1.45] text-ink-2">{post.rationale}</span>
      <div className="flex flex-wrap gap-1.5">
        <Link href="/plan" className={BTN_PRIMARY}>
          Open in Plan
        </Link>
        <Link href="/incidents" className={BTN_SECONDARY}>
          See the incidents
        </Link>
      </div>
    </CardShell>
  );
}

// ── Controls ──

const CTRL =
  "inline-flex h-9 min-w-9 items-center justify-center rounded-[2px] border border-line-strong bg-white px-2 text-[12px] font-extrabold text-ink";

export function NavControls({
  bearing,
  onRotate,
  onTop,
  onTilt,
  onZoom,
  onReset,
  onNorth,
  canTilt,
}: {
  bearing: number;
  onRotate: (deg: number) => void;
  onTop: () => void;
  onTilt: () => void;
  onZoom: (d: number) => void;
  onReset: () => void;
  onNorth: () => void;
  canTilt: boolean;
}) {
  return (
    <div role="group" aria-label="View controls" className="pointer-events-auto flex flex-wrap items-center gap-1">
      <button type="button" className={CTRL} aria-label="Rotate left" onClick={() => onRotate(-20)}>
        <RotateCcw className="size-4" strokeWidth={2.2} aria-hidden />
      </button>
      <button type="button" className={CTRL} aria-label="Rotate right" onClick={() => onRotate(20)}>
        <RotateCw className="size-4" strokeWidth={2.2} aria-hidden />
      </button>
      {canTilt && (
        <>
          <button type="button" className={CTRL} aria-label="Look more from above" onClick={onTop}>
            Top
          </button>
          <button type="button" className={CTRL} aria-label="Tilt toward the horizon" onClick={onTilt}>
            Tilt
          </button>
        </>
      )}
      <button type="button" className={cn(CTRL, "text-[18px]")} aria-label="Zoom in" onClick={() => onZoom(0.5)}>
        +
      </button>
      <button type="button" className={cn(CTRL, "text-[18px]")} aria-label="Zoom out" onClick={() => onZoom(-0.5)}>
        −
      </button>
      <button type="button" className={cn(CTRL, "font-bold")} onClick={onReset}>
        Reset view
      </button>
      <button
        type="button"
        onClick={onNorth}
        aria-label={`Compass, facing ${Math.round(((bearing % 360) + 360) % 360)} degrees. Turn north up`}
        className="inline-flex size-9 items-center justify-center rounded-full border border-line-strong bg-white"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${-bearing}deg)` }}>
          <path d="M12 2 16 12H8z" fill="#C8241B" />
          <path d="M12 22 8 12h8z" fill="#B4BAC3" />
        </svg>
      </button>
    </div>
  );
}

export function LayerToggle({
  layer,
  onChange,
}: {
  layer: "cameras" | "plan";
  onChange: (l: "cameras" | "plan") => void;
}) {
  const item = (l: "cameras" | "plan", text: string) => (
    <button
      type="button"
      aria-pressed={layer === l}
      onClick={() => onChange(l)}
      className={cn(
        "min-h-9 px-3 font-mono text-[12px] font-bold",
        layer === l ? "bg-ink text-white" : "bg-white text-ink",
        l === "plan" && "border-l border-ink",
      )}
    >
      {text}
    </button>
  );
  return (
    <div role="group" aria-label="Layer" className="pointer-events-auto inline-flex overflow-hidden rounded-[2px] border border-ink bg-white">
      {item("cameras", "CAMERAS")}
      {item("plan", "PATROL PLAN")}
    </div>
  );
}

export function Legend() {
  const item = (c: string, t: string) => (
    <span className="inline-flex items-center gap-1">
      <span className="size-[9px] rounded-full" style={{ background: c }} />
      {t}
    </span>
  );
  return (
    <div className="flex flex-wrap justify-end gap-x-2.5 gap-y-1 border border-line bg-white/90 px-2 py-1.5 text-[11px] text-ink-2">
      {item(SOURCE_DOT.live, "Live webcam")}
      {item(SOURCE_DOT.recorded, "Recording")}
      {item(SOURCE_DOT.black, "No signal")}
      {item("#2742D9", "Person on duty")}
    </div>
  );
}
