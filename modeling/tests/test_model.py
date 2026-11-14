"""M3 model input, transformation and component contracts; no MCMC in CI."""

import json
import shutil

import numpy as np
import pytest

from mmm_lab.model import (CONTROL_NAMES, expected_components,
                           geometric_adstock, load_model_data)
from mmm_lab.paths import DATA_DIR


def test_model_input_is_etl_verified_and_training_only(tmp_path):
    target = tmp_path / "data"
    (target / "metadata").mkdir(parents=True)
    (target / "processed").mkdir()
    shutil.copy2(DATA_DIR / "metadata/etl_manifest.json", target / "metadata/etl_manifest.json")
    shutil.copy2(DATA_DIR / "processed/model_ready.parquet", target / "processed/model_ready.parquet")
    # Evaluation truth is intentionally absent: fitting input still loads.
    data = load_model_data(target)
    assert data.sales.shape == (6, 120)
    assert data.spend.shape == (6, 120, 3)
    assert data.controls.shape == (6, 120, len(CONTROL_NAMES))
    assert data.train_weeks == 100
    assert np.all(data.spend >= 0)
    manifest_path = target / "metadata/etl_manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["output_hashes"]["model_ready"] = "0" * 64
    manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="provenance"):
        load_model_data(target)


def test_adstock_order_and_holdout_history():
    spend = np.zeros((6, 120, 3))
    spend[0, 99, 0] = 100
    stock = geometric_adstock(spend, np.array([0.5, 0.2, 0.7]))
    assert stock[0, 99, 0] == 100
    assert stock[0, 100, 0] == 50
    assert stock[0, 101, 0] == 25
    assert stock[1:, :, :].sum() == 0


def test_expected_sales_reconcile_components():
    data = load_model_data()
    baseline, channel, expected = expected_components(
        data, np.ones(6), np.zeros(7), np.ones((6, 3)),
        np.array([0.3, 0.5, 0.7]), np.array([3.0, 3.0, 3.0]),
    )
    assert baseline.shape == (6, 120)
    assert channel.shape == (6, 120, 3)
    assert np.allclose(expected, baseline + channel.sum(axis=-1))
    assert np.all(channel >= 0)
    assert np.all(expected[:, 100] > 0)
    with pytest.raises(ValueError, match="dimensions"):
        expected_components(data, np.ones(5), np.zeros(7), np.ones((6, 3)),
                            np.ones(3) * 0.5, np.ones(3) * 3)


def test_posterior_component_dimensions_and_netcdf_roundtrip(tmp_path):
    import arviz as az
    import xarray as xr
    from mmm_lab.evaluate import _population_prior_sensitivity, posterior_components

    data = load_model_data()
    posterior = xr.Dataset({
        "intercept": (("chain", "draw", "segment"), np.ones((2, 2, 6))),
        "control_coef": (("chain", "draw", "control"), np.zeros((2, 2, 7))),
        "beta": (("chain", "draw", "segment", "channel"), np.ones((2, 2, 6, 3))),
        "adstock_alpha": (("chain", "draw", "channel"), np.full((2, 2, 3), 0.5)),
        "half_saturation": (("chain", "draw", "channel"), np.full((2, 2, 3), 3.0)),
        "noise": (("chain", "draw", "segment"), np.full((2, 2, 6), 0.5)),
        "log_beta_population": (("chain", "draw", "channel"), np.zeros((2, 2, 3))),
    }, coords={"segment": list(data.segments), "channel": ["coupon", "retailer_promotion", "digital"]})
    tree = xr.DataTree.from_dict({"posterior": posterior})
    path = tmp_path / "fixture.nc"
    tree.to_netcdf(path)
    restored = az.from_netcdf(path)
    baseline, channel, expected, noise = posterior_components(data, restored["posterior"])
    assert baseline.shape == (4, 6, 120)
    assert channel.shape == (4, 6, 120, 3)
    assert noise.shape == (4, 6)
    assert np.allclose(expected, baseline + channel.sum(axis=-1))
    wrong = restored["posterior"].to_dataset().assign_coords(segment=list(reversed(data.segments)))
    with pytest.raises(ValueError, match="coordinates"):
        posterior_components(data, wrong)
    sensitivity = _population_prior_sensitivity(restored["posterior"])
    assert sensitivity["importance_effective_draws"] == 4
    assert sensitivity["max_absolute_coefficient_mean_shift_units"] == 0


def test_three_pymc_pooling_graphs_have_expected_dimensions():
    from mmm_lab.model import POOLING, build_model

    data = load_model_data()
    for pooling in POOLING:
        model = build_model(data, pooling)
        assert len(model.coords["segment"]) == 6
        assert len(model.coords["channel"]) == 3
        assert len(model.coords["week"]) == 100
        assert model["beta"].ndim == 2
        assert model["sales"].ndim == 2
        assert "adstock_alpha" in model.named_vars
        assert "half_saturation" in model.named_vars
        assert ("beta_global" in model.named_vars) == (pooling == "complete")
        assert ("beta_raw" in model.named_vars) == (pooling == "none")
        assert ("beta_z" in model.named_vars) == (pooling == "partial")
