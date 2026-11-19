"""Generate source-aligned retail detail from pre-outcome plans and latent demand."""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import asdict
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from mmm_lab.paths import DATA_DIR
from mmm_lab.simulation.config import (
    ADSTOCK_DECAY, BASELINES, CHANNELS, HALF_SATURATION, MAX_EFFECTS,
    NOISE_SIGMAS, SEGMENT_STATES, SPEND_SCALES, STORE_COUNTS, SimulationConfig,
)
from mmm_lab.simulation.schema import schema_sha256, source_schema

UTC = timezone.utc
SUBMITTERS = tuple(str(uuid.uuid5(uuid.NAMESPACE_DNS, f"mmm-lab-invented-submitter-{i}")).upper() for i in (1, 2))
PLAN_SCHEMA = pa.schema([
    pa.field("segment_id", pa.string(), nullable=False),
    pa.field("week_start", pa.date32(), nullable=False),
    pa.field("channel", pa.string(), nullable=False),
    pa.field("planned_spend", pa.float64(), nullable=False),
    pa.field("min_spend", pa.float64(), nullable=False),
    pa.field("max_spend", pa.float64(), nullable=False),
    pa.field("campaign_id", pa.string(), nullable=False),
    pa.field("plan_created_at", pa.timestamp("ns", tz="UTC"), nullable=False),
])
CONTEXT_SCHEMA = pa.schema([
    pa.field("segment_id", pa.string(), nullable=False),
    pa.field("week_start", pa.date32(), nullable=False),
    pa.field("planned_price_index", pa.float64(), nullable=False),
    pa.field("competitor_index", pa.float64(), nullable=False),
    pa.field("availability_index", pa.float64(), nullable=False),
    pa.field("market_size_index", pa.float64(), nullable=False),
    pa.field("context_as_of", pa.timestamp("ns", tz="UTC"), nullable=False),
])


def source_id(*parts: object) -> str:
    return hashlib.sha256("|".join(map(str, parts)).encode("utf-8")).hexdigest()[:32].upper()


def _decimal(value: float | int) -> Decimal:
    return Decimal(f"{value:.3f}")


def _empty(table: str) -> dict:
    return dict.fromkeys(source_schema(table).names)


def _write_table(rows: list[dict], schema: pa.Schema, path: Path) -> None:
    pq.write_table(pa.Table.from_pylist(rows, schema=schema), path, compression="zstd", use_dictionary=False)


