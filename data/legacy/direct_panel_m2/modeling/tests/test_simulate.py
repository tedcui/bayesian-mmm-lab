import json

import numpy as np
import pandas as pd

from mmm_lab.preprocess import OBSERVABLE_COLUMNS
from mmm_lab.simulate import CHANNELS, SEED, generate_dataset, geometric_adstock, write_dataset


def test_seeded_generation_is_identical():
    first, truth_one = generate_dataset(SEED)
    second, truth_two = generate_dataset(SEED)
    pd.testing.assert_frame_equal(first, second)
    assert truth_one == truth_two


def test_observable_schema_keys_and_ranges():
    raw, _ = generate_dataset()
    assert tuple(raw.columns) == OBSERVABLE_COLUMNS
    assert len(raw) == 720
    assert raw.groupby("segment").size().to_dict() == dict.fromkeys("ABCDEF", 120)
    assert not raw.duplicated(["segment", "week_index"]).any()
    assert set(raw.week_index) == set(range(1, 121))
    assert pd.to_datetime(raw.week_start).dt.day_of_week.eq(0).all()
    assert not raw.isna().any().any()
    assert np.isfinite(raw.select_dtypes(include="number").to_numpy()).all()
    assert (raw[["coupon_spend", "retailer_spend", "digital_spend", "sales_units"]] >= 0).all().all()
    assert raw.sales_units.mod(1).eq(0).all()
    assert raw.holiday.isin([0, 1]).all()
    assert raw.price_index.between(0.8, 1.2).all()
    assert raw.distribution_index.between(0.75, 1.0).all()
    assert raw.competitor_index.between(0.8, 1.2).all()
    assert set(CHANNELS) == {"coupon", "retailer", "digital"}


def test_adstock_carries_prior_spend():
    np.testing.assert_allclose(geometric_adstock(np.array([10, 0, 0]), 0.5), [10, 5, 2.5])


def test_saved_truth_reconstructs_observed_sales_and_is_separate(tmp_path):
    raw_path, processed_path, truth_path = write_dataset(tmp_path)
    raw = pd.read_csv(raw_path)
    processed = pd.read_csv(processed_path)
    truth = json.loads(truth_path.read_text(encoding="utf-8"))
    components = pd.DataFrame(truth["components"])
    assert len(components) == len(raw)
    assert components[["segment", "week_index"]].equals(raw[["segment", "week_index"]])
    contribution_names = ["baseline", "price", "distribution", "competitor", "trend", "seasonality", "holiday", *CHANNELS]
    np.testing.assert_allclose(components[contribution_names].sum(axis=1), components.expected_sales, atol=1e-9)
    np.testing.assert_allclose(
        components.expected_sales + components.noise + components.rounding_adjustment,
        raw.sales_units,
        atol=1e-8,
    )
    evaluation_only = {"baseline", "price", "distribution", "competitor", "seasonality", *CHANNELS, "noise", "expected_sales", "rounding_adjustment"}
    assert not evaluation_only & set(raw.columns)
    assert not evaluation_only & set(processed.columns)
    assert not any("true" in column or "ground_truth" in column for column in processed.columns)
