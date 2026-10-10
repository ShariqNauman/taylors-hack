"use client";

// Public entry for the 3D campus. deck.gl loads in its own chunk, client-side
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
      <span className="ee-label text-muted-foreground">Loading campus map</span>
    </div>
  ),
});

/**
 * 3D campus: OpenStreetMap footprints extruded with deck.gl (Google
 * Photorealistic 3D Tiles when NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is set), a flat
 * SVG fallback without WebGL, camera / guard / patrol-post pins as buttons.
 */
export function Campus3D(props: Campus3DProps) {
  const h = props.height ?? (props.compact ? 240 : 560);
  return (
    <div className="w-full" style={{ height: h }}>
      <Impl {...props} height={h} />
    </div>
  );
}
