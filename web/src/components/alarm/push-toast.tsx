"use client";

import Link from "next/link";
import { toast } from "sonner";
import { fmtTime } from "@/lib/format";
import { PersonByCall } from "@/components/chrome/person-tag";

/**
 * "Pushed · 14:31:06 · Aiman Hakimi · Grand Hall". On the desk the guard's phone already opens
 * beside it (showPhoneBeside), so no link; on a small screen, a link to their phone screen.
 */
export function pushToast(name: string, at: string | Date, location?: string) {
  const phoneBeside = typeof window !== "undefined" && window.innerWidth >= 1100;
  toast.custom(
    (id) => (
      <div className="flex max-w-[380px] items-start gap-3 rounded-[2px] bg-ink p-4 text-white">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-bold opacity-85">Pushed · {fmtTime(at)}</span>
          <PersonByCall call={name} size={36} dark className="text-[17px]" />
          {location && <span className="text-[13px] opacity-85">{location}</span>}
          {!phoneBeside && (
            <Link
              href={`/guard?staff=${encodeURIComponent(name)}`}
              className="text-[14px] font-bold text-[#B7C4FF]"
              onClick={() => toast.dismiss(id)}
            >
              Open their phone screen
            </Link>
          )}
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
