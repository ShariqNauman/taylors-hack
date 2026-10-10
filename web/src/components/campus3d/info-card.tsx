"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { SkeletonView } from "@/components/skeleton/skeleton-view";
import { C, FONT, LEVEL, type LevelKey } from "./tokens";
import type { PlacedCamera, PlacedPost, SiteView } from "./types";

const MYT = "Asia/Kuala_Lumpur";

function fmtClock(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: MYT, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);
}

/** "SAT 10 OCT 16:20" */
export function fmtRecorded(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: MYT, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(d)
    .replace(",", "")
    .toUpperCase();
}

function blackFor(iso: string | null | undefined, now: Date): string {
  if (!iso) return "";
  const h = Math.max(1, Math.floor((now.getTime() - new Date(iso).getTime()) / 3_600_000));
  if (h < 24) return `${h} H`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 DAY" : `${d} DAYS`;
}

function Shell({ children, onClose, chip, code }: { children: ReactNode; onClose: () => void; chip: ReactNode; code: string }) {
  return (
    <div
      className="ee-campus-sheet"
      role="dialog"
      aria-label="Details"
      style={{
        position: "absolute",
        background: C.panel,
        border: `1px solid ${C.ink}`,
        borderRadius: 2,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        overflowY: "auto",
        zIndex: 5,
        pointerEvents: "auto",
        fontFamily: FONT.sans,
        color: C.ink,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {chip}
        <span style={{ fontFamily: FONT.mono, fontSize: 11, color: C.muted }}>{code}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ee-campus-focus"
          style={{
            marginLeft: "auto",
            width: 32,
            height: 32,
            borderRadius: 2,
            border: `1px solid ${C.line}`,
            background: C.panel,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke={C.ink} strokeWidth="2.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {children}
    </div>
  );
}

function SourceChip({ bg, fg, dot, text }: { bg: string; fg: string; dot: string; text: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        borderRadius: 1,
        background: bg,
        color: fg,
        fontFamily: FONT.mono,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot }} />
      {text}
    </span>
  );
}

const primaryBtn = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 40,
  padding: "0 12px",
  borderRadius: 2,
  background: C.ink,
  color: "#FFFFFF",
  textDecoration: "none",
  fontSize: 13,
  fontWeight: 800,
} as const;
const secondaryBtn = {
  ...primaryBtn,
  background: C.panel,
  color: C.ink,
  border: `1px solid ${C.lineStrong}`,
  fontWeight: 700,
} as const;

function Title({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontFamily: FONT.display, fontSize: 28, fontWeight: 800, textTransform: "uppercase", lineHeight: 0.95 }}>{title}</span>
      <span style={{ fontSize: 13, color: C.ink2 }}>{sub}</span>
    </div>
  );
}

