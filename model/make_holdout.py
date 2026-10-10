"""
make_holdout.py - Lock away a hold-out test set: HOLDOUT_FRAC of the groups, stratified by dataset and
kind (kind implies label, and keeps SCVD weapon clips and AIRTLab hugs/claps in proportion).

Split is by group_id, so AIRTLab cam1/cam2 views of one scene always land on the same side.
Writes holdout_groups.csv: one row per hold-out clip (path, group_id, dataset, label, kind).
Paths are saved as well as group ids, because group ids are renumbered if videos.csv is rebuilt.

Rules (TRAINING_PLAN.md step 1): never use the hold-out for features, tuning, thresholds or model
choice. It is evaluated once, at the end.

Usage:  python make_holdout.py
"""
from pathlib import Path

import pandas as pd
from sklearn.model_selection import train_test_split

# ---------------- Tunable constants ----------------
VIDEOS_CSV = Path("videos.csv")
OUT_CSV = Path("holdout_groups.csv")
HOLDOUT_FRAC = 0.15
SEED = 42
# ---------------------------------------------------


def main():
    if OUT_CSV.exists():
        raise SystemExit(f"{OUT_CSV} already exists. The hold-out is locked; delete it only on purpose.")
    videos = pd.read_csv(VIDEOS_CSV)

    # One row per group; every clip in a group has the same dataset, label and kind.
    groups = videos.groupby("group_id").agg(dataset=("dataset", "first"), kind=("kind", "first"),
                                            n=("path", "size")).reset_index()
    assert (videos.groupby("group_id")[["dataset", "label", "kind"]].nunique() == 1).all().all()
    strata = groups["dataset"] + "/" + groups["kind"]
    _, hold = train_test_split(groups["group_id"], test_size=HOLDOUT_FRAC, stratify=strata,
                               random_state=SEED)

    out = videos[videos["group_id"].isin(set(hold))][["path", "group_id", "dataset", "label", "kind"]]
    out.to_csv(OUT_CSV, index=False)

    # ---- Check the mix ----
    videos["part"] = videos["group_id"].isin(set(hold)).map({True: "holdout", False: "train"})
    table = videos.pivot_table(index=["dataset", "label", "kind"], columns="part", values="path",
                               aggfunc="count", fill_value=0)
    table["holdout %"] = (100 * table["holdout"] / (table["holdout"] + table["train"])).round(1)
    print(f"Hold-out: {len(hold)} of {len(groups)} groups, {len(out)} of {len(videos)} clips -> {OUT_CSV}\n")
    print(table.to_string())
    pairs = out[out["dataset"] == "AIRTLab"].groupby("group_id").size()
    print(f"\nAIRTLab scenes in hold-out: {len(pairs)}, all with both camera views: {(pairs == 2).all()}")
    leaked = set(videos.loc[videos["part"] == "train", "group_id"]) & set(hold)
    print(f"Groups on both sides: {len(leaked)}")


if __name__ == "__main__":
    main()
