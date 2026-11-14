"""Reproducible source-to-mart command; never consumes synthetic ground truth."""

from __future__ import annotations

import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from mmm_lab.etl.aggregate import aggregate_transactions
from mmm_lab.etl.enrich import enrich_transactions
from mmm_lab.etl.features import MODEL_COLUMNS, build_panel
from mmm_lab.etl.report import make_reports
from mmm_lab.etl.validation import SOURCE_FILES, load_inputs, sha256_file
from mmm_lab.paths import DATA_DIR


def _write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")


def _write_fact(path: Path, source: pa.Table, enriched: pd.DataFrame) -> None:
    # Retain the exact Arrow types of all 44 original transaction columns.
    derived = enriched.drop(columns=source.schema.names)
    extra = pa.Table.from_pandas(derived, preserve_index=False)
    table = pa.Table.from_arrays(
        [*source.columns, *extra.columns], schema=pa.schema([*source.schema, *extra.schema])
    )
    pq.write_table(table, path, compression="zstd")


def build_mart(source_root: Path = DATA_DIR, output_root: Path | None = None) -> dict:
    source_root = Path(source_root)
    output_root = Path(output_root) if output_root is not None else source_root
    inputs = load_inputs(source_root)
    enriched = enrich_transactions(inputs.transactions, inputs.stores, inputs.brands)
    weekly, excluded_weekly = aggregate_transactions(enriched)
    mart, model = build_panel(weekly, excluded_weekly, inputs.plans, inputs.contexts,
                              inputs.manifest["config"])
    quality, reconciliation = make_reports(enriched, mart, inputs.plans)
    marts_dir = output_root / "marts"
    processed_dir = output_root / "processed"
    metadata_dir = output_root / "metadata"
    for directory in (marts_dir, processed_dir, metadata_dir):
        directory.mkdir(parents=True, exist_ok=True)
    outputs = {
        "fact_transactions_enriched": marts_dir / "fact_transactions_enriched.parquet",
        "mart_segment_week": marts_dir / "mart_segment_week.parquet",
        "model_ready": processed_dir / "model_ready.parquet",
        "etl_quality": metadata_dir / "etl_quality.json",
        "etl_reconciliation": metadata_dir / "etl_reconciliation.json",
    }
    _write_fact(outputs["fact_transactions_enriched"], inputs.transaction_table, enriched)
    pq.write_table(pa.Table.from_pandas(mart, preserve_index=False), outputs["mart_segment_week"], compression="zstd")
    pq.write_table(pa.Table.from_pandas(model, preserve_index=False), outputs["model_ready"], compression="zstd")
    _write_json(outputs["etl_quality"], quality)
    _write_json(outputs["etl_reconciliation"], reconciliation)
    lineage = {
        "schema_version": 1,
        "etl_version": "m2b-1",
        "source_manifest_sha256": inputs.manifest_sha256,
        "source_generator_config": inputs.manifest["config"],
        "etl_rule_file_sha256": {
            name: sha256_file(Path(__file__).parent / f"{name}.py")
            for name in ("validation", "enrich", "aggregate", "features", "report", "pipeline")
        },
        "source_files": {name: {"relative_path": relative, "sha256": inputs.manifest["files"][name]["sha256"]}
                         for name, (relative, _) in SOURCE_FILES.items()},
        "source_to_feature": {
            "sales_units": "sum eligible SOURCE_TRANSACTIONS.QUANTITY by store-derived segment and event Monday",
            "coupon_spend": "SIM_MARKETING_PLAN planned_spend where channel=coupon",
            "retailer_promo_spend": "SIM_MARKETING_PLAN planned_spend where channel=retailer_promotion",
            "digital_spend": "SIM_MARKETING_PLAN planned_spend where channel=digital",
            "price_index": "SIM_MARKET_CONTEXT.planned_price_index",
            "distribution_index": "SIM_MARKET_CONTEXT.availability_index",
            "competitor_index": "SIM_MARKET_CONTEXT.competitor_index",
            "holiday": "ISO calendar weeks 47 through 52",
            "week_start": "Monday of SOURCE_TRANSACTIONS.TRANSACTION_DATE",
            "segment_id": "SOURCE_STORES.STANDARD_STATE, falling back to STATE, then geographic crosswalk",
        },
        "model_columns": MODEL_COLUMNS,
        "split": {"train_weeks": [1, 100], "holdout_weeks": [101, 120],
                  "scaling": "none", "adstock_history": "all preceding spend retained in model_ready"},
        "output_hashes": {name: sha256_file(path) for name, path in outputs.items()},
    }
    _write_json(metadata_dir / "etl_manifest.json", lineage)
    return {"quality": quality, "reconciliation": reconciliation, "lineage": lineage}


def main() -> None:
    result = build_mart()
    print(json.dumps({"quality": result["quality"], "reconciliation": result["reconciliation"]}, indent=2))
