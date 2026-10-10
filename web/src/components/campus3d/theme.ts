// Light Console colours for the campus map.
export const COLORS = {
  background: "#E6EBF0",
  ground: "#F7F8FA",
  campusLine: "#B4BAC3",
  water: "#D6E3F1",
  waterLine: "#B9CDE2",
  pitch: "#E3F1E7",
  pitchLine: "#9FD3B4",
  edge: "#8F99A5",
  alarmTop: "#FDEDEB",
  alarmLine: "#C8241B",
  selectedTop: "#E7EBFD",
  selectedLine: "#2742D9",
  route: "#2742D9",
} as const;

export type RGBA = [number, number, number, number];

export function hex(h: string, a = 255): RGBA {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

/**
 * Lighting multiplies the base colour: tops get ×TOP, sides facing the side
 * light up to ×(1 + SIDE), sides facing away ×1. So a base of #C9D0D9 gives
 * white-ish tops, #E6E9EE-ish lit sides and #C9D0D9 shaded sides.
 */
export const LIGHT = { ambient: 1, top: 0.27, side: 0.14 } as const;

/** Base colour that lights up to roughly `top` on the roof. */
export function baseForTop(top: string, a = 255): RGBA {
  const [r, g, b] = hex(top);
  const k = 1 + LIGHT.top;
  return [Math.round(r / k), Math.round(g / k), Math.round(b / k), a];
}
