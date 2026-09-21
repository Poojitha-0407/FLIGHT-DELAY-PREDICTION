"""Train the LightGBM delay classifier.

Jan-Sep to train, Oct for early stopping, Nov-Dec left alone for evaluate.py.
No class reweighting -- it would wreck the probabilities we actually want.
"""
from __future__ import annotations

import argparse
import json

import lightgbm as lgb
import numpy as np
from sklearn.isotonic import IsotonicRegression

from common import (
    FEATURES, MODEL_DIR, TARGET, carrier_vocab, encode, load_features, split_frames,
)

PARAMS = {
    "objective": "binary",
    "metric": ["auc", "binary_logloss"],
    "learning_rate": 0.05,
    "num_leaves": 96,
    "min_data_in_leaf": 200,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "lambda_l2": 1.0,
    "max_cat_to_onehot": 32,
    "verbosity": -1,
    "num_threads": 0,
    "seed": 42,
    # Otherwise thread scheduling moves best_iteration between runs.
    # deterministic needs one of the force_*_wise modes set. Costs ~2x time,
    # so --fast drops both.
    "deterministic": True,
    "force_row_wise": True,
}


def fit_calibrator(probs: np.ndarray, labels: np.ndarray, n_points: int = 64) -> dict:
    """Isotonic calibration as breakpoints the API can interpolate.

    Beats pickling the estimator -- keeps sklearn out of the serverless bundle.
    """
    iso = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0)
    iso.fit(probs, labels)
    grid = np.linspace(probs.min(), probs.max(), n_points)
    return {"x": [round(float(v), 6) for v in grid],
            "y": [round(float(v), 6) for v in iso.predict(grid)]}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rounds", type=int, default=3000)
    ap.add_argument("--early-stopping", type=int, default=100)
    ap.add_argument("--no-calibration", action="store_true")
    ap.add_argument(
        "--no-refit",
        action="store_true",
        help="skip the all-months refit and deploy the chronological model",
    )
    ap.add_argument(
        "--fast",
        action="store_true",
        help="drop the determinism settings; trains quicker, not reproducible",
    )
    args = ap.parse_args()

    if args.fast:
        PARAMS.pop("deterministic", None)
        PARAMS.pop("force_row_wise", None)
        print("--fast: determinism disabled, runs will not reproduce exactly")

    df = load_features()
    train, valid, test = split_frames(df)
    vocab = carrier_vocab(df)
    print(f"train={len(train):,}  valid={len(valid):,}  test={len(test):,}")
    print(f"base delay rate (train) = {train[TARGET].mean():.4f}")

    d_train = lgb.Dataset(
        encode(train, vocab), label=train[TARGET],
        categorical_feature=["carrier"], free_raw_data=False,
    )
    d_valid = lgb.Dataset(
        encode(valid, vocab), label=valid[TARGET],
        categorical_feature=["carrier"], reference=d_train, free_raw_data=False,
    )

    booster = lgb.train(
        PARAMS,
        d_train,
        num_boost_round=args.rounds,
        valid_sets=[d_train, d_valid],
        valid_names=["train", "valid"],
        callbacks=[
            lgb.early_stopping(args.early_stopping, verbose=True),
            lgb.log_evaluation(100),
        ],
    )

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    booster.save_model(str(MODEL_DIR / "model.txt"), num_iteration=booster.best_iteration)
    print(f"\nbest_iteration = {booster.best_iteration}")

    calibration = None
    if not args.no_calibration:
        raw = booster.predict(encode(valid, vocab), num_iteration=booster.best_iteration)
        calibration = fit_calibrator(np.asarray(raw), valid[TARGET].to_numpy())
    (MODEL_DIR / "calibration.json").write_text(json.dumps(calibration))

    (MODEL_DIR / "feature_config.json").write_text(json.dumps({
        "features": FEATURES,
        "categorical": ["carrier"],
        "carrier_vocab": vocab,
        "target": "arrival more than 30 minutes late",
        "best_iteration": booster.best_iteration,
        "train_rows": int(len(train)),
        "base_rate": round(float(train[TARGET].mean()), 6),
        # fallback for anything the live request can't resolve
        "defaults": {
            c: (None if train[c].isna().all() else round(float(train[c].median()), 6))
            for c in FEATURES if c != "carrier"
        },
    }, indent=2))

    if not args.no_refit:
        refit_full(df, vocab, booster.best_iteration)

    print(f"Wrote model + config to {MODEL_DIR}")


def refit_full(df, vocab: list[str], rounds: int) -> None:
    """Refit on all 12 months for deployment.

    The chronological model is what evaluate.py scores and it's the honest
    number, but it's the wrong thing to deploy: it never saw a November, so
    month_sin/cos for Nov-Dec fall outside its training range and it
    extrapolates. Cost is ~5 points of under-prediction on the test months
    (0.12 predicted vs 0.17 observed).

    Rounds are inherited, not re-searched -- there's no held-out set left.
    """
    full = df[df["split"].isin(["train", "valid", "test"])]
    dataset = lgb.Dataset(
        encode(full, vocab), label=full[TARGET],
        categorical_feature=["carrier"], free_raw_data=False,
    )
    booster = lgb.train(PARAMS, dataset, num_boost_round=rounds)
    booster.save_model(str(MODEL_DIR / "model_deploy.txt"))
    print(f"Refit on all {len(full):,} rows for {rounds} rounds -> model_deploy.txt")


if __name__ == "__main__":
    main()
