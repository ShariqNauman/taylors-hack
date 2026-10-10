"use client";

import Link from "next/link";
import {
  useAlarmStore,
  selectBanner,
  selectSounding,
} from "@/lib/store/alarm-store";
import { LEVEL_LABEL, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Full-width banner under the header (brief §4): level colour, octagon glyph,
 * "FIGHT LIKELY · AUDITORIUM", who was pushed and when, a 3D-campus link, Silence.
 */
export function AlarmBanner() {
  const banner = useAlarmStore(selectBanner);
  const sounding = useAlarmStore(selectSounding);
  const silence = useAlarmStore((s) => s.silence);
  if (!banner) return null;
  const bg = banner.level === "fight" ? "#7F1310" : "#C8241B";
  const thisSounding = sounding && !banner.silenced;
  return (
    <div
      role="alert"
      className={cn("text-white", thisSounding && "ee-banner")}
      style={{ background: bg }}
    >
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z" fill="#FFFFFF" />
          <path
            d="M12 7v6M12 16.5v.5"
            stroke={bg}
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        </svg>
        <span className="ee-display text-[30px] leading-none">
          {LEVEL_LABEL[banner.level]} · {banner.location}
        </span>
        <span className="text-[16px] font-medium">
          {banner.pushed_to
            ? `${banner.pushed_to} pushed${banner.pushed_at ? ` at ${fmtTime(banner.pushed_at)}` : ""}`
            : "Not pushed yet"}
        </span>
        <Link
          href={`/cameras?cam=${encodeURIComponent(banner.camera_id)}`}
          className="text-[15px] font-extrabold text-white underline-offset-2 hover:underline"
        >
          View on the 3D campus
        </Link>
        <div className="ml-auto flex items-center gap-3">
          {thisSounding ? (
            <>
              <span className="font-mono text-[14px] font-bold">
                ALARM SOUNDING
              </span>
              <button
                type="button"
                onClick={() => silence(banner.incident_id)}
                className="min-h-10 rounded-[2px] border-2 border-white bg-transparent px-4 text-[15px] font-extrabold text-white hover:bg-white/10"
              >
                Silence
              </button>
            </>
          ) : (
            <span className="font-mono text-[14px] font-bold">
              ALARM SILENCED
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
