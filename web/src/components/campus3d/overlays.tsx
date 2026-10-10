"use client";

// HTML overlays projected onto the map: camera pins, patrol posts, people on
// duty and building labels. Real buttons, so they are keyboard-reachable.
import type { CSSProperties, ReactNode } from "react";
import { C, FONT, LEVEL } from "./tokens";
import type { PinKind, PlacedCamera, PlacedPost } from "./types";

export type Px = [x: number, y: number] | null;

const CAMERA_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M3 8a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 10l5-3v10l-5-3"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth="2.2"
      strokeLinejoin="round"
    />
  </svg>
);

const PERSON_ICON = (
  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="7" r="4" fill="#FFFFFF" />
    <path d="M4 21c1-5 4-7 8-7s7 2 8 7z" fill="#FFFFFF" />
  </svg>
);

export const DOT: Record<PinKind, string> = { live: C.liveDot, recorded: C.muted, black: C.ink };
export const PIN_SUFFIX: Record<PinKind, string> = { live: " · LIVE", recorded: " · REC", black: "" };
export const PIN_WORD: Record<PinKind, string> = { live: "live webcam", recorded: "recording", black: "no signal" };

function at(px: Px, extra?: CSSProperties): CSSProperties {
  return {
    position: "absolute",
    left: px ? px[0] : -9999,
    top: px ? px[1] : -9999,
    visibility: px ? "visible" : "hidden",
    pointerEvents: "auto",
    ...extra,
  };
}

export function CameraPin({
  cam,
  px,
  selected,
  alarming,
  onPick,
}: {
  cam: PlacedCamera;
  px: Px;
  selected: boolean;
  alarming: boolean;
  onPick: (id: string) => void;
}) {
  const level = cam.kind === "black" ? "black" : (cam.event?.level ?? "calm");
  const lv = LEVEL[level];
  const border = alarming ? `2px solid ${C.likely}` : selected ? `2px solid ${C.ink}` : `1px solid ${lv.border}`;
  return (
    <button
      type="button"
      onClick={() => onPick(cam.id)}
      aria-label={`${cam.id}, ${cam.location}, ${PIN_WORD[cam.kind]}${cam.event ? `, ${lv.label}` : ""}`}
      aria-pressed={selected}
      className={`ee-campus-focus${alarming ? " ee-pulse ee-campus-pulse" : ""}`}
      style={at(px, {
        transform: "translate(-50%, -50%)",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        minHeight: 30,
        padding: "2px 8px 2px 2px",
        borderRadius: 999,
        border,
        background: selected ? C.ink : C.panel,
        color: selected ? "#FFFFFF" : C.ink,
        fontFamily: FONT.mono,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
        cursor: "pointer",
        zIndex: alarming ? 3 : 2,
      })}
    >
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          background: DOT[cam.kind],
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {CAMERA_ICON}
      </span>
      {cam.id.replace("CAM-", "")}
      {PIN_SUFFIX[cam.kind]}
    </button>
  );
}

export function GuardChip({ name, px }: { name: string; px: Px }) {
  return (
    <span
      style={at(px, {
        transform: "translate(-50%, -50%)",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px 2px 4px",
        borderRadius: 999,
        background: C.signal,
        color: "#FFFFFF",
        fontFamily: FONT.sans,
        fontSize: 11,
        fontWeight: 800,
        whiteSpace: "nowrap",
        pointerEvents: "none",
        zIndex: 1,
      })}
    >
      {PERSON_ICON}
      {name}
    </span>
  );
}

export function PostPin({
  post,
  px,
  selected,
  onPick,
}: {
  post: PlacedPost;
  px: Px;
  selected: boolean;
  onPick: (id: string) => void;
}) {
  const when = `${post.slot.days} ${post.slot.hours}`.toUpperCase();
  return (
    <button
      type="button"
      onClick={() => onPick(post.id)}
      aria-label={`Patrol post ${post.id} at ${post.slot.location}, ${when}`}
      aria-pressed={selected}
      className="ee-campus-focus"
      style={at(px, {
        transform: "translate(-50%, -50%)",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        minHeight: 30,
        padding: "3px 9px 3px 5px",
        borderRadius: 999,
        border: `2px solid ${selected ? C.ink : "#FFFFFF"}`,
        background: C.signal,
        color: "#FFFFFF",
        fontFamily: FONT.sans,
        fontSize: 11,
        fontWeight: 800,
        whiteSpace: "nowrap",
        cursor: "pointer",
        zIndex: 2,
      })}
    >
      {PERSON_ICON}
      {post.id} · {when}
    </button>
  );
}

export function BuildingLabel({
  text,
  px,
  selected,
  live,
  onPick,
}: {
  text: string;
  px: Px;
  selected: boolean;
  live: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="ee-campus-focus"
      style={at(px, {
        transform: "translate(-50%, calc(-100% - 14px))",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px",
        borderRadius: 2,
        border: `1px solid ${live ? C.likely : selected ? C.ink : C.lineStrong}`,
        background: selected ? C.ink : "rgba(255, 255, 255, 0.94)",
        color: selected ? "#FFFFFF" : C.ink,
        fontFamily: FONT.mono,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
        cursor: "pointer",
        zIndex: 1,
      })}
    >
      {text}
    </button>
  );
}

/** A small mono chip used for the compact "WHERE" label and the site name. */
export function Chip({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span
      style={{
        fontFamily: FONT.mono,
        fontSize: 11,
        fontWeight: 700,
        padding: "3px 8px",
        background: "rgba(255, 255, 255, 0.92)",
        border: `1px solid ${C.line}`,
        color: C.ink,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
