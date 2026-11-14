import numpy as np
import pandas as pd

from mmm_lab.preprocess import SCALED_CONTROLS, prepare_model_table
from mmm_lab.simulate import generate_dataset


def test_temporal_split_and_train_only_scaling():
    raw, _ = generate_dataset()
    prepared, metadata = prepare_model_table(raw)
    assert prepared.groupby("split").size().to_dict() == {"train": 600, "holdout": 120}
    assert prepared.groupby("segment").split.apply(lambda x: x.eq("train").sum()).to_dict() == dict.fromkeys("ABCDEF", 100)
    assert prepared[["segment", "week_index", "week_start", "coupon_spend", "retailer_spend", "digital_spend"]].equals(
        raw[["segment", "week_index", "week_start", "coupon_spend", "retailer_spend", "digital_spend"]]
    )
    assert metadata["training_week_end"] == 100
    for column in SCALED_CONTROLS:
        train = prepared.loc[prepared.split == "train", f"{column}_z"]
        assert abs(train.mean()) < 1e-12
        assert abs(train.std(ddof=0) - 1.0) < 1e-12

    changed_holdout = raw.copy()
    changed_holdout.loc[changed_holdout.week_index > 100, "price_index"] += 5
    changed, changed_metadata = prepare_model_table(changed_holdout)
    assert metadata == changed_metadata
    pd.testing.assert_frame_equal(
        prepared.loc[prepared.split == "train"], changed.loc[changed.split == "train"]
    )


def test_invalid_observations_are_rejected():
    raw, _ = generate_dataset()
    duplicate = pd.concat([raw, raw.iloc[[0]]], ignore_index=True)
    try:
        prepare_model_table(duplicate)
    except ValueError as error:
        assert "Duplicate" in str(error)
    else:
        raise AssertionError("Duplicate keys were accepted")

    invalid = raw.copy()
    invalid.loc[0, "coupon_spend"] = np.nan
    try:
        prepare_model_table(invalid)
    except ValueError as error:
        assert "Missing" in str(error)
    else:
        raise AssertionError("Missing spend was accepted")
