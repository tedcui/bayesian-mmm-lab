"""Source-to-mart reconciliation and deterministic lineage reports."""

from __future__ import annotations

from collections import Counter

import numpy as np
import pandas as pd

from mmm_lab.etl.features import SPEND_NAMES


def make_reports(enriched: pd.DataFrame, mart: pd.DataFrame, plans: pd.DataFrame) -> tuple[dict, dict]:
    eligible = enriched.loc[enriched.is_eligible]
    by_cell = eligible.groupby(["segment_id", "week_start"], sort=True).quantity_units.sum()
    expected = mart.set_index(["segment_id", "week_start"]).sales_units
    if not by_cell.sort_index().equals(expected.sort_index()):
        raise ValueError("Source quantity does not reconcile to mart by segment-week")
    if int(eligible.quantity_units.sum()) != int(mart.sales_units.sum()):
        raise ValueError("Source quantity does not reconcile to mart total")
    spend_totals = {}
    for channel, column in SPEND_NAMES.items():
        source = plans.loc[plans.channel == channel].set_index(["segment_id", "week_start"]).planned_spend
        target = mart.set_index(["segment_id", "week_start"])[column]
        if not np.allclose(source.sort_index(), target.sort_index(), atol=1e-9, rtol=0):
            raise ValueError(f"Planned {channel} spend does not reconcile by segment-week")
        spend_totals[channel] = round(float(source.sum()), 6)
    reason_counts = Counter(
        reason for entry in enriched.exclusion_reasons.dropna()
        for reason in entry.split("|")
    )
    quality = {
        "source_transaction_lines": int(len(enriched)),
        "eligible_transaction_lines": int(enriched.is_eligible.sum()),
        "excluded_transaction_lines": int((~enriched.is_eligible).sum()),
        "store_matched_lines": int(enriched.store_match.sum()),
        "product_matched_lines": int(enriched.product_match.sum()),
        "null_upc_lines": int(enriched.null_upc.sum()),
        "join_fanout_lines": int(enriched.join_fanout.sum()),
        "exclusion_reason_counts": dict(sorted(reason_counts.items())),
        "source_file_submissions": int(enriched.FILE_SUBMISSION_ID.nunique()),
        "event_week_min": str(enriched.week_start.min()),
        "event_week_max": str(enriched.week_start.max()),
    }
    reconciliation = {
        "source_eligible_units": int(eligible.quantity_units.sum()),
        "mart_sales_units": int(mart.sales_units.sum()),
        "segment_weeks_reconciled": int(len(mart)),
        "planned_spend_usd_by_channel": spend_totals,
        "excluded_source_units": int(enriched.loc[~enriched.is_eligible, "quantity_units"].sum()),
        "unmatched_store_lines_outside_geography": int((~enriched.store_match).sum()),
    }
    return quality, reconciliation
