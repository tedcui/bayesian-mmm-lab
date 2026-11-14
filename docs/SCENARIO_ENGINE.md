# M6A scenario engine contract

M6A implements the **reference calculation only**. The decision simulator page and optimizer are M6B. The engine consumes the hash-checked M4 `manifest.json` and `simulator.json`; TypeScript callers use the existing `loadModelData()`/`validateModelDataBundle()` first. No MCMC runs in Python scenario evaluation or the browser.

## Inputs and units

- Choose one of the six business-defined geography regions.
- A baseline and an alternative are each a **12-row × 3-channel weekly planned-spend matrix in USD**, ordered coupon, retailer promotion, digital. The default baseline is `simulator.segments[].baseline_plan_usd`, covering holdout weeks **109–120**. These are pre-outcome plans from the separate synthetic marketing source; receipt discounts and redemptions are never budgets.
- `scale_baseline_plan` / `scaleBaselinePlan` multiply each channel's 12 individual baseline weeks by a nonnegative multiplier. A multiplier of 1 preserves that channel's entire weekly pattern; 0 sets its proposed weeks to zero. It does not multiply a 12-week total by 12.
- The 108 prior weeks of spend start the fitted geometric adstock state. The seven exported fixed controls are identical for baseline and alternative. The engine caches each draw's state after week 108 and its 12-week nonmarketing total in `prepare_scenario` / `prepareScenario`.
- The 96 exported partial-pooling draws are jointly indexed selections from **3,200** saved M3 posterior draws. Each evaluation uses the same draw's intercept, controls, region/channel beta, adstock alpha and Hill half-saturation for both plans. The hierarchical population, dispersion and region latent draws have already been combined into each saved `beta`; the engine uses that draw's fitted beta without resampling or averaging those hyperparameters. Observation noise is intentionally excluded.

For channel `c` in each draw, the recurrence is `A[t,c] = planned_spend_usd[t,c]/1000 + alpha[c] × A[t−1,c]`, starting from zero before week 1 and continuing through all 108 history weeks. Saturation is `A/(A+k[c])`. The 12-week expected-unit total equals the sum over replay weeks of `100 × intercept[region] × (1 + dot(fixed_controls[week], control_coef)) + Σ_c 100 × beta[region,c] × saturation[week,c]`. This is the exact M3 mean equation and scaling. The paired difference is alternative expected units minus baseline expected units **within each draw**. Channel differences are the corresponding alternative-minus-baseline transformed responses; the fixed nonmarketing term cancels.

## Outputs and limits

The result contains all 96 paired draw totals, 12-week total planned USD by channel and overall, and mean, median, 5th and 95th percentiles for baseline expected units, alternative expected units, paired incremental expected units, and each channel difference. Percentiles use linear interpolation at `(n−1)×p`, equivalent to NumPy's default. These are **central 90% parameter credible intervals for conditional expected units**, not predictive intervals for observed sales. Calculations and parity fixtures retain IEEE double precision; only a future UI should round display values.

Each plan reports weekly counts above the region/channel **training maximum** and above the **maximum observed in all 120 weeks**. Zero is the documented minimum. The engine accepts finite nonnegative proposed USD values above support and flags them explicitly; it does not silently clip them. Such scenarios are outside observed support and should not be treated as credible causal extrapolations. Negative, nonfinite, malformed, missing-history, mixed-version or mismatched-bundle inputs fail.

The baseline and alternatives replay known holdout plans and fixed pre-outcome context. They are **conditional historical model calculations**, not prospective forecasts, experiment-validated incremental lift, profit or ROI. The M3 partial-pooling reference has weak effect identification in some region/channel cells; no pooling covered 17/18 known synthetic effects in 90% intervals versus 15/18 for partial pooling. That limitation applies to any scenario interpretation.

## Reproduce and verify

From `modeling/`, with the committed `uv.lock`:

```sh
uv run --locked python scripts/generate_scenario_fixture.py
uv run --locked pytest -q
```

From `web/`, with the committed `package-lock.json`:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

The generator writes [the shared parity fixture](../web/src/tests/fixtures/scenario_parity.json) from the **actual 96 M4 joint draws** for two regions and two different planned-spend alternatives. Python and TypeScript tests compare all 96 paired baseline/alternative/difference/channel totals in both cases, plus their draw-first summaries. The declared comparison tolerance is `abs(error) ≤ 1e−8 + 1e−10 × abs(reference)` sales units or USD. The Python baseline test also compares each selected draw against the original M3 NetCDF posterior when that local, gitignored artifact is available; it skips only that exact-draw check in a checkout without NetCDF files. Across all six regions and 96 draws, the maximum baseline replay difference from the original M3 expected total was **7.28×10⁻¹² units** locally. The committed M4 weekly summaries use all 3,200 posterior draws and round to four decimals, so their total mean need not equal the 96-draw subset mean. The largest observed subset difference was **8.478 units** (Northeast); the largest relative difference was **0.171%** (Mountain West). The always-on test requires a difference below 1% for every region.
