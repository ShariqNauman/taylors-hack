/**
 * Synthetic 12-keypoint poses for dev and for the mock replay, ported from the
 * design prototype (design/canvas/L3Live.dc.html: fig(), PA, PB, CM, PE, WS).
 *
 * The prototype draws a side view with both shoulders at the neck; here the
 * left and right shoulder sit 6 px either side of the neck, and the hips likewise.
 * Any screen fed by these shows a dashed SYNTHETIC POSES chip. Replace with the
 * real recorded session before the 03:00 run-through (brief §8.3).
 */
import type { Keypoint, PoseFrame, TopFeature } from "./types";

/**
 * True while public/mock/replay.json and events.json carry poses generated here.
 * Set to false once replay.json is replaced by the recorded auditorium session.
 * While true, every frame fed from mock or replay data shows a SYNTHETIC POSES chip.
 */
export const SYNTHETIC_POSES_IN_MOCKS = true;

export interface ProtoPose {
  x: number;
  dir: 1 | -1;
  lean: number;
  ra: [number, number];
  la: [number, number];
  stride: number;
}

const T = 56; // torso length, px in a 640 × 360 frame
const G = 318; // ground line
const W = 640;
const H = 360;
const SIDE = 6; // half shoulder / hip width, px

const rad = (d: number) => (d * Math.PI) / 180;

/** 12 keypoints: l_sho, r_sho, l_elb, r_elb, l_wri, r_wri, l_hip, r_hip, l_knee, r_knee, l_ank, r_ank. */
export function figToKeypoints(p: ProtoPose): Keypoint[] {
  const legL = 0.58 * T;
  const hip: [number, number] = [p.x, G - 2 * legL * 0.97];
  const L = rad(p.lean || 0);
  const neck: [number, number] = [
    hip[0] + p.dir * T * Math.sin(L),
    hip[1] - T * Math.cos(L),
  ];
  const arm = (a: number, e: number): [[number, number], [number, number]] => {
    const A = rad(a);
    const E = rad(a + e);
    const el: [number, number] = [
      neck[0] + p.dir * 0.5 * T * Math.sin(A),
      neck[1] + 0.5 * T * Math.cos(A),
    ];
    return [
      el,
      [el[0] + p.dir * 0.46 * T * Math.sin(E), el[1] + 0.46 * T * Math.cos(E)],
    ];
  };
  const leg = (s: number): [[number, number], [number, number]] => {
    const S = rad(s);
    const S2 = rad(s * 0.4);
    const k: [number, number] = [
      hip[0] + p.dir * legL * Math.sin(S),
      hip[1] + legL * Math.cos(S),
    ];
    return [
      k,
      [k[0] + p.dir * legL * Math.sin(S2), k[1] + legL * Math.cos(S2)],
    ];
  };
  const r = arm(p.ra[0], p.ra[1]);
  const l = arm(p.la[0], p.la[1]);
  const st = p.stride == null ? 8 : p.stride;
  const rl = leg(st);
  const ll = leg(-st);
  const kp = (pt: [number, number], c = 0.9): Keypoint => [
    Math.round((pt[0] / W) * 1000) / 1000,
    Math.round((pt[1] / H) * 1000) / 1000,
    c,
  ];
  return [
    kp([neck[0] - SIDE, neck[1]]), // l_shoulder
    kp([neck[0] + SIDE, neck[1]]), // r_shoulder
    kp(l[0]), // l_elbow
    kp(r[0]), // r_elbow
    kp(l[1]), // l_wrist
    kp(r[1]), // r_wrist
    kp([hip[0] - SIDE, hip[1]]), // l_hip
    kp([hip[0] + SIDE, hip[1]]), // r_hip
    kp(ll[0]), // l_knee
    kp(rl[0]), // r_knee
    kp(ll[1]), // l_ankle
    kp(rl[1]), // r_ankle
  ];
}

const mk =
  (dir: 1 | -1) =>
  (v: number[]): ProtoPose => ({
    x: v[0],
    dir,
    lean: v[1],
    ra: [v[2], v[3]],
    la: [v[4], v[5]],
    stride: v[6],
  });

