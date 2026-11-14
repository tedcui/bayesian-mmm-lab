"""Build a complete weekly mart and a strict, unscaled modeling projection."""

from __future__ import annotations

from datetime import date, timedelta

import numpy as np
import pandas as pd

from mmm_lab.simulation.config import SEGMENT_STATES


MODEL_COLUMNS = [
    "segment_id", "week_start", "time_index", "is_holdout", "sales_units",
    "price_index", "distribution_index", "competitor_index", "holiday",
    "coupon_spend", "retailer_promo_spend", "digital_spend",
]

SPEND_NAMES = {
    "coupon": "coupon_spend",
    "retailer_promotion": "retailer_promo_spend",
    "digital": "digital_spend",
}


def build_panel(weekly: pd.DataFrame, excluded_weekly: pd.DataFrame,
                plans: pd.DataFrame, contexts: pd.DataFrame,
                config: dict) -> tuple[pd.DataFrame, pd.DataFrame]:
    first = date.fromisoformat(config["start_date"])
    weeks = [first + timedelta(weeks=i) for i in range(config["weeks"])]
    calendar = pd.DataFrame(
        [(segment, week, i + 1) for segment in SEGMENT_STATES for i, week in enumerate(weeks)],
        columns=["segment_id", "week_start", "time_index"],
    )
    if weekly.duplicated(["segment_id", "week_start"]).any():
        raise ValueError("Duplicate eligible segment-week aggregates")
    expected = set(zip(calendar.segment_id, calendar.week_start))
    actual = set(zip(weekly.segment_id, weekly.week_start))
    if actual != expected:
        missing = expected - actual
        extra = actual - expected
        raise ValueError(f"Eligible sales calendar incomplete: {len(missing)} missing, {len(extra)} extra; no implicit zero fill")
    spend = plans.pivot(index=["segment_id", "week_start"], columns="channel", values="planned_spend")
    spend = spend.rename(columns=SPEND_NAMES).reset_index()
    mart = calendar.merge(weekly, on=["segment_id", "week_start"], how="left", validate="one_to_one")
    mart = mart.merge(excluded_weekly, on=["segment_id", "week_start"], how="left", validate="one_to_one")
    for name in ("excluded_transaction_lines", "excluded_source_units", "unmatched_product_lines", "null_upc_lines"):
        mart[name] = mart[name].fillna(0).astype("int64")
    mart = mart.merge(spend, on=["segment_id", "week_start"], how="left", validate="one_to_one")
    mart = mart.merge(contexts, on=["segment_id", "week_start"], how="left", validate="one_to_one")
    mart = mart.rename(columns={
        "planned_price_index": "price_index",
        "availability_index": "distribution_index",
    })
    mart["holiday"] = mart.week_start.map(lambda day: int(day.isocalendar().week in (47, 48, 49, 50, 51, 52)))
    mart["is_holdout"] = mart.time_index > 100
    if mart[MODEL_COLUMNS].isna().any().any():
        raise ValueError("Model features contain nulls after source joins")
    if not np.isfinite(mart.select_dtypes(include="number").to_numpy()).all():
        raise ValueError("Nonfinite numeric mart values")
    if len(mart) != len(expected) or mart.duplicated(["segment_id", "week_start"]).any():
        raise ValueError("Mart calendar is not unique and complete")
    model = mart.loc[:, MODEL_COLUMNS].copy()
    return mart, model
