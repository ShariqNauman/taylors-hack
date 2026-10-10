# EarlyEye model

Detects fights from a camera using body keypoints only (no faces, no video stored).
Pipeline: webcam → YOLO26n-pose + ByteTrack → 12 body keypoints → features over the last 2 s
(resampled to 10 fps, scaled by torso length) → LightGBM → smoothed score → CALM / TENSE / FIGHT.

Results and limits: [REPORT.md](REPORT.md). Proof-page numbers for the backend: [proof.json](proof.json).

## Run the live demo (no datasets needed)

Needs Python 3.11 and a webcam. The trained model (`violence_model.joblib`) is in the repo; the pose
weights download automatically the first time.

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

Thresholds are constants at the top of `live_detector.py` (`SMOOTH_ALPHA`, `TENSE_AT`, `FIGHT_AT`,
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
   venv\Scripts\python train.py                    # -> violence_model.joblib, metrics_v2.json, proof.json
   ```

## Files

| File | What it does |
|---|---|
| `live_detector.py` | Live webcam demo and labelled-session recorder |
| `predict.py` | `predict(features)`: the single scoring entry point |
| `features.py` | Features from keypoints, shared by training and live |
| `tune_live.py` | Picks live thresholds from a labelled session |
| `list_videos.py` | Scans `data/` and writes `videos.csv` (labels, groups) |
| `extract_keypoints_v2.py` | YOLO pose + tracking → raw keypoint CSVs |
| `bytetrack_v2.yaml` | Tracker settings (track buffer 60), used by extraction and live |
| `train.py` | Trains LightGBM, writes metrics and `proof.json` |
| `violence_model.joblib` | The trained model (load only files made by `train.py`: joblib runs code on load) |
