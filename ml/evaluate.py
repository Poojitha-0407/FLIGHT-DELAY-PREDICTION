"""Evaluate on the held-out Nov-Dec months.

Delays are the minority class so accuracy is useless here. What matters is
ranking (ROC-AUC, PR-AUC, lift) and whether the numbers can be read as
probabilities at all (Brier, calibration).
"""
from __future__ import annotations

import argparse
import json

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import (
    average_precision_score, brier_score_loss, log_loss, roc_auc_score,
)

from common import MODEL_DIR, REPORT_DIR, TARGET, carrier_vocab, encode, load_features, split_frames


def apply_calibration(probs: np.ndarray, calib: dict | None) -> np.ndarray:
    if not calib:
        return probs
    return np.interp(probs, calib["x"], calib["y"])


def calibration_table(probs: np.ndarray, labels: np.ndarray, bins: int = 10) -> pd.DataFrame:
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(probs, edges) - 1, 0, bins - 1)
    rows = []
    for b in range(bins):
        m = idx == b
        if not m.any():
            continue
        rows.append({
            "bin": f"{edges[b]:.1f}-{edges[b + 1]:.1f}",
            "n": int(m.sum()),
            "predicted": round(float(probs[m].mean()), 4),
            "observed": round(float(labels[m].mean()), 4),
        })
    return pd.DataFrame(rows)


def lift_table(probs: np.ndarray, labels: np.ndarray, deciles: int = 10) -> pd.DataFrame:
    order = np.argsort(-probs)
    chunks = np.array_split(order, deciles)
    base = labels.mean()
    rows = []
    for i, chunk in enumerate(chunks, start=1):
        rate = labels[chunk].mean()
        rows.append({
            "decile": i,
            "n": len(chunk),
            "mean_predicted": round(float(probs[chunk].mean()), 4),
            "observed_delay_rate": round(float(rate), 4),
            "lift": round(float(rate / base), 2) if base else None,
        })
    return pd.DataFrame(rows)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--split", default="test", choices=["valid", "test"])
    ap.add_argument("--plots", action="store_true", help="also write PNG charts")
    args = ap.parse_args()

    model_path = MODEL_DIR / "model.txt"
    if not model_path.exists():
        raise SystemExit(f"{model_path} not found. Run: make train")

    booster = lgb.Booster(model_file=str(model_path))
    calib = json.loads((MODEL_DIR / "calibration.json").read_text())

    df = load_features()
    vocab = carrier_vocab(df)
    train, valid, test = split_frames(df)
    frame = valid if args.split == "valid" else test

    y = frame[TARGET].to_numpy()
    raw = booster.predict(encode(frame, vocab))
    probs = apply_calibration(np.asarray(raw), calib)

    base = float(y.mean())
    metrics = {
        "split": args.split,
        "rows": int(len(frame)),
        "date_range": [str(frame["flight_date"].min()), str(frame["flight_date"].max())],
        "base_delay_rate": round(base, 4),
        "roc_auc": round(float(roc_auc_score(y, probs)), 4),
        "pr_auc": round(float(average_precision_score(y, probs)), 4),
        "pr_auc_lift_over_base": round(float(average_precision_score(y, probs) / base), 2),
        "brier": round(float(brier_score_loss(y, probs)), 4),
        "brier_baseline": round(float(brier_score_loss(y, np.full_like(probs, base))), 4),
        "log_loss": round(float(log_loss(y, probs)), 4),
    }

    importance = pd.DataFrame({
        "feature": booster.feature_name(),
        "gain": booster.feature_importance("gain"),
        "split_count": booster.feature_importance("split"),
    }).sort_values("gain", ascending=False)
    importance["gain_pct"] = (
        100 * importance["gain"] / importance["gain"].sum()
    ).round(2) if importance["gain"].sum() else 0.0

    calib_tbl = calibration_table(probs, y)
    lift_tbl = lift_table(probs, y)

    print(json.dumps(metrics, indent=2))
    print("\nTop features by gain")
    print(importance.head(15).to_string(index=False))
    print("\nCalibration")
    print(calib_tbl.to_string(index=False))
    print("\nLift by decile")
    print(lift_tbl.to_string(index=False))

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    (REPORT_DIR / f"metrics_{args.split}.json").write_text(json.dumps({
        "metrics": metrics,
        "calibration": calib_tbl.to_dict("records"),
        "lift": lift_tbl.to_dict("records"),
        "feature_importance": importance.to_dict("records"),
    }, indent=2))
    print(f"\nWrote {REPORT_DIR / f'metrics_{args.split}.json'}")

    if args.plots:
        _plots(probs, y, importance, calib_tbl, args.split)


def _plots(probs, y, importance, calib_tbl, split) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from sklearn.metrics import precision_recall_curve, roc_curve

    fig, axes = plt.subplots(1, 3, figsize=(16, 4.5))

    fpr, tpr, _ = roc_curve(y, probs)
    axes[0].plot(fpr, tpr)
    axes[0].plot([0, 1], [0, 1], "--", lw=0.8, color="grey")
    axes[0].set(title="ROC", xlabel="false positive rate", ylabel="true positive rate")

    prec, rec, _ = precision_recall_curve(y, probs)
    axes[1].plot(rec, prec)
    axes[1].axhline(y.mean(), ls="--", lw=0.8, color="grey")
    axes[1].set(title="Precision-Recall", xlabel="recall", ylabel="precision")

    axes[2].plot(calib_tbl["predicted"], calib_tbl["observed"], "o-")
    axes[2].plot([0, 1], [0, 1], "--", lw=0.8, color="grey")
    axes[2].set(title="Calibration", xlabel="predicted", ylabel="observed")

    fig.tight_layout()
    fig.savefig(REPORT_DIR / f"curves_{split}.png", dpi=130)

    top = importance.head(20).iloc[::-1]
    fig2, ax = plt.subplots(figsize=(8, 7))
    ax.barh(top["feature"], top["gain"])
    ax.set(title="Feature importance (gain)")
    fig2.tight_layout()
    fig2.savefig(REPORT_DIR / f"importance_{split}.png", dpi=130)
    print(f"Wrote plots to {REPORT_DIR}")


if __name__ == "__main__":
    main()
