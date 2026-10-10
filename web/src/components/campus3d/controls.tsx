"use client";

import type { CSSProperties, ReactNode } from "react";
import { C, FONT } from "./tokens";
import type { Mode } from "./types";

const btn: CSSProperties = {
  height: 36,
  minWidth: 36,
  padding: "0 8px",
  borderRadius: 2,
  border: `1px solid ${C.lineStrong}`,
  background: C.panel,
  color: C.ink,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: FONT.sans,
  fontSize: 12,
  fontWeight: 800,
};

function Btn({
  label,
  onClick,
  children,
  style,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="ee-campus-focus" style={{ ...btn, ...style }}>
      {children}
    </button>
  );
}

export function LayerToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const seg = (m: Mode, text: string, first: boolean) => (
    <button
      type="button"
      onClick={() => onChange(m)}
      aria-pressed={mode === m}
      className="ee-campus-focus"
      style={{
        minHeight: 36,
        padding: "0 12px",
        border: "none",
        borderLeft: first ? "none" : `1px solid ${C.ink}`,
        background: mode === m ? C.ink : C.panel,
        color: mode === m ? "#FFFFFF" : C.ink,
        fontFamily: FONT.mono,
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {text}
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Layer"
      style={{ display: "inline-flex", border: `1px solid ${C.ink}`, borderRadius: 2, overflow: "hidden", background: C.panel }}
    >
      {seg("cameras", "CAMERAS", true)}
      {seg("plan", "PATROL PLAN", false)}
    </div>
  );
}

export function JumpChips({ jumps, onJump }: { jumps: { label: string }[]; onJump: (i: number) => void }) {
  return (
    <div role="group" aria-label="Jump to a building" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {jumps.map((j, i) => (
        <button
          key={j.label}
          type="button"
          onClick={() => onJump(i)}
          className="ee-campus-focus"
          style={{
            minHeight: 30,
            padding: "0 9px",
            borderRadius: 2,
            border: `1px solid ${C.lineStrong}`,
            background: "rgba(255, 255, 255, 0.94)",
            fontFamily: FONT.sans,
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            color: C.ink,
          }}
        >
          {j.label}
        </button>
      ))}
    </div>
  );
}

export function ViewButtons({
  bearing,
  onRotate,
  onTilt,
  onZoom,
  onReset,
}: {
  bearing: number;
  onRotate: (deg: number) => void;
  onTilt: (dir: "top" | "tilt") => void;
  onZoom: (delta: number) => void;
  onReset: () => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      <Btn label="Rotate left" onClick={() => onRotate(-20)} style={{ padding: 0 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5" fill="none" stroke={C.ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Btn>
      <Btn label="Rotate right" onClick={() => onRotate(20)} style={{ padding: 0 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 12a8 8 0 1 1-3-6.2M20 4v5h-5" fill="none" stroke={C.ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Btn>
      <Btn label="Look more from above" onClick={() => onTilt("top")}>
        Top
      </Btn>
      <Btn label="Tilt toward the horizon" onClick={() => onTilt("tilt")}>
        Tilt
      </Btn>
      <Btn label="Zoom in" onClick={() => onZoom(0.5)} style={{ fontSize: 18, padding: 0 }}>
        +
      </Btn>
      <Btn label="Zoom out" onClick={() => onZoom(-0.5)} style={{ fontSize: 18, padding: 0 }}>
        −
      </Btn>
      <Btn label="Reset view" onClick={onReset} style={{ fontWeight: 700, padding: "0 10px" }}>
        Reset view
      </Btn>
      <span
        role="img"
        aria-label={`Compass, north is ${Math.round(((bearing % 360) + 360) % 360)} degrees from up`}
        title="North"
        style={{ ...btn, width: 36, padding: 0, borderRadius: "50%", cursor: "default" }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${-bearing}deg)` }}>
          <path d="M12 3l4 9h-8z" fill={C.likely} />
          <path d="M12 21l-4-9h8z" fill={C.lineStrong} />
        </svg>
      </span>
    </div>
  );
}

export function Legend({ mode }: { mode: Mode }) {
  const item = (colour: string, text: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: colour }} />
      {text}
    </span>
  );
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "flex-end",
        gap: "4px 10px",
        padding: "6px 8px",
        background: "rgba(255, 255, 255, 0.92)",
        border: `1px solid ${C.line}`,
        fontFamily: FONT.sans,
        fontSize: 11,
        color: C.ink2,
      }}
    >
      {mode === "cameras" ? (
        <>
          {item(C.liveDot, "Live webcam")}
          {item(C.muted, "Recording")}
          {item(C.ink, "No signal")}
          {item(C.signal, "Person on duty")}
        </>
      ) : (
        <>
          {item(C.signal, "Patrol post")}
          {item(C.column, "Column height = incidents in 4 weeks")}
        </>
      )}
    </div>
  );
}

export function Credits({ text, google }: { text: string; google?: string | null }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontFamily: FONT.mono,
        fontSize: 10,
        color: C.muted,
        background: "rgba(255, 255, 255, 0.85)",
        padding: "2px 6px",
        maxWidth: "100%",
        textAlign: "right",
      }}
    >
      {google != null && (
        <span style={{ fontFamily: FONT.sans, fontSize: 12, fontWeight: 700, color: C.ink2, letterSpacing: 0 }}>
          {/* Google requires its logo on 3D Tiles. The image is Google's own; the text is the fallback. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://developers.google.com/static/maps/documentation/tile/images/google_on_white.png"
            alt="Google"
            height={16}
            style={{ height: 16, width: "auto", display: "block" }}
            onError={(e) => {
              const el = e.currentTarget;
              el.style.display = "none";
              if (el.parentElement && !el.parentElement.textContent?.trim()) el.parentElement.append("Google");
            }}
          />
        </span>
      )}
      <span>{google ? `${google} · ${text}` : text}</span>
    </span>
  );
}
