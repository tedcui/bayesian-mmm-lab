"""Posterior diagnostics and holdout/recovery checks for actual M3 fits."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from mmm_lab.model import CHANNELS, POOLING, SALES_SCALE, SPEND_SCALE, ModelData, load_model_data, sha256_file
from mmm_lab.paths import ARTIFACTS_DIR, DATA_DIR


def posterior_components(data: ModelData, posterior) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Evaluate all draws on all 120 weeks with pre-holdout adstock state."""
    if (tuple(str(value) for value in posterior.coords["segment"].values) != data.segments or
            tuple(str(value) for value in posterior.coords["channel"].values) != CHANNELS):
        raise ValueError("Posterior segment/channel coordinates do not match the M2B panel")
    intercept = posterior["intercept"].values.reshape(-1, 6)
    control = posterior["control_coef"].values.reshape(-1, 7)
    beta = posterior["beta"].values.reshape(-1, 6, 3)
    alpha = posterior["adstock_alpha"].values.reshape(-1, 3)
    half = posterior["half_saturation"].values.reshape(-1, 3)
    noise = posterior["noise"].values.reshape(-1, 6) * SALES_SCALE
    draws = len(intercept)
    stock = np.zeros((draws, 6, 3), dtype=float)
    saturated = np.empty((draws, 6, 120, 3), dtype=float)
    for week in range(120):
        stock = data.spend[:, week, :][None, :, :] / SPEND_SCALE + alpha[:, None, :] * stock
        saturated[:, :, week, :] = stock / (stock + half[:, None, :])
    baseline = SALES_SCALE * intercept[:, :, None] * (1 + np.einsum("stc,dc->dst", data.controls, control))
    channel = SALES_SCALE * beta[:, :, None, :] * saturated
    expected = baseline + channel.sum(axis=-1)
    return baseline, channel, expected, noise


def _metrics(data: ModelData, expected: np.ndarray, noise: np.ndarray,
             start: int, stop: int, seed: int) -> dict:
    mean = expected[:, :, start:stop].mean(axis=0)
    target = data.sales[:, start:stop]
    rng = np.random.default_rng(seed)
    predictive = expected[:, :, start:stop] + rng.normal(
        size=expected[:, :, start:stop].shape) * noise[:, :, None]
    low, high = np.quantile(predictive, [0.05, 0.95], axis=0)
    error = mean - target
    return {
        "mae_units": round(float(np.abs(error).mean()), 3),
        "wape": round(float(np.abs(error).sum() / target.sum()), 5),
        "bias_units_predicted_minus_observed": round(float(error.mean()), 3),
        "predictive_90_coverage": round(float(np.mean((target >= low) & (target <= high))), 4),
        "segment_mae_units": {segment: round(float(np.abs(error[index]).mean()), 3)
                              for index, segment in enumerate(data.segments)},
    }


