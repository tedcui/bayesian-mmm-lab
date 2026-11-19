"""M2B source joins, time axes, leakage, and reconciliation contracts."""

from __future__ import annotations

import json
from datetime import timedelta

import pandas as pd
import pyarrow.parquet as pq
import pytest

from mmm_lab.etl.aggregate import aggregate_transactions
from mmm_lab.etl.enrich import enrich_transactions
from mmm_lab.etl.features import MODEL_COLUMNS, build_panel
from mmm_lab.etl.pipeline import build_mart
from mmm_lab.etl.validation import load_inputs, sha256_file, validate_lookup_keys
from mmm_lab.simulation.config import SimulationConfig
from mmm_lab.simulation.generate import generate_sources


@pytest.fixture(scope="module")
def sample(tmp_path_factory):
    root = tmp_path_factory.mktemp("etl_source")
    generate_sources(SimulationConfig(weeks=4, unit_scale=0.1), root)
    return root


def test_source_provenance_and_no_truth_dependency(sample, tmp_path):
    inputs = load_inputs(sample)
    assert inputs.transaction_table.num_rows == len(inputs.transactions)
    assert len(inputs.plans) == 72 and len(inputs.contexts) == 24
    (sample / "metadata/ground_truth.json").unlink()
    result = build_mart(sample, tmp_path)
    assert result["reconciliation"]["segment_weeks_reconciled"] == 24
    assert result["lineage"]["source_manifest_sha256"] == inputs.manifest_sha256
    assert "ground_truth" not in json.dumps(result["lineage"])
    for name in ("etl_manifest.json", "etl_quality.json", "etl_reconciliation.json"):
        assert b"\r\n" not in (tmp_path / "metadata" / name).read_bytes()


def test_reference_joins_preserve_lines_and_nullable_upc(sample):
    inputs = load_inputs(sample)
    tx = inputs.transactions.head(3).copy()
    tx.loc[0, "STORE_ID"] = "F" * 32
    tx.loc[1, "UPC14"] = None
    brands = pd.concat([inputs.brands, inputs.brands.head(1).assign(UPC14=None)], ignore_index=True)
    enriched = enrich_transactions(tx, inputs.stores, brands)
    assert len(enriched) == len(tx)
    assert not enriched.loc[0, "store_match"]
    assert "unmatched_store" in enriched.loc[0, "exclusion_reasons"]
    assert enriched.loc[1, "null_upc"] and not enriched.loc[1, "product_match"]
    assert "null_upc" in enriched.loc[1, "exclusion_reasons"]
    assert enriched.source_file_row_number.tolist() == [1, 2, 3]
    assert not enriched.join_fanout.any()


def test_duplicate_lookup_keys_fail_before_fanout(sample):
    inputs = load_inputs(sample)
    with pytest.raises(ValueError, match="store lookup key"):
        validate_lookup_keys(pd.concat([inputs.stores, inputs.stores.head(1)]), inputs.brands)
    with pytest.raises(ValueError, match="product lookup key"):
        enrich_transactions(inputs.transactions.head(1), inputs.stores,
                            pd.concat([inputs.brands, inputs.brands.head(1)]))


def test_product_join_uses_brand_and_upc_not_submitter(sample):
    inputs = load_inputs(sample)
    tx = inputs.transactions.head(1).copy()
    brand_key = tx.loc[0, "BRAND_ID"]
    upc = tx.loc[0, "UPC14"]
    brands = inputs.brands.copy()
    brands.loc[(brands.BRAND_ID == brand_key) & (brands.UPC14 == upc), "SUBMITTER_ID"] = "OTHER"
    enriched = enrich_transactions(tx, inputs.stores, brands)
    assert enriched.loc[0, "product_match"]
    assert enriched.loc[0, "product_submitter_id"] == "OTHER"


def test_event_week_is_independent_of_late_submission(sample):
    inputs = load_inputs(sample)
    tx = inputs.transactions.head(1).copy()
    event = pd.Timestamp(tx.loc[0, "TRANSACTION_DATE"])
    tx.loc[0, "SUBMISSION_DATE_TIME"] = (event + timedelta(days=15)).tz_localize("UTC")
    enriched = enrich_transactions(tx, inputs.stores, inputs.brands)
    assert enriched.loc[0, "week_start"] == (event - timedelta(days=event.weekday())).date()
    assert enriched.loc[0, "is_eligible"]
    snapshot = enrich_transactions(tx, inputs.stores, inputs.brands,
                                   as_of=(event + timedelta(days=7)).tz_localize("UTC"))
    assert not snapshot.loc[0, "is_eligible"]
    assert "not_submitted_by_as_of" in snapshot.loc[0, "exclusion_reasons"]


