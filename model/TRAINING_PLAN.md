# EarlyEye: final training round plan

Goal: the best honestly tested model, using everything still usable: all 3,131 clips, all 17 keypoints + YOLO boxes, both machines (laptop + RTX 5090 server, which expires at 2:26 AM), and two model types (LightGBM + a small sequence model).

Backups are in model/backup_v3/. Work on branch model-final.

Machines:
- **Laptop:** feature code, LightGBM on cached windows, live testing, final packaging.
- **Server:** large tuning searches if faster there, and the sequence model.
- Copy every result back to the laptop as soon as a job finishes. The server never holds the only copy.

STOP at each **STOP** below: show me the results and wait for my OK.

---

## 1. Hold-out test set

- Lock away **15% of groups**, stratified by dataset and label, with seed 42. Save the list to `holdout_groups.csv` and commit it.
- Split by **group_id**, not by clip, so AIRTLab cam1/cam2 pairs of one scene always stay together.
- Check the hold-out has a reasonable mix: every dataset, both labels, AIRTLab non-violent clips (hugs/claps) and SCVD weapon clips. Print the counts.
- Rules:
  - **Never** use the hold-out for feature selection, tuning, threshold choice or model choice.
  - Every cross-validation step below runs only on the remaining 85% (the "training part").
  - The hold-out is evaluated **once**, in step 5.

## 2. Features from all body parts (laptop)

- Keep the existing 10 features.
- Add:
  - **Head:** head-to-head distance of the active pair; head snap speed (sudden head acceleration); facing angle between the pair (from nose + ears).
  - **Legs:** ankle speed toward the other person (kicks); knee lift; body height drop (falling or pushed down).
  - **Arms:** left/right arm symmetry during contact (hugs are symmetric, punches aren't); elbow angle change (punch extension).
  - **Whole body:** per-person all-joint motion energy; contact duration and number of separate contacts in the window; YOLO box overlap between the pair.
- Use the existing confidence thresholds and NaN for missing values. Same `window_features()` entry point for training and live.
- Report, using the training part only with GroupKFold:
  - single-feature AUC and missing rate for every new feature
  - ablation: old 10 features vs old + new
  - drop new features that don't help.

**STOP.**

## 3. LightGBM tuning (server if faster, otherwise laptop)

- Randomized search, about 100 settings, over: num_leaves, learning_rate, n_estimators, min_child_samples, subsample, colsample_bytree, reg_lambda.
- Also search the dataset sample weights: AIRTLab 2–4x, CCTV (SCF, SCVD) 1–3x, RLVS 1x.
- GroupKFold (5 folds, by group_id) on the training part only. Save the fold assignment so step 4 uses the **same folds**.

## 4. Sequence model (server)

- A small 1D-CNN or GRU over the keypoint time series:
  - Input: last 2 s at 10 fps (20 steps); all 17 keypoints (x, y, conf) of the active pair (2 people); normalised by torso length and centred on the pair. Missing person = zeros + mask.
  - Augmentation: left-right flips, small scale and position jitter.
  - Label = clip label for every window, same as LightGBM. Clip score = max window score.
- Same GroupKFold folds as step 3, with early stopping.
- Keep it small. Export to ONNX/OpenVINO and measure inference on the **laptop**: it must be **under 20 ms per window**.
- Also test the **ensemble**: average of LightGBM and sequence-model probabilities.

### How to choose

Report for each candidate (LightGBM alone, sequence alone, ensemble):
- out-of-fold clip ROC-AUC, overall and per dataset
- with the live logic (smoothing + MIN_DURATION): % fight clips reaching FIGHT, % normal clips reaching FIGHT, % AIRTLab hugs/claps reaching FIGHT, % SCVD weapon clips reaching FIGHT
- live inference time per window on the laptop.

Rule:
- Pick the highest clip AUC.
- **Reject** any candidate with more hug false alarms or more normal-clip false alarms than LightGBM alone, or slower than 20 ms per window.
- If the gain over LightGBM alone is under **+0.01 AUC**, keep LightGBM alone (simpler, safer for the demo).

**STOP.**

## 5. Final test + final model

- Evaluate the chosen setup **once** on the hold-out set, and the backup_v3 model on the same hold-out:
  - clip AUC overall and per dataset
  - precision / recall with the live logic
  - % fights reaching FIGHT, % normal clips, % AIRTLab hugs, % weapon clips.
- If the new setup is better: retrain on **all** data (training part + hold-out) with the chosen settings and save it.
  - Update `predict.py` so live uses the chosen setup (ensemble if chosen).
  - Update `proof.json`, `metrics_v2.json` and `REPORT.md`. Report the **hold-out** numbers as the official results, not the cross-validation ones.
- If it is not better: keep the backup_v3 model and say so honestly.
- Run `tune_live.py` on `session1.csv` for normal-activity false alarms only. I'll record a labelled session (holding F and H) afterwards for full threshold tuning.
- Commit to model-final (no data, keypoints or videos).

**STOP.**
