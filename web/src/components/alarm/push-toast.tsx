"use client";

import Link from "next/link";
import { toast } from "sonner";
import { fmtTime } from "@/lib/format";

/** "Pushed to Guard B · 14:31:06" with the two-tier subline and a phone link. */
export function pushToast(name: string, at: string | Date, location?: string) {
  toast.custom(
    (id) => (
      <div className="flex max-w-[380px] items-start gap-3 rounded-[2px] bg-ink p-4 text-white">
        <div className="flex flex-col gap-1">
          <span className="text-[17px] font-extrabold">
            Pushed to {name} · {fmtTime(at)}
          </span>
          {location && (
            <span className="text-[13px] opacity-85">{location}</span>
          )}
          <span className="text-[13px] opacity-85">
            One person only. They see a skeleton snapshot, not video.
          </span>
          <Link
            href={`/guard?staff=${encodeURIComponent(name)}`}
            className="text-[14px] font-bold text-[#B7C4FF]"
            onClick={() => toast.dismiss(id)}
          >
            Open their phone screen
          </Link>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={() => toast.dismiss(id)}
          className="ml-auto size-8 shrink-0 text-white"
        >
          ×
        </button>
      </div>
    ),
    { duration: 8000 },
  );
}
