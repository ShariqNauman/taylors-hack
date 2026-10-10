"use client";

// Public entry. The deck.gl engine is loaded lazily on the client, so the 3D
// chunk stays out of the initial bundle and never slows Live's first paint.
import dynamic from "next/dynamic";
import type { Campus3DProps } from "./engine";
import { C, FONT } from "./tokens";

const Engine = dynamic(() => import("./engine"), {
  ssr: false,
  loading: () => <Placeholder />,
});

function Placeholder({ compact = false }: { compact?: boolean }) {
  return (
    <div
      aria-busy="true"
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: compact ? "16 / 10" : "1200 / 640",
        minHeight: compact ? 200 : 360,
        maxHeight: compact ? 320 : "72vh",
        background: C.mapBg,
        border: `1px solid ${C.line}`,
        borderRadius: 2,
        display: "grid",
        placeItems: "center",
        fontFamily: FONT.mono,
        fontSize: 12,
        color: C.muted,
      }}
    >
      LOADING THE CAMPUS…
    </div>
  );
}

export type { Campus3DProps };

export function Campus3D(props: Campus3DProps) {
  return <Engine {...props} />;
}