def _recovery(data: ModelData, posterior, baseline: np.ndarray, channel: np.ndarray,
              truth: dict) -> dict:
    truth_cells = {(r["segment_id"], r["week_start"]): r for r in truth["segment_weeks"]}
    truth_channel = np.empty((6, 120, 3))
    truth_baseline = np.empty((6, 120))
    for s, segment in enumerate(data.segments):
        for t, week in enumerate(data.weeks):
            parts = truth_cells[(segment, week)]["components"]
            truth_channel[s, t, :] = [parts[c] for c in CHANNELS]
            truth_baseline[s, t] = sum(v for k, v in parts.items() if k not in CHANNELS)
    beta = posterior["beta"].values.reshape(-1, 6, 3) * SALES_SCALE
    alpha_draws = posterior["adstock_alpha"].values.reshape(-1, 3)
    half_draws = posterior["half_saturation"].values.reshape(-1, 3) * SPEND_SCALE
    beta_low, beta_high = np.quantile(beta, [0.05, 0.95], axis=0)
    true_beta = np.array([[truth["segments"][s]["maximum_channel_contribution_sales_units"][c]
                           for c in CHANNELS] for s in data.segments])
    channel_low, channel_high = np.quantile(channel, [0.05, 0.95], axis=0)
    baseline_low, baseline_high = np.quantile(baseline, [0.05, 0.95], axis=0)
    shape_recovery = []
    for c, channel_name in enumerate(CHANNELS):
        for parameter, draws, true_value, units in (
            ("adstock_alpha", alpha_draws[:, c], truth["adstock_decay"][channel_name], "unitless"),
            ("half_saturation", half_draws[:, c], truth["half_saturation_dollars"][channel_name], "USD"),
        ):
            low, high = np.quantile(draws, [0.05, 0.95])
            shape_recovery.append({
                "channel": channel_name, "parameter": parameter, "units": units,
                "true_value": float(true_value), "posterior_mean": round(float(draws.mean()), 4),
                "credible_90_low": round(float(low), 4), "credible_90_high": round(float(high), 4),
                "contains_truth": bool(low <= true_value <= high),
            })
    return {
        "coefficient_90_coverage": round(float(np.mean((true_beta >= beta_low) & (true_beta <= beta_high))), 4),
        "coefficient_mean_absolute_error_units": round(float(np.abs(beta.mean(axis=0) - true_beta).mean()), 3),
        "coefficient_by_segment_channel": [
            {"segment_id": segment, "channel": channel_name, "true_max_units": float(true_beta[s, c]),
             "posterior_mean_max_units": round(float(beta[:, s, c].mean()), 3),
             "credible_90_low": round(float(beta_low[s, c]), 3),
             "credible_90_high": round(float(beta_high[s, c]), 3)}
            for s, segment in enumerate(data.segments) for c, channel_name in enumerate(CHANNELS)
        ],
        "channel_contribution_mae_units": round(float(np.abs(channel.mean(axis=0) - truth_channel).mean()), 3),
        "channel_contribution_90_coverage": round(float(np.mean((truth_channel >= channel_low) &
                                                                 (truth_channel <= channel_high))), 4),
        "baseline_mae_units": round(float(np.abs(baseline.mean(axis=0) - truth_baseline).mean()), 3),
        "baseline_90_coverage": round(float(np.mean((truth_baseline >= baseline_low) &
                                                     (truth_baseline <= baseline_high))), 4),
        "shared_shape_recovery": shape_recovery,
    }


def _diagnostics(idata, az) -> dict:
    names = ["intercept", "control_coef", "adstock_alpha", "half_saturation", "beta", "noise"]
    rhat = az.rhat(idata, var_names=names)
    ess = az.ess(idata, var_names=names, method="bulk")
    return {
        "max_rhat": round(float(max(np.nanmax(rhat[name].values) for name in names)), 4),
        "min_bulk_ess": round(float(min(np.nanmin(ess[name].values) for name in names)), 1),
        "divergences": int(idata["sample_stats"]["diverging"].sum().item()),
        "parameters_with_rhat_above_1_01": [name for name in names
                                            if float(np.nanmax(rhat[name].values)) > 1.01],
    }


def _correlations(data: ModelData) -> dict:
    correlations = {}
    for s, segment in enumerate(data.segments):
        matrix = np.corrcoef(data.spend[s, :100, :].T)
        correlations[segment] = {
            f"{CHANNELS[i]}_vs_{CHANNELS[j]}": round(float(matrix[i, j]), 4)
            for i in range(3) for j in range(i + 1, 3)
        }
    return correlations


def _population_prior_sensitivity(posterior) -> dict:
    """Reweight partial-pooling draws under a wider population prior.

    This changes only Normal(0, 0.7) on each log population response to
    Normal(0, 1.0); all other priors and the likelihood stay fixed. Report
    importance ESS so a weak-overlap estimate is not mistaken for a refit.
    """
    population = posterior["log_beta_population"].values.reshape(-1, 3)
    beta = posterior["beta"].values.reshape(-1, 6, 3) * SALES_SCALE
    log_weight = 0.5 * np.sum(population**2 * (1 / 0.7**2 - 1 / 1.0**2), axis=1)
    weights = np.exp(log_weight - np.max(log_weight))
    weights /= weights.sum()
    baseline_mean = beta.mean(axis=0)
    alternate_mean = np.einsum("d,dsc->sc", weights, beta)
    return {
        "method": "posterior importance reweighting, not independent MCMC refit",
        "alternate_log_population_prior_sigma": 1.0,
        "base_log_population_prior_sigma": 0.7,
        "importance_effective_draws": round(float(1 / np.sum(weights**2)), 1),
        "available_draws": int(len(weights)),
        "max_absolute_coefficient_mean_shift_units": round(float(np.max(np.abs(alternate_mean - baseline_mean))), 3),
        "mean_absolute_coefficient_mean_shift_units": round(float(np.mean(np.abs(alternate_mean - baseline_mean))), 3),
    }


