// source: model/REPORT.md v3 (Part A, "multi-dataset model on v2 keypoints", trained 10 Oct 2026).
// Figures here are NOT in the GET /proof contract. Each one cites its section.
// Never add a number to this file without a section reference.

export const MODEL_REPORT = {
  version: "v3",
  /** A7.2: all datasets, out-of-fold (shipped model). */
  allDatasetsAuc: { value: 0.857, clips: 3131, ref: "A7.2" },
  /** A7.4 chosen live setting (alpha 0.6 / TENSE 0.5 / FIGHT 0.75 / 1.0 s), replayed on all clips. */
  liveLogicViolent: { value: 0.6, ref: "A7.4" },
  liveLogicNonViolent: { value: 0.09, ref: "A7.4" },
  liveLogicHugs: { value: 0.14, ref: "A7.4" },
  liveLogicWeapon: { value: 0.36, ref: "A7.4" },
  /** A7.8: CCTV out-of-fold with CCTV in training (shipped model). */
  cctvInTrainingAuc: { value: 0.745, ref: "A7.8" },
  /** A7.7: pipeline check on a training clip (proves the pipeline, not accuracy). */
  pipelineCheck: { tenseAtS: 4.8, fightAtS: 10.5, ref: "A7.7" },
  /** A4: webcam pose fps, yolo26n-pose at 640×480. */
  poseFps: { value: 76, ref: "A4" },
  /** A7.6 importance (share of gain). */
  featureGain: [
    { name: "pair_motion_energy", share: 0.349, label: "35%" },
    { name: "max_wrist_speed", share: 0.1, label: "10%" },
    { name: "min_torso_dist", share: 0.091, label: "9%" },
    { name: "wrist_toward_speed", share: 0.084, label: "8%" },
    { name: "pair_dist_var", share: 0.079, label: "8%" },
    { name: "each of the other 5", share: 0.059, label: "4–8%" },
  ],
  /** Example clips for the inspector. Keypoints are exported by Model B to /proof-clips/<id>.json. */
  clips: [
    {
      id: "airtlab-fight",
      name: "Fight caught · AIRTLab",
      tag: "CAUGHT",
      truth: "Fight",
      model: "Tense at 4.8 s, fight at 10.5 s",
      verdict: "FIGHT AT 10.5 S",
      why: "Pipeline check on a 14.5 s AIRTLab fight. The clip was in training, so this proves the pipeline works, not its accuracy.",
      ref: "A7.7",
    },
    {
      id: "hug",
      name: "Hugs and claps",
      tag: "14% FLAGGED",
      truth: "Not a fight",
      model: "14% of AIRTLab hugs and claps reach fight",
      verdict: "SOMETIMES FIGHT",
      why: "A close, moving hug still looks like a close scuffle to the model. Hugs need better features, not just more data.",
      ref: "A7.3, A7.4",
    },
    {
      id: "calm",
      name: "Calm clip",
      tag: "9% FLAGGED",
      truth: "Not a fight",
      model: "9% of non-violent clips reach fight",
      verdict: "CALM",
      why: "With the live thresholds replayed on all 3,131 clips, about one calm clip in eleven still triggers fight. Tense stays silent, so most of it never reaches a person.",
      ref: "A7.4",
    },
    {
      id: "weapon",
      name: "CCTV weapon",
      tag: "36% CAUGHT",
      truth: "Violent (weapon)",
      model: "36% of weapon clips reach fight",
      verdict: "OFTEN MISSED",
      why: "Weapons are not detected as objects; only body motion is scored. On CCTV angles most weapon clips stay below the alarm.",
      ref: "A7.4, A7.5",
    },
    {
      id: "own",
      name: "Our own room",
      tag: "NOT TESTED",
      truth: "—",
      model: "Not tested",
      verdict: "NOT TESTED",
      why: "No labelled webcam session yet. That session is the only real measure of hug false alarms and false alarms per minute in our room.",
      ref: "A7.9",
    },
  ],
} as const;
