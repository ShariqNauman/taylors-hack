// source: model/REPORT.md v2 (EarlyEye Model Report, "v2: new features + tuned LightGBM").
// Figures here are NOT in the GET /proof contract. Each one cites its section.
// Never add a number to this file without a section reference.

export const MODEL_REPORT = {
  version: "v2",
  /** §5.2 chosen setting: fight clips that reach FIGHT after smoothing + hold. */
  liveLogicFightClips: { value: 0.757, ref: "§5.2" },
  /** §5.2 chosen setting: calm clips that reach FIGHT. */
  liveLogicCalmClips: { value: 0.137, ref: "§5.2" },
  /** §5.2 chosen setting: mean delay to FIGHT after a fight starts. */
  meanDelayToFightS: { value: 2.1, ref: "§5.2" },
  /** §4.2 clip AUC, 241–480p band (webcam range). */
  webcamBandAuc: { value: 0.902, ref: "§4.2" },
  /** §3 fights caught at about 20% false alarms. */
  falseAlarmAtRecall: { value: 0.2, ref: "§3" },
  /** §5.3 pose throughput. */
  poseFps: { value: 65, ref: "§5.3" },
  /** §6 importance (gain). */
  featureGain: [
    { name: "pair_motion_energy", share: 0.47, label: "47%" },
    { name: "max_wrist_speed", share: 0.13, label: "13%" },
    { name: "wrist_peaks_per_s", share: 0.07, label: "7%" },
    { name: "max_wrist_accel", share: 0.06, label: "6%" },
    { name: "each of the other 6", share: 0.04, label: "3–5%" },
  ],
  /** §1, §5.2, §7 example clips for the inspector. Keypoints are exported by Model B to /proof-clips/<id>.json. */
  clips: [
    {
      id: "V_71",
      name: "Fight caught · V_71",
      tag: "CAUGHT",
      truth: "Fight",
      model: "Fight, about 2 s in",
      verdict: "FIGHT AT ~2 S",
      why: "Smoke test of the full live pipeline. V_71 was in training, so this proves the pipeline works, not its accuracy.",
      ref: "§5.2",
    },
    {
      id: "V_1",
      name: "Fight missed · V_1",
      tag: "MISSED",
      truth: "Fight",
      model: "Missed, peak 0.39",
      verdict: "MAX SCORE 0.39",
      why: "Mostly arms move while the bodies stay still. The model leans on whole-body motion, so it misses this kind of fight.",
      ref: "§1, §7",
    },
    {
      id: "calm",
      name: "Calm clip",
      tag: "13.7% FLAGGED",
      truth: "Not a fight",
      model: "Calm here; 13.7% of calm clips still reach fight",
      verdict: "CALM",
      why: "In the live-logic replay, about one calm clip in seven still triggers fight. The two-tier alert keeps most of that silent.",
      ref: "§5.2",
    },
    {
      id: "hug",
      name: "Hug",
      tag: "NOT TESTED",
      truth: "Not a fight",
      model: "Not tested",
      verdict: "NOT TESTED",
      why: "No own clips were recorded, so there is no hug-against-fight evidence yet. This is the clip judges will ask about.",
      ref: "§1",
    },
    {
      id: "cctv",
      name: "CCTV angle",
      tag: "NOT TESTED",
      truth: "Fight",
      model: "Not tested",
      verdict: "NOT TESTED",
      why: "All training and test clips are YouTube-style RLVS. A high, wide CCTV angle has not been tried.",
      ref: "§7",
    },
  ],
} as const;
