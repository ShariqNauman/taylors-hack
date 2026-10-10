"""
tune_live.py - Replay a labelled live_features.csv (record with live_detector.py while holding
F = fight, H = hug) with many smoothing / level settings, and pick the best one.

For every setting it reports:
  fights caught      labelled fight episodes where FIGHT showed (during it or up to CATCH_GRACE_S after)
  hugs -> FIGHT      labelled hug episodes where FIGHT wrongly showed
  normal FIGHT/TENSE seconds of normal time spent in FIGHT / TENSE

Usage:
  python tune_live.py                 # report only
  python tune_live.py --apply         # also write the best setting into live_detector.py
  python tune_live.py --log other.csv
  python tune_live.py --rlvs --apply  # no labelled session: tune on the training clips instead
"""
import argparse
import itertools
import re
from pathlib import Path

import pandas as pd

# ---------------- Tunable constants ----------------
LOG_CSV = "live_features.csv"
DETECTOR_FILE = Path("live_detector.py")
STEP_S = 0.5             # time per logged window
CATCH_GRACE_S = 1.0      # FIGHT this soon after a fight ends still counts as caught (smoothing lag)
SETTLE_S = 3.0           # ignore normal windows this long after a fight (FIGHT_HOLD + smoothing)
FIGHT_HOLD = 2.0         # kept fixed; it only changes how long the banner stays up
GRID = {
    "SMOOTH_ALPHA": [0.3, 0.4, 0.5, 0.6],
    "TENSE_AT": [0.3, 0.35, 0.4, 0.5],
    "FIGHT_AT": [0.4, 0.45, 0.5, 0.55, 0.6, 0.7],
    "MIN_DURATION": [0.5, 1.0, 1.5, 2.0],
}
SHOW_TOP = 10
MAX_CALM_FIGHT_PCT = 15  # --rlvs: at most this % of calm clips may reach FIGHT
# ---------------------------------------------------


def replay(raw_scores, times, alpha, tense_at, fight_at, min_duration, fight_hold):
    """Same level logic as live_detector.py. Returns one level per window."""
    score, high_since, fight_until, levels = 0.0, None, -1.0, []
    for raw, t in zip(raw_scores, times):
        score = alpha * raw + (1 - alpha) * score
        high_since = (high_since if high_since is not None else t) if score >= fight_at else None
        if high_since is not None and t - high_since >= min_duration:
            fight_until = t + fight_hold
        levels.append("FIGHT" if t <= fight_until else "TENSE" if score >= tense_at else "CALM")
    return levels


def episodes(log, label):
    """[(start_time, end_time), ...] for consecutive windows with this label."""
    out, start, prev = [], None, None
    for t, lb in zip(log["time_s"], log["label"]):
        if lb == label and start is None:
            start = t
        elif lb != label and start is not None:
            out.append((start, prev))
            start = None
        prev = t
    if start is not None:
        out.append((start, prev))
    return out


def evaluate(log, levels, fights, hugs):
    t = log["time_s"].to_numpy()
    fight_now = pd.Series(levels).eq("FIGHT").to_numpy()
    tense_now = pd.Series(levels).eq("TENSE").to_numpy()

    def fight_between(a, b):
        hit = fight_now & (t >= a) & (t <= b)
        return t[hit].min() if hit.any() else None

    first_hits = [fight_between(a, b + CATCH_GRACE_S) for a, b in fights]
    caught = [h for h in first_hits if h is not None]
    delays = [h - a for h, (a, _) in zip(first_hits, fights) if h is not None]
    hug_hits = sum(fight_between(a, b) is not None for a, b in hugs)
    # Normal windows, skipping the settle period right after each fight.
    normal = log["label"].eq("normal").to_numpy().copy()
    for _, b in fights:
        normal &= ~((t > b) & (t <= b + SETTLE_S))
    is_fight = log["label"].eq("fight").to_numpy()
    return {
        "fights_caught": len(caught),
        "hugs_to_FIGHT": hug_hits,
        "normal_FIGHT_s": STEP_S * (fight_now & normal).sum(),
        "normal_TENSE_s": STEP_S * (tense_now & normal).sum(),
        "fight_flagged_%": round(100 * (fight_now | tense_now)[is_fight].mean(), 0) if is_fight.any() else 0,
        "mean_delay_s": round(sum(delays) / len(delays), 2) if delays else None,
    }


def current_settings():
    text = DETECTOR_FILE.read_text()
    return {k: float(re.search(rf"^{k} = ([\d.]+)", text, re.M).group(1)) for k in GRID}


def apply_settings(best):
    text = DETECTOR_FILE.read_text()
    for k, v in best.items():
        text = re.sub(rf"^({k} = )[\d.]+", rf"\g<1>{v}", text, flags=re.M)
    DETECTOR_FILE.write_text(text)


