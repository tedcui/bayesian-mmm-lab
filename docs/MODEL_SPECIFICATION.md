# M3 Bayesian MMM specification

## Inputs and provenance

`mmm-fit` accepts only `data/processed/model_ready.parquet` whose SHA256 matches `data/metadata/etl_manifest.json`. It does not open `ground_truth.json`; that file is read only by `mmm-evaluate` for synthetic recovery checks. There are six business-defined regions and 120 Mondays per region. Weeks 1–100 train all three models; weeks 101–120 are untouched during fitting. Planned channel spending comes from the independent marketing plan; price, availability, and competitor indices come from pre-outcome market context. Receipt discounts, promotion flags, source reference metrics, and true latent components are excluded.

## Mean and likelihood

For segment `s`, week `t`, and channel `c`, spend is scaled to USD thousands, and sales to hundreds of units. The exact geometric recurrence starts at zero before week 1:

`A[s,t,c] = spend[s,t,c]/1000 + alpha[c] * A[s,t-1,c]`.

The shared channel saturation curve is `H[s,t,c] = A[s,t,c] / (A[s,t,c] + k[c])`. Its half-saturation `k` is in USD thousands of adstocked spending. Segment channel contribution is `100 * beta[s,c] * H[s,t,c]` sales units.

The nonmarketing component is `100 * intercept[s] * (1 + sum_j control_coef[j] * X[s,t,j])`, where the seven controls are `(price_index−1, distribution_index−0.9, competitor_index−1, (time_index−1)/119, sin(2π((time_index−1) mod 52)/52), cos(...), holiday)`. Expected sales equal this nonmarketing component plus all three channel contributions. The observed sales likelihood is Normal around expected sales with segment-specific standard deviation `100 * noise[s]`. This approximates the generator's rounded, nonnegative integer outcome; it can assign small probability to negative observations and is not a count likelihood.

The channel response is positive and monotone in adstocked spending. **Complete pooling** shares `beta[c]` across all regions. **No pooling** estimates independent `beta[s,c]` with the same lognormal prior. **Partial pooling** uses `beta[s,c] = exp(population[c] + dispersion[c] * z[s,c])`, with `z ~ Normal(0,1)`. The three models share the same controls, likelihood, adstock and saturation structure.

## Priors, scales and implementation

| Parameter | Prior |
|---|---|
| Region intercept | Normal(`0.9 × region training mean sales / 100`, 3) |
| Seven control coefficients | Independent Normal(0, `[1,1,0.7,0.3,0.2,0.2,0.2]`) |
| Shared channel adstock decay | Beta(2,2) |
| Shared channel half-saturation in USD thousands | LogNormal(log(3), 0.5) |
| Complete/no-pooling channel response in hundreds of units | LogNormal(0, 0.7) |
| Partial-pooling log population response | Normal(0, 0.7) |
| Partial-pooling log response dispersion | HalfNormal(0.5) |
| Region noise in hundreds of sales units | HalfNormal(1) |

Only the intercept prior center uses observed data, and it uses **training weeks only**. This is an empirical-Bayes prior center and reuses training outcomes; its broad standard deviation limits but does not eliminate possible undercoverage. The remaining priors are generic predeclared scales, not copied from the hidden generator truth. No fitted scaler uses holdout data. The evaluator applies each posterior draw's alpha and k to the **entire 120-week plan starting at week 1**, so holdout adstock retains all preceding spend.

PyMC 6.4.0 and ArviZ 1.3.0 are pinned in `modeling/pyproject.toml` and `uv.lock`. PyMC-Marketing 1.4.0 documents hierarchical dimensions and geometric adstock, but its default transformation and model wrapper are not the project's exact generator equation, and the three pooling priors need direct comparability. This milestone therefore uses lower-level PyMC's documented model, `sample`, and prior predictive APIs. Full MCMC runs only through `mmm-fit`, never ordinary CI or a frontend build.

API references: [PyMC sampling](https://www.pymc.io/projects/docs/en/stable/api/generated/pymc.sample.html), [PyMC prior predictive sampling](https://www.pymc.io/projects/docs/en/stable/api/generated/pymc.sample_prior_predictive.html), [ArviZ DataTree migration](https://python.arviz.org/en/stable/user_guide/migration_guide.html), and [PyMC-Marketing hierarchical MMM example](https://www.pymc-marketing.io/en/latest/notebooks/mmm/mmm_gam_options.html).

## Interpretation and checks

`mmm-evaluate` reports chain diagnostics, prior and posterior predictive checks, conditional holdout MAE/WAPE/bias and 90% predictive coverage, plus coefficient and contribution recovery against evaluation-only synthetic truth. Parameter intervals are credible intervals; sales predictive coverage includes observation noise. The holdout results are conditional on the supplied future plan and context, not unconditional forecasts.

The partial-pooling sensitivity check reweights its posterior draws under a wider `Normal(0, 1.0)` log population response prior, compared with the fitted `Normal(0, 0.7)`, and reports the importance effective draw count and effect-mean shifts. This checks one prior locally without another MCMC fit; poor importance overlap would require an independent refit. Training campaign-spend correlations are reported for each segment alongside recovery and interval widths.

The source generator deliberately correlates channel schedules and links campaigns with price. Shared alpha and k, three overlapping channels, and six heterogeneous regions may make individual beta and shape parameters weakly identified. Partial pooling can reduce variance and also introduce shrinkage bias. Synthetic recovery verifies behavior under this known generating process; it does not establish causal incrementality for observational marketing data.

## Actual M3 fit assessment

The first two-chain partial-pooling fit had three divergences and maximum R-hat 1.0192. Its four-chain rerun with 1,000 tuning steps, 800 posterior draws per chain and `target_accept=0.98` had zero divergences, maximum R-hat 1.0043 and minimum bulk ESS 1,146.4. Complete and no pooling had zero divergences and maximum R-hat 1.0056 and 1.0097 respectively; their minimum bulk ESS was 266.3 and 427.7. The rerun settings are saved per model in `modeling/artifacts/fit_manifest.json`.

All three conditional holdout WAPEs are close to 4%. The 90% coefficient credible intervals contain 12/18, 17/18 and 15/18 true maximum effects for complete, no and partial pooling. The partial-pooling intervals are broad in the two smallest regions. For example, Pacific Coast retailer response has a true maximum of 55 sales units, posterior mean 152.55 and 90% interval 62.051–264.701; this particular interval **misses truth**. Mountain West retailer response is also biased high (truth 70, posterior mean 156.177, interval 66.616–269.342). All six shared adstock and half-saturation intervals contain truth, but adstock ranges remain wide: coupon alpha 0.104–0.949 around truth 0.25. These findings indicate weak decomposition despite acceptable demand prediction and convergence. The hierarchical model is not uniformly better than no pooling; its coefficient mean absolute error is 49.981 units versus 37.972 for no pooling.

The saved [evaluation report](../modeling/artifacts/evaluation.json) contains every coefficient and shape interval, contribution recovery, campaign-spend correlations, prior sensitivity, and conditional holdout metrics. Avoid presenting model contributions as validated causal lift or using them for confident budget optimization without additional sensitivity or experimental evidence.
