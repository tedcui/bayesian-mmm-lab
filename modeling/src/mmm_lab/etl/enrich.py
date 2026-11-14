"""Nonmultiplying left enrichment and synthetic-only eligibility rules."""

from __future__ import annotations

from datetime import datetime

import numpy as np
import pandas as pd

from mmm_lab.etl.validation import validate_lookup_keys
from mmm_lab.simulation.quality import STATE_TO_SEGMENT


def enrich_transactions(
    transactions: pd.DataFrame,
    stores: pd.DataFrame,
    brands: pd.DataFrame,
    *,
    as_of: datetime | None = None,
) -> pd.DataFrame:
    """Keep every source line, with explicit lookup and eligibility outcomes.

    `as_of` is an optional UTC submission snapshot. Event week remains based on
    TRANSACTION_DATE even for records submitted in a later week.
    """
    validate_lookup_keys(stores, brands)
    source = transactions.copy().reset_index(drop=True)
    source["source_file_row_number"] = np.arange(1, len(source) + 1, dtype=np.int64)
    store_lookup = stores.loc[stores["SUBMITTER_ID"].notna(), [
        "SUBMITTER_ID", "STORE_ID", "MASTER_STORE_ID", "STATE", "STANDARD_STATE", "FILE_SUBMISSION_ID",
    ]].rename(columns={
        "MASTER_STORE_ID": "store_master_id", "STATE": "store_state",
        "STANDARD_STATE": "store_standard_state", "FILE_SUBMISSION_ID": "store_file_submission_id",
    })
    enriched = source.merge(
        store_lookup, on=["SUBMITTER_ID", "STORE_ID"], how="left", sort=False,
        validate="many_to_one", indicator="_store_merge",
    )
    if len(enriched) != len(source):
        raise ValueError("Store lookup multiplied transaction lines")
    enriched["store_match"] = enriched.pop("_store_merge").eq("both")

    # Filtering null reference UPCs implements ordinary SQL equality semantics:
    # null transaction UPC14 must never match null reference UPC14.
    product_lookup = brands.loc[brands["UPC14"].notna(), [
        "BRAND_ID", "UPC14", "MASTER_BRAND_ID", "SUBMITTER_ID", "FILE_SUBMISSION_ID",
    ]].rename(columns={
        "MASTER_BRAND_ID": "product_master_id", "SUBMITTER_ID": "product_submitter_id",
        "FILE_SUBMISSION_ID": "product_file_submission_id",
    })
    enriched = enriched.merge(
        product_lookup, on=["BRAND_ID", "UPC14"], how="left", sort=False,
        validate="many_to_one", indicator="_product_merge",
    )
    if len(enriched) != len(source) or not np.array_equal(
        enriched["source_file_row_number"].to_numpy(), source["source_file_row_number"].to_numpy()
    ):
        raise ValueError("Product lookup multiplied or reordered transaction lines")
    enriched["product_match"] = enriched.pop("_product_merge").eq("both")
    enriched["join_fanout"] = False
    enriched["null_upc"] = enriched["UPC14"].isna()
    enriched["segment_id"] = enriched["store_standard_state"].fillna(enriched["store_state"]).map(STATE_TO_SEGMENT)
    event = pd.to_datetime(enriched["TRANSACTION_DATE"], errors="coerce")
    enriched["week_start"] = (event.dt.normalize() - pd.to_timedelta(event.dt.day_of_week, unit="D")).dt.date
    submitted = pd.to_datetime(enriched["SUBMISSION_DATE_TIME"], utc=True, errors="coerce")

    quantity = pd.to_numeric(enriched["QUANTITY"], errors="coerce")
    price = pd.to_numeric(enriched["PRICE"], errors="coerce")
    valid_quantity = np.isfinite(quantity) & (quantity > 0) & (quantity % 1 == 0)
    valid_price = np.isfinite(price) & (price > 0)
    enriched["quantity_units"] = quantity.where(valid_quantity, 0).astype("int64")
    enriched["line_gross_sales_usd"] = (quantity * price).round(3)
    discount_fields = ["PID_COUPON_DISCOUNT", "ACCOUNT_DISCOUNT_AMOUNT", "MFG_DISCOUNT_AMOUNT"]
    discounts = enriched[discount_fields].apply(pd.to_numeric, errors="coerce")
    discount_total = discounts.fillna(0).sum(axis=1)
    enriched["line_net_sales_usd"] = (enriched["line_gross_sales_usd"] - discount_total).round(3)
    for field, output in (
        ("PID_COUPON_DISCOUNT", "redeemed_coupon_discount_usd"),
        ("ACCOUNT_DISCOUNT_AMOUNT", "redeemed_account_discount_usd"),
        ("MFG_DISCOUNT_AMOUNT", "redeemed_mfg_discount_usd"),
    ):
        enriched[output] = pd.to_numeric(enriched[field], errors="coerce").fillna(0)

    reasons = pd.Series("", index=enriched.index, dtype="string")

    def mark(mask: pd.Series, code: str) -> None:
        reasons.loc[mask.fillna(False)] += code + "|"

    mark(~enriched["store_match"], "unmatched_store")
    mark(enriched["null_upc"], "null_upc")
    mark(~enriched["product_match"], "unmatched_product")
    mark(enriched["store_match"] & enriched["segment_id"].isna(), "unknown_segment")
    mark(enriched["TEST_DATA"].isna() | enriched["TEST_DATA"].ne(False), "test_data")
    mark(enriched["ERROR_COUNT"].isna() | enriched["ERROR_COUNT"].ne(0) |
         enriched["DISPLAY_ERROR_COUNT"].isna() | enriched["DISPLAY_ERROR_COUNT"].ne(0), "source_error")
    mark(enriched["STATUS"].isna() | enriched["STATUS"].ne("A"), "inactive_status")
    mark(enriched["TRANSFORMATION_FLAG"].isna() | enriched["TRANSFORMATION_FLAG"].ne("N") |
         enriched["TRANSFORMATION_2_PASS_FLAG"].isna() |
         enriched["TRANSFORMATION_2_PASS_FLAG"].ne("N"), "transformed")
    mark(~valid_quantity, "invalid_quantity")
    mark(~valid_price, "invalid_price")
    mark(event.isna(), "missing_event_time")
    mark(submitted.isna() | (submitted <= event.dt.tz_localize("UTC")), "invalid_submission_time")
    mark(enriched["TRANSACTION_ID"].isna() |
         enriched["TRANSACTION_ID"].duplicated(keep=False), "duplicate_transaction_id")
    mark((discounts.notna().sum(axis=1) > 1), "overlapping_discounts")
    mark((discounts < 0).any(axis=1) | (~np.isfinite(discounts.fillna(0))).any(axis=1) |
         (discount_total > enriched["line_gross_sales_usd"]), "invalid_discount")
    mark(enriched["PROMOTION_FLAG"].ne(discounts.notna().any(axis=1)), "promotion_flag_mismatch")
    if as_of is not None:
        cutoff = pd.Timestamp(as_of)
        if cutoff.tzinfo is None:
            raise ValueError("as_of must have an explicit timezone")
        mark(submitted > cutoff.tz_convert("UTC"), "not_submitted_by_as_of")
    enriched["exclusion_reasons"] = reasons.str.rstrip("|").replace("", pd.NA)
    enriched["is_eligible"] = reasons.eq("").astype(bool)
    return enriched