export function CameraCard({
  cam,
  view,
  now,
  onClose,
  onOpenCamera,
}: {
  cam: PlacedCamera;
  view: SiteView;
  now: Date;
  onClose: () => void;
  onOpenCamera?: (id: string) => void;
}) {
  const [streamFailed, setStreamFailed] = useState(false);
  const kind = cam.kind;
  const level: LevelKey = kind === "black" ? "black" : (cam.event?.level ?? "calm");
  const lv = LEVEL[level];
  const people = cam.event?.people_count ?? cam.camera.people_count;
  const edge = cam.camera.edge_url?.replace(/\/$/, "");
  const canStream = view === "onsite" && kind !== "black" && !!edge && !streamFailed;
  const recorded = cam.camera.recorded_at ? fmtRecorded(cam.camera.recorded_at) : "";
  const topLeft =
    kind === "black"
      ? `NO SIGNAL · ${blackFor(cam.camera.black_since, now)}`
      : kind === "live"
        ? canStream
          ? `LIVE · ${fmtClock(now)}`
          : `LIVE SKELETONS · ${fmtClock(now)}`
        : `REC${recorded ? ` · RECORDED ${recorded}` : ""}`;
  const foot =
    kind === "black"
      ? ""
      : view === "onsite"
        ? kind === "live"
          ? "LAPTOP WEBCAM · VIDEO STAYS ON SITE"
          : "OUR OWN STAGED RECORDING · LABELLED AS SUCH"
        : "NO PIXELS LEAVE THE SITE · 12 BODY KEYPOINTS PER PERSON";
  const chip =
    kind === "live" ? (
      <SourceChip bg={C.ink} fg="#FFFFFF" dot={C.liveDot} text="LIVE WEBCAM" />
    ) : kind === "recorded" ? (
      <SourceChip bg={C.ground} fg={C.ink2} dot={C.muted} text="RECORDING · LOOP" />
    ) : (
      <SourceChip bg={C.ink} fg="#FFFFFF" dot="#8B939E" text="NO SIGNAL" />
    );
  const sub = [cam.building, cam.floor].filter(Boolean).join(" · ");
  const liveHref = `/?cam=${encodeURIComponent(cam.id)}`;
  const detailsHref = `/cameras?cam=${encodeURIComponent(cam.id)}`;
  const openLabel = kind === "live" ? "Open live view" : kind === "recorded" ? "Play recording in Live" : "Report repair";

  return (
    <Shell onClose={onClose} chip={chip} code={cam.id}>
      <Title title={cam.location} sub={sub} />
      <div style={{ position: "relative", background: kind === "black" ? "#000" : C.frame }}>
        {canStream ? (
          <>
            {/* On site only: the edge draws the skeletons; we add the HUD. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${edge}/stream.mjpg`}
              alt={`${cam.location} feed`}
              style={{ display: "block", width: "100%", aspectRatio: "16 / 9", objectFit: "cover" }}
              onError={() => setStreamFailed(true)}
            />
            <span style={{ position: "absolute", left: 10, top: 8, fontFamily: FONT.mono, fontSize: 12, fontWeight: 700, color: "#ECEFF3" }}>{topLeft}</span>
            <span style={{ position: "absolute", left: 10, bottom: 6, fontFamily: FONT.mono, fontSize: 10, color: "#AEB7C2" }}>{foot}</span>
          </>
        ) : (
          <SkeletonView
            frame={kind === "black" ? null : cam.event?.snapshot}
            level={level === "black" ? "calm" : level}
            score={cam.event?.peak_score}
            background={kind === "black" ? "black" : view === "onsite" ? "onsite" : "remote"}
            hud={{ topLeft, bottomLeft: foot }}
            idleText={kind === "black" ? undefined : people != null ? `${people} people in view` : "No one in view"}
            ariaLabel={`${cam.location} feed, ${lv.label}`}
          />
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 800,
            padding: "2px 8px",
            borderRadius: 1,
            background: lv.bg,
            color: lv.fg,
            border: `1px solid ${lv.border}`,
            textTransform: "uppercase",
          }}
        >
          {lv.label}
        </span>
        <span style={{ fontSize: 13, color: C.ink2 }}>{people == null ? "People in view unknown" : `${people} people in view`}</span>
        {kind === "recorded" && recorded && <span style={{ fontSize: 12, color: C.muted }}>Recording made {recorded.toLowerCase()}, looping</span>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <Link href={kind === "black" ? detailsHref : liveHref} style={primaryBtn} className="ee-campus-focus" onClick={() => onOpenCamera?.(cam.id)}>
          {openLabel}
        </Link>
        <Link href={detailsHref} style={secondaryBtn} className="ee-campus-focus" onClick={() => onOpenCamera?.(cam.id)}>
          Camera details
        </Link>
      </div>
    </Shell>
  );
}

export function PostCard({ post, cameraId, onClose }: { post: PlacedPost; cameraId?: string; onClose: () => void }) {
  const when = `${post.slot.days} ${post.slot.hours}`;
  const stat = (value: string, label: string, tint = false) => (
    <div
      style={{
        background: tint ? C.signalTint : C.raised,
        border: `1px solid ${tint ? C.signalLine : C.line}`,
        padding: 8,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      <span style={{ fontFamily: FONT.mono, fontSize: 20, fontWeight: 700, color: tint ? C.signalInk : C.ink }}>{value}</span>
      <span style={{ fontSize: 11, color: tint ? C.signalInk : C.ink2 }}>{label}</span>
    </div>
  );
  const hrs = Number.isInteger(post.hoursPerWeek) ? String(post.hoursPerWeek) : post.hoursPerWeek.toFixed(1);
  return (
    <Shell onClose={onClose} chip={<SourceChip bg={C.signal} fg="#FFFFFF" dot="#FFFFFF" text={`PATROL POST ${post.id}`} />} code={when.toUpperCase()}>
      <Title title={post.slot.location} sub={`Place one person here · ${when.toLowerCase()}`} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
        {stat(String(post.slot.incidents_4w), "in 4 weeks")}
        {stat(post.slot.expected_avoided_per_week.toFixed(2), "avoided a week", true)}
        {stat(`${hrs} h`, "hours a week")}
      </div>
      <span style={{ fontSize: 13, lineHeight: 1.45, color: C.ink2 }}>{post.slot.rationale}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <Link href={`/plan?slot=${encodeURIComponent(post.id)}`} style={primaryBtn} className="ee-campus-focus">
          Open in Plan
        </Link>
        <Link href={cameraId ? `/incidents?cam=${encodeURIComponent(cameraId)}` : "/incidents"} style={secondaryBtn} className="ee-campus-focus">
          See the incidents
        </Link>
      </div>
    </Shell>
  );
}
