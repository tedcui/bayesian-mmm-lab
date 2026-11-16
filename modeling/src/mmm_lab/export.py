"""Versioned, lineage-checked browser exports from the actual M3 posteriors."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from mmm_lab.evaluate import posterior_components
from mmm_lab.model import (CHANNELS, CONTROL_NAMES, POOLING, SALES_SCALE,
                           SPEND_SCALE, load_model_data, sha256_file)
from mmm_lab.paths import ARTIFACTS_DIR, DATA_DIR, WEB_MODEL_DATA_DIR

SCHEMA_VERSION = "m4-2"
REFERENCE_MODEL = "partial"  # comparison reference, not a best-model claim
EXPORT_SEED = 20261114
SIMULATOR_DRAWS = 96


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, value: dict) -> None:
    # Hash the same bytes on Windows and Linux; text-mode writes translate newlines.
    path.write_bytes((json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8"))


def _summary(values: np.ndarray) -> dict:
    """Summarize a draw vector after any within-draw aggregation."""
    values = np.asarray(values, dtype=float)
    if values.ndim != 1 or not np.isfinite(values).all():
        raise ValueError("A summary requires finite posterior draws")
    low, median, high = np.quantile(values, [0.05, 0.5, 0.95])
    return {"mean": round(float(values.mean()), 4), "p05": round(float(low), 4),
            "p50": round(float(median), 4), "p95": round(float(high), 4)}


def _check_lineage(data_root: Path, artifact_dir: Path, data) -> tuple[dict, dict, dict, dict]:
    source_path = data_root / "metadata/source_manifest.json"
    etl_path = data_root / "metadata/etl_manifest.json"
    fit_path = artifact_dir / "fit_manifest.json"
    evaluation_path = artifact_dir / "evaluation.json"
    source, etl, fit, evaluation = map(_read_json, (source_path, etl_path, fit_path, evaluation_path))
    if etl.get("source_manifest_sha256") != sha256_file(source_path):
        raise ValueError("M2B source lineage hash mismatch")
    if fit.get("etl_manifest_sha256") != sha256_file(etl_path) or fit.get("model_input_sha256") != data.input_sha256:
        raise ValueError("M3 input lineage hash mismatch")
    if evaluation.get("fit_manifest_sha256") != sha256_file(fit_path) or evaluation.get("model_input_sha256") != data.input_sha256:
        raise ValueError("M3 evaluation lineage hash mismatch")
    if tuple(fit.get("pooling", ())) != POOLING or set(fit.get("files", {})) != set(POOLING):
        raise ValueError("All three M3 fits are required")
    for pooling in POOLING:
        diagnostics = evaluation["models"][pooling]["diagnostics"]
        if diagnostics["divergences"] or diagnostics["max_rhat"] > 1.01:
            raise ValueError(f"Unresolved sampling diagnostics for {pooling}")
        info = fit["files"][pooling]
        if sha256_file(artifact_dir / info["path"]) != info["sha256"]:
            raise ValueError(f"Posterior hash mismatch for {pooling}")
    return source, etl, fit, evaluation


def _weekly_and_aggregates(data, baseline, channel, expected, predictive) -> tuple[list, list, list, list, list]:
    overview_rows, contribution_rows, all_overview_rows, all_contribution_rows, aggregates = [], [], [], [], []
    for s, segment in enumerate(data.segments):
        for t, week in enumerate(data.weeks):
            key = {"segment_id": segment, "week_start": week, "time_index": t + 1,
                   "period": "training" if t < 100 else "holdout"}
            observed = int(data.sales[s, t])
            expected_summary = _summary(expected[:, s, t])
            residual = round(observed - expected_summary["mean"], 4)
            overview_rows.append({**key, "observed_sales_units": observed,
                                  "planned_spend_usd": {name: round(float(data.spend[s, t, c]), 2)
                                                        for c, name in enumerate(CHANNELS)},
                                  "expected_sales_units": expected_summary,
                                  "predictive_sales_units": _summary(predictive[:, s, t]),
                                  "residual_to_expected_mean_units": residual})
            contribution_rows.append({**key, "observed_sales_units": observed,
                                      "baseline_units": _summary(baseline[:, s, t]),
                                      "channels_units": {name: _summary(channel[:, s, t, c])
                                                         for c, name in enumerate(CHANNELS)},
                                      "expected_sales_units": expected_summary,
                                      "residual_to_expected_mean_units": residual})
    for t, week in enumerate(data.weeks):
        key = {"segment_id": None, "week_start": week, "time_index": t + 1,
               "period": "training" if t < 100 else "holdout"}
        observed = int(data.sales[:, t].sum())
        base_draws = baseline[:, :, t].sum(axis=1)
        channel_draws = channel[:, :, t, :].sum(axis=1)
        expected_draws = expected[:, :, t].sum(axis=1)
        if not np.allclose(base_draws + channel_draws.sum(axis=1), expected_draws, atol=1e-7):
            raise ValueError("All-region weekly expected sales do not reconcile within draws")
        expected_summary = _summary(expected_draws)
        common = {**key, "observed_sales_units": observed,
                  "expected_sales_units": expected_summary,
                  "residual_to_expected_mean_units": round(observed - expected_summary["mean"], 4)}
        all_overview_rows.append({**common,
                                  "planned_spend_usd": {name: round(float(data.spend[:, t, c].sum()), 2)
                                                        for c, name in enumerate(CHANNELS)},
                                  "predictive_sales_units": _summary(predictive[:, :, t].sum(axis=1))})
        all_contribution_rows.append({**common, "baseline_units": _summary(base_draws),
                                      "channels_units": {name: _summary(channel_draws[:, c])
                                                         for c, name in enumerate(CHANNELS)}})
    for s in (None, *range(6)):
        segment_slice = slice(None) if s is None else slice(s, s + 1)
        for period, week_slice in (("all", slice(None)), ("training", slice(0, 100)),
                                   ("holdout", slice(100, None))):
            base_draws = baseline[:, segment_slice, week_slice].sum(axis=(1, 2))
            channel_draws = channel[:, segment_slice, week_slice, :].sum(axis=(1, 2))
            expected_draws = base_draws + channel_draws.sum(axis=1)
            if not np.allclose(expected_draws, expected[:, segment_slice, week_slice].sum(axis=(1, 2)), atol=1e-7):
                raise ValueError("Expected sales do not reconcile within draws")
            observed = int(data.sales[segment_slice, week_slice].sum())
            expected_summary = _summary(expected_draws)
            aggregates.append({
                "segment_id": None if s is None else data.segments[s], "period": period,
                "observed_sales_units": observed,
                "planned_spend_usd": {name: round(float(data.spend[segment_slice, week_slice, c].sum()), 2)
                                      for c, name in enumerate(CHANNELS)},
                "baseline_units": _summary(base_draws),
                "channels_units": {name: _summary(channel_draws[:, c]) for c, name in enumerate(CHANNELS)},
                "expected_sales_units": expected_summary,
                "predictive_sales_units": _summary(predictive[:, segment_slice, week_slice].sum(axis=(1, 2))),
                "residual_to_expected_mean_units": round(observed - expected_summary["mean"], 4),
            })
    return overview_rows, contribution_rows, all_overview_rows, all_contribution_rows, aggregates


def _segments(data, posteriors: dict, evaluation: dict, bundle_id: str) -> dict:
    effects, models, profiles = [], {}, []
    for pooling in POOLING:
        beta = posteriors[pooling]["beta"].values.reshape(-1, 6, 3) * SALES_SCALE
        result = evaluation["models"][pooling]
        truth = {(row["segment_id"], row["channel"]): row["true_max_units"]
                 for row in result["recovery"]["coefficient_by_segment_channel"]}
        if len(truth) != 18:
            raise ValueError("Incomplete coefficient truth in M3 evaluation")
        for s, segment in enumerate(data.segments):
            for c, name in enumerate(CHANNELS):
                summary = _summary(beta[:, s, c])
                true_value = float(truth[(segment, name)])
                effects.append({"pooling": pooling, "segment_id": segment, "channel": name,
                                "maximum_effect_units": summary, "synthetic_truth_units": true_value,
                                "interval_contains_truth": summary["p05"] <= true_value <= summary["p95"]})
        models[pooling] = {"diagnostics": result["diagnostics"],
                           "conditional_holdout": result["conditional_holdout"],
                           "coefficient_recovery": {key: result["recovery"][key]
                                                    for key in ("coefficient_90_coverage",
                                                                "coefficient_mean_absolute_error_units")}}
    for s, segment in enumerate(data.segments):
        profiles.append({"segment_id": segment,
                         "training_mean_sales_units": round(float(data.sales[s, :100].mean()), 4),
                         "training_spend_cv": {name: round(float(data.spend[s, :100, c].std() /
                                                                 max(data.spend[s, :100, c].mean(), 1e-9)), 4)
                                               for c, name in enumerate(CHANNELS)}})
    return {"schema_version": SCHEMA_VERSION, "bundle_id": bundle_id,
            "effect_definition": "Maximum modeled weekly channel contribution at full Hill saturation, not units per USD.",
            "interval_definition": "90% parameter credible interval; synthetic truth is evaluation-only.",
            "interpretation": "Good prediction does not establish channel identification or causal incrementality.",
            "models": models, "effects": effects, "segment_profiles": profiles}


def _simulator(data, posterior, bundle_id: str, count: int) -> dict:
    chains, draws_per_chain = int(posterior.sizes["chain"]), int(posterior.sizes["draw"])
    total = chains * draws_per_chain
    if not 1 <= count <= total:
        raise ValueError("Invalid simulator draw count")
    indices = np.sort(np.random.default_rng(EXPORT_SEED).choice(total, count, replace=False))
    parameters = ("intercept", "control_coef", "beta", "adstock_alpha", "half_saturation", "noise")
    flat = {name: posterior[name].values.reshape(total, *posterior[name].shape[2:]) for name in parameters}
    selected = [{"joint_draw_index": int(i), "chain_index": int(i // draws_per_chain),
                 "chain_draw_index": int(i % draws_per_chain),
                 "intercept_scaled_by_segment": flat["intercept"][i].tolist(),
                 "control_coef": flat["control_coef"][i].tolist(),
                 "beta_scaled_by_segment_channel": flat["beta"][i].tolist(),
                 "adstock_alpha": flat["adstock_alpha"][i].tolist(),
                 "half_saturation_thousands_usd": flat["half_saturation"][i].tolist(),
                 "noise_scaled_by_segment": flat["noise"][i].tolist()} for i in indices]
    horizon_start = 108
    plans = []
    for s, segment in enumerate(data.segments):
        limits = []
        for c, name in enumerate(CHANNELS):
            training = data.spend[s, :100, c]
            limits.append({"channel": name, "min_usd": 0.0,
                           "max_usd": round(float(data.spend[s, :, c].max()), 2),
                           "training_max_usd": round(float(training.max()), 2),
                           "training_p95_usd": round(float(np.quantile(training, 0.95)), 2)})
        plans.append({"segment_id": segment,
                      "history_spend_usd": np.round(data.spend[s, :horizon_start], 2).tolist(),
                      "baseline_plan_usd": np.round(data.spend[s, horizon_start:], 2).tolist(),
                      "fixed_controls": data.controls[s, horizon_start:].tolist(),
                      "spend_limits_usd": limits})
    return {"schema_version": SCHEMA_VERSION, "bundle_id": bundle_id,
            "reference_model": REFERENCE_MODEL, "draw_selection_seed": EXPORT_SEED,
            "draw_count": count, "source_posterior_draw_count": total,
            "chain_count": chains, "draws_per_chain": draws_per_chain,
            "channel_order": list(CHANNELS), "segment_order": list(data.segments),
            "control_order": list(CONTROL_NAMES),
            "horizon_week_starts": list(data.weeks[horizon_start:]),
            "history_week_starts": list(data.weeks[:horizon_start]),
            "scenario_context": "Retrospective replay of the last 12 holdout weeks with fixed plans and pre-outcome context; not an unconditional future forecast.",
            "transformation": {"adstock": "state[t] = spend_usd[t]/1000 + alpha * state[t-1]; initial state = 0",
                               "saturation": "state/(state + half_saturation_thousands_usd)",
                               "baseline": "sales_scale * intercept_scaled * (1 + dot(fixed_controls, control_coef))",
                               "channel": "sales_scale * beta_scaled * saturation",
                               "sales_scale": SALES_SCALE, "spend_scale_usd": SPEND_SCALE},
            "spend_support": "Allowed: zero through maximum observed planned spend across 120 weeks; above training maximum is extrapolation.",
            "segments": plans, "draws": selected}


def export_model_data(*, data_root: Path = DATA_DIR, artifact_dir: Path = ARTIFACTS_DIR,
                      output_dir: Path = WEB_MODEL_DATA_DIR, simulator_draws: int = SIMULATOR_DRAWS) -> dict:
    """Write compact fitted-model JSON without fitting or exposing source rows."""
    import arviz as az

    data_root, artifact_dir, output_dir = map(Path, (data_root, artifact_dir, output_dir))
    data = load_model_data(data_root)
    source, etl, fit, evaluation = _check_lineage(data_root, artifact_dir, data)
    fit_hash = sha256_file(artifact_dir / "fit_manifest.json")
    evaluation_hash = sha256_file(artifact_dir / "evaluation.json")
    bundle_id = hashlib.sha256(f"{SCHEMA_VERSION}:{data.input_sha256}:{fit_hash}:{evaluation_hash}".encode()).hexdigest()
    posteriors = {}
    for pooling in POOLING:
        posterior = az.from_netcdf(artifact_dir / fit["files"][pooling]["path"])["posterior"]
        if (tuple(str(x) for x in posterior.coords["segment"].values) != data.segments or
                tuple(str(x) for x in posterior.coords["channel"].values) != CHANNELS):
            raise ValueError(f"Posterior coordinates mismatch for {pooling}")
        posteriors[pooling] = posterior
    baseline, channel, expected, noise = posterior_components(data, posteriors[REFERENCE_MODEL])
    predictive = expected + noise[:, :, None] * np.random.default_rng(EXPORT_SEED + 1).normal(size=expected.shape)
    overview_rows, contribution_rows, all_overview_rows, all_contribution_rows, aggregates = (
        _weekly_and_aggregates(data, baseline, channel, expected, predictive))
    overview = {"schema_version": SCHEMA_VERSION, "bundle_id": bundle_id,
                "reference_model": REFERENCE_MODEL,
                "intervals": {"expected_sales_units": "posterior credible 90% interval for the conditional mean",
                              "predictive_sales_units": "posterior predictive 90% interval for a future observation at fixed inputs"},
                "weekly": overview_rows, "all_regions_weekly": all_overview_rows,
                "aggregates": [{key: row[key] for key in ("segment_id", "period", "observed_sales_units",
                                                     "planned_spend_usd", "expected_sales_units",
                                                     "predictive_sales_units", "residual_to_expected_mean_units")}
                               for row in aggregates]}
    contributions = {"schema_version": SCHEMA_VERSION, "bundle_id": bundle_id,
                     "reference_model": REFERENCE_MODEL,
                     "interpretation": "Modeled, assumption-dependent contributions; not experiment-validated causal lift.",
                     "weekly": contribution_rows, "all_regions_weekly": all_contribution_rows,
                     "aggregates": aggregates}
    payloads = {"overview.json": overview, "contributions.json": contributions,
                "segments.json": _segments(data, posteriors, evaluation, bundle_id),
                "simulator.json": _simulator(data, posteriors[REFERENCE_MODEL], bundle_id, simulator_draws)}
    output_dir.mkdir(parents=True, exist_ok=True)
    for name, payload in payloads.items():
        _write_json(output_dir / name, payload)
    manifest = {"schema_version": SCHEMA_VERSION, "bundle_id": bundle_id,
                "generated_at_utc": datetime.now(timezone.utc).isoformat(),
                "reference_model": REFERENCE_MODEL,
                "reference_model_note": "Partial pooling is the pedagogical reference, not the best coefficient-recovery model in this run.",
                "models": list(POOLING), "segments": list(data.segments), "channels": list(CHANNELS),
                "units": {"sales": "units", "planned_spend": "USD", "time": "Monday-start week"},
                "dates": {"first_week": data.weeks[0], "last_week": data.weeks[-1],
                          "last_training_week": data.weeks[99], "first_holdout_week": data.weeks[100]},
                "lineage": {"source_manifest_sha256": sha256_file(data_root / "metadata/source_manifest.json"),
                            "source_schema_sha256": source["source_schema_sha256"],
                            "etl_manifest_sha256": sha256_file(data_root / "metadata/etl_manifest.json"),
                            "etl_version": etl["etl_version"], "model_input_sha256": data.input_sha256,
                            "fit_manifest_sha256": fit_hash, "evaluation_sha256": evaluation_hash,
                            "model_version": fit["model_version"],
                            "posterior_sha256": {name: fit["files"][name]["sha256"] for name in POOLING}},
                "files": {name: {"sha256": sha256_file(output_dir / name),
                                  "bytes": (output_dir / name).stat().st_size} for name in payloads},
                "limitations": [*evaluation["limitations"],
                                "Partial pooling misses some true effects; no pooling has better coefficient recovery in this run.",
                                "Simulator baseline replays holdout weeks 109-120, conditional on fixed inputs."],
                "disclosure": "Synthetic data · illustrative model results"}
    _write_json(output_dir / "manifest.json", manifest)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Export versioned M3 posterior summaries for M4")
    parser.add_argument("--simulator-draws", type=int, default=SIMULATOR_DRAWS)
    args = parser.parse_args()
    manifest = export_model_data(simulator_draws=args.simulator_draws)
    print(json.dumps({"bundle_id": manifest["bundle_id"], "files": manifest["files"]}, indent=2))


if __name__ == "__main__":
    main()
