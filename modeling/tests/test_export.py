"""M4 numerical, provenance, and public-payload contracts; no MCMC in tests."""

import json
import shutil

import arviz as az
import numpy as np
import pytest

from mmm_lab.evaluate import posterior_components
from mmm_lab.export import EXPORT_SEED, _check_lineage, export_model_data
from mmm_lab.model import (CHANNELS, SALES_SCALE, SPEND_SCALE, expected_components,
                           load_model_data, sha256_file)
from mmm_lab.paths import ARTIFACTS_DIR, DATA_DIR, WEB_MODEL_DATA_DIR


@pytest.fixture(scope="module")
def exported(tmp_path_factory):
    if not all((ARTIFACTS_DIR / f"posterior_{pooling}.nc").exists()
               for pooling in ("complete", "none", "partial")):
        pytest.skip("Full M3 posteriors are local artifacts; ordinary CI does not refit MCMC")
    output = tmp_path_factory.mktemp("m4")
    manifest = export_model_data(output_dir=output)
    payloads = {name.removesuffix(".json"): json.loads((output / name).read_text(encoding="utf-8"))
                for name in ("overview.json", "contributions.json", "segments.json", "simulator.json")}
    return output, manifest, payloads


def test_committed_export_hashes_and_model_lineage_without_mcmc():
    manifest = json.loads((WEB_MODEL_DATA_DIR / "manifest.json").read_text(encoding="utf-8"))
    data = load_model_data()
    assert manifest["lineage"]["model_input_sha256"] == data.input_sha256
    assert manifest["lineage"]["etl_manifest_sha256"] == data.etl_manifest_sha256
    assert manifest["lineage"]["fit_manifest_sha256"] == sha256_file(ARTIFACTS_DIR / "fit_manifest.json")
    assert manifest["lineage"]["evaluation_sha256"] == sha256_file(ARTIFACTS_DIR / "evaluation.json")
    for name, info in manifest["files"].items():
        path = WEB_MODEL_DATA_DIR / name
        assert path.stat().st_size == info["bytes"]
        assert sha256_file(path) == info["sha256"]
        assert b"\r\n" not in path.read_bytes()
        payload = json.loads(path.read_text(encoding="utf-8"))
        assert payload["bundle_id"] == manifest["bundle_id"]


def test_export_lineage_version_and_public_fields(exported):
    output, manifest, payloads = exported
    assert manifest["schema_version"] == "m4-2"
    assert manifest["lineage"]["etl_version"] == "m2b-1"
    assert manifest["lineage"]["model_version"] == "m3-1"
    assert manifest["lineage"]["model_input_sha256"] == sha256_file(DATA_DIR / "processed/model_ready.parquet")
    assert manifest["reference_model"] == "partial"
    assert "not the best coefficient-recovery" in manifest["reference_model_note"]
    for name, info in manifest["files"].items():
        assert info["sha256"] == sha256_file(output / name)
        assert info["bytes"] == (output / name).stat().st_size
        assert info["bytes"] < 900_000
    assert sum(info["bytes"] for info in manifest["files"].values()) < 2_000_000
    for payload in payloads.values():
        assert payload["schema_version"] == manifest["schema_version"]
        assert payload["bundle_id"] == manifest["bundle_id"]
    public_text = "".join((output / name).read_text(encoding="utf-8") for name in manifest["files"])
    for forbidden in ("TRANSACTION_ID", "CONTACT_NAME", "EMAIL_ADDRESS", "SOURCE_TRANSACTIONS",
                      "FILE_SUBMISSION_ID", "STORE_ID", "BRAND_ID"):
        assert forbidden not in public_text


