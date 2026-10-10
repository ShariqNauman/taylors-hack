# EarlyEye — Model Report (v2: new features + tuned LightGBM)

Fight detection from video using body keypoints (no faces). Model only, no backend or website.
Reproduce with `train.py` (comparison table), `analyze_model.py` (diagnostics), `tune_live.py --rlvs` (live thresholds), `benchmark_pose.py` (speed).

---

## 1. Verdict

**The model improved measurably, but it is still a moderate detector, and live performance on the webcam is unmeasured.**

- **Clip ROC-AUC:** 0.850 → **0.876** on 600 held-out RLVS clips.
- **Fights caught at about 20% false alarms:** 79% → **82%**.
- The improvement is more *trustworthy* than the headline number suggests:
  - **Resolution:** the model now works equally well at every video resolution. HD clips improved from 0.770 to 0.888, and the webcam-like 241–480p band reaches 0.902.
  - **Missing data:** "missing data = calm" has almost disappeared as a shortcut (AUC 0.613 → 0.530).
- **It still misses obvious fights.** Fight clip V_1 scores at most 0.39: the new model relies on whole-body motion of the active pair, and in V_1 mostly arms move. The old model caught it.
- **No own clips were recorded** (and none are planned), so there is no hug-vs-fight evidence.
- **Live thresholds were tuned in simulation.** All 600 RLVS clips' out-of-fold scores were replayed through the exact live logic (`tune_live.py --rlvs`). In that replay FIGHT fires on **75.7% of fight clips and 13.7% of calm clips**. That's 5 s YouTube clips, not the webcam.

---

## 2. What changed in v2

| Area | Change |
|---|---|
| Cleanup | Random forest removed (LightGBM only). `person_count` removed (it was a dataset artifact). Mirrored copies dropped: every feature is left-right symmetric, so mirrors were exact duplicates. |
| Pair features | Torso keypoint confidence 0.5 → 0.3. Falls back to the centre of the keypoint bounding box when shoulders and hips are missing. Uses the **active pair** (the two people seen together whose wrists move fastest) instead of whoever stands closest. |
| New 2 s features | `wrist_peaks_per_s`, `wrist_toward_speed`, `pair_motion_energy`, `close_motion`, `pair_dist_var` (the 1 s features are kept) |
| Windows | One every 0.5 s; the 1 s features use the last 1 s and the 2 s features the last 2 s |
| Own data | `record_clips.py` records labelled 5 s clips to `data/own/violent` and `data/own/nonviolent`; each clip is its own group with 3× sample weight (pipeline tested, no clips recorded) |
| LightGBM tuning | 20-setting random search over num_leaves, learning_rate, n_estimators, min_child_samples (GroupKFold by video, chosen by clip ROC-AUC). Runs in about 1 minute. |
| Live threshold tuning | `tune_live.py --rlvs` replays out-of-fold RLVS scores through the live logic (304 settings) |
| Live | 2 s windows resampled to 10 fps. Label box always visible top-right (grey NORMAL / red FIGHT / blue HUG). Label changes printed in the terminal; per-label summary when the session ends. |

**Bounding-box note:** the fallback box is built from the keypoints (all 12 body joints with confidence ≥ 0.3), not YOLO's detection box. The keypoint CSVs don't store boxes, and re-extracting 600 videos wasn't worth it.

---

## 3. Comparison table

5-fold GroupKFold by video, same folds for every row. Clip score = highest window score in the clip. Scored on the 600 RLVS clips.

| Variant | Clip ROC-AUC | Fights caught at ~20% false alarms | Own fight clips | Own hug clips |
|---|---|---|---|---|
| Old 600 model (6 old features) | 0.850 | 79% (FA 19%) | — | — |
| New features | 0.868 | 82% (FA 20%) | — | — |
| New features + own clips | not available (no own clips) | — | — | — |
| **Tuned (saved)** | **0.876** | **82% (FA 20%)** | — | — |

- "Tuned" picks the best of 20 settings on the same folds, so 0.876 is slightly optimistic. The honest gain from features alone is +0.018.
- The tuned model was saved because it beats the old model. The old one is backed up as `violence_model_600.joblib` (it needs the old `features.py`, which was replaced).

