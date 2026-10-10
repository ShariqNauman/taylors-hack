# EarlyEye model

Detects fights from a camera using body keypoints only (no faces, no video stored).
Pipeline: webcam → YOLO26n-pose + ByteTrack → 17 keypoints + boxes → last 2 s at 10 fps (torso-scaled) →
LightGBM (23 features) + 1D-CNN (keypoint sequence), averaged → smoothed score → CALM / TENSE / FIGHT.
Hold-out clip AUC 0.929 (470 clips never used for any choice); see REPORT.md Part A0.

Results and limits: [REPORT.md](REPORT.md). Proof-page numbers for the backend: [proof.json](proof.json).

## Run the live demo (no datasets needed)

Needs Python 3.11 and a webcam. The trained models (`violence_model.joblib`, `seq_model.onnx`) are in the
repo; the pose weights download automatically the first time.

```powershell
cd model
py -3.11 -m venv venv
venv\Scripts\python -m pip install -r requirements.txt
venv\Scripts\python live_detector.py
```

Always use `venv\Scripts\python`, not plain `python` (plain `python` gives `No module named 'cv2'`).

- **First start** exports the pose model to OpenVINO (one time, about 10 s). It uses the Intel GPU if
  there is one, otherwise the CPU.
- **Other camera:** `--camera 1`. **Video file:** `--camera path\to\clip.mp4`.
- **Quit:** press `q`.
- **Framing:** 3–4 m away, both people's full bodies in frame, no bright window behind them.

## Record a labelled session (to tune thresholds for your room)

```powershell
venv\Scripts\python live_detector.py --log session1.csv
```

Hold **F** during a staged fight and **H** during a hug; nothing held = normal. Then:

```powershell
venv\Scripts\python tune_live.py --log session1.csv            # report
venv\Scripts\python tune_live.py --log session1.csv --apply    # write the best thresholds
```

Scoring mode is `MODE` at the top of `predict.py`: `"ensemble"` (default) or `"lgbm"` (fallback, LightGBM
only). Thresholds are constants at the top of `live_detector.py` (`FIGHT_AT` for the ensemble, `FIGHT_AT_LGBM`) (`SMOOTH_ALPHA`, `TENSE_AT`, `FIGHT_AT`,
`MIN_DURATION`, `FIGHT_HOLD`).

## Retrain (needs the datasets)

1. Put the datasets in `model/data/` (folder layout in `list_videos.py`):
   - AIRTLab: https://github.com/airtlab/A-Dataset-for-Automatic-Violence-Detection-in-Videos/tree/master/violence-detection-dataset
   - Surveillance Camera Fight (SCF): https://github.com/seymanurakti/fight-detection-surv-dataset
   - RLVS: https://www.kaggle.com/datasets/mohamedmustafa/real-life-violence-situations-dataset
   - SCVD: https://www.kaggle.com/datasets/toluwaniaremu/smartcity-cctv-violence-detection-dataset-scvd
2. Run:
   ```powershell
   venv\Scripts\python list_videos.py              # data/ -> videos.csv
   venv\Scripts\python extract_keypoints_v2.py     # videos -> keypoints_v2/ (resumable; --device 0 on an NVIDIA GPU)
   venv\Scripts\python train.py                    # v3-style LightGBM report
   ```
   The v4 ensemble is built by the steps in `TRAINING_PLAN.md`: `make_holdout.py`, `analyze_features.py`,
   `tune_lgbm.py`, `seq_dataset.py` + `seq_train.py` (GPU), `compare_candidates.py`, `evaluate_holdout.py`,
   `seq_final.py` (GPU), `finalize_model.py`.

## Files

| File | What it does |
|---|---|
| `live_detector.py` | Live webcam demo and labelled-session recorder |
| `predict.py` | `predict(features, sequence)`: the single scoring entry point (`MODE`) |
| `features.py` | LightGBM features from keypoints, shared by training and live |
| `seq_features.py` | Sequence-model input, and `window_inputs()` (both inputs from one pass) |
| `seq_model.onnx` | The trained 1D-CNN (run with OpenVINO) |
| `tune_live.py` | Picks live thresholds from a labelled session |
| `list_videos.py` | Scans `data/` and writes `videos.csv` (labels, groups) |
| `extract_keypoints_v2.py` | YOLO pose + tracking → raw keypoint CSVs |
| `bytetrack_v2.yaml` | Tracker settings (track buffer 60), used by extraction and live |
| `train.py` | Trains LightGBM, writes metrics and `proof.json` |
| `violence_model.joblib` | The trained model (load only files made by `train.py`: joblib runs code on load) |
