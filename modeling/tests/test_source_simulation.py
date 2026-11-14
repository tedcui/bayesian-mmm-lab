import json
import re
import shutil
from datetime import timedelta
from decimal import Decimal

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from mmm_lab.simulation.config import CHANNELS, SEGMENT_STATES, STORE_COUNTS, SimulationConfig
from mmm_lab.simulation.generate import generate_sources
from mmm_lab.simulation.quality import reference_quality, validate_sources
from mmm_lab.simulation.schema import source_columns, source_schema


@pytest.fixture(scope="module")
def sample(tmp_path_factory):
    root = tmp_path_factory.mktemp("source_sample")
    manifest = generate_sources(SimulationConfig(weeks=4, unit_scale=0.1), root)
    return root, manifest


def test_exact_source_inventories_and_arrow_types(sample):
    root, _ = sample
    for name, count in (("transactions", 44), ("stores", 42), ("brands", 19)):
        columns = source_columns(name)
        assert len(columns) == count
        table = pq.read_table(root / "silver" / f"source_{name}.parquet")
        assert table.schema.equals(source_schema(name), check_metadata=False)
        assert table.schema.names == [column.name for column in columns]
    transactions = pq.read_table(root / "silver" / "source_transactions.parquet")
    assert transactions.schema.field("TRANSACTION_DATE").type == pa.timestamp("ns")
    assert transactions.schema.field("SUBMISSION_DATE_TIME").type == pa.timestamp("ns", tz="UTC")
    assert transactions.schema.field("TEST_DATA").nullable
    assert transactions.schema.field("PROMOTION_FLAG").nullable is False


def test_identifiers_and_source_identity_levels(sample):
    root, _ = sample
    stores = pq.read_table(root / "silver" / "source_stores.parquet").to_pylist()
    brands = pq.read_table(root / "silver" / "source_brands.parquet").to_pylist()
    transactions = pq.read_table(root / "silver" / "source_transactions.parquet")
    assert len(stores) == sum(STORE_COUNTS.values()) == 190
    assert len(brands) == 36
    assert all(re.fullmatch(r"[0-9A-F]{32}", row["STORE_ID"]) for row in stores)
    assert all(re.fullmatch(r"[0-9A-F]{32}", row["BRAND_ID"]) for row in brands)
    assert all(len(row["SUBMITTER_ID"]) == 36 for row in stores)
    assert all(len(str(row["FILE_SUBMISSION_ID"])) == 19 for row in stores)
    assert all(len(row["UPC14"]) == 14 and row["UPC14"].startswith("0") for row in brands)
    assert len({row["MASTER_STORE_ID"] for row in stores}) < len(stores)
    assert len({row["MASTER_BRAND_ID"] for row in brands}) < len(brands)
    assert set(transactions.column("BRAND_ID").to_pylist()).issubset({row["BRAND_ID"] for row in brands})
    assert all(row["STORE_ID"] != str(row["MASTER_STORE_ID"]) for row in stores)
    assert all(row["BRAND_ID"] != str(row["MASTER_BRAND_ID"]) for row in brands)


def test_pre_outcome_auxiliary_sources_and_truth_separation(sample):
    root, manifest = sample
    assert set(manifest["files"]) == {
        "source_transactions", "source_stores", "source_brands",
        "sim_marketing_plan", "sim_market_context",
    }
    assert set(SEGMENT_STATES) == {
        "northeast", "southeast", "great_lakes", "south_central",
        "mountain_west", "pacific_coast",
    }
    plan = pq.read_table(root / "auxiliary" / "sim_marketing_plan.parquet").to_pylist()
    context = pq.read_table(root / "auxiliary" / "sim_market_context.parquet").to_pylist()
    transactions = pq.read_table(root / "silver" / "source_transactions.parquet")
    assert len(plan) == 6 * 4 * 3
    assert len(context) == 6 * 4
    assert set(row["channel"] for row in plan) == set(CHANNELS)
    assert len({(row["segment_id"], row["week_start"], row["channel"]) for row in plan}) == len(plan)
    assert len({(row["segment_id"], row["week_start"]) for row in context}) == len(context)
    assert all(row["plan_created_at"].date() < row["week_start"] for row in plan)
    assert all(row["context_as_of"].date() < row["week_start"] for row in context)
    assert all(row["min_spend"] <= row["planned_spend"] <= row["max_spend"] for row in plan)
    assert not {"planned_spend", "expected_sales_units", "components", "noise"} & set(transactions.column_names)
    assert not (root / "processed" / "model_ready.parquet").exists()
    assert manifest["lineage_order"].index("planned_marketing_and_context") < manifest["lineage_order"].index("latent_demand")