---

## 4. Diagnostics (`analyze_model.py`)

### 4.1 Single features (window AUC when present, missing rate)
| Feature | Window | AUC | Missing (calm / fight) |
|---|---|---|---|
| close_motion | 2 s | **0.866** | 77% / 60% |
| pair_motion_energy | 2 s | **0.827** | 52% / 24% |
| max_wrist_speed | 1 s | 0.743 | 18% / 10% |
| max_wrist_accel | 1 s | 0.719 | 22% / 16% |
| pair_dist_var | 2 s | 0.719 | 54% / 26% |
| wrist_toward_speed | 2 s | 0.644 | 53% / 26% |
| wrist_peaks_per_s | 2 s | 0.615 | 8% / 1% |
| max_arm_extension | 1 s | 0.550 | 69% / 50% |
| closing_speed | 1 s | 0.527 | 65% / 57% |
| min_torso_dist | 1 s | 0.520 | 58% / 38% |

- **The new 2 s motion features are the strongest signals.** Whole-body motion while close (`close_motion`) separates best, as intended (hugs still, fights chaotic). It's only available when a pair is close, though.
- **Distance-based features are still weak** (0.52–0.55), even with the active pair.
- **Pair features are still missing 24–77% of the time**, often because only one person is tracked.

### 4.2 Resolution bands (clip AUC)
| Band | Calm / fight clips | Old model | New model |
|---|---|---|---|
| ≤240p | 226 / 71 | 0.866 | 0.880 |
| 241–480p (webcam range) | 38 / 107 | 0.859 | **0.902** |
| >480p | 36 / 122 | 0.770 | **0.888** |

### 4.3 Ablations (clip AUC)
| Variant | Clip AUC |
|---|---|
| All 10 features (tuned) | 0.876 |
| Without pair_motion_energy | 0.865 |
| 2 s features only | 0.848 |
| 1 s features only | 0.805 |
| Rules mode (`predict.py`) | 0.777 |
| Wrist speed + accel only | 0.715 |

**Rules mode got weaker** (0.807 → 0.777). Wrist speeds are now computed for more people (lower torso confidence plus box fallback), which adds noise to the simple rule. It's still usable as a fallback, but not better than before.

### 4.4 Learning curve
120 → 240 → 360 → 480 training clips per fold gives clip AUC 0.864 → 0.857 → 0.872 → 0.876. It's flat and noisy, so more RLVS clips won't help much. Different data (own clips, CCTV) is what's missing.

