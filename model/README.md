# EarlyEye model

Detects fights from a camera using body keypoints only (no faces, no video stored).
Pipeline: camera → YOLO26n-pose + ByteTrack → 17 keypoints + boxes → last 2 s at 10 fps (torso-scaled) →
LightGBM (36 features) + 1D-CNN (keypoint sequence), averaged → smoothed score → CALM / TENSE / FIGHT.

**Current model: v6** ("violence, not speed"). Hold-out clip AUC 0.935, 72% of fights caught at 9% normal-clip
false alarms; 6 of 6 fights caught on our own 7 test videos. Results, limits and operating range:
[REPORT.md](REPORT.md) (Part V6). Proof-page numbers for the backend: [proof.json](proof.json).

## Setup (once)

Needs Python 3.11. The trained models (`violence_model.joblib`, `seq_model.onnx`, `seq_clip.json`) are in the
repo; the pose weights download automatically the first time.

```powershell
cd model
py -3.11 -m venv venv
venv\Scripts\python -m pip install -r requirements.txt
```

Always use `venv\Scripts\python`, not plain `python` (plain `python` gives `No module named 'cv2'`).

## Run

```powershell
venv\Scripts\python live_detector.py                                  # live demo, webcam 0 (q = quit)
venv\Scripts\python live_detector.py --camera 1                       # another webcam
venv\Scripts\python live_detector.py --camera path\to\clip.mp4        # test on a video (plays in real time)
venv\Scripts\python live_detector.py --camera clip.mp4 --seconds 30 --no-show   # timed run, no window
venv\Scripts\python live_detector.py --log s.csv --save-keypoints s_kp.csv      # record a session for training
```

**Edge app** (same model, thresholds and guards; serves the on-site dashboard and posts incidents to the API),
from the repo root:

```powershell
model\venv\Scripts\python edge\earlyeye_edge.py --camera 0                       # webcam, posts fights to the API
model\venv\Scripts\python edge\earlyeye_edge.py --camera clip.mp4 --no-post      # video test, nothing posted
```

The edge app serves `http://127.0.0.1:8765/live.json`. Edge options: `edge/README.md`.

**Framing:** camera about one floor up (or held high). People at least ~60 px tall, at least waist-up. Not wide
crowd views. Good light.

## Settings (top of `live_detector.py`; `MODE` at the top of `predict.py`)

| Setting | Default | What it does |
|---|---|---|
| `SENSITIVITY` | `"strict"` | FIGHT_AT 0.505. `"sensitive"` uses 0.439: more fights caught, more false alarms |
| `GUARD_K_OF_N` | `False` | `True` = FIGHT needs ~2 s instead of 1 s: the best switch against false alarms |
| `GUARD_PROX`, `GUARD_TWO_KEY`, `GUARD_MIN_TRACK` | `False` | Optional guards; each costs more recall than it saves (REPORT V5.5) |
| `CLIP_FEATURES` | `True` | Clips features to the training range |
| `predict.MODE` | `"ensemble"` | `"lgbm"` = LightGBM alone (fallback, FIGHT_AT 0.581) |

The overlay shows `blocked: <guard>` when a guard stops an alarm. A window with fewer than 2 tracked people is never FIGHT.

## Retrain (needs the datasets)

1. Put the datasets in `model/data/` (folder rules in `list_videos.py`):
   - AIRTLab: https://github.com/airtlab/A-Dataset-for-Automatic-Violence-Detection-in-Videos/tree/master/violence-detection-dataset
   - Surveillance Camera Fight (SCF): https://github.com/seymanurakti/fight-detection-surv-dataset
   - RLVS: https://www.kaggle.com/datasets/mohamedmustafa/real-life-violence-situations-dataset
   - SCVD: https://www.kaggle.com/datasets/toluwaniaremu/smartcity-cctv-violence-detection-dataset-scvd
   - KTH running / walking in `data/non_violent_run_walk/`
   - Own videos in `data/recorded_data/`, with `fight_times.csv` and `fast_times.csv`
2. Run:
   ```powershell
   venv\Scripts\python list_videos.py                # data/ -> videos.csv (keeps existing group ids)
   venv\Scripts\python extract_keypoints_v2.py       # videos -> keypoints_v2/ (resumable; --device 0 on NVIDIA)
   venv\Scripts\python train_v6.py --step weights    # weights + labels for both models
   venv\Scripts\python train_v6.py --step lgbm       # LightGBM candidates
   ```
   The CNN runs on a GPU: `seq_dataset.py`, `seq_train.py`, `seq_final.py`, `seq_lovo.py`.
   Then `step6_v6.py --step lgbm | report | final`.

## Files

| File | What it does |
|---|---|
| `live_detector.py` | Live demo, video test, session recorder |
| `predict.py` | `predict(features, sequence)`: the single scoring entry point (`MODE`) |
| `features.py` | LightGBM features (36) from keypoints, shared by training and live |
| `seq_features.py` | CNN input, and `window_inputs()` (both inputs from one pass) |
| `guards.py` | CALM / TENSE / FIGHT logic, guards and single-person rule (live, edge and evaluation) |
| `violence_model.joblib` / `seq_model.onnx` / `seq_clip.json` | The trained v6 models. joblib runs code on load: load only files made by this repo's scripts. |
| `tune_live.py` | Picks live thresholds from a labelled session |
| `list_videos.py`, `extract_keypoints_v2.py`, `bytetrack_v2.yaml` | Dataset listing, pose extraction, tracker settings |
| `train_v6.py`, `step6_v6.py`, `seq_*.py` | v6 training and evaluation (earlier rounds: `train_halfbody.py`, `tune_lgbm.py`, ...) |
| `run_recorded.py` | Plays our own videos through the live pipeline and reports alarms, false alarms and lead time |