def _reference_tables(config: SimulationConfig) -> tuple[list[dict], list[dict], dict[str, list[dict]], dict[str, list[dict]]]:
    stores: list[dict] = []
    products: list[dict] = []
    stores_by_segment: dict[str, list[dict]] = {segment: [] for segment in SEGMENT_STATES}
    products_by_submitter: dict[str, list[dict]] = {submitter: [] for submitter in SUBMITTERS}
    reference_time = datetime.combine(date.fromisoformat(config.start_date) - timedelta(days=30), time(12), UTC)

    for segment_no, (segment, states) in enumerate(SEGMENT_STATES.items()):
        for index in range(STORE_COUNTS[segment]):
            submitter = SUBMITTERS[index % 2]
            store_id = source_id("store", segment, index)
            state = states[index % len(states)]
            house = 100 + index
            row = _empty("stores")
            row.update({
                "STORE_ID": store_id,
                "SUBMITTER_ID": submitter,
                "STORE_NUMBER": f"{segment_no + 1:02d}{index + 1:04d}",
                "MASTER_STORE_ID": 1_000_000_000_000_000_000 + segment_no * 1000 + index // 2,
                "GSS_ID": 1_100_000_000_000_000_000 + segment_no * 1000 + index,
                "OUTLET_LOCATION_ID": source_id("location", segment, index),
                "LEGACY_OUTLET_ID": f"SYN-LEGACY-{segment}-{index + 1:04d}",
                "NAME": f"Fictional {segment.replace('_', ' ').title()} Store {index + 1:03d}",
                "ADDRESS_LINE_1": f"{house} Example Road",
                "CITY": f"Demo City {segment.replace('_', ' ').title()}",
                "STATE": state,
                "ZIP": f"{(segment_no + 1) * 10000 + index:05d}",
                "EMAIL_ADDRESS": f"store{segment.lower()}{index + 1:03d}@example.invalid",
                "PHONE_NUMBER": f"202555{1000 + index:04d}",
                "STANDARD_ADDRESS_LINE_1": f"{house} EXAMPLE RD",
                "STANDARD_CITY": f"DEMO CITY {segment.replace('_', ' ').upper()}",
                "STANDARD_HOUSE_NUMBER": str(house),
                "STANDARD_STATE": None if index % 10 == 0 else state,
                "STANDARD_STREET_NAME": "EXAMPLE",
                "STANDARD_STREET_TYPE": "RD",
                "STANDARD_ZIP": f"{(segment_no + 1) * 10000 + index:05d}",
                "STANDARDIZED_INDICATOR": "Y" if index % 10 else "N",
                "VERIFICATION_INDICATOR": "Y",
                "FILE_TYPE": "SYNTH",
                "OUTLET_TYPE": "R",
                "FUEL_OUTLET_FLAG": "N",
                "FILE_SUBMISSION_ID": 1_200_000_000_000_000_000 + segment_no,
                "CREATED": reference_time,
                "MODIFIED": reference_time,
                "TEST_DATA": False,
                "ERROR_COUNT": 0,
                "DISPLAY_ERROR_COUNT": 0,
                "STATUS": "A",
            })
            stores.append(row)
            stores_by_segment[segment].append(row)

    for index in range(36):
        submitter = SUBMITTERS[index % 2]
        row = _empty("brands")
        row.update({
            "BRAND_ID": source_id("submitted-item", index),
            "GBS_ID": 1_300_000_000_000_000_000 + index,
            "MASTER_BRAND_ID": 1_400_000_000_000_000_000 + index // 2,
            "VERIFICATION_INDICATOR": "Y",
            "LEGACY_ITEM_ID": f"SYN-ITEM-{index + 1:04d}",
            "DESCRIPTION": f"Fictional packaged item {index + 1:03d}",
            "TEST_DATA": False,
            "UPC": f"{index + 1:012d}",
            "UPC14": f"{index + 1:014d}",
            "CREATED": reference_time,
            "MODIFIED": reference_time,
            "UNIT_OF_MEASURE": "EACH",
            "SUBMITTER_ID": submitter,
            "FILE_SUBMISSION_ID": 1_500_000_000_000_000_000 + index % 2,
            "AVG_PRICE": None,
            "ERROR_COUNT": 0,
            "DISPLAY_ERROR_COUNT": 0,
            "THIRTEEN_WK_QUANTITY": None,
            "STATUS": "A",
        })
        products.append(row)
        products_by_submitter[submitter].append(row)
    return stores, products, stores_by_segment, products_by_submitter


def _plans_and_context(config: SimulationConfig, rng: np.random.Generator, weeks: list[date]) -> tuple[list[dict], list[dict], dict, dict]:
    plans: list[dict] = []
    contexts: list[dict] = []
    spend_map: dict[tuple[str, date, str], float] = {}
    context_map: dict[tuple[str, date], dict] = {}
    reference_spend = (2800.0, 2300.0, 1900.0)
    for segment in SEGMENT_STATES:
        for week_no, week in enumerate(weeks, start=1):
            campaign = float(rng.normal(0, 0.8)) + 0.65 * (week.isocalendar().week in range(47, 53)) + 0.35 * (week_no % 13 == 0)
            created = datetime.combine(week - timedelta(days=21), time(12), UTC)
            for channel_no, channel in enumerate(CHANNELS):
                spend = min(
                    reference_spend[channel_no] * SPEND_SCALES[segment] * 2.0,
                    max(0.0, reference_spend[channel_no] * SPEND_SCALES[segment] *
                        (0.92 + 0.30 * campaign + rng.normal(0, 0.22))),
                )
                spend = round(spend, 2)
                row = {
                    "segment_id": segment, "week_start": week, "channel": channel,
                    "planned_spend": spend, "min_spend": 0.0,
                    "max_spend": round(reference_spend[channel_no] * SPEND_SCALES[segment] * 2.0, 2),
                    "campaign_id": source_id("campaign", segment, week, channel),
                    "plan_created_at": created,
                }
                plans.append(row)
                spend_map[(segment, week, channel)] = spend
            context = {
                "segment_id": segment, "week_start": week,
                "planned_price_index": float(np.clip(1 - 0.015 * campaign + rng.normal(0, 0.025), 0.8, 1.2)),
                "competitor_index": float(np.clip(1 + rng.normal(0, 0.035), 0.8, 1.2)),
                "availability_index": float(np.clip(0.9 + 0.015 * week_no / config.weeks + rng.normal(0, 0.018), 0.75, 1.0)),
                "market_size_index": 1.0,
                "context_as_of": datetime.combine(week - timedelta(days=14), time(12), UTC),
            }
            contexts.append(context)
            context_map[(segment, week)] = context
    return plans, contexts, spend_map, context_map


