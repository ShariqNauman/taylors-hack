// source: model/REPORT.md, Part V5 (the live model: v5 half-body ensemble, 10 Oct 2026).
// Figures here are NOT in the GET /proof contract. Each one cites its section.
// Never add a number to this file without a section reference.

export interface TechRow {
  test: string;
  means: string;
  caught: string | null; // null with `missing` = not measured / not tested
  flagged: string | null;
  missing?: "not measured yet" | "not tested";
  ref: string;
}

export const MODEL_REPORT = {
  version: "v5",
  /** V5.3 / V5.5: strict preset (the default), full-body hold-out clips. */
  holdout: {
    clips: 470,
    caught: 0.645,
    calmFlagged: 0.052,
    auc: 0.917,
    ref: "V5.3",
  },
  /** V5.3: AIRTLab hugs and claps reaching FIGHT. */
  hugsFlagged: { value: 0.111, of: "2 of 18", ref: "V5.3" },
  /** V5.5 presets. */
  sensitive: { caught: 0.756, calmFlagged: 0.095, ref: "V5.5" },
  /** V5.3: framings. */
  waistUp: { caught: 0.649, calmFlagged: 0.043, ref: "V5.3" },
  /** A0.1 and proof.json disclosure: the earlier model trained without any CCTV. */
  cctvPureAuc: { value: 0.709, ref: "A0.1, A7.8" },
  /** A0.3: the alarm needs the score to hold this long. */
  holdS: { value: 1, ref: "A0.3" },
} as const;

/** The model card, in plain words, for the folded technical section. */
export const MODEL_CARD: { k: string; v: string; ref: string }[] = [
  {
    k: "POSE",
    v: "YOLO26n-pose with ByteTrack. 17 points per person; the nose, eyes and ears are used only as head position. No face images, no video stored.",
    ref: "A0.3, proof.json",
  },
  {
    k: "CLASSIFIER",
    v: "The average of two models: LightGBM on 24 movement features and a small 1D-CNN over the pair's keypoints. Scored every 0.5 s over the last 2 s.",
    ref: "A0.2, A0.3",
  },
  {
    k: "TEST",
    v: "470 clips (15% of video groups) locked away from all tuning. This is the second look at them: the previous model was scored on them once before.",
    ref: "A0.2, V5.3",
  },
  {
    k: "DATA",
    v: "AIRTLab, RLVS, Surveillance Camera Fight and SCVD, plus waist-up and chest-up copies of every clip. RWF-2000 was withdrawn and is not used.",
    ref: "A0.1, V5.2",
  },
  {
    k: "LIVE LEVELS",
    v: "Tense at 0.5. Fight when the smoothed score stays at 0.656 or more for 1 s with two people tracked. A 'sensitive' preset at 0.541 catches more fights and raises more false alarms.",
    ref: "A0.3, V5.5",
  },
  {
    k: "ONE PERSON",
    v: "A window with only one tracked person can't reach Fight. That costs 1.7% of fight clips, and stops one person alone from raising an alarm.",
    ref: "V5.2",
  },
];

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Technical rows that are not in GET /proof. The phone-video and CCTV rows come from /proof. */
export const TECH_ROWS: TechRow[] = [
  {
    test: "Public fight videos, held out (470 clips, full body)",
    means: "Videos it never trained on, at the live threshold",
    caught: pct(MODEL_REPORT.holdout.caught),
    flagged: pct(MODEL_REPORT.holdout.calmFlagged),
    ref: "V5.3",
  },
  {
    test: "Same videos, waist-up only",
    means: "As if the camera cuts people off at the waist",
    caught: pct(MODEL_REPORT.waistUp.caught),
    flagged: pct(MODEL_REPORT.waistUp.calmFlagged),
    ref: "V5.3",
  },
  {
    test: "Same videos, 'sensitive' preset",
    means: "Lower threshold: more fights caught, more false alarms",
    caught: pct(MODEL_REPORT.sensitive.caught),
    flagged: pct(MODEL_REPORT.sensitive.calmFlagged),
    ref: "V5.5",
  },
  {
    test: "Hugs and claps (AIRTLab)",
    means: "Close, friendly contact that should stay calm",
    caught: null,
    flagged: `${pct(MODEL_REPORT.hugsFlagged.value)} (${MODEL_REPORT.hugsFlagged.of})`,
    ref: "V5.3",
  },
];

export const TECH_ROWS_MISSING: TechRow[] = [
  {
    test: "Staged fights on our own cameras",
    means: "Our recorded clips, timed and scored",
    caught: null,
    flagged: null,
    missing: "not measured yet",
    ref: "V5.4",
  },
  {
    test: "Night or infrared",
    means: "Real IR frames through the pose model",
    caught: null,
    flagged: null,
    missing: "not tested",
    ref: "proof.json ir_check",
  },
];
