"""
list_videos.py - Scan data/ and write videos.csv (path, dataset, label, group_id).

label: 1 = fight / violent, 0 = not.
group_id: one per video, EXCEPT AIRTLab, where the same scene is filmed by
two cameras (cam1 / cam2). Those two files share one group_id so GroupKFold
never puts one camera view in train and the other in test (that would leak).

Usage:  python list_videos.py
"""
from pathlib import Path
import re
import pandas as pd

# ---------------- Tunable constants ----------------
DATA_DIR = Path("data")
OUT_CSV = Path("videos.csv")
VIDEO_EXTS = {".mp4", ".avi", ".mov", ".mkv", ".mpg", ".mpeg", ".wmv"}

# Dataset is detected from words in the path (lowercase). First match wins.
DATASET_KEYWORDS = [
    ("AIRTLab", ["airtlab", "airt", "violence-detection-dataset"]),
    ("RLVS", ["rlvs", "real life violence", "real_life_violence"]),
    ("SurveillanceFight", ["surveillance", "fight-detection-surv", "fight_detection"]),
]
# Fallback when folders carry no dataset name: recognise the file naming scheme.
DATASET_FILE_PATTERNS = [
    ("RLVS", r"^n?v_\d+"),                 # V_1.mp4 / NV_1.mp4
    ("SurveillanceFight", r"^(no)?fi\d+"),  # fi001.mp4 / nofi001.mp4
]

# Label is detected from folder / file names. NEGATIVE is checked first,
# because "nonviolence" contains "violence" and "nofight" contains "fight".
NEGATIVE_PATTERNS = [r"non[-_ ]?violen", r"no[-_ ]?fight", r"^nofi\d", r"^nv_", r"normal"]
POSITIVE_PATTERNS = [r"violen", r"fight", r"^fi\d", r"^v_"]
# ---------------------------------------------------


def detect_dataset(rel_path: Path) -> str:
    """Pick a dataset name from keywords in the path, else use the top folder name."""
    text = str(rel_path).lower().replace("\\", "/")
    if rel_path.parts[0].lower() == "own":
        return "Own"
    for name, keywords in DATASET_KEYWORDS:
        if any(k in text for k in keywords):
            return name
    for name, pattern in DATASET_FILE_PATTERNS:
        if re.search(pattern, rel_path.name.lower()):
            return name
    return rel_path.parts[0] if len(rel_path.parts) > 1 else "unknown"


def detect_label(rel_path: Path):
    """Return 1/0 from folder or file names, or None if unclear. Deepest part wins."""
    for part in reversed([p.lower() for p in rel_path.parts]):
        if any(re.search(p, part) for p in NEGATIVE_PATTERNS):
            return 0
        if any(re.search(p, part) for p in POSITIVE_PATTERNS):
            return 1
    return None


def make_group_key(rel_path: Path, dataset: str, label: int) -> str:
    """Key that identifies one real-world clip. AIRTLab cam1/cam2 of the same scene share a key."""
    if dataset == "AIRTLab":
        # Remove the camera folder (cam1 / cam2) so both views map to the same key.
        parts = [p for p in rel_path.parts[:-1] if not re.fullmatch(r"cam\d+", p.lower())]
        return f"AIRTLab/{label}/{'/'.join(parts)}/{rel_path.stem}"
    return str(rel_path)


def main():
    rows, unlabeled = [], []
    for f in sorted(DATA_DIR.rglob("*")):
        if not f.is_file() or f.suffix.lower() not in VIDEO_EXTS:
            continue
        rel = f.relative_to(DATA_DIR)
        dataset = detect_dataset(rel)
        label = detect_label(rel)
        if label is None:
            unlabeled.append(str(f))
            continue
        rows.append({"path": f.as_posix(), "dataset": dataset, "label": label,
                     "group_key": make_group_key(rel, dataset, label)})

    if not rows:
        print(f"No labeled videos found in {DATA_DIR.resolve()}")
        return

    df = pd.DataFrame(rows)
    # One integer group id per real-world clip.
    df["group_id"] = pd.factorize(df["group_key"])[0]
    df = df.drop(columns="group_key")
    df.to_csv(OUT_CSV, index=False)

    print(f"Wrote {len(df)} videos to {OUT_CSV}  ({df['group_id'].nunique()} groups)\n")
    counts = df.pivot_table(index="dataset", columns="label", values="path",
                            aggfunc="count", fill_value=0)
    counts.columns = [f"label_{c}" for c in counts.columns]
    counts["total"] = counts.sum(axis=1)
    print(counts.to_string())
    if unlabeled:
        print(f"\nWARNING: {len(unlabeled)} videos had no recognizable label and were skipped, e.g.:")
        for p in unlabeled[:10]:
            print("  ", p)


if __name__ == "__main__":
    main()
