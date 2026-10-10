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
        title={`Guards were sent ${pushes} alert${pushes === 1 ? "" : "s"} this shift. The aim is ${budget} or fewer, so guards don't start ignoring them: "fight likely" alerts stop at ${budget}, a fight always alerts. Click to see them.`}
        className="inline-flex min-h-10 flex-col justify-center rounded-[2px] border border-line bg-ground px-3 text-ink no-underline"
      >
        <span className="text-[13px] font-bold leading-tight">
          <span className="font-mono text-[15px]">{pushes}</span> guard alert
          {pushes === 1 ? "" : "s"} this shift
        </span>
        <span className="text-[11px] leading-tight text-ink-2">
          {pushes > budget
            ? `${pushes - budget} over the aim of ${budget}`
            : `aim: ${budget} or fewer`}
        </span>
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