def _demand(config: SimulationConfig, rng: np.random.Generator, weeks: list[date], spend_map: dict, context_map: dict) -> tuple[list[dict], dict]:
    truth_rows: list[dict] = []
    targets: dict[tuple[str, date], int] = {}
    for segment in SEGMENT_STATES:
        adstock = dict.fromkeys(CHANNELS, 0.0)
        for week_no, week in enumerate(weeks, start=1):
            context = context_map[(segment, week)]
            baseline = BASELINES[segment] * config.unit_scale
            phase = 2 * np.pi * ((week_no - 1) % 52) / 52
            parts = {
                "baseline": baseline,
                "price": baseline * -1.6 * (context["planned_price_index"] - 1),
                "availability": baseline * 1.1 * (context["availability_index"] - 0.9),
                "competitor": baseline * -0.45 * (context["competitor_index"] - 1),
                "trend": baseline * 0.08 * (week_no - 1) / 119,
                "seasonality": baseline * (0.09 * np.sin(phase) + 0.04 * np.cos(phase)),
                "holiday": baseline * 0.12 * (week.isocalendar().week in range(47, 53)),
            }
            for channel_no, channel in enumerate(CHANNELS):
                adstock[channel] = spend_map[(segment, week, channel)] + ADSTOCK_DECAY[channel] * adstock[channel]
                parts[channel] = config.unit_scale * MAX_EFFECTS[segment][channel_no] * adstock[channel] / (adstock[channel] + HALF_SATURATION[channel])
            expected = float(sum(parts.values()))
            noise = float(rng.normal(0, NOISE_SIGMAS[segment] * config.unit_scale))
            realized = max(0, round(expected + noise))
            targets[(segment, week)] = realized
            # libm can differ in the last binary digit across operating systems.
            # Quantize evaluation-only truth, then retain exact reconstruction.
            stored_parts = {key: round(float(value), 9) for key, value in parts.items()}
            stored_expected = round(sum(stored_parts.values()), 9)
            stored_noise = round(noise, 9)
            truth_rows.append({
                "segment_id": segment, "week_start": week.isoformat(), "week_index": week_no,
                "components": stored_parts,
                "expected_sales_units": stored_expected, "noise": stored_noise,
                "rounding_adjustment": round(realized - stored_expected - stored_noise, 9),
                "sales_units": realized,
            })
    return truth_rows, targets


