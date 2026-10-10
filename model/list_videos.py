"""
list_videos.py - Scan data/ and write videos.csv (path, dataset, label, kind, domain, group_id).

label:  1 = violent (fight or weapon), 0 = not violent.
kind:   finer class for reporting: fight / weapon / normal / acted_nonviolent (AIRTLab hugs, claps, ...)
domain: youtube / acted / cctv (used for sample weights and per-domain reporting)
group_id: one per video, EXCEPT AIRTLab, where the same scene is filmed by two cameras (cam1 / cam2).
          Both views share one group_id so GroupKFold never puts one view in train and the other in test.

Folder rules (first match wins), paths relative to data/:
  Violence/, NonViolence/                RLVS (V_*.mp4 / NV_*.mp4)
  AIRTLab/joking_violent/cam*/           AIRTLab, violent (acted fights)
  AIRTLab/non-violent/cam*/              AIRTLab, not violent (acted hugs, claps, high-fives, ...)
  cctv/*/fi*, cctv/*/nofi*               SCF  (Surveillance Camera Fight)
  cctv/*/v*, t_v*  /  cctv/*/n*, t_n*    SCVD fight / normal (t_ = SCVD's own test split)
  weaponizeViolence/w*, t_w*             SCVD weapon (violent)
  own/violent|nonviolent/<kind>_*        Own clips from record_clips.py
Anything else is skipped with a warning.

Usage:  python list_videos.py
"""
import re
from pathlib import Path

import pandas as pd

# ---------------- Tunable constants ----------------
DATA_DIR = Path("data")
OUT_CSV = Path("videos.csv")
VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".mpg", ".mpeg", ".wmv"}
# ---------------------------------------------------


def classify(rel: Path):
    """Return (dataset, label, kind, domain) for a path relative to data/, or None if unknown."""
    parts = [p.lower() for p in rel.parts]
    top, name = parts[0], rel.name.lower()

    if top == "violence":
        return "RLVS", 1, "fight", "youtube"
    if top == "nonviolence":
        return "RLVS", 0, "normal", "youtube"

    if top == "airtlab":
        if "joking_violent" in parts:
            return "AIRTLab", 1, "fight", "acted"
        if "non-violent" in parts:
            return "AIRTLab", 0, "acted_nonviolent", "acted"

    if top == "cctv":
        # nofi must be checked before fi, and t_ prefixes before the plain ones.
        if re.match(r"nofi\d", name):
            return "SCF", 0, "normal", "cctv"
        if re.match(r"fi\d", name):
            return "SCF", 1, "fight", "cctv"
        if re.match(r"(t_)?v\d", name):
            return "SCVD", 1, "fight", "cctv"
        if re.match(r"(t_)?n\d", name):
            return "SCVD", 0, "normal", "cctv"

    if top == "weaponizeviolence" and re.match(r"(t_)?w\d", name):
        return "SCVD", 1, "weapon", "cctv"

    if top == "own" and len(parts) >= 3:
        label = {"violent": 1, "nonviolent": 0}.get(parts[1])
        if label is not None:
            return "Own", label, name.split("_")[0], "acted"
    return None


def group_key(rel: Path, dataset: str) -> str:
    """Key that identifies one real-world scene. AIRTLab cam1/cam2 of the same scene share a key."""
    if dataset == "AIRTLab":
        parts = [p for p in rel.parts[:-1] if not re.fullmatch(r"cam\d+", p.lower())]
        return "/".join(parts + [rel.stem])
    return rel.as_posix()


def main():
    rows, unknown = [], []
    for f in sorted(DATA_DIR.rglob("*")):
        if not f.is_file() or f.suffix.lower() not in VIDEO_EXTS:
            continue
        rel = f.relative_to(DATA_DIR)
        info = classify(rel)
        if info is None:
            unknown.append(rel.as_posix())
            continue
        dataset, label, kind, domain = info
        rows.append({"path": f.as_posix(), "dataset": dataset, "label": label, "kind": kind,
                     "domain": domain, "group_key": group_key(rel, dataset)})

    if not rows:
        print(f"No labelled videos found in {DATA_DIR.resolve()}")
        return
    df = pd.DataFrame(rows)
    df["group_id"] = pd.factorize(df["group_key"])[0]  # one integer per real-world scene
    df = df.drop(columns="group_key")
    df.to_csv(OUT_CSV, index=False)

    print(f"Wrote {len(df)} videos to {OUT_CSV}  ({df['group_id'].nunique()} groups)\n")
    counts = df.pivot_table(index=["dataset", "domain"], columns="label", values="path",
                            aggfunc="count", fill_value=0)
    counts.columns = [f"label_{c}" for c in counts.columns]
    counts["total"] = counts.sum(axis=1)
    counts["groups"] = df.groupby(["dataset", "domain"])["group_id"].nunique()
    print(counts.to_string())
    print("\nBy kind:")
    print(df.groupby(["dataset", "label", "kind"]).size().to_string())
    if unknown:
        print(f"\nWARNING: {len(unknown)} videos matched no rule and were skipped, e.g.:")
        for p in unknown[:10]:
            print("  ", p)


if __name__ == "__main__":
    main()