def test_export_week_keys_reconciliation_and_draw_first_interval(exported):
    _, manifest, payloads = exported
    data = load_model_data()
    overview, contributions = payloads["overview"], payloads["contributions"]
    assert len(overview["weekly"]) == len(contributions["weekly"]) == 720
    assert len(overview["all_regions_weekly"]) == len(contributions["all_regions_weekly"]) == 120
    assert len(overview["aggregates"]) == len(contributions["aggregates"]) == 21
    keys = [(r["segment_id"], r["week_start"]) for r in overview["weekly"]]
    assert len(set(keys)) == 720
    assert {r["period"] for r in overview["weekly"] if r["time_index"] <= 100} == {"training"}
    assert {r["period"] for r in overview["weekly"] if r["time_index"] > 100} == {"holdout"}
    assert overview["weekly"][0]["week_start"] == manifest["dates"]["first_week"]
    assert overview["weekly"][-1]["week_start"] == manifest["dates"]["last_week"]
    for a, b in zip(overview["weekly"], contributions["weekly"], strict=True):
        assert a["observed_sales_units"] == b["observed_sales_units"]
        assert abs(b["expected_sales_units"]["mean"] - b["baseline_units"]["mean"] -
                   sum(v["mean"] for v in b["channels_units"].values())) < 0.0003
        assert abs(a["observed_sales_units"] - a["expected_sales_units"]["mean"] -
                   a["residual_to_expected_mean_units"]) < 0.0002
    assert sum(row["observed_sales_units"] for row in overview["weekly"]) == int(data.sales.sum())
    aggregate = next(row for row in contributions["aggregates"]
                     if row["segment_id"] is None and row["period"] == "holdout")
    assert aggregate["observed_sales_units"] == int(data.sales[:, 100:].sum())
    posterior = az.from_netcdf(ARTIFACTS_DIR / "posterior_partial.nc")["posterior"]
    baseline, channel, expected, noise = posterior_components(data, posterior)
    predictive = expected + noise[:, :, None] * np.random.default_rng(EXPORT_SEED + 1).normal(size=expected.shape)
    for t in (0, 99, 100, 119):
        overall = overview["all_regions_weekly"][t]
        parts = contributions["all_regions_weekly"][t]
        expected_draws = expected[:, :, t].sum(axis=1)
        assert overall["segment_id"] is None and parts["segment_id"] is None
        assert overall["observed_sales_units"] == int(data.sales[:, t].sum())
        assert abs(overall["expected_sales_units"]["p05"] - np.quantile(expected_draws, 0.05)) < 0.0001
        assert abs(overall["expected_sales_units"]["p95"] - np.quantile(expected_draws, 0.95)) < 0.0001
        predictive_draws = predictive[:, :, t].sum(axis=1)
        assert abs(overall["predictive_sales_units"]["p05"] - np.quantile(predictive_draws, 0.05)) < 0.0001
        assert abs(overall["predictive_sales_units"]["p95"] - np.quantile(predictive_draws, 0.95)) < 0.0001
        naive_weekly_low = sum(row["predictive_sales_units"]["p05"] for row in overview["weekly"][t::120])
        assert abs(overall["predictive_sales_units"]["p05"] - naive_weekly_low) > 0.01
        channel_draws = channel[:, :, t, 0].sum(axis=1)
        assert abs(parts["channels_units"]["coupon"]["p05"] - np.quantile(channel_draws, 0.05)) < 0.0001
        assert abs(parts["channels_units"]["coupon"]["p95"] - np.quantile(channel_draws, 0.95)) < 0.0001
    draw_totals = expected[:, :, 100:].sum(axis=(1, 2))
    assert abs(aggregate["expected_sales_units"]["p05"] - np.quantile(draw_totals, 0.05)) < 0.0001
    assert abs(aggregate["expected_sales_units"]["p95"] - np.quantile(draw_totals, 0.95)) < 0.0001
    # Separate component endpoints cannot be added to produce the total interval.
    naive_low = aggregate["baseline_units"]["p05"] + sum(
        part["p05"] for part in aggregate["channels_units"].values())
    assert abs(naive_low - aggregate["expected_sales_units"]["p05"]) > 0.01
    assert np.allclose(expected, baseline + channel.sum(axis=-1))


