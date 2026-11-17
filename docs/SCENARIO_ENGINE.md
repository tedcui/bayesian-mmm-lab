# M6 scenario engine and decision simulator contract

M6A implements the reference calculation; M6B adds the decision simulator page and bounded fixed-budget search. The engine consumes the hash-checked M4 `manifest.json` and `simulator.json`; TypeScript callers use the existing `loadModelData()`/`validateModelDataBundle()` first. No MCMC runs in Python scenario evaluation or the browser.

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

## M6B browser controls and optimization

Open `#/simulator` in the local Vite app. Choose a business region. Three accessible range controls initially read 100% and set `proposed_spend[t,c] = exported_baseline_spend[t,c] × control_percent[c]/100` for each of the 12 holdout weeks. Reset restores all multipliers to one, and changing regions resets the page. The fixed 108-week spend history and 12-week context never change. The page shows the same M6A paired expected-unit summaries, channel differences and planned USD totals; displayed quantities are rounded only after the engine has calculated full-precision values. The 90% credible intervals describe expected-unit parameter uncertainty from 96 jointly indexed posterior draws, excluding future-observation noise.

One grouped chart compares expected sales and the coupon, retailer-promotion, and digital contributions under the original and alternative plans. All eight bars show posterior means with their own 90% credible-interval whiskers, computed from the same 96 paired posterior draws. Each channel uses its established color for the alternative plan and a muted gray-tinted version for the baseline plan; the baseline bar is left of the alternative bar in every pair. Expected sales uses the left axis and includes nonmarketing demand; the three channel groups use the right axis and exclude nonmarketing baseline demand. The two axis scales are labeled separately so bar heights across total sales and channel groups must not be compared visually. Contributions depend on the model's observational identification assumptions and are not experiment-validated causal lift. Historical adstock can remain when proposed new spend is zero.

The manual controls may exceed support. The page reports the number of weeks above the training maximum and, separately, above the maximum observed across all 120 weeks. Above-observed spending is explicitly marked unsupported. The optimizer enforces each region/channel's exported `min_usd = 0` and `max_usd` **per week**. Its upper channel-total bound is the original 12-week channel total multiplied by `min_t(max_usd[c] / baseline_spend[t,c])` over positive baseline weeks. This preserves the original within-channel weekly profile and prevents a large original week from crossing its cap. Zero-baseline channels cannot receive spend under this fixed-profile rule.

The requested optimizer budget is an absolute USD total over all three channels and all 12 weeks. Feasibility requires `0 ≤ budget ≤ sum_c(channel_total_cap[c])`; an impossible budget is reported without an allocation. Starting from capped baseline proportions, a deterministic bounded pairwise-transfer search moves dollars between channels, accepting only changes that improve the **mean paired incremental expected units** from `evaluateScenario`. Each transfer preserves the total. Five descending transfer sizes provide local refinement; the search is a heuristic and does **not** certify global optimality. It reports channels at zero or their caps, the allocated total, 90% credible interval, and comparison to the original baseline. Applied optimizer allocations convert back to channel multipliers and use the same manual scenario engine. A search can remain above training support even while meeting observed caps; the UI says so.

The source lineage is M2A simulated transaction/store/item references plus independent pre-outcome synthetic marketing plans and context → M2B reconciled mart → M3 partial-pooling posterior → checksum-validated M4 browser export → M6A exact replay → M6B controls/search. Synthetic known truth is evaluation-only and is never used by the optimizer. The app makes no causal, profit, or ROI recommendation.

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
