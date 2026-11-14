"""Paired posterior scenarios for the M4 conditional 12-week holdout replay.

Inputs are planned USD spending, never redeemed transaction discounts. The
result describes uncertainty in expected units across 96 selected joint draws;
it deliberately does not simulate observation noise or claim causal lift.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from mmm_lab.model import CHANNELS, CONTROL_NAMES, SALES_SCALE, SPEND_SCALE
from mmm_lab.paths import WEB_MODEL_DATA_DIR

HORIZON_WEEKS = 12
HISTORY_WEEKS = 108
SCENARIO_VERSION = "m6a-1"
TRANSFORMATION = {
    "adstock": "state[t] = spend_usd[t]/1000 + alpha * state[t-1]; initial state = 0",
    "saturation": "state/(state + half_saturation_thousands_usd)",
    "baseline": "sales_scale * intercept_scaled * (1 + dot(fixed_controls, control_coef))",
    "channel": "sales_scale * beta_scaled * saturation",
}


@dataclass(frozen=True)
class PreparedScenario:
    """Validated per-region export and precomputed history/control terms."""

    bundle_id: str
    segment_id: str
    segment_index: int
    simulator: dict[str, Any]
    segment: dict[str, Any]
    history_states: np.ndarray  # draw x channel, after all 108 historical weeks
    nonmarketing_totals: np.ndarray  # draw, in sales units


def load_scenario_export(directory: Path = WEB_MODEL_DATA_DIR) -> tuple[dict, dict]:
    """Read the committed M4 manifest and hash-verified simulator payload."""
    directory = Path(directory)
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    info = manifest["files"]["simulator.json"]
    raw = (directory / "simulator.json").read_bytes()
    if len(raw) != info["bytes"] or hashlib.sha256(raw).hexdigest() != info["sha256"]:
        raise ValueError("simulator.json does not match the M4 manifest")
    simulator = json.loads(raw)
    return manifest, simulator


def _matrix(value: Any, rows: int, columns: int, name: str, *, nonnegative: bool) -> np.ndarray:
    if (not isinstance(value, (list, tuple, np.ndarray)) or len(value) != rows or
            any(not isinstance(row, (list, tuple, np.ndarray)) or len(row) != columns or
                any(isinstance(cell, (bool, np.bool_)) for cell in row) for row in value)):
        raise ValueError(f"{name} must be a numeric {rows}x{columns} matrix")
    try:
        matrix = np.asarray(value, dtype=float)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a numeric {rows}x{columns} matrix") from exc
    if matrix.shape != (rows, columns) or not np.isfinite(matrix).all():
        raise ValueError(f"{name} must be a finite {rows}x{columns} matrix")
    if nonnegative and np.any(matrix < 0):
        raise ValueError(f"{name} cannot contain negative planned spend")
    return matrix


def prepare_scenario(manifest: dict, simulator: dict, segment_id: str) -> PreparedScenario:
    """Validate M4 identity and cache adstock history and fixed controls once."""
    if (manifest.get("schema_version") != "m4-1" or simulator.get("schema_version") != "m4-1" or
            manifest.get("bundle_id") != simulator.get("bundle_id") or
            manifest.get("reference_model") != "partial" or simulator.get("reference_model") != "partial"):
        raise ValueError("Scenario source/version mismatch")
    if (tuple(simulator.get("channel_order", ())) != CHANNELS or
            tuple(simulator.get("control_order", ())) != CONTROL_NAMES or
            tuple(simulator.get("segment_order", ())) != tuple(manifest.get("segments", ()))):
        raise ValueError("Scenario source coordinates mismatch")
    transform = simulator.get("transformation", {})
    if (any(transform.get(key) != value for key, value in TRANSFORMATION.items()) or
            transform.get("sales_scale") != SALES_SCALE or
            transform.get("spend_scale_usd") != SPEND_SCALE):
        raise ValueError("Scenario transformation/version mismatch")
    if (len(simulator.get("history_week_starts", ())) != HISTORY_WEEKS or
            len(simulator.get("horizon_week_starts", ())) != HORIZON_WEEKS):
        raise ValueError("Missing or incomplete scenario history/horizon")
    if segment_id not in simulator["segment_order"]:
        raise ValueError(f"Unknown scenario segment: {segment_id}")
    segment_index = simulator["segment_order"].index(segment_id)
    segment = simulator["segments"][segment_index]
    if segment.get("segment_id") != segment_id:
        raise ValueError("Scenario segment coordinates mismatch")
    history = _matrix(segment.get("history_spend_usd"), HISTORY_WEEKS, 3,
                      "history_spend_usd", nonnegative=True)
    _matrix(segment.get("baseline_plan_usd"), HORIZON_WEEKS, 3,
            "baseline_plan_usd", nonnegative=True)
    controls = _matrix(segment.get("fixed_controls"), HORIZON_WEEKS, 7,
                       "fixed_controls", nonnegative=False)
    draws = simulator.get("draws", ())
    if len(draws) != simulator.get("draw_count") or not draws:
        raise ValueError("Scenario posterior draw count mismatch")
    states = np.empty((len(draws), 3), dtype=float)
    nonmarketing = np.empty(len(draws), dtype=float)
    seen: set[int] = set()
    for d, draw in enumerate(draws):
        draw_id = draw.get("joint_draw_index")
        if not isinstance(draw_id, int) or draw_id in seen:
            raise ValueError("Invalid or duplicate joint draw index")
        seen.add(draw_id)
        alpha = np.asarray(draw["adstock_alpha"], dtype=float)
        half = np.asarray(draw["half_saturation_thousands_usd"], dtype=float)
        beta = np.asarray(draw["beta_scaled_by_segment_channel"], dtype=float)
        intercept = np.asarray(draw["intercept_scaled_by_segment"], dtype=float)
        coef = np.asarray(draw["control_coef"], dtype=float)
        if (alpha.shape != (3,) or half.shape != (3,) or beta.shape != (6, 3) or
                intercept.shape != (6,) or coef.shape != (7,) or
                not all(np.isfinite(x).all() for x in (alpha, half, beta, intercept, coef)) or
                np.any(alpha < 0) or np.any(alpha >= 1) or np.any(half <= 0) or np.any(beta < 0)):
            raise ValueError("Invalid posterior draw parameters")
        stock = np.zeros(3, dtype=float)
        for week in history:
            stock = week / SPEND_SCALE + alpha * stock
        states[d] = stock
        nonmarketing[d] = sum(SALES_SCALE * intercept[segment_index] *
                              (1 + float(np.dot(week, coef))) for week in controls)
    return PreparedScenario(manifest["bundle_id"], segment_id, segment_index,
                            simulator, segment, states, nonmarketing)


def scale_baseline_plan(baseline_plan_usd: Any, channel_multipliers: Any) -> list[list[float]]:
    """Scale each channel's existing weekly pattern, retaining twelve weeks."""
    plan = _matrix(baseline_plan_usd, HORIZON_WEEKS, 3, "baseline_plan_usd", nonnegative=True)
    scale = np.asarray(channel_multipliers, dtype=float)
    if (scale.shape != (3,) or any(isinstance(value, (bool, np.bool_)) for value in channel_multipliers) or
            not np.isfinite(scale).all() or np.any(scale < 0)):
        raise ValueError("channel_multipliers must be three finite nonnegative values")
    return (plan * scale[None, :]).tolist()


