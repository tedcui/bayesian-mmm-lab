"""M6A reference replay, saved-posterior reconciliation, and parity fixture."""

import copy
import json

import numpy as np
import pytest

from mmm_lab.evaluate import posterior_components
from mmm_lab.model import load_model_data
from mmm_lab.paths import ARTIFACTS_DIR, REPOSITORY_ROOT, WEB_MODEL_DATA_DIR
from mmm_lab.scenario import (evaluate_scenario, load_scenario_export,
                              prepare_scenario, scale_baseline_plan)

FIXTURE = REPOSITORY_ROOT / "web/src/tests/fixtures/scenario_parity.json"


@pytest.fixture(scope="module")
def source():
    return load_scenario_export()


def _close(actual, expected, tolerance):
    assert np.isclose(actual, expected, atol=tolerance["absolute"],
                      rtol=tolerance["relative"]), (actual, expected)


def test_selected_genuine_draws_and_summaries_match_shared_fixture(source):
    manifest, simulator = source
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert fixture["bundle_id"] == manifest["bundle_id"]
    assert fixture["simulator_sha256"] == manifest["files"]["simulator.json"]["sha256"]
    tolerance = fixture["numeric_tolerance"]
    for case in fixture["cases"]:
        prepared = prepare_scenario(manifest, simulator, case["segment_id"])
        baseline = prepared.segment["baseline_plan_usd"]
        alternate = scale_baseline_plan(baseline, case["channel_multipliers"])
        actual = evaluate_scenario(prepared, baseline, alternate)
        assert actual["draw_count"] == simulator["draw_count"] == 96
        assert actual["alternative_support"] == case["alternative_support"]
        for key in ("baseline_spend_usd", "alternative_spend_usd"):
            _close(actual[key]["total"], case[key]["total"], tolerance)
            for channel, value in case[key]["by_channel"].items():
                _close(actual[key]["by_channel"][channel], value, tolerance)
        assert len(case["draw_rows"]) == 96
        for draw_index, (row, expected) in enumerate(zip(actual["draws"], case["draw_rows"], strict=True)):
            assert row["joint_draw_index"] == expected[0]
            for key, value in zip(("baseline_expected_units", "alternative_expected_units",
                                   "incremental_expected_units"), expected[1:4], strict=True):
                _close(row[key], value, tolerance)
            for offset, key in ((4, "channel_difference_units"), (7, "baseline_channel_units"),
                                (10, "alternative_channel_units")):
                for channel, value in zip(simulator["channel_order"], expected[offset:offset + 3], strict=True):
                    _close(row[key][channel], value, tolerance)
            _close(row["baseline_expected_units"] - sum(row["baseline_channel_units"].values()),
                   prepared.nonmarketing_totals[draw_index], tolerance)
        for key in ("baseline_expected_units", "alternative_expected_units", "incremental_expected_units"):
            for statistic, value in case["summary"][key].items():
                _close(actual["summary"][key][statistic], value, tolerance)
        for key in ("baseline_channel_units", "alternative_channel_units", "channel_difference_units"):
            for channel, expected in case["summary"][key].items():
                for statistic, value in expected.items():
                    _close(actual["summary"][key][channel][statistic], value, tolerance)


def test_baseline_replay_matches_m4_full_draw_weekly_means_with_subset_tolerance(source):
    manifest, simulator = source
    overview = json.loads((WEB_MODEL_DATA_DIR / "overview.json").read_text(encoding="utf-8"))
    for segment_id in manifest["segments"]:
        prepared = prepare_scenario(manifest, simulator, segment_id)
        baseline = prepared.segment["baseline_plan_usd"]
        result = evaluate_scenario(prepared, baseline, baseline)
        m4_full_draw_mean = sum(row["expected_sales_units"]["mean"] for row in overview["weekly"]
                                if row["segment_id"] == segment_id and row["time_index"] > 108)
        # The public weekly means use 3,200 draws; this replay uses 96 selected draws.
        assert abs(result["summary"]["baseline_expected_units"]["mean"] - m4_full_draw_mean) < 0.01 * m4_full_draw_mean


def test_selected_baseline_draws_reconstruct_saved_m3_posterior(source):
    manifest, simulator = source
    posterior_path = ARTIFACTS_DIR / "posterior_partial.nc"
    if not posterior_path.exists():
        pytest.skip("Exact M3 draw comparison requires local, gitignored NetCDF artifact")
    import arviz as az

    data = load_model_data()
    posterior = az.from_netcdf(posterior_path)["posterior"]
    expected = posterior_components(data, posterior)[2].reshape(-1, 6, 120)
    for s, segment_id in enumerate(manifest["segments"]):
        prepared = prepare_scenario(manifest, simulator, segment_id)
        baseline = prepared.segment["baseline_plan_usd"]
        result = evaluate_scenario(prepared, baseline, baseline)
        for row in result["draws"]:
            expected_total = float(expected[row["joint_draw_index"], s, 108:].sum())
            assert abs(row["baseline_expected_units"] - expected_total) < 1e-8


