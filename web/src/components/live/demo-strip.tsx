"use client";

import Link from "next/link";
import { useState } from "react";
import { DemoVideoModal } from "@/components/demo-video-modal";

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
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-[2px] border border-dashed border-line-strong bg-white px-3.5 py-2.5">
        <span className="rounded-[1px] bg-ink px-2 py-0.5 font-mono text-[12px] font-bold text-white">
          BENCHMARK DEMO ACTIVE
        </span>
        <span className="text-[15px]">
          {mode === "replay"
            ? "Violence prediction footage running on Camera 1"
            : "No live events in the last minute"}
          {location ? ` · ${location}` : " · Grand Hall"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-[2px] border border-line-strong bg-white px-3.5 text-[14px] font-extrabold text-ink hover:bg-raised"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            Watch Full Video
          </button>
          {mode === "replay" ? (
            <button
              type="button"
              onClick={onRestart}
              className="min-h-10 rounded-[2px] bg-signal px-3.5 text-[14px] font-extrabold text-white"
            >
              Restart demo feed
            </button>
          ) : (
            <Link
              href="/?replay=1"
              className="inline-flex min-h-10 items-center rounded-[2px] bg-signal px-3.5 text-[14px] font-extrabold text-white no-underline"
            >
              Play demo feed
            </Link>
          )}
        </div>
      </div>
      <DemoVideoModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