def _support(plan: np.ndarray, limits: list[dict]) -> dict:
    flags = {}
    for c, name in enumerate(CHANNELS):
        limit = limits[c]
        if (limit["channel"] != name or not all(np.isfinite(limit[key]) for key in
            ("min_usd", "max_usd", "training_max_usd", "training_p95_usd")) or
                limit["min_usd"] != 0 or limit["max_usd"] < limit["training_max_usd"] or
                limit["max_usd"] < limit["training_p95_usd"]):
            raise ValueError("Invalid scenario spend limits")
        flags[name] = {
            "above_training_max_weeks": int(np.count_nonzero(plan[:, c] > limit["training_max_usd"] + 1e-9)),
            "above_observed_max_weeks": int(np.count_nonzero(plan[:, c] > limit["max_usd"] + 1e-9)),
        }
    return {"by_channel": flags,
            "extrapolates_beyond_training": any(v["above_training_max_weeks"] for v in flags.values()),
            "outside_observed_bounds": any(v["above_observed_max_weeks"] for v in flags.values())}


def _summary(values: list[float]) -> dict:
    series = np.asarray(values, dtype=float)
    low, median, high = np.quantile(series, [0.05, 0.5, 0.95])
    return {"mean": float(series.mean()), "p05": float(low), "p50": float(median), "p95": float(high)}