def test_crosswalk_fallback_and_exclusion_policy(sample):
    inputs = load_inputs(sample)
    tx = inputs.transactions.head(1).copy()
    stores = inputs.stores.copy()
    key = (stores.SUBMITTER_ID == tx.loc[0, "SUBMITTER_ID"]) & (stores.STORE_ID == tx.loc[0, "STORE_ID"])
    expected_segment = enrich_transactions(tx, stores, inputs.brands).loc[0, "segment_id"]
    stores.loc[key, "STANDARD_STATE"] = None
    assert enrich_transactions(tx, stores, inputs.brands).loc[0, "segment_id"] == expected_segment
    tx.loc[0, "TEST_DATA"] = True
    row = enrich_transactions(tx, stores, inputs.brands).iloc[0]
    assert not row.is_eligible and "test_data" in row.exclusion_reasons


def test_model_allowlist_split_and_adstock_history(sample, tmp_path):
    build_mart(sample, tmp_path)
    raw = pq.read_table(sample / "silver/source_transactions.parquet")
    fact = pq.read_table(tmp_path / "marts/fact_transactions_enriched.parquet")
    assert fact.num_rows == raw.num_rows
    assert fact.schema.names[:44] == raw.schema.names
    assert fact.select(raw.schema.names).equals(raw)
    assert fact.column("source_file_row_number").to_pylist() == list(range(1, raw.num_rows + 1))
    model = pq.read_table(tmp_path / "processed/model_ready.parquet").to_pandas()
    mart = pq.read_table(tmp_path / "marts/mart_segment_week.parquet").to_pandas()
    assert model.columns.tolist() == MODEL_COLUMNS
    assert len(model) == len(mart) == 24
    assert not model.is_holdout.any()  # four-week fixture; full 120-week split checked below
    assert "redeemed_coupon_discount_usd" in mart and "redeemed_coupon_discount_usd" not in model
    assert "promo_line_rate" in mart and "promo_line_rate" not in model
    assert "coupon_spend" in model and model.coupon_spend.gt(0).any()
    assert not any("truth" in name or "contribution" in name for name in model.columns)


def test_calendar_gap_fails_instead_of_zero_fill(sample):
    inputs = load_inputs(sample)
    enriched = enrich_transactions(inputs.transactions, inputs.stores, inputs.brands)
    weekly, excluded = aggregate_transactions(enriched)
    with pytest.raises(ValueError, match="calendar incomplete"):
        build_panel(weekly.iloc[1:], excluded, inputs.plans, inputs.contexts, inputs.manifest["config"])


def test_reconciliation_and_idempotent_outputs(sample, tmp_path):
    one = tmp_path / "one"
    two = tmp_path / "two"
    first = build_mart(sample, one)
    second = build_mart(sample, two)
    assert first["reconciliation"] == second["reconciliation"]
    assert first["lineage"]["output_hashes"] == second["lineage"]["output_hashes"]
    mart = pq.read_table(one / "marts/mart_segment_week.parquet").to_pandas()
    assert mart.sales_units.sum() == first["reconciliation"]["source_eligible_units"]
    assert not mart.duplicated(["segment_id", "week_start"]).any()
    assert sha256_file(one / "processed/model_ready.parquet") == sha256_file(two / "processed/model_ready.parquet")


def test_full_calendar_holdout_split():
    from mmm_lab.paths import DATA_DIR
    model = pq.read_table(DATA_DIR / "processed/model_ready.parquet").to_pandas()
    assert len(model) == 720
    assert model.groupby("segment_id").is_holdout.sum().eq(20).all()
    assert model.loc[model.is_holdout, "time_index"].min() == 101
    assert model.loc[~model.is_holdout, "time_index"].max() == 100
    assert model.groupby("segment_id").coupon_spend.apply(lambda x: x.iloc[99] >= 0 and x.iloc[100] >= 0).all()
