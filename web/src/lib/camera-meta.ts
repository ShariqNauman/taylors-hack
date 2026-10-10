import type { Camera } from "./types";
import { fmtDateTime, fmtTime, MYT_TZ } from "./format";

/** "Thu 02:00" in Malaysia time. */
function fmtWeekdayTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: MYT_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export type CameraKind = "live" | "recorded" | "black";

export function cameraKind(c: Camera): CameraKind {
  if (!c.online || c.black_since) return "black";
  return c.source === "recorded" ? "recorded" : "live";
}

/** Tile suffix: "· LIVE" / "· REC" / "". */
export function kindSuffix(k: CameraKind): string {
  return k === "live" ? " · LIVE" : k === "recorded" ? " · REC" : "";
}

/** Source chip text (brief §15). */
export function sourceLabel(k: CameraKind): string {
  return k === "live"
    ? "LIVE WEBCAM"
    : k === "recorded"
      ? "RECORDING · LOOP"
      : "NO SIGNAL";
}

/** "Recording made Sat 10 Oct 16:20, looping". */
export function recordingLine(c: Camera): string | null {
  if (!c.recorded_at) return "Sample CCTV clip, not filmed on campus · looping";
  return `Recording made ${fmtDateTime(c.recorded_at).replace(",", "")}, looping`;
}

/** Short tile line: "live", "rec 16:20", "last Thu 02:00". */
export function tileTimeLine(c: Camera): string {
  const k = cameraKind(c);
  if (k === "black") {
    const at = c.black_since ?? c.last_frame_at;
    return at ? `last ${fmtWeekdayTime(at)}` : "no signal";
  }
  if (k === "recorded")
    return c.recorded_at ? `rec ${fmtTime(c.recorded_at, false)}` : "rec";
  return "live";
}
