"""Bayesian MMMs fitted only to the source-derived M2B panel."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

from mmm_lab.paths import ARTIFACTS_DIR, DATA_DIR

CHANNELS = ("coupon", "retailer_promotion", "digital")
SPEND_COLUMNS = ("coupon_spend", "retailer_promo_spend", "digital_spend")
CONTROL_NAMES = ("price_delta", "distribution_delta", "competitor_delta", "trend", "season_sin", "season_cos", "holiday")
POOLING = ("complete", "none", "partial")
SALES_SCALE = 100.0
SPEND_SCALE = 1000.0
FIT_SEED = 20261114


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _configure_pytensor_cache() -> None:
    """Keep compiler caches writable in locked-down Windows environments."""
    path = ARTIFACTS_DIR / ".pytensor-cache"
    path.mkdir(parents=True, exist_ok=True)
    flags = os.environ.get("PYTENSOR_FLAGS", "")
    if "base_compiledir=" not in flags:
        os.environ["PYTENSOR_FLAGS"] = f"{flags + ',' if flags else ''}base_compiledir={path.as_posix()}"


@dataclass(frozen=True)
class ModelData:
    segments: tuple[str, ...]
    weeks: tuple[str, ...]
    sales: np.ndarray  # segment x week, units
    spend: np.ndarray  # segment x week x channel, USD
    controls: np.ndarray  # segment x week x control
    train_weeks: int
    input_sha256: str
    etl_manifest_sha256: str


def load_model_data(data_root: Path = DATA_DIR) -> ModelData:
    """Reject a stale panel or an old standalone CSV; never open ground truth."""
    data_root = Path(data_root)
    path = data_root / "processed/model_ready.parquet"
    manifest_path = data_root / "metadata/etl_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("etl_version") != "m2b-1" or manifest["output_hashes"]["model_ready"] != sha256_file(path):
        raise ValueError("Model input lacks valid M2B ETL provenance")
    expected_columns = ["segment_id", "week_start", "time_index", "is_holdout", "sales_units",
                        "price_index", "distribution_index", "competitor_index", "holiday", *SPEND_COLUMNS]
    frame = pq.read_table(path).to_pandas()
    if frame.columns.tolist() != expected_columns:
        raise ValueError("Model input column allowlist differs from M2B contract")
    segments = tuple(frame.segment_id.drop_duplicates())
    dates = sorted(frame.week_start.unique())
    weeks = tuple(str(week) for week in dates)
    if len(segments) != 6 or len(weeks) != 120 or len(frame) != 720:
        raise ValueError("Expected exactly six segments and 120 weekly periods")
    frame = frame.set_index(["segment_id", "week_start"]).sort_index()
    index = [(segment, week) for segment in segments for week in dates]
    if frame.index.has_duplicates or set(index) != set(frame.index):
        raise ValueError("Model input segment-week keys are incomplete or duplicated")
    ordered = frame.loc[index]
    if not np.array_equal(ordered.time_index.to_numpy().reshape(6, 120),
                          np.broadcast_to(np.arange(1, 121), (6, 120))):
        raise ValueError("Unexpected time index")
    holdout = ordered.is_holdout.to_numpy().reshape(6, 120)
    if holdout[:, :100].any() or not holdout[:, 100:].all():
        raise ValueError("Train/holdout split is not weeks 1-100 / 101-120")
    numeric = ordered[["sales_units", "price_index", "distribution_index", "competitor_index",
                       "holiday", *SPEND_COLUMNS]].to_numpy(dtype=float)
    if not np.isfinite(numeric).all() or (ordered[list(SPEND_COLUMNS)].to_numpy() < 0).any():
        raise ValueError("Nonfinite or negative model values")
    time = ordered.time_index.to_numpy(dtype=float).reshape(6, 120)
    phase = 2 * np.pi * ((time - 1) % 52) / 52
    controls = np.stack([
        ordered.price_index.to_numpy(dtype=float).reshape(6, 120) - 1,
        ordered.distribution_index.to_numpy(dtype=float).reshape(6, 120) - 0.9,
        ordered.competitor_index.to_numpy(dtype=float).reshape(6, 120) - 1,
        (time - 1) / 119, np.sin(phase), np.cos(phase),
        ordered.holiday.to_numpy(dtype=float).reshape(6, 120),
    ], axis=-1)
    return ModelData(segments, weeks, ordered.sales_units.to_numpy(dtype=float).reshape(6, 120),
                     ordered[list(SPEND_COLUMNS)].to_numpy(dtype=float).reshape(6, 120, 3),
                     controls, 100, sha256_file(path), sha256_file(manifest_path))


def geometric_adstock(spend: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Exact recurrence, including all earlier weeks for holdout predictions."""
    spend = np.asarray(spend, dtype=float)
    alpha = np.asarray(alpha, dtype=float)
    if spend.ndim != 3 or spend.shape[-1] != 3 or alpha.shape != (3,):
        raise ValueError("Expected segment x week x channel spend and 3 decay values")
    result = np.empty_like(spend)
    previous = np.zeros((spend.shape[0], 3))
    for week in range(spend.shape[1]):
        previous = spend[:, week, :] + alpha * previous
        result[:, week, :] = previous
    return result


