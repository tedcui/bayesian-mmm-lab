"""M2A source-contract checks; no analytical mart or ETL output is built here."""

from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict
from datetime import date, timedelta, timezone
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from mmm_lab.simulation.config import CHANNELS, SEGMENT_STATES
from mmm_lab.simulation.generate import CONTEXT_SCHEMA, PLAN_SCHEMA
from mmm_lab.simulation.schema import source_schema

HEX32 = re.compile(r"^[0-9A-F]{32}$")
STATE_TO_SEGMENT = {
    state: segment for segment, states in SEGMENT_STATES.items() for state in states
}


def validate_schema(table: pa.Table, expected: pa.Schema, label: str) -> None:
    if not table.schema.equals(expected, check_metadata=False):
        raise ValueError(f"{label}: columns, types, or nullability differ from contract")
    for field in expected:
        if not field.nullable and table.column(field.name).null_count:
            raise ValueError(f"{label}: required field {field.name} contains nulls")


def reference_quality(stores: pa.Table, brands: pa.Table) -> dict:
    """Check candidate lookup keys before any downstream join is attempted."""
    validate_schema(stores, source_schema("stores"), "stores")
    validate_schema(brands, source_schema("brands"), "brands")
    store_rows = stores.select(["SUBMITTER_ID", "STORE_ID", "MASTER_STORE_ID", "STATE", "STANDARD_STATE"]).to_pylist()
    brand_rows = brands.select(["BRAND_ID", "UPC14", "MASTER_BRAND_ID"]).to_pylist()
    store_keys = [(row["SUBMITTER_ID"], row["STORE_ID"]) for row in store_rows]
    product_keys = [(row["BRAND_ID"], row["UPC14"]) for row in brand_rows]
    if len(store_keys) != len(set(store_keys)):
        raise ValueError("Duplicate candidate store lookup key")
    if len(product_keys) != len(set(product_keys)):
        raise ValueError("Duplicate candidate product lookup key")
    if not all(HEX32.fullmatch(row["STORE_ID"]) for row in store_rows):
        raise ValueError("Invalid STORE_ID")
    if not all(HEX32.fullmatch(row["BRAND_ID"]) for row in brand_rows):
        raise ValueError("Invalid BRAND_ID")
    if not all(row["UPC14"] is None or (len(row["UPC14"]) == 14 and row["UPC14"].isdigit()) for row in brand_rows):
        raise ValueError("Invalid UPC14")
    if not all((row["STANDARD_STATE"] or row["STATE"]) in STATE_TO_SEGMENT for row in store_rows):
        raise ValueError("Store geography outside documented six-segment mapping")
    return {
        "store_reference_rows": len(store_rows),
        "product_reference_rows": len(brand_rows),
        "duplicate_store_keys": 0,
        "duplicate_product_keys": 0,
        "standard_state_fallback_stores": sum(row["STANDARD_STATE"] is None for row in store_rows),
        "distinct_master_store_ids": len({row["MASTER_STORE_ID"] for row in store_rows}),
        "distinct_master_brand_ids": len({row["MASTER_BRAND_ID"] for row in brand_rows}),
    }


