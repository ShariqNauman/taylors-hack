# EarlyEye — Model Report

Fight detection from video using body keypoints (no faces). Model only, no backend or website.

- **Part A** (below): v3, multi-dataset model on v2 keypoints. **Current model.**
- **Part B** (further down): the previous model (RLVS only, v1 keypoints), kept for comparison.

---

# Part A — v3: multi-dataset model on v2 keypoints (trained 10 Oct 2026; webcam tuning still to do)

Branch: `model-dev`. Nothing in Part A is committed yet.

**Files set aside (10 Oct):** these are no longer used by the v3 pipeline.

- **Restore from git** with `git checkout main -- <file>`:
  - `extract_keypoints.py` (the v1 extractor)
  - `analyze_model.py` (broken by the `train.py` rewrite)
  - `benchmark_pose.py`
  - `record_clips.py`
- **Not in git**, kept outside the repo:
  - `compare_pose.py`, which produced the A4 table
  - `videos_v1_rlvs.csv`
  - the yolo26s weights

## A1. Goal

Train LightGBM on four datasets instead of RLVS alone, using higher-quality keypoints. Two models are planned:

1. **First model:** AIRTLab + SCF + SCVD, so a working model exists early.
2. **Final model:** the same plus all of RLVS.

Questions the report must answer:

- What is the clip ROC-AUC, overall and per dataset?
- If the model never sees AIRTLab, how many of AIRTLab's hug/clap clips go over FIGHT_AT? This is the hug false-alarm test.
- Is the new model better than the old one (`violence_model_backup_v1.joblib`)? Keep whichever is better.

## A2. Status

| Step | Status |
|---|---|
| Dataset list (`list_videos.py` → `videos.csv`) | ✅ done: 3,131 clips |
| Pose model choice (yolo26n vs yolo26s) | ✅ done: **yolo26n-pose** |
| v2 extractor (`extract_keypoints_v2.py`) | ✅ written and tested |
| v2 extraction: all 3,131 clips | ✅ done, 0 real failures. AIRTLab and SCF (and 315 SCVD clips) ran on the laptop's Intel GPU; RLVS and the last 166 SCVD clips ran on the RTX 5090 server (4 processes in parallel) |
| `features.py`, `train.py`, `live_detector.py` for v2 | ✅ updated |
| Quick demo model (AIRTLab + SCF + 60% of SCVD, default settings) | ✅ used for the mentor demo, then replaced |
| **Final v3 model (all 4 datasets, tuned)** | ✅ **saved as `violence_model.joblib`** (beats the old model, see A7) |
| Live thresholds re-tuned for v3 | ✅ alpha 0.6, TENSE 0.5, FIGHT 0.75, duration 1.0 (see A7.4) |
| Live re-check | ✅ pipeline works (A7.6); not yet tested on our own webcam footage |
| `.gitignore` | ✅ `keypoints_v2/`, logs, archives and caches ignored |
| CCTV-domain row + `proof.json` for `GET /proof` | ✅ written by `train.py` (A7.8) |
| Commit to `model-dev` | ⬜ not done yet (`main` has 19 newer commits to merge first; only `.gitignore` overlaps) |
| Labelled webcam session + `tune_live.py` | ⬜ to do; the only real-world test of the thresholds |

## A3. Data (`videos.csv`)

| Dataset | Domain | Label 0 | Label 1 | Total | Groups | Sample weight |
|---|---|---|---|---|---|---|
| AIRTLab | acted | 120 (hugs, claps, high-fives…) | 230 (acted fights) | 350 | 175 | 3x |
| SCF (Surveillance Camera Fight) | CCTV | 150 | 150 | 300 | 300 | 2x |
| SCVD | CCTV | 246 | 235 (111 fight + 124 weapon) | 481 | 481 | 2x |
| RLVS | YouTube | 1,000 | 1,000 | 2,000 | 2,000 | 1x |

- **Labels:** 1 = violent (a fight or a weapon), 0 = not violent.
  - AIRTLab's `joking_violent` folder is AIRTLab's official "violent" class (acted fights), so it is label 1.
  - Its `non-violent` folder is label 0.
