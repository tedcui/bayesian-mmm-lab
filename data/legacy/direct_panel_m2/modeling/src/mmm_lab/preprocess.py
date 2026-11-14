"""Validate observable data and fit control scaling on training weeks only."""

from __future__ import annotations

import numpy as np
import pandas as pd

OBSERVABLE_COLUMNS = (
    "segment", "week_index", "week_start", "coupon_spend", "retailer_spend",
    "digital_spend", "price_index", "distribution_index", "competitor_index",
    "holiday", "trend", "season_sin", "season_cos", "sales_units",
)
SCALED_CONTROLS = ("price_index", "distribution_index", "competitor_index")


def prepare_model_table(raw: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """Add a fixed temporal split and train-only standardized controls."""
    if tuple(raw.columns) != OBSERVABLE_COLUMNS:
        raise ValueError("Observable schema differs from the expected column order")
    if raw.duplicated(["segment", "week_index"]).any():
        raise ValueError("Duplicate segment-week observations")
    if raw.isna().any().any() or not np.isfinite(raw.select_dtypes(include="number").to_numpy()).all():
        raise ValueError("Missing or nonfinite observable values")
    if (raw["week_index"] < 1).any() or (raw["week_index"] > 120).any():
        raise ValueError("week_index outside 1–120")
    if (raw[["coupon_spend", "retailer_spend", "digital_spend", "sales_units"]] < 0).any().any():
        raise ValueError("Negative spend or sales")
    if not raw["segment"].isin(tuple("ABCDEF")).all():
        raise ValueError("Unknown segment")

    prepared = raw.copy()
    prepared["split"] = np.where(prepared["week_index"] <= 100, "train", "holdout")
    train = prepared["split"] == "train"
    scaling: dict[str, dict[str, float]] = {}
    for column in SCALED_CONTROLS:
        mean = float(prepared.loc[train, column].mean())
        standard_deviation = float(prepared.loc[train, column].std(ddof=0))
        if standard_deviation <= 0:
            raise ValueError(f"Training control {column} has zero variation")
        prepared[f"{column}_z"] = (prepared[column] - mean) / standard_deviation
        scaling[column] = {"train_mean": mean, "train_standard_deviation": standard_deviation}
    metadata = {"training_week_end": 100, "scaling_scope": "pooled training rows only", "controls": scaling}
    return prepared, metadata