def test_simulator_draws_keep_joint_indices_and_exact_transform(exported):
    _, _, payloads = exported
    simulator = payloads["simulator"]
    data = load_model_data()
    posterior = az.from_netcdf(ARTIFACTS_DIR / "posterior_partial.nc")["posterior"]
    assert simulator["draw_count"] == len(simulator["draws"]) == 96
    assert simulator["channel_order"] == list(CHANNELS)
    assert simulator["segment_order"] == list(data.segments)
    assert len(simulator["history_week_starts"]) == 108
    assert len(simulator["horizon_week_starts"]) == 12
    indices = [row["joint_draw_index"] for row in simulator["draws"]]
    assert indices == sorted(set(indices))
    flat_beta = posterior["beta"].values.reshape(-1, 6, 3)
    flat_alpha = posterior["adstock_alpha"].values.reshape(-1, 3)
    flat_half = posterior["half_saturation"].values.reshape(-1, 3)
    for row in simulator["draws"][::19]:
        i = row["joint_draw_index"]
        assert i == row["chain_index"] * posterior.sizes["draw"] + row["chain_draw_index"]
        assert np.array_equal(row["beta_scaled_by_segment_channel"], flat_beta[i])
        assert np.array_equal(row["adstock_alpha"], flat_alpha[i])
        assert np.array_equal(row["half_saturation_thousands_usd"], flat_half[i])
    draw = simulator["draws"][0]
    _, _, expected = expected_components(data, np.array(draw["intercept_scaled_by_segment"]),
                                          np.array(draw["control_coef"]),
                                          np.array(draw["beta_scaled_by_segment_channel"]),
                                          np.array(draw["adstock_alpha"]),
                                          np.array(draw["half_saturation_thousands_usd"]))
    segment = simulator["segments"][0]
    history = np.array(segment["history_spend_usd"])
    plan = np.array(segment["baseline_plan_usd"])
    controls = np.array(segment["fixed_controls"])
    stock = np.zeros(3)
    for spend in history:
        stock = spend / SPEND_SCALE + np.array(draw["adstock_alpha"]) * stock
    actual = []
    for spend, control in zip(plan, controls, strict=True):
        stock = spend / SPEND_SCALE + np.array(draw["adstock_alpha"]) * stock
        saturated = stock / (stock + np.array(draw["half_saturation_thousands_usd"]))
        value = SALES_SCALE * (draw["intercept_scaled_by_segment"][0] *
                               (1 + np.dot(control, draw["control_coef"])) +
                               np.dot(draw["beta_scaled_by_segment_channel"][0], saturated))
        actual.append(value)
    assert np.allclose(actual, expected[0, 108:], atol=1e-8)


def test_export_is_deterministic_except_manifest_timestamp(exported, tmp_path):
    _, manifest, _ = exported
    second = export_model_data(output_dir=tmp_path)
    assert second["bundle_id"] == manifest["bundle_id"]
    assert second["files"] == manifest["files"]


def test_export_rejects_stale_evaluation_lineage(tmp_path):
    data = load_model_data()
    metadata = tmp_path / "data/metadata"
    metadata.mkdir(parents=True)
    for name in ("source_manifest.json", "etl_manifest.json"):
        shutil.copy2(DATA_DIR / "metadata" / name, metadata / name)
    artifacts = tmp_path / "artifacts"
    artifacts.mkdir()
    shutil.copy2(ARTIFACTS_DIR / "fit_manifest.json", artifacts / "fit_manifest.json")
    evaluation = json.loads((ARTIFACTS_DIR / "evaluation.json").read_text())
    evaluation["fit_manifest_sha256"] = "0" * 64
    (artifacts / "evaluation.json").write_text(json.dumps(evaluation))
    with pytest.raises(ValueError, match="evaluation lineage"):
        _check_lineage(tmp_path / "data", artifacts, data)
