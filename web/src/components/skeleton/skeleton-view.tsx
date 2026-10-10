import type { Level, PoseFrame } from "@/lib/types";
import { LEVEL_LABEL, LEVEL_THEME } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Bones as index pairs into the 12 body keypoints. */
const BONES: [number, number][] = [
  [0, 2],
  [2, 4],
  [1, 3],
  [3, 5],
  [0, 1],
  [0, 6],
  [1, 7],
  [6, 7],
  [6, 8],
  [8, 10],
  [7, 9],
  [9, 11],
];
const MIN_CONF = 0.3;
const PERSON = ["#7FE0FF", "#C9A7FF", "#C9CED6"];
const W = 640;
const H = 360;

const SCENE_LINES =
  "M0 318L640 318M0 318L120 230L520 230L640 318M120 230L120 0M520 230L520 0M520 230L560 230L560 205L590 205L590 180L620 180L620 155L640 155M150 60L230 60L230 130L150 130Z";
let GRID = "";
for (let x = 0; x <= W; x += 40) GRID += `M${x} 0L${x} ${H}`;
for (let y = 0; y <= H; y += 40) GRID += `M0 ${y}L${W} ${y}`;

type Pt = [number, number];

function personGeometry(kp: PoseFrame["people"][number]["kp"]) {
  const pts: (Pt | null)[] = kp.map((k) =>
    k && k[2] >= MIN_CONF ? [k[0] * W, k[1] * H] : null,
  );
  const mid = (a: Pt | null, b: Pt | null): Pt | null =>
    a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : (a ?? b);
  const sho = mid(pts[0], pts[1]);
  const hip = mid(pts[6], pts[7]);
  let torso = 56;
  let dir: Pt = [0, -1];
  if (sho && hip) {
    const dx = sho[0] - hip[0];
    const dy = sho[1] - hip[1];
    const len = Math.hypot(dx, dy);
    if (len > 4) {
      torso = len;
      dir = [dx / len, dy / len];
    }
  }
  const head: Pt | null = sho
    ? [sho[0] + dir[0] * 0.34 * torso, sho[1] + dir[1] * 0.34 * torso]
    : null;
  const headR = 0.2 * torso;
  const bones = BONES.filter(([a, b]) => pts[a] && pts[b]).map(
    ([a, b]) => [pts[a]!, pts[b]!] as [Pt, Pt],
  );
  const joints = pts.filter((p): p is Pt => !!p);
  const xs = [
    ...joints.map((p) => p[0]),
    ...(head ? [head[0] - headR, head[0] + headR] : []),
  ];
  const ys = [...joints.map((p) => p[1]), ...(head ? [head[1] - headR] : [])];
  return { bones, joints, head, headR, torso, hip, xs, ys };
}

export interface SkeletonViewProps {
  frame?: PoseFrame | null;
  level?: Level;
  /** Box label; defaults to "LEVEL SCORE" when `score` is given. */
  label?: string;
  score?: number;
  showBox?: boolean;
  /** Dashed white line between the first two people's hips, labelled in torso-lengths. */
  showDistance?: boolean;
  /** Dashed cyan polyline, frame coordinates 0–1. */
  trail?: [number, number][];
  /** On site: dark frame with scene lines. Remote: darker frame with a 40 px grid. */
  background?: "onsite" | "remote" | "black";
  /** HUD overlays, mono uppercase. */
  hud?: {
    topLeft?: string;
    topRight?: string;
    topRightDot?: string | null;
    bottomLeft?: string;
  };
  /** Shown centred when there is no frame: "N people in view". */
  idleText?: string;
  idleSub?: string;
  /** Stroke width for small tiles. */
  stroke?: number;
  className?: string;
  ariaLabel?: string;
}

/**
 * Renders a 12-keypoint PoseFrame as skeletons in a 640 × 360 camera frame.
 * No face points: the head is a circle 0.34 torso-lengths above the shoulders.
 */