/** Person A (cyan), one keyframe per replay event (12). */
export const PA: ProtoPose[] = [
  [296, 2, 12, 8, -8, 6, 7],
  [313, 10, 105, 55, 95, 60, 8],
  [288, 0, 165, 5, -5, 5, 8],
  [300, 6, 30, 20, 25, 20, 12],
  [305, 8, 80, 60, 25, 20, 14],
  [307, 10, 100, 35, 35, 30, 14],
  [309, 12, 125, 15, 45, 40, 16],
  [311, 14, 155, 5, 60, 50, 16],
  [315, 10, 145, 10, 135, 15, 16],
  [327, 28, 95, 0, 90, 0, 22],
  [338, 18, 150, -20, 80, 40, 18],
  [342, 16, 120, 10, 150, -10, 18],
].map(mk(1));

/** Person B (violet). */
export const PB: ProtoPose[] = [
  [350, 2, 15, 10, -6, 8, 7],
  [337, 10, 105, 55, 95, 60, 8],
  [342, 0, 165, 5, -5, 5, 8],
  [336, 4, 28, 20, 22, 20, 12],
  [334, 2, 30, 30, 20, 20, 10],
  [335, 0, 40, 40, 20, 20, 10],
  [334, -4, 60, 70, 30, 30, 10],
  [338, -14, 70, 80, 40, 40, 14],
  [332, -10, 120, 70, 110, 70, 14],
  [372, -24, 60, 40, 150, 20, 18],
  [366, -12, 125, 70, 115, 70, 14],
  [369, -14, 125, 70, 115, 70, 14],
].map(mk(-1));

/** Feature tracks per replay event: close motion, pair motion energy, wrist speed (TL/s). */
export const CM = [
  0.05, 0.08, 0.1, 0.25, 0.32, 0.4, 0.62, 0.7, 0.74, 0.92, 0.95, 0.9,
];
export const PE = [
  0.06, 0.1, 0.18, 0.28, 0.35, 0.45, 0.66, 0.72, 0.78, 0.95, 0.97, 0.93,
];
export const WS = [0.3, 0.5, 2.1, 0.9, 1.4, 2.2, 3.4, 3.1, 3.3, 4.6, 5.1, 4.8];

export function lerpPose(a: ProtoPose, b: ProtoPose, k: number): ProtoPose {
  const m = (x: number, y: number) => x + (y - x) * k;
  return {
    x: m(a.x, b.x),
    dir: a.dir,
    lean: m(a.lean, b.lean),
    ra: [m(a.ra[0], b.ra[0]), m(a.ra[1], b.ra[1])],
    la: [m(a.la[0], b.la[0]), m(a.la[1], b.la[1])],
    stride: m(a.stride, b.stride),
  };
}

/** Pose at fractional keyframe index `tt` (0–11). */
export function poseAt(table: ProtoPose[], tt: number): ProtoPose {
  const a = Math.max(0, Math.min(table.length - 1, Math.floor(tt)));
  const b = Math.min(table.length - 1, a + 1);
  return lerpPose(table[a], table[b], Math.max(0, Math.min(1, tt - a)));
}

export function lerpArr(arr: number[], tt: number): number {
  const a = Math.max(0, Math.min(arr.length - 1, Math.floor(tt)));
  const b = Math.min(arr.length - 1, a + 1);
  return arr[a] + (arr[b] - arr[a]) * Math.max(0, Math.min(1, tt - a));
}

/** The replay escalation frame at keyframe `tt` (0–11); a third person walks in after 10.2. */
export function replayFrame(tt: number, t: string): PoseFrame {
  const people = [
    { id: 1, kp: figToKeypoints(poseAt(PA, tt)) },
    { id: 2, kp: figToKeypoints(poseAt(PB, tt)) },
  ];
  if (tt > 10.2) {
    const x = 600 - ((Math.min(tt, 11) - 10.2) / 0.8) * 80;
    people.push({
      id: 3,
      kp: figToKeypoints({
        x,
        dir: -1,
        lean: 6,
        ra: [25, 10],
        la: [-20, 10],
        stride: 18,
      }),
    });
  }
  return { t, people };
}

