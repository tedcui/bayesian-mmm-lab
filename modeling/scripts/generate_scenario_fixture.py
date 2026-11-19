"""Regenerate cross-language parity expectations from genuine M4 joint draws."""

from __future__ import annotations

import json

from mmm_lab.paths import REPOSITORY_ROOT
from mmm_lab.scenario import (SCENARIO_VERSION, evaluate_scenario,
                              load_scenario_export, prepare_scenario,
                              scale_baseline_plan)


def main() -> None:
    manifest, simulator = load_scenario_export()
    cases = []
    for segment_id, multipliers in (("northeast", [1.25, 0.75, 1.10]),
                                    ("pacific_coast", [0.0, 0.0, 0.0])):
        prepared = prepare_scenario(manifest, simulator, segment_id)
        baseline = prepared.segment["baseline_plan_usd"]
        alternate = scale_baseline_plan(baseline, multipliers)
        result = evaluate_scenario(prepared, baseline, alternate)
        cases.append({"segment_id": segment_id, "channel_multipliers": multipliers,
                      "draw_rows": [[row["joint_draw_index"], row["baseline_expected_units"],
                                     row["alternative_expected_units"], row["incremental_expected_units"],
                                     *(row["channel_difference_units"][name] for name in simulator["channel_order"]),
                                     *(row["baseline_channel_units"][name] for name in simulator["channel_order"]),
                                     *(row["alternative_channel_units"][name] for name in simulator["channel_order"])]
                                    for row in result["draws"]],
                      "summary": result["summary"],
                      "baseline_spend_usd": result["baseline_spend_usd"],
                      "alternative_spend_usd": result["alternative_spend_usd"],
                      "alternative_support": result["alternative_support"]})
    fixture = {"fixture_version": SCENARIO_VERSION, "bundle_id": manifest["bundle_id"],
               "simulator_sha256": manifest["files"]["simulator.json"]["sha256"],
               "draw_row_fields": ["joint_draw_index", "baseline_expected_units", "alternative_expected_units",
                                   "incremental_expected_units", "coupon_difference_units",
                                   "retailer_promotion_difference_units", "digital_difference_units",
                                   "coupon_baseline_units", "retailer_promotion_baseline_units", "digital_baseline_units",
                                   "coupon_alternative_units", "retailer_promotion_alternative_units", "digital_alternative_units"],
               "numeric_tolerance": {"absolute": 1e-8, "relative": 1e-10},
               "cases": cases}
    path = REPOSITORY_ROOT / "web/src/tests/fixtures/scenario_parity.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes((json.dumps(fixture, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8"))
    print(f"Wrote {path.relative_to(REPOSITORY_ROOT)}")


if __name__ == "__main__":
    main()
