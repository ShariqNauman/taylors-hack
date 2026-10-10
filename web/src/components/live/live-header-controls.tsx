"use client";

import Link from "next/link";
import { fmtTime } from "@/lib/format";
import { ArmSoundButton } from "@/components/alarm/arm-sound-button";

/** Live-only header controls (brief §4): arm sound, pushes counter, MYT clock, End shift. */
export function LiveHeaderControls({
  pushes,
  budget,
  now,
  onEndShift,
}: {
  pushes: number;
  budget: number;
  now: Date;
  onEndShift: () => void;
}) {
  return (
    <>
      <ArmSoundButton />
      <Link
        href="/incidents?status=pushed"
        title="See pushed incidents"
        className="inline-flex min-h-10 items-center gap-1.5 rounded-[2px] border border-line bg-ground px-3 text-[13px] font-bold text-ink no-underline"
      >
        <span className="font-mono text-[15px]">
          {pushes}/{budget}
        </span>
        pushes this shift
      </Link>
      <span
        className="font-mono text-[16px] font-bold tabular-nums"
        suppressHydrationWarning
      >
        {fmtTime(now)} <span className="text-[11px] text-muted-ink">MYT</span>
      </span>
      <button
        type="button"
        onClick={onEndShift}
        className="min-h-10 rounded-[2px] border border-ink bg-white px-3.5 text-[13px] font-extrabold text-ink"
      >
        End shift
      </button>
    </>
  );
}