def test_zero_change_is_exact_and_history_survives_zero_future_spend(source):
    manifest, simulator = source
    prepared = prepare_scenario(manifest, simulator, "pacific_coast")
    baseline = prepared.segment["baseline_plan_usd"]
    no_change = evaluate_scenario(prepared, baseline, baseline)
    assert all(row["incremental_expected_units"] == 0 for row in no_change["draws"])
    assert all(all(value == 0 for value in row["channel_difference_units"].values())
               for row in no_change["draws"])
    assert no_change["summary"]["incremental_expected_units"] == {"mean": 0, "p05": 0, "p50": 0, "p95": 0}
    zero_plan = [[0.0] * 3 for _ in range(12)]
    replay = evaluate_scenario(prepared, baseline, zero_plan)
    assert replay["alternative_spend_usd"]["total"] == 0
    # Prior spending continues to affect early replay weeks through adstock.
    assert all(row["alternative_expected_units"] > prepared.nonmarketing_totals[i]
               for i, row in enumerate(replay["draws"]))


def test_individual_channel_change_segment_isolation_and_reproducibility(source):
    manifest, simulator = source
    northeast = prepare_scenario(manifest, simulator, "northeast")
    baseline = northeast.segment["baseline_plan_usd"]
    coupon_only = scale_baseline_plan(baseline, [1.1, 1, 1])
    first = evaluate_scenario(northeast, baseline, coupon_only)
    for row in first["draws"]:
        assert row["channel_difference_units"]["coupon"] > 0
        assert row["channel_difference_units"]["retailer_promotion"] == 0
        assert row["channel_difference_units"]["digital"] == 0
        assert abs(row["incremental_expected_units"] - sum(row["channel_difference_units"].values())) < 1e-8
    pacific = prepare_scenario(manifest, simulator, "pacific_coast")
    other = evaluate_scenario(pacific, pacific.segment["baseline_plan_usd"],
                              pacific.segment["baseline_plan_usd"])
    assert other["summary"]["baseline_expected_units"]["mean"] != first["summary"]["baseline_expected_units"]["mean"]
    assert evaluate_scenario(northeast, baseline, coupon_only) == first
    assert northeast.segment["baseline_plan_usd"] == baseline  # pure, no mutation


def test_source_mismatch_bounds_and_invalid_inputs(source, tmp_path):
    manifest, simulator = source
    wrong = copy.deepcopy(simulator)
    wrong["bundle_id"] = "0" * 64
    with pytest.raises(ValueError, match="source/version"):
        prepare_scenario(manifest, wrong, "northeast")
    wrong = copy.deepcopy(simulator)
    wrong["segments"][0]["history_spend_usd"] = []
    with pytest.raises(ValueError, match="history_spend_usd"):
        prepare_scenario(manifest, wrong, "northeast")
    with pytest.raises(ValueError, match="Unknown scenario segment"):
        prepare_scenario(manifest, simulator, "unknown")
    prepared = prepare_scenario(manifest, simulator, "northeast")
    baseline = prepared.segment["baseline_plan_usd"]
    for malformed in (baseline[:-1], [[-1, 0, 0]] + baseline[1:],
                      [[float("nan"), 0, 0]] + baseline[1:]):
        with pytest.raises(ValueError):
            evaluate_scenario(prepared, baseline, malformed)
    with pytest.raises(ValueError, match="channel_multipliers"):
        scale_baseline_plan(baseline, [1, float("inf"), 1])
    unsupported = [[limit["max_usd"] + 1 for limit in prepared.segment["spend_limits_usd"]]
                   for _ in range(12)]
    flagged = evaluate_scenario(prepared, baseline, unsupported)
    assert flagged["alternative_support"]["outside_observed_bounds"]
    assert flagged["alternative_support"]["extrapolates_beyond_training"]
    assert all(row["above_observed_max_weeks"] == 12
               for row in flagged["alternative_support"]["by_channel"].values())
    export_dir = tmp_path / "model-data"
    export_dir.mkdir()
    (export_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (export_dir / "simulator.json").write_text(json.dumps(simulator) + " ", encoding="utf-8")
    with pytest.raises(ValueError, match="does not match"):
        load_scenario_export(export_dir)
