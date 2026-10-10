"use client";

import { toast } from "sonner";
import { useAlarmStore } from "@/lib/store/alarm-store";
import { armAlarmAudio } from "./alarm-layer";
import { cn } from "@/lib/utils";

/** Amber outline until clicked; label becomes "Sound armed". */
export function ArmSoundButton({ className }: { className?: string }) {
  const armed = useAlarmStore((s) => s.armed);
  return (
    <button
      type="button"
      onClick={async () => {
        if (armed) return;
        const ok = await armAlarmAudio();
        if (ok) toast.success("Alarm sound armed");
        else toast.warning("Browser blocked audio; click again");
      }}
      aria-pressed={armed}
      className={cn(
        "inline-flex min-h-10 items-center gap-2 rounded-[2px] border px-3 text-[13px] font-bold text-ink",
        armed ? "border-line bg-white" : "border-tense-line bg-tense-tint",
        className,
      )}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 9h4l5-4v14l-5-4H4z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d={armed ? "M16 9a4 4 0 0 1 0 6" : "M16 9l5 6M21 9l-5 6"}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      {armed ? "Sound armed" : "Arm alarm sound"}
    </button>
  );
}
