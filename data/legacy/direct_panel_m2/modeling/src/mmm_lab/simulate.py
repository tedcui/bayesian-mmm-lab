"""Deterministic synthetic segment-week marketing observations."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from mmm_lab.paths import METADATA_DIR, PROCESSED_DATA_DIR, RAW_DATA_DIR
from mmm_lab.preprocess import prepare_model_table

SEED = 20261113
SEGMENTS = tuple("ABCDEF")
CHANNELS = ("coupon", "retailer", "digital")
SPEND_COLUMNS = tuple(f"{channel}_spend" for channel in CHANNELS)
WEEKS = 120
TRAIN_WEEKS = 100
START_DATE = "2023-01-02"


def geometric_adstock(spend: np.ndarray, decay: float) -> np.ndarray:
    """Apply x[t] + decay * adstock[t-1], starting with zero history."""
    result = np.empty(len(spend), dtype=float)
    previous = 0.0
    for i, value in enumerate(spend):
        previous = float(value) + decay * previous
        result[i] = previous
    return result


def generate_dataset(seed: int = SEED) -> tuple[pd.DataFrame, dict]:
    """Return observable rows and evaluation-only generating truth."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range(START_DATE, periods=WEEKS, freq="W-MON")
    week_index = np.arange(1, WEEKS + 1)
    phase = 2 * np.pi * ((week_index - 1) % 52) / 52
    season_sin, season_cos = np.sin(phase), np.cos(phase)
    trend = (week_index - 1) / (WEEKS - 1)
    holiday = np.isin(dates.isocalendar().week.to_numpy(), [47, 48, 49, 50, 51, 52]).astype(int)

    baselines = dict(zip(SEGMENTS, [1200.0, 980.0, 760.0, 540.0, 310.0, 180.0]))
    spend_scales = dict(zip(SEGMENTS, [1.0, 0.82, 0.65, 0.45, 0.22, 0.12]))
    noise_sigmas = dict(zip(SEGMENTS, [45.0, 48.0, 46.0, 43.0, 48.0, 55.0]))
    max_effects = {
        "A": [180.0, 145.0, 115.0],
        "B": [145.0, 120.0, 100.0],
        "C": [130.0, 105.0, 90.0],
        "D": [105.0, 95.0, 75.0],
        "E": [80.0, 70.0, 65.0],
        "F": [65.0, 55.0, 50.0],
    }
    decay = {"coupon": 0.25, "retailer": 0.45, "digital": 0.65}
    half_saturation = {"coupon": 2800.0, "retailer": 3300.0, "digital": 3500.0}
    spend_reference = np.array([2800.0, 2300.0, 1900.0])
    control_coefficients = {
        "price_index": -1.6,
        "distribution_index": 1.1,
        "competitor_index": -0.45,
        "trend": 0.08,
        "season_sin": 0.09,
        "season_cos": 0.04,
        "holiday": 0.12,
    }

    rows: list[dict] = []
    components: list[dict] = []
    for segment in SEGMENTS:
        baseline = baselines[segment]
        campaign = rng.normal(0.0, 0.8, WEEKS) + 0.65 * holiday + 0.35 * (week_index % 13 == 0)
        channel_noise = rng.normal(0.0, 0.22, (WEEKS, len(CHANNELS)))
        spend = np.maximum(
            0.0,
            spend_reference * spend_scales[segment]
            * (0.92 + 0.30 * campaign[:, None] + channel_noise),
        )
        price = np.clip(1.0 - 0.015 * campaign + rng.normal(0, 0.025, WEEKS), 0.80, 1.20)
        distribution = np.clip(0.90 + 0.015 * trend + rng.normal(0, 0.018, WEEKS), 0.75, 1.0)
        competitor = np.clip(1.0 + 0.025 * season_cos + rng.normal(0, 0.035, WEEKS), 0.80, 1.20)
        promotional: dict[str, np.ndarray] = {}
        for channel_no, channel in enumerate(CHANNELS):
            adstock = geometric_adstock(spend[:, channel_no], decay[channel])
            saturated = adstock / (adstock + half_saturation[channel])
            promotional[channel] = max_effects[segment][channel_no] * saturated
        noise = rng.normal(0.0, noise_sigmas[segment], WEEKS)

        for i in range(WEEKS):
            parts = {
                "baseline": baseline,
                "price": baseline * control_coefficients["price_index"] * (price[i] - 1.0),
                "distribution": baseline * control_coefficients["distribution_index"] * (distribution[i] - 0.90),
                "competitor": baseline * control_coefficients["competitor_index"] * (competitor[i] - 1.0),
                "trend": baseline * control_coefficients["trend"] * trend[i],
                "seasonality": baseline * (control_coefficients["season_sin"] * season_sin[i] + control_coefficients["season_cos"] * season_cos[i]),
                "holiday": baseline * control_coefficients["holiday"] * holiday[i],
                **{channel: promotional[channel][i] for channel in CHANNELS},
            }
            expected = float(sum(parts.values()))
            observed = int(max(0, np.rint(expected + noise[i])))
            rows.append({
                "segment": segment,
                "week_index": int(week_index[i]),
                "week_start": dates[i].strftime("%Y-%m-%d"),
                **{column: float(spend[i, j]) for j, column in enumerate(SPEND_COLUMNS)},
                "price_index": float(price[i]),
                "distribution_index": float(distribution[i]),
                "competitor_index": float(competitor[i]),
                "holiday": int(holiday[i]),
                "trend": float(trend[i]),
                "season_sin": float(season_sin[i]),
                "season_cos": float(season_cos[i]),
                "sales_units": observed,
            })
            components.append({
                "segment": segment,
                "week_index": int(week_index[i]),
                **{name: float(value) for name, value in parts.items()},
                "expected_sales": expected,
                "noise": float(noise[i]),
                "rounding_adjustment": float(observed - expected - noise[i]),
            })

    truth = {
        "schema_version": 1,
        "seed": seed,
        "start_date": START_DATE,
        "weeks_per_segment": WEEKS,
        "training_week_end": TRAIN_WEEKS,
        "segments": {
            segment: {
                "baseline_sales_units": baselines[segment],
                "spend_scale": spend_scales[segment],
                "noise_sigma_sales_units": noise_sigmas[segment],
                "maximum_channel_contribution_sales_units": dict(zip(CHANNELS, max_effects[segment])),
            }
            for segment in SEGMENTS
        },
        "shared_parameters": {
            "adstock_decay": decay,
            "half_saturation_adstock_dollars": half_saturation,
            "control_coefficients_as_baseline_fraction": control_coefficients,
        },
        "components": components,
    }
    return pd.DataFrame(rows), truth