def validate_sources(root: Path, *, save_report: bool = True) -> dict:
    """Check source rows, plan timing, references, and unit allocation to truth."""
    root = Path(root)
    transactions = pq.read_table(root / "silver" / "source_transactions.parquet")
    stores = pq.read_table(root / "silver" / "source_stores.parquet")
    brands = pq.read_table(root / "silver" / "source_brands.parquet")
    plans = pq.read_table(root / "auxiliary" / "sim_marketing_plan.parquet")
    contexts = pq.read_table(root / "auxiliary" / "sim_market_context.parquet")
    validate_schema(transactions, source_schema("transactions"), "transactions")
    validate_schema(plans, PLAN_SCHEMA, "marketing plan")
    validate_schema(contexts, CONTEXT_SCHEMA, "market context")
    reference = reference_quality(stores, brands)
    truth = json.loads((root / "metadata" / "ground_truth.json").read_text(encoding="utf-8"))

    store_rows = stores.select(["SUBMITTER_ID", "STORE_ID", "STATE", "STANDARD_STATE"]).to_pylist()
    store_segment = {
        (row["SUBMITTER_ID"], row["STORE_ID"]): STATE_TO_SEGMENT[row["STANDARD_STATE"] or row["STATE"]]
        for row in store_rows
    }
    product_keys = {
        (row["BRAND_ID"], row["UPC14"])
        for row in brands.select(["BRAND_ID", "UPC14"]).to_pylist() if row["UPC14"] is not None
    }
    tx_columns = ["TRANSACTION_ID", "SUBMITTER_ID", "STORE_ID", "BRAND_ID", "UPC14", "QUANTITY",
                  "TRANSACTION_DATE", "SUBMISSION_DATE_TIME", "MARKET_BASKET_TRANSACTION_ID",
                  "PRICE", "PROMOTION_FLAG", "PID_COUPON_DISCOUNT", "ACCOUNT_DISCOUNT_AMOUNT",
                  "MFG_DISCOUNT_AMOUNT"]
    lines = transactions.select(tx_columns).to_pylist()
    transaction_ids: set[str] = set()
    basket_counts: Counter = Counter()
    allocated: defaultdict = defaultdict(int)
    unmatched_store = unmatched_product = null_upc = 0
    for row in lines:
        identifier = row["TRANSACTION_ID"]
        if not HEX32.fullmatch(identifier) or identifier in transaction_ids:
            raise ValueError("Invalid or duplicate TRANSACTION_ID")
        transaction_ids.add(identifier)
        quantity = row["QUANTITY"]
        if quantity is None or quantity <= 0 or quantity != quantity.to_integral_value():
            raise ValueError("Nonpositive or fractional source QUANTITY")
        price = row["PRICE"]
        if price is None or price <= 0:
            raise ValueError("Missing or nonpositive source PRICE")
        event = row["TRANSACTION_DATE"]
        submitted = row["SUBMISSION_DATE_TIME"]
        if submitted is None or submitted <= event.replace(tzinfo=timezone.utc):
            raise ValueError("Submission must follow transaction event")
        key = (row["SUBMITTER_ID"], row["STORE_ID"])
        segment = store_segment.get(key)
        if segment is None:
            unmatched_store += 1
        else:
            monday = event.date() - timedelta(days=event.weekday())
            allocated[(segment, monday)] += int(quantity)
        if row["UPC14"] is None:
            null_upc += 1
        elif (row["BRAND_ID"], row["UPC14"]) not in product_keys:
            unmatched_product += 1
        elif len(row["UPC14"]) != 14 or not row["UPC14"].isdigit():
            raise ValueError("Invalid transaction UPC14")
        basket_counts[row["MARKET_BASKET_TRANSACTION_ID"]] += 1
        discount_fields = ("PID_COUPON_DISCOUNT", "ACCOUNT_DISCOUNT_AMOUNT", "MFG_DISCOUNT_AMOUNT")
        discounts = [row[field] for field in discount_fields if row[field] is not None]
        if len(discounts) > 1:
            raise ValueError("Overlapping synthetic discount categories")
        if any(discount < 0 or discount > price * quantity for discount in discounts):
            raise ValueError("Invalid source discount amount")
        if row["PROMOTION_FLAG"] != bool(discounts):
            raise ValueError("Promotion flag and discount fields disagree")

    plan_rows = plans.to_pylist()
    context_rows = contexts.to_pylist()
    plan_keys = [(row["segment_id"], row["week_start"], row["channel"]) for row in plan_rows]
    context_keys = [(row["segment_id"], row["week_start"]) for row in context_rows]
    if len(plan_keys) != len(set(plan_keys)) or len(context_keys) != len(set(context_keys)):
        raise ValueError("Duplicate auxiliary source key")
    if set(row["channel"] for row in plan_rows) != set(CHANNELS):
        raise ValueError("Campaign channels differ from three-channel contract")
    if any(not 0 <= row["planned_spend"] <= row["max_spend"] or row["min_spend"] != 0 or
           row["plan_created_at"].date() >= row["week_start"] for row in plan_rows):
        raise ValueError("Invalid or late marketing plan")
    if any(row["context_as_of"].date() >= row["week_start"] for row in context_rows):
        raise ValueError("Context not available before sales week")
    context_fields = ("planned_price_index", "competitor_index", "availability_index", "market_size_index")
    if any(any(not math.isfinite(row[field]) for field in context_fields) or
           row["planned_price_index"] <= 0 or row["competitor_index"] <= 0 or
           not 0 < row["availability_index"] <= 1 or row["market_size_index"] <= 0
           for row in context_rows):
        raise ValueError("Invalid nonfinite or out-of-range market context")
    target = {(row["segment_id"], date.fromisoformat(row["week_start"])): row["sales_units"]
              for row in truth["segment_weeks"]}
    if len(target) != len(truth["segment_weeks"]):
        raise ValueError("Duplicate truth segment-week")
    if (set(context_keys) != set(target) or len(plan_keys) != 3 * len(target) or
            set((s, w) for s, w, _ in plan_keys) != set(target) or
            any(count != 3 for count in Counter((s, w) for s, w, _ in plan_keys).values())):
        raise ValueError("Incomplete auxiliary segment-week coverage")
    if any(sum((row["components"][part] for part in row["components"]), 0.0) + row["noise"] +
           row["rounding_adjustment"] != row["sales_units"] for row in truth["segment_weeks"]):
        # Normal floating-point summation may differ by a few ulps.
        if any(not math.isclose(sum(row["components"].values()) + row["noise"] +
                                row["rounding_adjustment"], row["sales_units"], abs_tol=1e-8)
               for row in truth["segment_weeks"]):
            raise ValueError("Truth components do not reconstruct realized sales")
    if any(allocated.get(key, 0) != value for key, value in target.items()):
        raise ValueError("Transaction quantities do not reconstruct segment-week demand")
    report = {
        "schema_valid": True,
        "transaction_lines": len(lines),
        "store_rows": stores.num_rows,
        "product_rows": brands.num_rows,
        "plan_rows": len(plan_rows),
        "context_rows": len(context_rows),
        "intended_segment_weeks": len(target),
        "total_sales_units": sum(target.values()),
        "allocated_source_units": sum(allocated.values()),
        "unmatched_store_lines": unmatched_store,
        "unmatched_product_lines": unmatched_product,
        "null_upc_lines": null_upc,
        "multi_line_baskets": sum(count > 1 for count in basket_counts.values()),
        **reference,
    }
    if save_report:
        (root / "metadata" / "source_quality.json").write_bytes(
            (json.dumps(report, indent=2) + "\n").encode("utf-8")
        )
    return report
