"""
seq_train.py - Step 4 of TRAINING_PLAN.md: small 1D-CNN over the active pair's keypoint sequence.
Runs on the GPU server. TRAINING PART only (hold-out windows in seq_windows.npz are skipped).

Input: seq_windows.npz from seq_dataset.py, (n, 20, 2, 17, 4). Label = clip label for every window.
Folds: the same folds.csv as tune_lgbm.py; inside each training fold, VAL_FRAC of its groups are used
for early stopping on validation clip AUC. Sample weights: same dataset weights and hug multiplier as
the LightGBM pick (best_lgbm.json).
Augmentation (training only): left-right flip, scale and position jitter, swap the two people.

Writes oof_seq.csv (out-of-fold window scores), seq_fold0.onnx (for the laptop speed test) and
seq_train.json (settings, epochs, fold AUCs).

Usage:  python seq_train.py
"""
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.metrics import roc_auc_score

from seq_features import FLIP

# ---------------- Tunable constants ----------------
DATA_NPZ = Path("seq_windows.npz")
FOLDS_CSV = Path("folds.csv")
BEST_LGBM = Path("best_lgbm.json")
OOF_CSV = Path("oof_seq.csv")
ONNX_OUT = Path("seq_fold0.onnx")
INFO_JSON = Path("seq_train.json")
CLIP_JSON = Path("seq_clip.json")   # x, y range (1st-99th percentile of training data), used live too
N_FOLDS = 5
SEED = 42
HIDDEN = 64              # channels per conv layer (keep it small: must run < 20 ms on the laptop)
DROPOUT = 0.3
LR = 1e-3
WEIGHT_DECAY = 1e-4
BATCH = 512
MAX_EPOCHS = 40
PATIENCE = 6             # stop after this many epochs without a better validation clip AUC
VAL_FRAC = 0.15          # share of each training fold's groups used for early stopping
SCALE_JITTER = 0.1       # x, y multiplied by U(1 - j, 1 + j)
SHIFT_JITTER = 0.1       # x, y shifted by U(-j, j) torso lengths
DEFAULT_WEIGHTS = {"w_airtlab": 3.0, "w_cctv": 2.0, "hug_mult": 1.0}
# ---------------------------------------------------

DEV = "cuda" if torch.cuda.is_available() else "cpu"


class SeqNet(nn.Module):
    """(B, 20, 2, 17, 4) -> fight logit. Dilated 1D convolutions over time, then max + mean pooling."""

    def __init__(self, c_in=2 * 17 * 4, hidden=HIDDEN, dropout=DROPOUT):
        super().__init__()
        layers, c = [], c_in
        for d in (1, 2, 4):
            layers += [nn.Conv1d(c, hidden, 3, padding=d, dilation=d), nn.BatchNorm1d(hidden), nn.ReLU()]
            c = hidden
        self.conv = nn.Sequential(*layers)
        self.head = nn.Sequential(nn.Dropout(dropout), nn.Linear(2 * hidden, 1))

    def forward(self, x):
        b, t = x.shape[0], x.shape[1]
        h = self.conv(x.reshape(b, t, -1).transpose(1, 2))         # (B, hidden, T)
        return self.head(torch.cat([h.amax(dim=2), h.mean(dim=2)], dim=1)).squeeze(1)


def augment(x):
    """x: (B, 20, 2, 17, 4) on the GPU. Keeps missing keypoints at zero."""
    b = x.shape[0]
    flip = torch.rand(b, device=x.device) < 0.5
    xf = x[:, :, :, FLIP].clone()
    xf[..., 0] = -xf[..., 0]
    x = torch.where(flip[:, None, None, None, None], xf, x)
    swap = torch.rand(b, device=x.device) < 0.5
    x = torch.where(swap[:, None, None, None, None], x.flip(2), x)
    seen = (x[..., 2:3] > 0).float()                               # keypoint present
    scale = 1 + (torch.rand(b, 1, 1, 1, 1, device=x.device) * 2 - 1) * SCALE_JITTER
    shift = (torch.rand(b, 1, 1, 1, 2, device=x.device) * 2 - 1) * SHIFT_JITTER
    xy = (x[..., :2] * scale + shift) * seen
    return torch.cat([xy, x[..., 2:]], dim=-1)


def trainable(d):
    """Windows a model may train on: never synthetic one-person copies of violent clips (not a fight)."""
    return ~(np.isin(d["crop"], ["single", "close"]) & (d["label"] == 1))


def coord_range(X, rng):
    """1st-99th percentile of present x, y values (sampled)."""
    present = (X[..., 3] > 0) & (X[..., 2] > 0)
    vals = X[..., :2][present].astype(np.float32).ravel()
    vals = rng.choice(vals, min(len(vals), 2_000_000), replace=False)
    return [float(v) for v in np.percentile(vals, [1, 99])]


def clip_coords(X, lo, hi):
    """Clip x, y in place (missing points are 0, which is inside the range, so they stay 0)."""
    np.clip(X[..., :2], lo, hi, out=X[..., :2])
    return X


def predict(model, X):
    model.eval()
    out = []
    with torch.no_grad():
        for i in range(0, len(X), 4096):
            out.append(torch.sigmoid(model(torch.as_tensor(X[i:i + 4096], device=DEV).float())).cpu().numpy())
    return np.concatenate(out)


