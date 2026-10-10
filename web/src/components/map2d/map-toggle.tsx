"use client";

import { cn } from "@/lib/utils";

export type MapView = "2d" | "3d";

/** "Map | 3D". The pages hide it when the browser has no WebGL. */
export function MapToggle({ view, onChange }: { view: MapView; onChange: (v: MapView) => void }) {
  return (
    <div role="group" aria-label="Map type" className="inline-flex overflow-hidden rounded-[2px] border border-line-strong">
      {(["2d", "3d"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => onChange(v)}
          className={cn(
            "min-h-9 px-3.5 text-[14px] font-bold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal",
            v === "3d" && "border-l border-line-strong",
            view === v ? "bg-ink text-white" : "bg-white",
          )}
        >
          {v === "2d" ? "Map" : "3D"}
        </button>
      ))}
    </div>
  );
}
