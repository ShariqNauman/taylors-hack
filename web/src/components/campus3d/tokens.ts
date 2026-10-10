// Light Console tokens (docs/frontend-build-brief.md §3), as literals so the
// map renders the same on every branch of the shell.
export const C = {
  ground: "#F1F2F4",
  panel: "#FFFFFF",
  raised: "#F7F8FA",
  line: "#DCDFE4",
  lineStrong: "#B4BAC3",
  ink: "#0B0D10",
  ink2: "#3A414B",
  muted: "#5D6672",
  signal: "#2742D9",
  signalTint: "#E7EBFD",
  signalInk: "#1F35B3",
  signalLine: "#A9B6F2",
  frame: "#161B22",
  frameRemote: "#0E1217",
  frameLine: "#2A323C",
  gridLine: "#1A2028",
  personA: "#7FE0FF",
  personB: "#C9A7FF",
  personC: "#C9CED6",
  likely: "#C8241B",
  likelyTint: "#FDEDEB",
  fight: "#7F1310",
  liveDot: "#FF453A",
  // map
  mapBg: "#E6EBF0",
  water: "#D6E3F1",
  waterLine: "#B9CDE2",
  pitch: "#E3F1E7",
  pitchLine: "#9FD3B4",
  buildingTop: "#FFFFFF",
  buildingSideL: "#E6E9EE",
  buildingSideR: "#C9D0D9",
  buildingLine: "#8F99A5",
  column: "#3653DC",
} as const;

export const FONT = {
  display: "var(--font-saira), 'Saira Condensed', system-ui, sans-serif",
  sans: "var(--font-atkinson), 'Atkinson Hyperlegible Next', system-ui, sans-serif",
  mono: "var(--font-atkinson-mono), 'Atkinson Hyperlegible Mono', ui-monospace, SFMono-Regular, monospace",
} as const;

export type LevelKey = "calm" | "tense" | "fight_likely" | "fight" | "black";

export const LEVEL: Record<LevelKey, { label: string; bg: string; fg: string; border: string }> = {
  calm: { label: "Calm", bg: "#E4F3EA", fg: "#17663D", border: "#9FD3B4" },
  tense: { label: "Tense", bg: "#F5B323", fg: "#1A1200", border: "#E5A41C" },
  fight_likely: { label: "Fight likely", bg: "#C8241B", fg: "#FFFFFF", border: "#C8241B" },
  fight: { label: "Fight", bg: "#7F1310", fg: "#FFFFFF", border: "#7F1310" },
  black: { label: "No signal", bg: "#0B0D10", fg: "#FFFFFF", border: "#0B0D10" },
};

export const hex = (h: string, a = 255): [number, number, number, number] => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
  a,
];
