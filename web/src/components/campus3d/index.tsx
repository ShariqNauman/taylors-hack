"use client";

// Public entry for the 3D campus. three.js loads in its own chunk, client-side
// only, so no page's first load grows.
import dynamic from "next/dynamic";
import type { Campus3DProps } from "./types";

export type { Campus3DProps } from "./types";

const Impl = dynamic(() => import("./campus3d"), {
  ssr: false,
  loading: () => (
    <div
      className="grid size-full place-items-center rounded-[2px] border border-line bg-[#E6EBF0]"
      aria-busy="true"
    >
      <span className="ee-label text-muted-foreground">Building the campus model</span>
    </div>
  ),
});

/**
 * 3D campus: a stylised diorama of the real Taylor's Lakeside built in code from
 * the OpenStreetMap footprints (three.js), a flat SVG fallback without WebGL,
 * camera / guard / patrol-post pins as buttons. No Google tiles.
 */
export function Campus3D(props: Campus3DProps) {
  const h = props.height ?? (props.compact ? 240 : 560);
  return (
    <div className="w-full" style={{ height: h }}>
      <Impl {...props} height={h} />
    </div>
  );
}
