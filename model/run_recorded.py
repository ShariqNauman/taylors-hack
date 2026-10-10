"""
run_recorded.py - Play our own recorded videos through the live pipeline (live_detector.py, real time,
current model and settings) and report per video:
  max score, when FIGHT triggers, false alarms per minute, and with fight_times.csv:
  fights caught and lead time (first TENSE before the fight to fight_start; positive = early warning).

Usage:
  python run_recorded.py --run --tag v5     # play every video (real time), logs in recorded_logs/<tag>/
  python run_recorded.py --tag v5           # analyse existing logs only
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd

# ---------------- Tunable constants ----------------
DATA = Path("data/recorded_data")
FIGHT_TIMES = DATA / "fight_times.csv"     # file, fight_start_s, fight_end_s (one row per fight)
LOG_DIR = Path("recorded_logs")
CATCH_GRACE_S = 1.0       # FIGHT up to this long after a fight ends still counts as catching it
LEAD_LOOKBACK_S = 15.0    # lead time: earliest TENSE/FIGHT in this window before fight_start
# ---------------------------------------------------


def episodes(t, on):
    """[(start, end), ...] of consecutive True windows."""
    out, start = [], None
    for ti, o in zip(t, on):
        if o and start is None:
            start = ti
        if not o and start is not None:
            out.append((start, prev))
            start = None
        prev = ti
    if start is not None:
        out.append((start, prev))
    return out


def analyse(log, fights):
    t, lv = log["time_s"].to_numpy(), log["level"].to_numpy()
    dur_min = (t.max() - t.min() + 0.5) / 60 if len(t) else 0
    fight_eps = episodes(t, lv == "FIGHT")
    r = {"duration_s": round(dur_min * 60, 1), "max_score": round(float(log["smoothed_score"].max()), 3),
         "max_raw": round(float(log["raw_score"].max()), 3),
         "FIGHT_starts_s": [round(a, 1) for a, _ in fight_eps],
         "FIGHT_seconds": round(0.5 * (lv == "FIGHT").sum(), 1)}
    inside = lambda a, b: any(a <= fe + CATCH_GRACE_S and b >= fs for fs, fe in fights)
    false_eps = [e for e in fight_eps if not inside(*e)]
    r["false_alarms"] = len(false_eps)
    free_min = dur_min - sum(fe - fs for fs, fe in fights) / 60
    r["false_alarms_per_min"] = round(len(false_eps) / max(free_min, 1e-6), 2)
    if fights:
        caught, leads = 0, []
        for fs, fe in fights:
            hit = [a for a, b in fight_eps if a <= fe + CATCH_GRACE_S and b >= fs]
            caught += bool(hit)
            warn = t[(t >= fs - LEAD_LOOKBACK_S) & (t <= fe) & np.isin(lv, ["TENSE", "FIGHT"])]
            leads.append(round(fs - warn.min(), 1) if len(warn) else None)
        r.update(fights=len(fights), fights_caught=caught, lead_time_s=leads)
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", action="store_true", help="play the videos through live_detector.py first")
    ap.add_argument("--tag", default="v5")
    args = ap.parse_args()
    out = LOG_DIR / args.tag
    out.mkdir(parents=True, exist_ok=True)
    videos = sorted(DATA.glob("*/*.mp4"))
    if args.run:
        for v in videos:
            log = out / (v.stem + ".csv")
            print(f"playing {v.name} ...", flush=True)
            subprocess.run([sys.executable, "live_detector.py", "--no-show", "--camera", str(v), "--log", str(log)],
                           check=True, capture_output=True)
    ft = pd.read_csv(FIGHT_TIMES) if FIGHT_TIMES.exists() else None
    rows = []
    for v in videos:
        log = out / (v.stem + ".csv")
        if not log.exists():
            continue
        fights = ([] if ft is None else
                  [(r.fight_start_s, r.fight_end_s) for r in ft[ft["file"] == v.name].itertuples()])
        rows.append({"video": v.name, "folder": v.parent.name, **analyse(pd.read_csv(log), fights)})
    res = pd.DataFrame(rows)
    pd.set_option("display.width", 250)
    print(res.to_string(index=False))
    if ft is None:
        print(f"\n{FIGHT_TIMES} not found: fights caught and lead time need it; violence videos count every "
              "FIGHT as a false alarm until then.")
    (out / "summary.json").write_text(json.dumps(rows, indent=2, default=float))


if __name__ == "__main__":
    main()