def evaluate_scenario(prepared: PreparedScenario, baseline_plan_usd: Any,
                      alternative_plan_usd: Any) -> dict:
    """Evaluate paired expected units across the same selected posterior draws.

    All plans and support bounds are weekly USD. The 12-week response uses the
    cached adstock state after weeks 1-108 and fixed nonmarketing controls.
    """
    baseline = _matrix(baseline_plan_usd, HORIZON_WEEKS, 3, "baseline_plan_usd", nonnegative=True)
    alternative = _matrix(alternative_plan_usd, HORIZON_WEEKS, 3, "alternative_plan_usd", nonnegative=True)
    results = []
    s = prepared.segment_index
    for d, draw in enumerate(prepared.simulator["draws"]):
        alpha = draw["adstock_alpha"]
        half = draw["half_saturation_thousands_usd"]
        beta = draw["beta_scaled_by_segment_channel"][s]
        base_state = prepared.history_states[d].copy()
        alt_state = prepared.history_states[d].copy()
        base_channel = [0.0, 0.0, 0.0]
        alt_channel = [0.0, 0.0, 0.0]
        for week in range(HORIZON_WEEKS):
            for c in range(3):
                base_state[c] = baseline[week, c] / SPEND_SCALE + alpha[c] * base_state[c]
                alt_state[c] = alternative[week, c] / SPEND_SCALE + alpha[c] * alt_state[c]
                base_channel[c] += SALES_SCALE * beta[c] * base_state[c] / (base_state[c] + half[c])
                alt_channel[c] += SALES_SCALE * beta[c] * alt_state[c] / (alt_state[c] + half[c])
        base_total = float(prepared.nonmarketing_totals[d] + sum(base_channel))
        alt_total = float(prepared.nonmarketing_totals[d] + sum(alt_channel))
        if not np.isfinite((base_total, alt_total)).all():
            raise ValueError("Scenario expected units overflowed")
        results.append({"joint_draw_index": draw["joint_draw_index"],
                        "baseline_expected_units": base_total,
                        "alternative_expected_units": alt_total,
                        "incremental_expected_units": alt_total - base_total,
                        "channel_difference_units": {name: alt_channel[c] - base_channel[c]
                                                     for c, name in enumerate(CHANNELS)}})
    baseline_by_channel = {name: float(baseline[:, c].sum()) for c, name in enumerate(CHANNELS)}
    alternate_by_channel = {name: float(alternative[:, c].sum()) for c, name in enumerate(CHANNELS)}
    return {
        "scenario_version": SCENARIO_VERSION, "bundle_id": prepared.bundle_id,
        "segment_id": prepared.segment_id, "horizon_week_starts": prepared.simulator["horizon_week_starts"],
        "draw_count": len(results), "uncertainty": "parameter_credible_90; expected sales units; no observation noise",
        "baseline_spend_usd": {"by_channel": baseline_by_channel, "total": sum(baseline_by_channel.values())},
        "alternative_spend_usd": {"by_channel": alternate_by_channel, "total": sum(alternate_by_channel.values())},
        "baseline_support": _support(baseline, prepared.segment["spend_limits_usd"]),
        "alternative_support": _support(alternative, prepared.segment["spend_limits_usd"]),
        "draws": results,
        "summary": {
            "baseline_expected_units": _summary([row["baseline_expected_units"] for row in results]),
            "alternative_expected_units": _summary([row["alternative_expected_units"] for row in results]),
            "incremental_expected_units": _summary([row["incremental_expected_units"] for row in results]),
            "channel_difference_units": {name: _summary([row["channel_difference_units"][name]
                                                        for row in results]) for name in CHANNELS},
        },
    }
