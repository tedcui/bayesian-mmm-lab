"""Aggregate eligible transaction details without confusing lines, baskets, and units."""

from __future__ import annotations

import pandas as pd


KEY = ["segment_id", "week_start"]


def aggregate_transactions(enriched: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    eligible = enriched.loc[enriched["is_eligible"]]
    weekly = eligible.groupby(KEY, sort=True).agg(
        sales_units=("quantity_units", "sum"),
        eligible_transaction_lines=("TRANSACTION_ID", "size"),
        observed_baskets=("MARKET_BASKET_TRANSACTION_ID", "nunique"),
        unique_selling_stores=("STORE_ID", "nunique"),
        source_submission_count=("FILE_SUBMISSION_ID", "nunique"),
        promo_lines=("PROMOTION_FLAG", "sum"),
        observed_gross_sales_usd=("line_gross_sales_usd", "sum"),
        observed_net_sales_usd=("line_net_sales_usd", "sum"),
        redeemed_coupon_discount_usd=("redeemed_coupon_discount_usd", "sum"),
        redeemed_account_discount_usd=("redeemed_account_discount_usd", "sum"),
        redeemed_mfg_discount_usd=("redeemed_mfg_discount_usd", "sum"),
    ).reset_index()
    weekly["promo_line_rate"] = weekly["promo_lines"] / weekly["eligible_transaction_lines"]
    weekly = weekly.drop(columns="promo_lines")
    excluded = enriched.loc[~enriched["is_eligible"] & enriched["segment_id"].notna() &
                            enriched["week_start"].notna()].copy()
    if excluded.empty:
        excluded_weekly = pd.DataFrame(columns=[*KEY, "excluded_transaction_lines", "excluded_source_units",
                                                "unmatched_product_lines", "null_upc_lines"])
    else:
        excluded["unmatched_product_lines"] = (~excluded["product_match"]).astype(int)
        excluded["null_upc_lines"] = excluded["null_upc"].astype(int)
        excluded_weekly = excluded.groupby(KEY, sort=True).agg(
            excluded_transaction_lines=("TRANSACTION_ID", "size"),
            excluded_source_units=("quantity_units", "sum"),
            unmatched_product_lines=("unmatched_product_lines", "sum"),
            null_upc_lines=("null_upc_lines", "sum"),
        ).reset_index()
    return weekly, excluded_weekly
