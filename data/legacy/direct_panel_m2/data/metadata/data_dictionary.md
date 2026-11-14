# Synthetic MMM data dictionary

`uv run mmm-generate` writes one row for each of six segments (A–F) and 120 Monday-start weeks beginning 2023-01-02. The dataset is synthetic. Values are illustrative and have no relationship to any client or real business.

## Observable fields

| Field | Unit | Meaning |
|---|---|---|
| `segment` | ID | Market segment A–F; smaller E and F have lower sales and spend. |
| `week_index` | week | 1–120 within each segment. Weeks 1–100 train; 101–120 holdout. |
| `week_start` | ISO date | Monday at the start of the week. |
| `coupon_spend` | dollars per week | Coupon promotional spend. |
| `retailer_spend` | dollars per week | Retailer promotion spend. |
| `digital_spend` | dollars per week | Digital advertising spend. |
| `price_index` | ratio | Price relative to reference price 1.0. Higher values reduce expected sales. |
| `distribution_index` | ratio | Distribution coverage, bounded 0.75–1.0; reference 0.90. |
| `competitor_index` | ratio | Competitor activity relative to 1.0. Higher values reduce expected sales. |
| `holiday` | indicator | 1 for ISO weeks 47–52, otherwise 0. |
| `trend` | fraction | `(week_index - 1) / 119`, a known calendar feature. |
| `season_sin`, `season_cos` | unitless | Annual Fourier terms with period 52 weeks. |
| `sales_units` | units per week | Nonnegative integer observed sales; target variable. |

`data/processed/model_ready.csv` retains every observable field in the same row order. It adds `split` (`train` or `holdout`) and `price_index_z`, `distribution_index_z`, and `competitor_index_z`. These use pooled training-row means and population standard deviations from weeks 1–100 only. The fitted values are saved in `preprocessing.json`; the holdout has no effect on them. Original spend is retained for adstock history, including the weeks immediately before the holdout.

## Generating process

The generator uses NumPy's `default_rng` with fixed seed `20261113`. Baselines, noise scales, spend scales and maximum channel effects vary by segment. A common weekly campaign factor plus channel-specific variation makes promotion channels positively correlated. Promotions also modestly influence the simulated price index, so raw channel associations are confounded.

For channel spend `x_t`, geometric adstock is `a_t = x_t + decay × a_(t-1)` with `a_0 = 0`. Saturated response is `a_t / (a_t + half_saturation)`. Expected sales equal segment baseline plus additive price, distribution, competitor, trend, annual seasonality, holiday, and three channel contributions. Each channel contribution is its segment-specific maximum effect multiplied by saturated response. Gaussian noise is then added, the total rounded to an integer, and negative values clipped to zero. The exact `noise` and `rounding_adjustment` are recorded separately for reconstruction.

`ground_truth.json` is **evaluation-only**. It stores the random seed, true coefficients, adstock decay, saturation constants, and the exact expected-sales components for every segment-week. It must never be joined into training inputs or passed to a fitting function. The field names `trend` and `holiday` in its `components` array mean their true sales-unit contributions; in CSV they mean observable features.

## Availability and leakage

`week_index`, dates, holidays, trend, and Fourier features are known in advance. Holdout spend, price, distribution, and competitor indexes are realized exogenous values, not generally known before the week. Any evaluation using them is a **conditional holdout prediction**, not an unconditional forecast. Adstock must carry prior observed spend from training into holdout. No preprocessing statistic may be fitted on holdout rows.

## Limits

These observations follow a deliberately specified additive process with stable coefficients and measured controls. Real marketing data may have unrecorded campaigns, targeting, endogeneity, changing distributions and response curves, reporting error, delayed sales, and structural breaks. Correlated channels and promotion-linked price make separate effects difficult to identify even here. Recovery of the synthetic truth does not establish real-world causal lift.