export function SkeletonView({
  frame,
  level = "calm",
  label,
  score,
  showBox = true,
  showDistance = false,
  trail,
  background = "remote",
  hud,
  idleText,
  idleSub,
  stroke = 4,
  className,
  ariaLabel,
}: SkeletonViewProps) {
  const theme = LEVEL_THEME[level];
  const people = (frame?.people ?? []).map((p) => personGeometry(p.kp));
  const allX = people.flatMap((p) => p.xs);
  const allY = people.flatMap((p) => p.ys);
  const meanTorso = people.length
    ? people.reduce((s, p) => s + p.torso, 0) / people.length
    : 56;
  const pad = 0.85 * meanTorso;
  const box =
    showBox && allX.length
      ? {
          x: Math.max(2, Math.min(...allX) - pad),
          y: Math.max(2, Math.min(...allY) - pad * 0.3),
          x2: Math.min(W - 2, Math.max(...allX) + pad),
          y2: Math.min(H - 2, Math.max(...allY) + 6),
        }
      : null;
  const boxLabel =
    label ??
    (score != null
      ? `${LEVEL_LABEL[level].toUpperCase()} ${score.toFixed(2)}`
      : LEVEL_LABEL[level].toUpperCase());
  const bg =
    background === "black"
      ? "#000000"
      : background === "onsite"
        ? "#161B22"
        : "#0E1217";
  const lines =
    background === "onsite" ? SCENE_LINES : background === "remote" ? GRID : "";
  const lineStroke = background === "onsite" ? "#2A323C" : "#1A2028";

  let dist: { a: Pt; b: Pt; tl: number } | null = null;
  if (showDistance && people.length >= 2 && people[0].hip && people[1].hip) {
    const a = people[0].hip;
    const b = people[1].hip;
    dist = { a, b, tl: Math.hypot(a[0] - b[0], a[1] - b[1]) / meanTorso };
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={
        ariaLabel ??
        `Camera frame, ${LEVEL_LABEL[level]}, ${people.length} people`
      }
      className={cn("block h-auto w-full", className)}
    >
      <rect x="0" y="0" width={W} height={H} fill={bg} />
      {lines && (
        <path
          d={lines}
          stroke={lineStroke}
          strokeWidth={background === "onsite" ? 2 : 1}
          fill="none"
        />
      )}
      {box && (
        <>
          <rect
            x={box.x}
            y={box.y}
            width={box.x2 - box.x}
            height={box.y2 - box.y}
            fill="none"
            stroke={theme.box}
            strokeWidth="2.5"
          />
          <rect
            x={box.x}
            y={Math.max(0, box.y - 24)}
            width={boxLabel.length * 8.6 + 16}
            height="24"
            fill={theme.box}
          />
          <text
            x={box.x + 8}
            y={Math.max(0, box.y - 24) + 17}
            fontFamily="var(--font-atkinson-mono), ui-monospace, monospace"
            fontSize="14"
            fontWeight="700"
            fill={theme.boxFg}
          >
            {boxLabel}
          </text>
        </>
      )}
      {trail && trail.length > 1 && (
        <polyline
          points={trail
            .map(([x, y]) => `${(x * W).toFixed(1)},${(y * H).toFixed(1)}`)
            .join(" ")}
          fill="none"
          stroke="#7FE0FF"
          strokeWidth="3"
          strokeOpacity="0.55"
          strokeDasharray="2 5"
          strokeLinecap="round"
        />
      )}
      {dist && (
        <>
          <line
            x1={dist.a[0]}
            y1={dist.a[1]}
            x2={dist.b[0]}
            y2={dist.b[1]}
            stroke="#FFFFFF"
            strokeWidth="1.5"
            strokeDasharray="4 4"
            strokeOpacity="0.8"
          />
          <text
            x={(dist.a[0] + dist.b[0]) / 2}
            y={(dist.a[1] + dist.b[1]) / 2 - 8}
            textAnchor="middle"
            fontFamily="var(--font-atkinson-mono), ui-monospace, monospace"
            fontSize="12"
            fontWeight="700"
            fill="#FFFFFF"
          >
            {dist.tl.toFixed(2)} TL
          </text>
        </>
      )}
      {people.map((p, i) => {
        const colour = PERSON[Math.min(i, PERSON.length - 1)];
        return (
          <g key={i}>
            {p.bones.map(([a, b], j) => (
              <line
                key={j}
                x1={a[0]}
                y1={a[1]}
                x2={b[0]}
                y2={b[1]}
                stroke={colour}
                strokeWidth={stroke}
                strokeLinecap="round"
              />
            ))}
            {p.head && (
              <circle
                cx={p.head[0]}
                cy={p.head[1]}
                r={p.headR}
                fill="none"
                stroke={colour}
                strokeWidth={stroke}
              />
            )}
            {p.joints.map((q, j) => (
              <circle
                key={j}
                cx={q[0]}
                cy={q[1]}
                r={stroke * 0.7}
                fill="#FFFFFF"
              />
            ))}
          </g>
        );
      })}
      {!people.length && idleText && (
        <>
          <text
            x={W / 2}
            y={H / 2 - 4}
            textAnchor="middle"
            fontFamily="var(--font-atkinson-mono), ui-monospace, monospace"
            fontSize="26"
            fontWeight="700"
            fill="#ECEFF3"
          >
            {idleText}
          </text>
          {idleSub && (
            <text
              x={W / 2}
              y={H / 2 + 22}
              textAnchor="middle"
              fontFamily="var(--font-atkinson), system-ui, sans-serif"
              fontSize="14"
              fill="#AEB7C2"
            >
              {idleSub}
            </text>
          )}
        </>
      )}
      {hud?.topLeft && (
        <text
          x="18"
          y="34"
          fontFamily="var(--font-atkinson-mono), ui-monospace, monospace"
          fontSize="13"
          fontWeight="700"
          fill="#ECEFF3"
        >
          {hud.topLeft}
        </text>
      )}
      {hud?.topRight && (
        <>
          {hud.topRightDot && (
            <circle
              cx={W - 18 - hud.topRight.length * 8.2 - 14}
              cy="29"
              r="6"
              fill={hud.topRightDot}
            />
          )}
          <text
            x={W - 18}
            y="34"
            textAnchor="end"
            fontFamily="var(--font-atkinson-mono), ui-monospace, monospace"
            fontSize="13"
            fontWeight="700"
            fill="#ECEFF3"
          >
            {hud.topRight}
          </text>
        </>
      )}
      {hud?.bottomLeft && (
        <text
          x="18"
          y="342"
          fontFamily="var(--font-atkinson-mono), ui-monospace, monospace"
          fontSize="12"
          fill="#AEB7C2"
        >
          {hud.bottomLeft}
        </text>
      )}
    </svg>
  );
}

/** Dark camera frame wrapper with the four ink corner brackets. */
export function CameraFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("ee-brackets", className)}>
      <span className="ee-bracket-b" aria-hidden />
      {children}
    </div>
  );
}
