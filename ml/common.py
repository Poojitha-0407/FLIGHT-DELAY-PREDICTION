"""Loading and encoding, shared by train/evaluate/export."""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))

from config import (  # noqa: E402
    CATEGORICAL_FEATURES, FEATURES, NUMERIC_FEATURES, PROCESSED, TARGET,
)

FEATURES_PARQUET = PROCESSED / "features.parquet"
MODEL_DIR = ROOT / "ml" / "artifacts"
REPORT_DIR = ROOT / "ml" / "reports"


def load_features() -> pd.DataFrame:
    if not FEATURES_PARQUET.exists():
        raise SystemExit(
            f"{FEATURES_PARQUET} not found. Run: make transform"
        )
    return pd.read_parquet(FEATURES_PARQUET)


def carrier_vocab(df: pd.DataFrame) -> list[str]:
    """Train split only. Unseen carriers map to -1."""
    return sorted(df.loc[df["split"] == "train", "carrier"].dropna().unique().tolist())


def encode(df: pd.DataFrame, vocab: list[str]) -> pd.DataFrame:
    """Model matrix. Column order fixed by config.FEATURES."""
    lookup = {c: i for i, c in enumerate(vocab)}
    out = df[NUMERIC_FEATURES].astype("float64").copy()
    for col in CATEGORICAL_FEATURES:
        out[col] = df[col].map(lookup).fillna(-1).astype("int32")
    return out[FEATURES]


def split_frames(df: pd.DataFrame):
    return (
        df[df["split"] == "train"],
        df[df["split"] == "valid"],
        df[df["split"] == "test"],
    )


__all__ = [
    "CATEGORICAL_FEATURES", "FEATURES", "NUMERIC_FEATURES", "TARGET",
    "FEATURES_PARQUET", "MODEL_DIR", "REPORT_DIR", "ROOT",
    "carrier_vocab", "encode", "load_features", "split_frames",
]