def tune_on_clips(apply):
    """No labelled webcam session: replay the model's out-of-fold window scores for every training
    clip through the live logic. A clip 'fires' if FIGHT shows anywhere in it."""
    import joblib
    from features import FEATURE_NAMES
    from train import DEFAULT_PARAMS, MODEL_OUT, WINDOWS_CACHE, oof_scores

    params = joblib.load(MODEL_OUT).get("params", DEFAULT_PARAMS)  # our own model file
    win = pd.read_csv(WINDOWS_CACHE)
    win["p"] = oof_scores(win, FEATURE_NAMES, params)
    clips = [(g["label"].iloc[0], g["p"].tolist(), g["end_s"].tolist())
             for _, g in win.sort_values("end_s").groupby("path")]
    n_fight = sum(lb == 1 for lb, _, _ in clips)
    print(f"Replaying out-of-fold scores of {len(clips)} clips ({n_fight} fight, "
          f"{len(clips) - n_fight} calm) through the live logic, {params}\n")

    rows = []
    for values in itertools.product(*GRID.values()):
        cfg = dict(zip(GRID, values))
        if cfg["TENSE_AT"] >= cfg["FIGHT_AT"]:
            continue
        caught, false_fight, delays, calm_flagged, calm_windows = 0, 0, [], 0, 0
        for label, scores, times in clips:
            lv = replay(scores, times, cfg["SMOOTH_ALPHA"], cfg["TENSE_AT"], cfg["FIGHT_AT"],
                        cfg["MIN_DURATION"], FIGHT_HOLD)
            fired = "FIGHT" in lv
            if label == 1:
                caught += fired
                if fired:
                    delays.append(times[lv.index("FIGHT")] - times[0])
            else:
                false_fight += fired
                calm_flagged += sum(level != "CALM" for level in lv)
                calm_windows += len(lv)
        rows.append({**cfg,
                     "fights_caught_%": round(100 * caught / n_fight, 1),
                     "calm_to_FIGHT_%": round(100 * false_fight / (len(clips) - n_fight), 1),
                     "calm_time_TENSE+_%": round(100 * calm_flagged / max(calm_windows, 1), 1),
                     "mean_delay_s": round(sum(delays) / len(delays), 2) if delays else None})
    res = pd.DataFrame(rows)
    # Best = most fights caught while calm clips reaching FIGHT stay <= MAX_CALM_FIGHT_PCT.
    ok = res[res["calm_to_FIGHT_%"] <= MAX_CALM_FIGHT_PCT]
    res = ok.sort_values(["fights_caught_%", "calm_to_FIGHT_%", "calm_time_TENSE+_%", "mean_delay_s"],
                         ascending=[False, True, True, True])
    cur = current_settings()
    print(f"Current settings: {cur}")
    print(f"\nTop {SHOW_TOP} settings with calm clips -> FIGHT <= {MAX_CALM_FIGHT_PCT}%:")
    print(res.head(SHOW_TOP).to_string(index=False))
    best = {k: float(res.iloc[0][k]) for k in GRID}
    print(f"\nBest: {best}")
    if apply:
        apply_settings(best)
        print(f"Written into {DETECTOR_FILE}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--log", default=LOG_CSV)
    ap.add_argument("--apply", action="store_true", help="write the best setting into live_detector.py")
    ap.add_argument("--rlvs", action="store_true",
                    help="no labelled session: tune on the training clips' out-of-fold scores instead")
    args = ap.parse_args()
    if args.rlvs:
        return tune_on_clips(args.apply)

    log = pd.read_csv(args.log)
    if "label" not in log.columns:
        raise SystemExit(f"{args.log} has no labels. Record with live_detector.py holding F / H.")
    fights, hugs = episodes(log, "fight"), episodes(log, "hug")
    print(f"{len(log)} windows ({log['time_s'].iloc[-1] - log['time_s'].iloc[0]:.0f} s): "
          f"{len(fights)} fight episodes, {len(hugs)} hug episodes, "
          f"{STEP_S * log['label'].eq('normal').sum():.0f} s normal\n")
    if not fights:
        print("WARNING: no fight episodes labelled, so 'fights caught' can't be measured.")

    rows = []
    for values in itertools.product(*GRID.values()):
        cfg = dict(zip(GRID, values))
        if cfg["TENSE_AT"] >= cfg["FIGHT_AT"]:
            continue
        levels = replay(log["raw_score"], log["time_s"], cfg["SMOOTH_ALPHA"], cfg["TENSE_AT"],
                        cfg["FIGHT_AT"], cfg["MIN_DURATION"], FIGHT_HOLD)
        rows.append({**cfg, **evaluate(log, levels, fights, hugs)})
    res = pd.DataFrame(rows)
    # Best = most fights caught, then fewest hug alarms, fewest normal FIGHT seconds,
    # fastest detection, then least normal TENSE time relative to fight time flagged.
    res["tense_tradeoff"] = res["normal_TENSE_s"] - res["fight_flagged_%"] / 10
    res = res.sort_values(["fights_caught", "hugs_to_FIGHT", "normal_FIGHT_s", "mean_delay_s",
                           "tense_tradeoff"], ascending=[False, True, True, True, True])

    cur = current_settings()
    cur_row = res[(res[list(GRID)] == pd.Series(cur)).all(axis=1)]
    show = res.drop(columns="tense_tradeoff")
    print(f"Current settings: {cur}")
    print(show[show.index.isin(cur_row.index)].to_string(index=False) if len(cur_row)
          else "  (current settings are not in GRID)")
    print(f"\nTop {SHOW_TOP} of {len(res)} settings:")
    print(show.head(SHOW_TOP).to_string(index=False))

    best = {k: float(res.iloc[0][k]) for k in GRID}
    print(f"\nBest: {best}")
    if args.apply:
        apply_settings(best)
        print(f"Written into {DETECTOR_FILE}")


if __name__ == "__main__":
    main()