- **`kind` column:** `fight`, `weapon`, `normal` or `acted_nonviolent`. Results are reported per kind, so weapon clips and hug/clap clips get their own numbers.
- **The `cctv/` folder holds two datasets:**
  - SCF: `fi*` / `nofi*` `.mp4`
  - SCVD: `v*`, `n*`, `t_v*` and `t_n*` `.avi`; the `t_` files are SCVD's own test split.
  - `weaponizeViolence/` (`w*`, `t_w*`) is SCVD's weapon class.
- **Groups (GroupKFold):** AIRTLab's cam1 and cam2 views of one scene share a group. Every other clip is its own group.
- **⚠ Possible leakage:**
  - SCF, SCVD and RLVS may cut several clips from the same source video. The file names don't show which clips belong together, so such clips can land in both training and test.
  - That can make within-dataset AUC look a little better than it really is.
  - The leave-one-dataset-out results are not affected, because a whole dataset is held out.
- HMDB51 was skipped.
- The previous RLVS-only list is kept as `videos_v1_rlvs.csv`.

## A4. Pose model choice

Compared on 20 random RLVS clips (10 violent, 10 non-violent) with the v2 settings, using OpenVINO on the Intel GPU at imgsz 640 (`compare_pose.py`):

| | yolo26n-pose | yolo26s-pose |
|---|---|---|
| Extraction fps | **72.0** | 54.2 |
| Frames with ≥1 person | 83.8% | 85.4% |
| Keypoints with conf ≥ 0.5 (all / wrists / hips) | 61.0 / 65.7 / 78.0% | 59.8 / 64.5 / 78.1% |
| People per frame | 1.80 | 1.81 |
| Track IDs per clip | 9.0 | 8.0 |
| Webcam pose fps (640×480) | **75.9** | 57.7 |

**Decision: yolo26n-pose for both extraction and live.**

- yolo26s detects people in slightly more frames and has one fewer track ID per clip.
- Its keypoint confidence is no better, and it is 25–30% slower.
- 9 track IDs per clip for about 1.8 people means IDs still switch. This is why features score the "active pair" instead of trusting IDs.

## A5. Extraction v2 (`extract_keypoints_v2.py` → `keypoints_v2/`)

| Setting | v1 (old `keypoints/`) | v2 |
|---|---|---|
| Frames | 10 fps sample | every frame at the native fps, capped at 30 |
| Timestamps | frame / fps | frame / fps, checked on 40 clips: matches OpenCV's own timestamps exactly (all clips are constant frame rate; RLVS ranges from 11 to 37 fps) |
| Keypoints | 12 body (face dropped) | all 17 COCO, face included (features still use only the 12 body joints) |
| Boxes | none | YOLO box x1, y1, x2, y2 and box confidence |
| Tracker | ByteTrack, buffer 30 | ByteTrack, **buffer 60** (`bytetrack_v2.yaml`) |
| Backend | PyTorch CPU | OpenVINO on the Intel GPU (laptop); PyTorch CUDA (GPU server) |
| Output path | `keypoints/<dataset>/<name>.csv` | `keypoints_v2/<same folders as data/>/<name>.csv`. AIRTLab names files `1.mp4`… in every folder, so the old flat naming would overwrite them. |

- **Resumable:** finished videos are skipped, and each CSV is written to a temporary file and then renamed.
- **Failures** are logged to `failed_videos_v2.txt`.
- **Speed on the laptop:** about 34 frames/s on AIRTLab, whose HD video is slow to decode, and about 72 frames/s on low-resolution clips.
- **GPU server:** RTX 5090, PyTorch 2.14.1 with CUDA 13.0, ultralytics 8.4.175 (the same version as on the laptop). It runs PyTorch on CUDA, not OpenVINO, so its keypoints may differ very slightly from laptop runs.

## A6. Feature and training changes

**`features.py`**