def write_dataset(directory: Path | None = None, seed: int = SEED) -> tuple[Path, Path, Path]:
    """Write the observable, prepared, and evaluation-only files."""
    raw, truth = generate_dataset(seed)
    prepared, preprocessing = prepare_model_table(raw)
    raw_dir = RAW_DATA_DIR if directory is None else directory / "raw"
    processed_dir = PROCESSED_DATA_DIR if directory is None else directory / "processed"
    metadata_dir = METADATA_DIR if directory is None else directory / "metadata"
    for target in (raw_dir, processed_dir, metadata_dir):
        target.mkdir(parents=True, exist_ok=True)
    raw_path = raw_dir / "synthetic_mmm.csv"
    prepared_path = processed_dir / "model_ready.csv"
    truth_path = metadata_dir / "ground_truth.json"
    raw.to_csv(raw_path, index=False)
    prepared.to_csv(prepared_path, index=False)
    truth_path.write_text(json.dumps(truth, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    (metadata_dir / "preprocessing.json").write_text(
        json.dumps(preprocessing, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    return raw_path, prepared_path, truth_path


def main() -> None:
    raw_path, prepared_path, truth_path = write_dataset()
    print(f"Generated {len(SEGMENTS) * WEEKS} rows: {raw_path}, {prepared_path}, {truth_path}")


if __name__ == "__main__":
    main()