def clip_auc(paths, labels, p):
    d = pd.DataFrame({"path": paths, "label": labels, "p": p}).groupby("path").agg(label=("label", "first"),
                                                                                   p=("p", "max"))
    return roc_auc_score(d["label"], d["p"])


def train_fold(X, y, w, paths, groups, tr, rng):
    """Train on windows `tr` with early stopping on a group-wise validation split. Returns the model."""
    tr_groups = np.unique(groups[tr])
    val_groups = set(rng.choice(tr_groups, int(len(tr_groups) * VAL_FRAC), replace=False))
    is_val = np.isin(groups, list(val_groups))
    fit, val = tr & ~is_val, tr & is_val
    Xf = torch.as_tensor(X[fit], device=DEV).float()
    yf = torch.as_tensor(y[fit], device=DEV).float()
    wf = torch.as_tensor(w[fit], device=DEV).float()
    model = SeqNet().to(DEV)
    opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=WEIGHT_DECAY)
    loss_fn = nn.BCEWithLogitsLoss(reduction="none")
    best, best_state, best_epoch, bad = -1.0, None, 0, 0
    for epoch in range(MAX_EPOCHS):
        model.train()
        order = torch.randperm(len(Xf), device=DEV)
        for i in range(0, len(order), BATCH):
            idx = order[i:i + BATCH]
            loss = (loss_fn(model(augment(Xf[idx])), yf[idx]) * wf[idx]).sum() / wf[idx].sum()
            opt.zero_grad()
            loss.backward()
            opt.step()
        auc = clip_auc(paths[val], y[val], predict(model, X[val]))
        if auc > best:
            best, best_epoch, bad = auc, epoch, 0
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
        else:
            bad += 1
            if bad >= PATIENCE:
                break
    model.load_state_dict(best_state)
    return model, best, best_epoch


def main():
    torch.manual_seed(SEED)
    rng = np.random.default_rng(SEED)
    d = np.load(DATA_NPZ, allow_pickle=True)  # our own file from seq_dataset.py
    keep = (d["holdout"] == 0) & trainable(d)   # training part only, no one-person copies of fights
    X, y = d["X"][keep], d["label"][keep].astype(np.float32)
    paths, groups = d["path"][keep], d["group_id"][keep]
    dataset, kind, end_s = d["dataset"][keep], d["kind"][keep], d["end_s"][keep]
    lo, hi = coord_range(X, rng)
    CLIP_JSON.write_text(json.dumps({"lo": lo, "hi": hi}))
    X = clip_coords(X, lo, hi)
    print(f"coordinates clipped to [{lo:.2f}, {hi:.2f}]")
    fold = pd.Series(groups).map(pd.read_csv(FOLDS_CSV).set_index("group_id")["fold"]).to_numpy()
    assert not np.isnan(fold).any(), "a training-part group has no fold"
    wcfg = json.loads(BEST_LGBM.read_text())["settings"] if BEST_LGBM.exists() else DEFAULT_WEIGHTS
    w = pd.Series(dataset).map({"AIRTLab": wcfg["w_airtlab"], "SCF": wcfg["w_cctv"], "SCVD": wcfg["w_cctv"],
                                "RLVS": 1.0}).fillna(1.0).to_numpy()
    w = np.where((dataset == "AIRTLab") & (y == 0), w * wcfg["hug_mult"], w).astype(np.float32)
    print(f"{len(X)} training-part windows on {DEV}; weights {wcfg}; "
          f"{sum(p.numel() for p in SeqNet().parameters())} parameters")

    oof, info, start = np.zeros(len(X)), {"folds": []}, time.time()
    for k in range(N_FOLDS):
        model, val_auc, epoch = train_fold(X, y, w, paths, groups, fold != k, rng)
        te = fold == k
        oof[te] = predict(model, X[te])
        test_auc = clip_auc(paths[te], y[te], oof[te])
        info["folds"].append({"fold": k, "val_clip_auc": val_auc, "best_epoch": epoch, "test_clip_auc": test_auc})
        print(f"fold {k}: best epoch {epoch}, val clip AUC {val_auc:.4f}, test clip AUC {test_auc:.4f} "
              f"({time.time() - start:.0f} s)", flush=True)
        if k == 0:
            model.eval().cpu()
            torch.onnx.export(model, torch.zeros(1, 20, 2, 17, 4), str(ONNX_OUT), input_names=["x"],
                              output_names=["logit"], opset_version=17, dynamo=False)
            model.to(DEV)

    pd.DataFrame({"path": paths, "end_s": end_s, "label": y.astype(int), "dataset": dataset, "kind": kind,
                  "group_id": groups, "fold": fold.astype(int), "p": oof}).to_csv(OOF_CSV, index=False)
    info.update(oof_clip_auc=clip_auc(paths, y, oof), weights=wcfg, hidden=HIDDEN, dropout=DROPOUT,
                params=sum(p.numel() for p in SeqNet().parameters()), minutes=(time.time() - start) / 60)
    INFO_JSON.write_text(json.dumps(info, indent=2, default=float))
    print(f"Out-of-fold clip AUC {info['oof_clip_auc']:.4f}. Saved {OOF_CSV}, {ONNX_OUT}, {INFO_JSON}")


if __name__ == "__main__":
    main()
