"""Validate source schemas, provenance, lookup keys, and auxiliary coverage."""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from mmm_lab.simulation.config import CHANNELS, SEGMENT_STATES
from mmm_lab.simulation.generate import CONTEXT_SCHEMA, PLAN_SCHEMA
from mmm_lab.simulation.quality import validate_schema
from mmm_lab.simulation.schema import schema_sha256, source_schema


SOURCE_FILES = {
    "source_transactions": ("silver/source_transactions.parquet", source_schema("transactions")),
    "source_stores": ("silver/source_stores.parquet", source_schema("stores")),
    "source_brands": ("silver/source_brands.parquet", source_schema("brands")),
    "sim_marketing_plan": ("auxiliary/sim_marketing_plan.parquet", PLAN_SCHEMA),
    "sim_market_context": ("auxiliary/sim_market_context.parquet", CONTEXT_SCHEMA),
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass
class SourceInputs:
    transaction_table: pa.Table
    transactions: pd.DataFrame
    stores: pd.DataFrame
    brands: pd.DataFrame
    plans: pd.DataFrame
    contexts: pd.DataFrame
    manifest: dict
    manifest_sha256: str


def validate_lookup_keys(stores: pd.DataFrame, brands: pd.DataFrame) -> None:
    """Fail before a left join can multiply a transaction line."""
    if stores.duplicated(["SUBMITTER_ID", "STORE_ID"]).any():
        raise ValueError("Duplicate candidate store lookup key")
    if brands.duplicated(["BRAND_ID", "UPC14"]).any():
        raise ValueError("Duplicate candidate product lookup key")


def validate_auxiliary(plans: pd.DataFrame, contexts: pd.DataFrame, config: dict) -> list[date]:
    if plans.duplicated(["segment_id", "week_start", "channel"]).any():
        raise ValueError("Duplicate marketing plan key")
    if contexts.duplicated(["segment_id", "week_start"]).any():
        raise ValueError("Duplicate market context key")
    first = date.fromisoformat(config["start_date"])
    if first.weekday() != 0:
        raise ValueError("Source calendar must start on a Monday")
    weeks = [first + timedelta(weeks=i) for i in range(config["weeks"])]
    expected = {(segment, week) for segment in SEGMENT_STATES for week in weeks}
    actual_context = set(zip(contexts["segment_id"], contexts["week_start"]))
    actual_plan = set(zip(plans["segment_id"], plans["week_start"], plans["channel"]))
    if actual_context != expected or len(contexts) != len(expected):
        raise ValueError("Market context lacks complete segment-week coverage")
    if actual_plan != {(s, w, c) for s, w in expected for c in CHANNELS}:
        raise ValueError("Marketing plan lacks exactly three channels per segment-week")
    for row in plans.itertuples(index=False):
        if (not math.isfinite(row.planned_spend) or not math.isfinite(row.min_spend) or
                not math.isfinite(row.max_spend) or
                not 0 <= row.min_spend <= row.planned_spend <= row.max_spend or
                row.plan_created_at.date() >= row.week_start):
            raise ValueError("Invalid spend bounds or late marketing plan")
    for row in contexts.itertuples(index=False):
        if (row.context_as_of.date() >= row.week_start or
                any(not math.isfinite(getattr(row, field)) for field in
                    ("planned_price_index", "competitor_index", "availability_index", "market_size_index")) or
                row.planned_price_index <= 0 or row.competitor_index <= 0 or
                not 0 < row.availability_index <= 1 or row.market_size_index <= 0):
            raise ValueError("Invalid or late market context")
    return weeks


def load_inputs(root: Path) -> SourceInputs:
    """Load only the five observable sources; do not open ground_truth.json."""
    root = Path(root)
    manifest_path = root / "metadata/source_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("source_schema_sha256") != schema_sha256():
        raise ValueError("Source schema hash differs from checked-in contract")
    if set(manifest["files"]) != set(SOURCE_FILES):
        raise ValueError("Source manifest file set differs from M2A contract")
    tables: dict[str, pa.Table] = {}
    for name, (relative, schema) in SOURCE_FILES.items():
        info = manifest["files"][name]
        if info["relative_path"] != relative:
            raise ValueError(f"Unexpected source path for {name}")
        path = root / relative
        if sha256_file(path) != info["sha256"]:
            raise ValueError(f"Source hash mismatch for {name}")
        table = pq.read_table(path)
        validate_schema(table, schema, name)
        if table.num_rows != info["rows"]:
            raise ValueError(f"Source row count mismatch for {name}")
        tables[name] = table
    transactions = tables["source_transactions"].to_pandas()
    stores = tables["source_stores"].to_pandas()
    brands = tables["source_brands"].to_pandas()
    # Arrow's nullable 19-digit integers must not pass through float64.
    for frame, table, field in (
        (stores, tables["source_stores"], "MASTER_STORE_ID"),
        (brands, tables["source_brands"], "MASTER_BRAND_ID"),
    ):
        frame[field] = pd.array(table[field].to_pylist(), dtype="Int64")
    plans = tables["sim_marketing_plan"].to_pandas()
    contexts = tables["sim_market_context"].to_pandas()
    validate_lookup_keys(stores, brands)
    validate_auxiliary(plans, contexts, manifest["config"])
    return SourceInputs(
        tables["source_transactions"], transactions, stores, brands, plans, contexts,
        manifest, sha256_file(manifest_path),
    )
