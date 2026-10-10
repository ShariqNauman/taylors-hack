import type { Keypoint, PoseFrame } from "./types";

/** Linear blend between two pose frames, matching people by id. Unmatched people come from `b`. */
export function lerpFrame(
  a: PoseFrame | undefined,
  b: PoseFrame | undefined,
  k: number,
): PoseFrame | undefined {
  if (!b) return a;
  if (!a || k >= 1) return b;
  if (k <= 0) return a;
  const byId = new Map(a.people.map((p) => [p.id, p]));
  return {
    t: b.t,
    people: b.people.map((p) => {
      const q = byId.get(p.id);
      if (!q || q.kp.length !== p.kp.length) return p;
      return {
        id: p.id,
        kp: p.kp.map((pt, i): Keypoint => {
          const o = q.kp[i];
          if (o[2] < 0.3 || pt[2] < 0.3) return pt;
          return [o[0] + (pt[0] - o[0]) * k, o[1] + (pt[1] - o[1]) * k, pt[2]];
        }),
      };
    }),
  };
}

/** Fastest-wrist positions of person 0 across frames (for the dashed trail). */
export function wristTrail(
  frames: (PoseFrame | undefined)[],
): [number, number][] {
  const out: [number, number][] = [];
  for (const f of frames) {
    const kp = f?.people[0]?.kp;
    if (!kp) continue;
    const w = kp[5]?.[2] >= 0.3 ? kp[5] : kp[4];
    if (w && w[2] >= 0.3) out.push([w[0], w[1]]);
  }
  return out;
}