### 4.5 Shortcut check
Video height alone still predicts the label with window AUC 0.77 (that's the dataset). The model's scores correlate with height at only 0.22.

---

## 5. Live detector

### 5.1 Live vs offline consistency
Fight clip V_1 was processed by both the live pipeline (threaded, OpenVINO on the Intel GPU, resampled to 10 fps) and the offline training pipeline. The features matched closely (e.g. pair_motion_energy 0.27–0.70 live vs 0.26–0.80 offline), so there is no train/live mismatch. Both give V_1 low scores, so that miss is a model weakness, not a bug.

### 5.2 Threshold tuning without a labelled session (`tune_live.py --rlvs`)
No labelled webcam session exists, so the thresholds were tuned on the training clips:

- Out-of-fold window scores (GroupKFold, so each clip is scored by a model that never saw it) for all 600 RLVS clips are replayed through the exact live logic: smoothing, `MIN_DURATION`, `FIGHT_HOLD`.
- 304 settings were tried. Rule: catch the most fight clips while at most 15% of calm clips reach FIGHT.

| Setting (alpha / TENSE / FIGHT / duration) | Fight clips → FIGHT | Calm clips → FIGHT | Calm time in TENSE or FIGHT | Mean delay |
|---|---|---|---|---|
| 0.5 / 0.55 / 0.7 / 1.5 (old, tuned for the old model) | 52% | 7% | — | — |
| 0.5 / 0.35 / 0.5 / 1.5 (previous) | 74% | 14% | — | — |
| 0.6 / 0.4 / 0.5 / 1.5 (top raw pick) | 77.7% | 14.7% | 30.2% | 2.0 s |
| **0.4 / 0.5 / 0.55 / 1.0 (chosen)** | **75.7%** | **13.7%** | **14.6%** | **2.1 s** |

The top raw pick catches 2 points more fights but shows TENSE during 30% of calm time, which would look jumpy in a demo. The chosen setting halves that for 2 points less recall.

**Limits of this tuning:**
- RLVS clips are about 5 s long and continuous webcam footage is not, so the real live false-alarm rate per minute is unknown.
- Thresholds were chosen on the same clips they are measured on, so the numbers are slightly optimistic.
- A smoke test on clip V_71, which was part of training, reached FIGHT about 2 s in. That confirms the pipeline works, not its accuracy.

### 5.3 Current live parameters
| Parameter | Value |
|---|---|
| Pose | YOLO26n-pose, OpenVINO on Intel GPU (CPU fallback), imgsz 640, about 65 pose fps |
| Camera | 640×480 @ 30 fps |
| Features | last 2 s resampled to 10 fps, scored every 0.5 s |
| `SMOOTH_ALPHA` | 0.4 |
| `TENSE_AT` | 0.5 |
| `FIGHT_AT` | 0.55 |
| `MIN_DURATION` | 1.0 s |
| `FIGHT_HOLD` | 2.0 s |

---

## 6. All model parameters

| Stage | Parameters |
|---|---|
| Data | RLVS, 300 violent + 300 non-violent (seed 42); own clips: none |
| Extraction | `yolo26n-pose.pt` (PyTorch, CPU), imgsz 640, 10 fps, first 30 s, detection confidence 0.25, ByteTrack, 12 body keypoints |
| Features | `MIN_CONF` 0.5 (motion joints), `TORSO_MIN_CONF` 0.3, `BBOX_TO_TORSO` 0.37, `MAX_GAP_S` 0.25, `MIN_PAIR_FRAMES` 3, `MIN_PAIR_SPAN_S` 0.3, `ARM_PAIR_MAX_DIST` 3.0, `PEAK_MIN_SPEED` 3.0, `CLOSE_DIST` 1.5, windows 1 s and 2 s |
| Training | windows every 0.5 s, 5-fold GroupKFold by video, clip = max window |
| LightGBM (tuned) | **num_leaves 15, learning_rate 0.02, n_estimators 400, min_child_samples 50**, subsample 0.8, colsample 0.8 |
| Tuning grid | num_leaves {7, 15, 31, 63}, learning_rate {0.02, 0.05, 0.1}, n_estimators {100, 200, 400, 800}, min_child_samples {10, 20, 50, 100}; 20 settings |
| Importance (gain) | pair_motion_energy 47%, max_wrist_speed 13%, wrist_peaks_per_s 7%, max_wrist_accel 6%, others 3–5% each |
| Live thresholds | alpha 0.4, TENSE 0.5, FIGHT 0.55, duration 1.0 s, hold 2.0 s (from `tune_live.py --rlvs`) |

---

## 7. Honest weaknesses

1. **One feature dominates** (pair_motion_energy, 47% of gain). Fights with mostly arm motion, like V_1, get missed.
2. **Pair features are often missing** because tracking finds only one person or IDs break up.
3. **No own or CCTV data.** All numbers are on YouTube-style RLVS clips, and there is no hug-vs-fight evidence.
4. **Live thresholds are tuned on RLVS clips in simulation**, not on webcam footage. Expect a different false-alarm rate live.
5. **The tuned AUC is slightly optimistic** (best of 20 on the same folds).

## 8. Status and how to check it

Training and tuning are final for the current data (no more recording planned):
- Model: `violence_model.joblib` (tuned LightGBM, 10 features, 600 RLVS clips)
- Live thresholds: `live_detector.py` (tuned with `tune_live.py --rlvs`)

To check:
```
venv\Scripts\python train.py                 # comparison table (about 1 min)
venv\Scripts\python analyze_model.py         # diagnostics
venv\Scripts\python tune_live.py --rlvs      # threshold replay (add --apply to write the best)
venv\Scripts\python live_detector.py         # webcam demo
```
If own clips are ever recorded, `record_clips.py`, then `list_videos.py`, `extract_keypoints.py --per-class 300` and `train.py` add them automatically.