def expected_components(data: ModelData, intercept: np.ndarray, control_coef: np.ndarray,
                        beta: np.ndarray, adstock_alpha: np.ndarray,
                        half_saturation: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Numerical mirror of the fitted mean equation, in original sales units."""
    intercept = np.asarray(intercept, dtype=float)
    control_coef = np.asarray(control_coef, dtype=float)
    beta = np.asarray(beta, dtype=float)
    if intercept.shape != (6,) or control_coef.shape != (7,) or beta.shape != (6, 3):
        raise ValueError("Posterior parameter dimensions do not match model input")
    adstock = geometric_adstock(data.spend / SPEND_SCALE, np.asarray(adstock_alpha, dtype=float))
    saturated = adstock / (adstock + np.asarray(half_saturation, dtype=float)[None, None, :])
    baseline = SALES_SCALE * intercept[:, None] * (1 + np.sum(data.controls * control_coef, axis=-1))
    channel = SALES_SCALE * beta[:, None, :] * saturated
    return baseline, channel, baseline + channel.sum(axis=-1)


def build_model(data: ModelData, pooling: str):
    """Exact geometric recurrence and Hill curve; only beta pooling changes."""
    if pooling not in POOLING:
        raise ValueError(f"Unknown pooling specification: {pooling}")
    _configure_pytensor_cache()
    import pymc as pm
    import pytensor
    import pytensor.tensor as pt

    n_train = data.train_weeks
    coords = {"segment": list(data.segments), "channel": list(CHANNELS),
              "control": list(CONTROL_NAMES), "week": list(data.weeks[:n_train])}
    spend = pt.as_tensor_variable((data.spend[:, :n_train, :] / SPEND_SCALE).transpose(1, 0, 2))
    controls = pt.as_tensor_variable(data.controls[:, :n_train, :])
    y = data.sales[:, :n_train] / SALES_SCALE
    intercept_center = np.mean(y, axis=1) * 0.9  # training data only
    with pm.Model(coords=coords) as model:
        intercept = pm.Normal("intercept", mu=intercept_center, sigma=3.0, dims="segment")
        control_coef = pm.Normal("control_coef", mu=0,
                                 sigma=np.array([1.0, 1.0, 0.7, 0.3, 0.2, 0.2, 0.2]), dims="control")
        adstock_alpha = pm.Beta("adstock_alpha", alpha=2, beta=2, dims="channel")
        half_saturation = pm.LogNormal("half_saturation", mu=np.log(3.0), sigma=0.5, dims="channel")
        if pooling == "complete":
            global_beta = pm.LogNormal("beta_global", mu=0, sigma=0.7, dims="channel")
            beta = pt.broadcast_to(global_beta[None, :], (len(data.segments), len(CHANNELS)))
        elif pooling == "none":
            beta = pm.LogNormal("beta_raw", mu=0, sigma=0.7, dims=("segment", "channel"))
        else:
            population = pm.Normal("log_beta_population", mu=0, sigma=0.7, dims="channel")
            dispersion = pm.HalfNormal("beta_dispersion", sigma=0.5, dims="channel")
            z = pm.Normal("beta_z", mu=0, sigma=1, dims=("segment", "channel"))
            beta = pt.exp(population[None, :] + dispersion[None, :] * z)
        beta = pm.Deterministic("beta", beta, dims=("segment", "channel"))
        noise = pm.HalfNormal("noise", sigma=1.0, dims="segment")
        adstock_time = pytensor.scan(
            fn=lambda current, prior, decay: current + decay[None, :] * prior,
            sequences=spend, outputs_info=pt.zeros((len(data.segments), len(CHANNELS))),
            non_sequences=adstock_alpha, return_updates=False,
        )
        adstock = adstock_time.dimshuffle(1, 0, 2)
        saturated = adstock / (adstock + half_saturation[None, None, :])
        baseline = intercept[:, None] * (1 + pt.sum(controls * control_coef[None, None, :], axis=-1))
        mean = baseline + pt.sum(saturated * beta[:, None, :], axis=-1)
        pm.Normal("sales", mu=mean, sigma=noise[:, None], observed=y, dims=("segment", "week"))
    return model


def fit_models(*, draws: int = 600, tune: int = 600, chains: int = 2,
               target_accept: float = 0.92, poolings: tuple[str, ...] = POOLING,
               output_dir: Path = ARTIFACTS_DIR, data_root: Path = DATA_DIR) -> dict:
    """Fit all models or update selected fits while verifying retained artifacts."""
    _configure_pytensor_cache()
    import arviz as az
    import pymc as pm

    data = load_model_data(data_root)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    if not poolings or any(pooling not in POOLING for pooling in poolings):
        raise ValueError("Invalid pooling selection")
    manifest_path = output_dir / "fit_manifest.json"
    if set(poolings) != set(POOLING):
        existing = json.loads(manifest_path.read_text(encoding="utf-8"))
        if (existing["model_input_sha256"] != data.input_sha256 or
                existing["etl_manifest_sha256"] != data.etl_manifest_sha256):
            raise ValueError("Cannot retain fits from a different M2B input")
        files = dict(existing["files"])
        samplers = dict(existing.get("sampler_by_model", {name: existing["sampler"] for name in POOLING}))
        for name in POOLING:
            path = output_dir / files[name]["path"]
            if name not in poolings and sha256_file(path) != files[name]["sha256"]:
                raise ValueError(f"Retained {name} posterior hash mismatch")
    else:
        files = {}
        samplers = {}
    for pooling in poolings:
        index = POOLING.index(pooling)
        print(f"Fitting {pooling} pooling: {chains} chains, {tune} tune, {draws} draws", flush=True)
        model = build_model(data, pooling)
        with model:
            prior = pm.sample_prior_predictive(draws=100, var_names=["sales"], random_seed=FIT_SEED + index)
            idata = pm.sample(draws=draws, tune=tune, chains=chains, cores=1,
                              target_accept=target_accept, random_seed=FIT_SEED + index,
                              progressbar=False)
        prior.update(idata)
        idata = prior
        path = output_dir / f"posterior_{pooling}.nc"
        idata.to_netcdf(path)
        files[pooling] = {"path": path.name, "sha256": sha256_file(path)}
        samplers[pooling] = {"draws": draws, "tune": tune, "chains": chains,
                             "target_accept": target_accept}
    manifest = {
        "schema_version": 1, "model_version": "m3-1", "model_input_sha256": data.input_sha256,
        "etl_manifest_sha256": data.etl_manifest_sha256, "seed": FIT_SEED,
        "sampler_by_model": samplers,
        "versions": {"pymc": pm.__version__, "arviz": az.__version__},
        "files": files, "sales_scale": SALES_SCALE, "spend_scale": SPEND_SCALE,
        "train_weeks": [1, 100], "holdout_weeks": [101, 120], "pooling": list(POOLING),
    }
    manifest_path.write_bytes((json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode("utf-8"))
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Fit three Bayesian MMM pooling specifications")
    parser.add_argument("--draws", type=int, default=600)
    parser.add_argument("--tune", type=int, default=600)
    parser.add_argument("--chains", type=int, default=2)
    parser.add_argument("--target-accept", type=float, default=0.92)
    parser.add_argument("--pooling", choices=("all", *POOLING), default="all")
    args = parser.parse_args()
    if args.draws < 50 or args.tune < 50 or args.chains < 2 or not 0.8 <= args.target_accept < 1:
        parser.error("Use >=50 draws, >=50 tuning steps, >=2 chains, and target_accept in [0.8,1)")
    selected = POOLING if args.pooling == "all" else (args.pooling,)
    print(json.dumps(fit_models(draws=args.draws, tune=args.tune, chains=args.chains,
                                target_accept=args.target_accept, poolings=selected), indent=2))


if __name__ == "__main__":
    main()