def evaluate_models(*, data_root: Path = DATA_DIR, artifact_dir: Path = ARTIFACTS_DIR) -> dict:
    """Read fit artifacts and evaluation-only truth after all fitting is complete."""
    import arviz as az

    data = load_model_data(data_root)
    artifact_dir = Path(artifact_dir)
    manifest = json.loads((artifact_dir / "fit_manifest.json").read_text(encoding="utf-8"))
    if (manifest["model_input_sha256"] != data.input_sha256 or
            manifest["etl_manifest_sha256"] != data.etl_manifest_sha256):
        raise ValueError("Fit artifact does not match current M2B input lineage")
    truth = json.loads((Path(data_root) / "metadata/ground_truth.json").read_text(encoding="utf-8"))
    if not truth.get("evaluation_only"):
        raise ValueError("Synthetic truth must be an evaluation-only artifact")
    results = {}
    for index, pooling in enumerate(POOLING):
        info = manifest["files"][pooling]
        path = artifact_dir / info["path"]
        if sha256_file(path) != info["sha256"]:
            raise ValueError(f"Posterior hash mismatch for {pooling}")
        idata = az.from_netcdf(path)
        baseline, channel, expected, noise = posterior_components(data, idata["posterior"])
        if not np.allclose(expected, baseline + channel.sum(axis=-1), atol=1e-9):
            raise ValueError("Expected sales do not reconcile to components")
        prior = idata["prior_predictive"]["sales"].values * SALES_SCALE
        results[pooling] = {
            "diagnostics": _diagnostics(idata, az),
            "train": _metrics(data, expected, noise, 0, 100, 3000 + index),
            "conditional_holdout": _metrics(data, expected, noise, 100, 120, 4000 + index),
            "prior_predictive": {
                "draws": int(prior.shape[0] * prior.shape[1]),
                "negative_sales_fraction": round(float(np.mean(prior < 0)), 4),
                "overall_mean_units": round(float(prior.mean()), 3),
            },
            "recovery": _recovery(data, idata["posterior"], baseline, channel, truth),
        }
        if pooling == "partial":
            results[pooling]["prior_sensitivity"] = _population_prior_sensitivity(idata["posterior"])
    result = {
        "schema_version": 1, "fit_manifest_sha256": sha256_file(artifact_dir / "fit_manifest.json"),
        "model_input_sha256": data.input_sha256, "observations": 720,
        "training_observations": 600, "holdout_observations": 120,
        "training_campaign_spend_correlations": _correlations(data),
        "models": results,
        "limitations": [
            "Synthetic generator truth is available for evaluation only, never model fitting.",
            "Three channels overlap and co-vary; individual effects and shapes may be weakly identified.",
            "Holdout predictions condition on planned spend and pre-outcome market context.",
            "Normal observation noise approximates rounded nonnegative integer sales units.",
            "Model-based contributions are assumption dependent, not experiment-validated incrementality.",
            "Prior sensitivity reweights one population prior only; poor importance ESS would require an independent refit.",
        ],
    }
    (artifact_dir / "evaluation.json").write_text(
        json.dumps(result, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")
    return result


def main() -> None:
    result = evaluate_models()
    print(json.dumps({name: {"diagnostics": model["diagnostics"],
                             "holdout": model["conditional_holdout"],
                             "recovery": {key: value for key, value in model["recovery"].items()
                                          if key not in {"coefficient_by_segment_channel", "shared_shape_recovery"}}}
                      for name, model in result["models"].items()}, indent=2))


if __name__ == "__main__":
    main()