/** Replay feature values at keyframe `tt`. */
export function replayFeatures(tt: number, score: number): TopFeature[] {
  return [
    { name: "close_motion", value: Math.round(lerpArr(CM, tt) * 100) / 100 },
    {
      name: "pair_motion_energy",
      value: Math.round(lerpArr(PE, tt) * 100) / 100,
    },
    { name: "max_wrist_speed", value: Math.round(lerpArr(WS, tt) * 10) / 10 },
    { name: "risk_score", value: score },
  ];
}

/** Static scenes for the other mock cameras. */
export function staticFrame(
  kind: "crowd" | "play" | "pair" | "one",
  t: string,
): PoseFrame {
  const figs: number[][] =
    kind === "crowd"
      ? [
          [232, 1, 4, 10, 5, -5, 5, 8],
          [282, 1, 6, 15, 10, -5, 5, 10],
          [330, 1, 2, 20, 30, 10, 10, 6],
          [392, -1, 6, 12, 8, -6, 6, 10],
          [444, -1, 4, 10, 6, -4, 5, 8],
        ]
      : kind === "play"
        ? [
            [250, 1, -6, 170, 0, 150, 10, 22],
            [420, -1, -4, 150, 10, 20, 10, 20],
          ]
        : kind === "pair"
          ? [
              [290, 1, 3, 20, 10, 10, 10, 8],
              [350, -1, 2, 15, 10, 12, 8, 8],
            ]
          : [[320, 1, 2, 10, 5, 8, 5, 8]];
  return {
    t,
    people: figs.map((v, i) => ({
      id: i + 1,
      kp: figToKeypoints({
        x: v[0],
        dir: v[1] as 1 | -1,
        lean: v[2],
        ra: [v[3], v[4]],
        la: [v[5], v[6]],
        stride: v[7],
      }),
    })),
  };
}

/** Human labels for the model's feature names (model/REPORT.md §4.1). */
export const FEATURE_LABEL: Record<
  string,
  { label: string; note: string; max: number; unit?: string }
> = {
  close_motion: {
    label: "CLOSE MOTION",
    note: "Body motion while the pair is close",
    max: 1,
  },
  pair_motion_energy: {
    label: "PAIR MOTION ENERGY",
    note: "Top signal: 35% of model gain",
    max: 1,
  },
  max_wrist_speed: {
    label: "WRIST SPEED",
    note: "Fastest wrist, torso-lengths per second",
    max: 6,
    unit: " TL/s",
  },
  max_wrist_accel: {
    label: "WRIST ACCEL",
    note: "Fastest wrist acceleration",
    max: 20,
    unit: " TL/s²",
  },
  wrist_peaks_per_s: {
    label: "WRIST PEAKS",
    note: "Fast wrist swings per second",
    max: 4,
    unit: " /s",
  },
  wrist_toward_speed: {
    label: "WRIST TOWARD",
    note: "Wrist speed toward the other person",
    max: 6,
    unit: " TL/s",
  },
  pair_dist_var: {
    label: "DISTANCE VARIANCE",
    note: "How much the pair distance changes",
    max: 1,
  },
  min_torso_dist: {
    label: "MIN DISTANCE",
    note: "Closest the pair got, torso-lengths",
    max: 3,
    unit: " TL",
  },
  closing_speed: {
    label: "CLOSING SPEED",
    note: "How fast the pair closed in",
    max: 4,
    unit: " TL/s",
  },
  max_arm_extension: {
    label: "ARM EXTENSION",
    note: "Fullest arm reach, torso-lengths",
    max: 1.2,
    unit: " TL",
  },
  risk_score: {
    label: "RISK SCORE",
    note: "Model score for this window",
    max: 1,
  },
  people_close: {
    label: "PEOPLE CLOSE",
    note: "People within 3 torso-lengths",
    max: 6,
  },
};