- **`window_features(kp, t_end)`** is now the single entry point for training and live. It keeps the frames nearest a `FEATURE_FPS = 10` grid over the last 2 s, then computes the features. Both sides therefore see 10 fps, whatever the source frame rate.
- **Same 10 features as Part B**, with no `person_count`:
  - `max_wrist_speed`, `max_wrist_accel`, `min_torso_dist`, `closing_speed`, `max_arm_extension`
  - `wrist_peaks_per_s`, `wrist_toward_speed`, `pair_motion_energy`, `close_motion`, `pair_dist_var`
- **Fallback when shoulders or hips are missing:** use YOLO's bounding box. Its centre gives the position, and its height × `BOX_TO_TORSO` gives the torso scale.
  - `BOX_TO_TORSO = 0.30` was measured on v2 data: median torso / box height = 0.298, IQR 0.28–0.33, over 6,360 person-frames.
  - v1 files without boxes still use the keypoint-box fallback.

**`train.py`** (rewritten for v2)

- **Windows:** one every 0.5 s, using only frames up to the window end (live can't see the future). Features are cached per video in `windows_v2.csv`, so adding RLVS only computes the new clips.
- **Sample weights:** AIRTLab 3x, SCF 2x, SCVD 2x, RLVS 1x.
- **Cross-validation:** 5-fold GroupKFold by `group_id`, plus a 12-setting LightGBM random search.
- **Report:**
  - out-of-fold clip AUC, overall and per dataset
  - clips over FIGHT_AT per dataset and kind, two ways: the raw peak window score, and whether the live logic (smoothing + MIN_DURATION) shows FIGHT
  - leave-one-dataset-out for every dataset
  - the old model scored on the same windows
- **Output:** the new model is saved only if it beats the old one. Metrics go to `metrics_v2.json`.

**`live_detector.py`**

- Uses `bytetrack_v2.yaml` and adds boxes to each row.
- Uses `features.window_features`, so its resampling is identical to training.
- The pose model is still yolo26n.

## A7. Results (final v3 model, 10 Oct 2026)

Run with `python train.py` (2.1 min); full numbers are in `metrics_v2.json`.

- **Data:** 3,131 clips, 25,748 windows (57% fight).
- **Best LightGBM** (12 settings tried): num_leaves 31, learning_rate 0.02, n_estimators 800, min_child_samples 20.
- **How scores are computed:** every number below comes from clips the model did not train on. Either GroupKFold out-of-fold, or the whole dataset held out.

### A7.1 Verdict

- **The v3 model is better than the old one** (clip AUC 0.857 vs 0.841 overall) and is now `violence_model.joblib`. The gain is clearest on data the old model never saw:
  - AIRTLab: 0.830 vs 0.662
  - SCF: 0.791 vs 0.773
- **On RLVS the two are equal** (0.896 vs 0.899). The old model's RLVS number is flattered, because it trained on 600 of those clips.
- **Hugs are still the weak spot.** With AIRTLab hugs/claps in training, about 14% of them still reach FIGHT at the tuned thresholds (A7.4).
- **CCTV is the hardest domain.** SCVD AUC is 0.72, and only about 36% of weapon clips reach FIGHT.

### A7.2 Clip ROC-AUC (clip score = highest window score)

| Dataset | New, out-of-fold | New, dataset held out | Old model |
|---|---|---|---|
| **All** | **0.857** | — | 0.841 |
| AIRTLab | 0.830 | 0.725 | 0.662 |
| RLVS | 0.896 | 0.829 | 0.899 (partly in-sample) |
| SCF | 0.791 | 0.795 | 0.773 |
| SCVD | 0.721 | 0.667 | 0.715 |

- **Out-of-fold vs held out:** "held out" means trained on the other three datasets only. It is the fairer test of how the model handles a new kind of footage (domain shift).
- **AIRTLab:** adding it to training raised its AUC from 0.725 to 0.830.
- **The tuned AUC is slightly optimistic,** since it is the best of 12 settings scored on the same folds.

### A7.3 Leave-one-dataset-out: AIRTLab hugs/claps

Live logic: alpha 0.4, TENSE 0.5, FIGHT 0.7, duration 1.0. These were the demo thresholds in effect when `train.py` ran; the re-tuned setting is in A7.4.

| Model | AIRTLab hugs/claps: peak ≥ FIGHT_AT | AIRTLab hugs/claps: live FIGHT | AIRTLab fights: live FIGHT |
|---|---|---|---|
| New, **trained without AIRTLab** | 77/120 (64%) | **20/120 (17%)** | 98/230 (43%) |
| New, with AIRTLab (out-of-fold) | 80/120 (67%) | 21/120 (18%) | 143/230 (62%) |
| Old model | 73/120 (61%) | 17/120 (14%) | 67/230 (29%) |

- **Single high windows are common.** About 2 in 3 hug/clap clips have at least one window above FIGHT_AT, but smoothing plus the 1 s hold filters most of them out.
- **Adding AIRTLab to training mostly helped catch fights** (43% → 62% reaching live FIGHT). It did not reduce hug alarms.
- **Hugs need better features, not just more data.** The model can't yet separate a close, moving hug from a close scuffle well enough.

### A7.4 Live thresholds re-tuned for v3

- **Method:** out-of-fold window scores of all 3,131 clips were replayed through the live logic, over 512 settings.
- **Rule:** catch the most violent clips while ≤ 10% of non-violent clips reach FIGHT.

| Setting (alpha / TENSE / FIGHT / duration) | Violent clips → FIGHT | Non-violent → FIGHT | AIRTLab hugs → FIGHT | AIRTLab fights → FIGHT | Weapon → FIGHT |
|---|---|---|---|---|---|
| 0.4 / 0.5 / 0.7 / 1.0 (quick-model demo setting) | 58% | 8% | 18% | 62% | 38% |
| **0.6 / 0.5 / 0.75 / 1.0 (chosen, now in `live_detector.py`)** | **60%** | **9%** | **14%** | **63%** | **36%** |
| 0.5 / 0.5 / 0.65 / 1.0 (if ≤ 15% non-violent is acceptable) | 71% | 15% | 30% | 78% | 52% |

**Limits:**

- **Short clips:** these are 2–5 s clips, not continuous camera footage, so the false-alarm rate per camera-hour is unknown.
- **SCF:** its clips are about 2 s long (median 2.0 s), too short to hold FIGHT for 1 s after smoothing. So SCF fights almost never reach live FIGHT (2%) even though 75% of them peak above FIGHT_AT. The SCF clip AUC (0.79) is the fair number for that dataset.

### A7.5 Per kind, new model out-of-fold (FIGHT_AT 0.7 setting)

| Dataset | Kind | Peak ≥ FIGHT_AT | Live FIGHT |
|---|---|---|---|
| AIRTLab | hugs/claps (0) | 80/120 (67%) | 21/120 (18%) |
| AIRTLab | fight (1) | 222/230 (97%) | 143/230 (62%) |
| RLVS | normal (0) | 395/1000 (40%) | 82/1000 (8%) |
| RLVS | fight (1) | 955/1000 (96%) | 680/1000 (68%) |
| SCF | normal (0) | 45/150 (30%) | 0/150 (0%) |
| SCF | fight (1) | 112/150 (75%) | 3/150 (2%), clips too short |
| SCVD | normal (0) | 125/246 (51%) | 24/246 (10%) |
| SCVD | fight (1) | 102/111 (92%) | 67/111 (60%) |
| SCVD | weapon (1) | 88/124 (71%) | 47/124 (38%) |

**Held-out RLVS** (trained on AIRTLab + SCF + SCVD only): 77% of fights reach FIGHT, but so do 30% of normal clips. A model trained without YouTube-style footage over-fires on it. This is the domain-shift risk, and it is why the thresholds must be tuned on our own camera.

### A7.6 Feature importance (share of gain)

| Feature | Share |
|---|---|
| pair_motion_energy | 0.349 |
| max_wrist_speed | 0.100 |
| min_torso_dist | 0.091 |
| wrist_toward_speed | 0.084 |
| pair_dist_var | 0.079 |
| max_wrist_accel | 0.077 |
| closing_speed | 0.062 |
| close_motion | 0.062 |
| max_arm_extension | 0.060 |
| wrist_peaks_per_s | 0.035 |

Less dominated by one feature than the old model was (pair_motion_energy 35% vs 47%).

**Missing rates:** pair features are still missing 29–67% of the time, because often only one person is tracked. `close_motion` is missing in 67% of windows.

### A7.7 Live pipeline check

- **Live vs offline:** the threaded live detector (OpenVINO on the Intel GPU) uses the same `features.window_features` as training.
- **Test clip:** on a 14.5 s AIRTLab fight clip (part of training, so this checks the pipeline, not accuracy) it went CALM → TENSE at 4.8 s → FIGHT at 10.5 s. Pose ran at the file's full 30 fps.
- **Warm-up:** the first ~4 s are slow because the Intel GPU recompiles the pose model when the input shape changes. The warm-up uses 640×480, the webcam size, so this only affects HD video files, not the webcam demo.
- **Component speed:** pose + tracking about 43–46 fps on its own; `window_features` about 15 ms per call.

### A7.8 Proof-page rows and `proof.json` (team rule: report both rows)

Main's CLAUDE.md (approved 10 Oct 14:50) says to train on RLVS + AIRTLab and hold out SCF + SCVD as the CCTV-domain test, and to report both rows if they are included in training. `train.py` now does both and writes `model/proof.json`, which the backend serves at `GET /proof`.

**Alarm definition:** a clip counts as "alarmed" when the live logic raises an alarm: smoothed score ≥ FIGHT_AT (0.75) held for 1 s. This is the team's 1-s persistence rule. Counting a single moment above 0.75 instead would flag 42% of AIRTLab hugs, versus 19% with the 1 s hold.

| Row | Clips | AUC | Precision | Recall |
|---|---|---|---|---|
| **Phone-video sets** (RLVS + AIRTLab), out-of-fold | 2,350 | **0.887** | 0.88 | 0.68 |
| **CCTV domain, held out** (SCF + SCVD; trained on RLVS + AIRTLab only) | 781 | **0.709** | 0.80 | 0.32 |
| CCTV, out-of-fold with CCTV in training (shipped model) | 781 | 0.745 | 0.81 | 0.30 |
| All datasets, out-of-fold (shipped model) | 3,131 | 0.857 | 0.87 | 0.60 |

- **High precision, modest recall.** When it alarms it is usually right (80–88%), but with the 1 s hold it misses a share of fights, especially on CCTV.
- **CCTV recall (0.32) is partly a clip-length artifact.** SCF clips are about 2 s long, too short for the 1 s hold (A7.4). The AUC is the fairer CCTV number.
- **Training on CCTV helps only a little:** CCTV AUC goes from 0.709 to 0.745.
- **`proof.json` fields:**
  - `clip_*` = the phone-video row
  - `cctv_domain` = the held-out row
  - `airtlab_fp_rate` = 0.192
  - `latency_ms` = 38 (pose 22 + features 15 + LightGBM about 1 ms per window)
- **Left as placeholders, flagged in `note`:** `live_precision`, `live_recall`, `fa_per_camera_hour`, `lead_time_s` and `ir_check`. These need our own footage.

### A7.9 Next steps

1. **Labelled webcam session.** Hold F for fights and H for hugs, then run `python tune_live.py --log session1.csv`. This is the only real measure of hug false alarms and of false alarms per minute in our room.
2. **Hug features.** Hugs still reach FIGHT 14% of the time. Candidates:
   - how long the pair stays in contact
   - whether the motion repeats (strikes) or stays smooth
   - arm symmetry (both arms around the other person)
3. **Commit to `model-dev`** and open a PR into `main`.

---

# Part B — Previous model (v2 features + tuned LightGBM, RLVS only, v1 keypoints)

Reproduce with `train.py` (comparison table), `analyze_model.py` (diagnostics), `tune_live.py --rlvs` (live thresholds), `benchmark_pose.py` (speed). Note: `train.py` has since been rewritten for Part A, so these commands no longer reproduce Part B exactly.

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
