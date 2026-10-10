"use client";

import Link from "next/link";

/** "No camera connected" strip (brief §15 copy). */
export function DemoStrip({
  mode,
  onRestart,
  location,
}: {
  /** Where the recorded feed was filmed (the live camera's location). */
  location?: string;
  /** "replay": the recorded demo feed is playing. "idle": no live feed and no replay. */
  mode: "replay" | "idle";
  onRestart?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-[2px] border border-dashed border-line-strong bg-white px-3.5 py-2.5">
      <span className="rounded-[1px] border border-ink px-2 py-0.5 font-mono text-[12px] font-bold">
        NO CAMERA CONNECTED
      </span>
      <span className="text-[15px]">
        {mode === "replay" ? "Recorded demo feed" : "No live events in the last minute"}
        {location ? ` · ${location}` : ""}
      </span>
      {mode === "replay" ? (
        <button
          type="button"
          onClick={onRestart}
          className="ml-auto min-h-10 rounded-[2px] bg-signal px-3.5 text-[14px] font-extrabold text-white"
        >
          Restart demo feed
        </button>
      ) : (
        <Link
          href="/?replay=1"
          className="ml-auto inline-flex min-h-10 items-center rounded-[2px] bg-signal px-3.5 text-[14px] font-extrabold text-white no-underline"
        >
          Play demo feed
        </Link>
      )}
    </div>
  );
}