def test_quantities_baskets_and_event_timing_reconcile(sample):
    root, _ = sample
    report = validate_sources(root, save_report=False)
    assert report["schema_valid"]
    assert report["allocated_source_units"] == report["total_sales_units"]
    assert report["intended_segment_weeks"] == 6 * 4
    assert report["unmatched_store_lines"] == report["unmatched_product_lines"] == 0
    assert report["multi_line_baskets"] > 0
    truth = json.loads((root / "metadata" / "ground_truth.json").read_text(encoding="utf-8"))
    assert len(truth["segment_weeks"]) == 24
    assert set(truth["segments"]) == set(SEGMENT_STATES)
    assert truth["evaluation_only"]
    for row in truth["segment_weeks"]:
        assert row["sales_units"] >= 0
        assert abs(sum(row["components"].values()) + row["noise"] + row["rounding_adjustment"] - row["sales_units"]) < 1e-8


def test_regeneration_is_byte_identical(tmp_path):
    config = SimulationConfig(seed=2718, weeks=3, unit_scale=0.05)
    first = generate_sources(config, tmp_path / "first")
    second = generate_sources(config, tmp_path / "second")
    assert first == second
    for name, info in first["files"].items():
        assert (tmp_path / "first" / info["relative_path"]).read_bytes() == (tmp_path / "second" / info["relative_path"]).read_bytes(), name
    assert (tmp_path / "first" / "metadata" / "ground_truth.json").read_bytes() == (tmp_path / "second" / "metadata" / "ground_truth.json").read_bytes()


def test_reference_duplicates_fail_fast_and_missing_products_are_counted(sample, tmp_path):
    root, _ = sample
    stores = pq.read_table(root / "silver" / "source_stores.parquet")
    brands = pq.read_table(root / "silver" / "source_brands.parquet")
    duplicated = pa.concat_tables([stores, stores.slice(0, 1)])
    with pytest.raises(ValueError, match="Duplicate candidate store"):
        reference_quality(duplicated, brands)
    duplicated_product = pa.concat_tables([brands, brands.slice(0, 1)])
    with pytest.raises(ValueError, match="Duplicate candidate product"):
        reference_quality(stores, duplicated_product)

    first_product = brands.slice(0, 1).to_pylist()[0]["BRAND_ID"]
    assert first_product in pq.read_table(root / "silver" / "source_transactions.parquet").column("BRAND_ID").to_pylist()
    bad_root = tmp_path / "missing_product"
    shutil.copytree(root, bad_root)
    bad_rows = brands.to_pylist()
    bad_rows[0]["UPC14"] = "99999999999999"
    pq.write_table(pa.Table.from_pylist(bad_rows, schema=source_schema("brands")),
                   bad_root / "silver" / "source_brands.parquet")
    report = validate_sources(bad_root, save_report=False)
    assert report["unmatched_product_lines"] > 0
    assert report["transaction_lines"] == pq.read_table(root / "silver" / "source_transactions.parquet").num_rows


def test_calendar_is_consecutive_mondays(sample):
    root, _ = sample
    context = pq.read_table(root / "auxiliary" / "sim_market_context.parquet").to_pylist()
    for segment in SEGMENT_STATES:
        weeks = [row["week_start"] for row in context if row["segment_id"] == segment]
        assert len(weeks) == 4
        assert all(week.weekday() == 0 for week in weeks)
        assert all(right - left == timedelta(days=7) for left, right in zip(weeks, weeks[1:]))


@pytest.mark.parametrize("defect, error", [
    ("negative_price", "nonpositive source PRICE"),
    ("promotion_mismatch", "Promotion flag and discount fields disagree"),
])
def test_source_quality_rejects_invalid_line_values(sample, tmp_path, defect, error):
    source_root, _ = sample
    bad_root = tmp_path / defect
    shutil.copytree(source_root, bad_root)
    path = bad_root / "silver" / "source_transactions.parquet"
    table = pq.read_table(path)
    rows = table.to_pylist()
    if defect == "negative_price":
        rows[0]["PRICE"] = Decimal("-1.000")
    else:
        rows[0]["PROMOTION_FLAG"] = not rows[0]["PROMOTION_FLAG"]
    pq.write_table(pa.Table.from_pylist(rows, schema=source_schema("transactions")), path)
    with pytest.raises(ValueError, match=error):
        validate_sources(bad_root, save_report=False)


def test_source_quality_rejects_nonfinite_context(sample, tmp_path):
    source_root, _ = sample
    bad_root = tmp_path / "nonfinite_context"
    shutil.copytree(source_root, bad_root)
    path = bad_root / "auxiliary" / "sim_market_context.parquet"
    table = pq.read_table(path)
    rows = table.to_pylist()
    rows[0]["competitor_index"] = float("nan")
    pq.write_table(pa.Table.from_pylist(rows, schema=table.schema), path)
    with pytest.raises(ValueError, match="nonfinite or out-of-range market context"):
        validate_sources(bad_root, save_report=False)