def _transaction_rows(segment: str, segment_no: int, weeks: list[date], targets: dict,
                      stores_by_segment: dict, products_by_submitter: dict,
                      spend_map: dict, rng: np.random.Generator) -> list[dict]:
    rows: list[dict] = []
    stores = stores_by_segment[segment]
    store_weights = rng.dirichlet(np.full(len(stores), 3.0))
    for week_no, week in enumerate(weeks, start=1):
        remaining = targets[(segment, week)]
        basket_no = 0
        while remaining:
            basket_no += 1
            store = stores[int(rng.choice(len(stores), p=store_weights))]
            basket_id = source_id("basket", segment, week_no, basket_no)
            basket_key = source_id("basket-key", segment, week_no, basket_no)
            line_count = int(rng.choice((1, 2, 3), p=(0.30, 0.50, 0.20)))
            for line_no in range(line_count):
                if not remaining:
                    break
                quantity = min(remaining, int(rng.integers(1, 7)))
                remaining -= quantity
                item_pool = products_by_submitter[store["SUBMITTER_ID"]]
                item = item_pool[int(rng.integers(len(item_pool)))]
                event = datetime.combine(week + timedelta(days=int(rng.integers(0, 7))),
                                         time(int(rng.integers(8, 22)), int(rng.integers(0, 60))))
                submitted = event.replace(tzinfo=UTC) + timedelta(days=int(rng.integers(1, 4)), hours=int(rng.integers(0, 12)))
                price = _decimal(float(rng.uniform(2.0, 12.0)))
                coupon_probability = min(0.30, 0.03 + 0.12 * spend_map[(segment, week, "coupon")] / 2800)
                retailer_probability = min(0.25, 0.02 + 0.10 * spend_map[(segment, week, "retailer_promotion")] / 2300)
                draw = rng.random()
                promotion = "coupon" if draw < coupon_probability else (
                    "retailer" if draw < coupon_probability + retailer_probability else (
                        "manufacturer" if draw < coupon_probability + retailer_probability + 0.02 else None
                    )
                )
                discount = _decimal(float(price) * quantity * (0.08 if promotion == "coupon" else 0.06)) if promotion else None
                row = _empty("transactions")
                row.update({
                    "TRANSACTION_ID": source_id("line", segment, week_no, basket_no, line_no),
                    "FILE_SUBMISSION_ID": 1_600_000_000_000_000_000 + segment_no * 1000 + week_no,
                    "SUBMITTER_ID": store["SUBMITTER_ID"], "BRAND_ID": item["BRAND_ID"],
                    "STORE_ID": store["STORE_ID"], "CREATED": submitted + timedelta(hours=1),
                    "MODIFIED": submitted + timedelta(hours=1), "SUBMISSION_DATE_TIME": submitted,
                    "TRANSACTION_DATE": event, "TRANSACTION_DATE_TIME": event,
                    "MARKET_BASKET_TRANSACTION_ID": basket_id, "MARKET_BASKET_KEY": basket_key,
                    "SCAN_TRANSACTION_ID": source_id("scan", segment, week_no, basket_no),
                    "REGISTER_ID": f"R{int(rng.integers(1, 7)):02d}",
                    "STORE_NUMBER": store["STORE_NUMBER"],
                    "ACCOUNT_LOYALTY_ID_NUMBER": source_id("invented-loyalty", basket_id) if rng.random() < 0.35 else None,
                    "UPC14": item["UPC14"], "QUANTITY": _decimal(quantity), "PRICE": price,
                    "ORIGINAL_QUANTITY": _decimal(quantity), "ORIGINAL_UPC14": item["UPC14"],
                    "TRANSFORMATION_FLAG": "N", "TRANSFORMATION_2_PASS_FLAG": "N",
                    "PROMOTION_FLAG": promotion is not None, "OUTLET_MULTIPACK_FLAG": False,
                    "ACCOUNT_PROMOTION_NAME": "Synthetic retailer promotion" if promotion == "retailer" else None,
                    "ACCOUNT_DISCOUNT_AMOUNT": discount if promotion == "retailer" else None,
                    "MFG_DISCOUNT_AMOUNT": discount if promotion == "manufacturer" else None,
                    "PID_COUPON": source_id("receipt-coupon", basket_id, line_no) if promotion == "coupon" else None,
                    "PID_COUPON_DISCOUNT": discount if promotion == "coupon" else None,
                    "MANUFACTURER_MULTIPACK_FLAG": False,
                    "MANUFACTURER_PROMOTION_DESCRIPTION": "Synthetic manufacturer offer" if promotion == "manufacturer" else None,
                    "COUPON_DESCRIPTION": "Synthetic receipt coupon" if promotion == "coupon" else None,
                    "TEST_DATA": False, "ERROR_COUNT": 0, "DISPLAY_ERROR_COUNT": 0, "STATUS": "A",
                })
                rows.append(row)
    return rows


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def generate_sources(config: SimulationConfig = SimulationConfig(), output_root: Path | None = None) -> dict:
    """Write three silver and two auxiliary sources; never create a model-ready panel."""
    root = DATA_DIR if output_root is None else Path(output_root)
    silver, auxiliary, metadata = (root / name for name in ("silver", "auxiliary", "metadata"))
    for directory in (silver, auxiliary, metadata):
        directory.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(config.seed)
    weeks = [date.fromisoformat(config.start_date) + timedelta(weeks=i) for i in range(config.weeks)]
    stores, products, stores_by_segment, products_by_submitter = _reference_tables(config)
    plans, contexts, spend_map, context_map = _plans_and_context(config, rng, weeks)
    truth_rows, targets = _demand(config, rng, weeks, spend_map, context_map)

    paths = {
        "source_stores": silver / "source_stores.parquet",
        "source_brands": silver / "source_brands.parquet",
        "source_transactions": silver / "source_transactions.parquet",
        "sim_marketing_plan": auxiliary / "sim_marketing_plan.parquet",
        "sim_market_context": auxiliary / "sim_market_context.parquet",
    }
    _write_table(stores, source_schema("stores"), paths["source_stores"])
    _write_table(products, source_schema("brands"), paths["source_brands"])
    _write_table(plans, PLAN_SCHEMA, paths["sim_marketing_plan"])
    _write_table(contexts, CONTEXT_SCHEMA, paths["sim_market_context"])

    transaction_count = 0
    writer = pq.ParquetWriter(paths["source_transactions"], source_schema("transactions"), compression="zstd", use_dictionary=False)
    try:
        for segment_no, segment in enumerate(SEGMENT_STATES):
            rows = _transaction_rows(segment, segment_no, weeks, targets, stores_by_segment, products_by_submitter, spend_map, rng)
            writer.write_table(pa.Table.from_pylist(rows, schema=source_schema("transactions")))
            transaction_count += len(rows)
    finally:
        writer.close()

    truth = {
        "schema_version": 2,
        "evaluation_only": True,
        "generator_config": asdict(config),
        "segments": {segment: {"states": states, "store_count": STORE_COUNTS[segment],
                               "baseline_sales_units": BASELINES[segment], "spend_scale": SPEND_SCALES[segment],
                               "noise_sigma_sales_units": NOISE_SIGMAS[segment],
                               "maximum_channel_contribution_sales_units": dict(zip(CHANNELS, MAX_EFFECTS[segment]))}
                     for segment, states in SEGMENT_STATES.items()},
        "adstock_decay": ADSTOCK_DECAY, "half_saturation_dollars": HALF_SATURATION,
        "segment_weeks": truth_rows,
    }
    truth_path = metadata / "ground_truth.json"
    truth_path.write_bytes((json.dumps(truth, indent=2, allow_nan=False) + "\n").encode("utf-8"))
    file_info = {
        name: {"relative_path": str(path.relative_to(root)).replace("\\", "/"),
               "rows": (transaction_count if name == "source_transactions" else
                        len(stores) if name == "source_stores" else len(products) if name == "source_brands" else
                        len(plans) if name == "sim_marketing_plan" else len(contexts)),
               "sha256": _sha256(path)}
        for name, path in paths.items()
    }
    manifest = {
        "schema_version": 1, "generator": "mmm_lab.simulation.generate",
        "config": asdict(config), "source_schema_sha256": schema_sha256(),
        "simulation_semantics": {
            "price": "Pre-discount USD per unit for this simulation; source production semantics are unverified",
            "quantity": "Whole units on a transaction detail line; multiple lines may share a basket",
            "status_A": "Active and eligible in this simulation only; not a production code dictionary",
            "promotion_flag": "A simulated receipt-level promotion or redemption, not a planned budget",
            "planned_spend": "USD budget set before the sales week in a separate synthetic source",
            "event_timezone": "Naive business event timestamps; submission and audit timestamps use UTC",
            "reference_mapping": "Current-state submitted identity to master identity; no historical versions",
            "ground_truth_precision": "Evaluation-only floating components rounded to 9 decimal places for cross-platform reproducibility",
        },
        "lineage_order": ["reference_tables", "planned_marketing_and_context", "latent_demand",
                          "realized_units", "transaction_detail"],
        "files": file_info, "ground_truth_sha256": _sha256(truth_path),
    }
    (metadata / "source_manifest.json").write_bytes((json.dumps(manifest, indent=2) + "\n").encode("utf-8"))
    from mmm_lab.simulation.quality import validate_sources

    validate_sources(root)
    return manifest


def main() -> None:
    manifest = generate_sources()
    counts = {name: info["rows"] for name, info in manifest["files"].items()}
    print(f"Generated M2A sources: {counts}")


if __name__ == "__main__":
    main()
