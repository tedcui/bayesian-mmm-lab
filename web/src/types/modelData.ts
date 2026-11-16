/** M4 fitted-model export contract. Sales are units; planned spend is USD. */
export type Pooling = 'complete' | 'none' | 'partial'
export type Channel = 'coupon' | 'retailer_promotion' | 'digital'
export type Period = 'training' | 'holdout'
export type AggregatePeriod = Period | 'all'

export interface Summary {
  mean: number
  p05: number
  p50: number
  p95: number
}

export type ChannelMap<T> = Record<Channel, T>

export interface ExportManifest {
  schema_version: 'm4-2'
  bundle_id: string
  generated_at_utc: string
  reference_model: 'partial'
  reference_model_note: string
  models: Pooling[]
  segments: string[]
  channels: Channel[]
  units: { sales: 'units'; planned_spend: 'USD'; time: 'Monday-start week' }
  dates: { first_week: string; last_week: string; last_training_week: string; first_holdout_week: string }
  lineage: {
    source_manifest_sha256: string
    source_schema_sha256: string
    etl_manifest_sha256: string
    etl_version: string
    model_input_sha256: string
    fit_manifest_sha256: string
    evaluation_sha256: string
    model_version: string
    posterior_sha256: Record<Pooling, string>
  }
  files: Record<'overview.json' | 'contributions.json' | 'segments.json' | 'simulator.json',
    { sha256: string; bytes: number }>
  limitations: string[]
  disclosure: string
}

export interface WeeklyKey {
  segment_id: string
  week_start: string
  time_index: number
  period: Period
}

export interface OverviewWeek extends WeeklyKey {
  observed_sales_units: number
  planned_spend_usd: ChannelMap<number>
  expected_sales_units: Summary
  predictive_sales_units: Summary
  residual_to_expected_mean_units: number
}

export interface ContributionWeek extends WeeklyKey {
  observed_sales_units: number
  baseline_units: Summary
  channels_units: ChannelMap<Summary>
  expected_sales_units: Summary
  residual_to_expected_mean_units: number
}

export type AllRegionsOverviewWeek = Omit<OverviewWeek, 'segment_id'> & { segment_id: null }
export type AllRegionsContributionWeek = Omit<ContributionWeek, 'segment_id'> & { segment_id: null }

export interface Aggregate {
  segment_id: string | null
  period: AggregatePeriod
  observed_sales_units: number
  planned_spend_usd: ChannelMap<number>
  expected_sales_units: Summary
  predictive_sales_units: Summary
  residual_to_expected_mean_units: number
}

export interface ContributionAggregate extends Aggregate {
  baseline_units: Summary
  channels_units: ChannelMap<Summary>
}

interface PayloadBase {
  schema_version: 'm4-2'
  bundle_id: string
  reference_model: 'partial'
}

export interface OverviewData extends PayloadBase {
  intervals: { expected_sales_units: string; predictive_sales_units: string }
  weekly: OverviewWeek[]
  all_regions_weekly: AllRegionsOverviewWeek[]
  aggregates: Aggregate[]
}

export interface ContributionsData extends PayloadBase {
  interpretation: string
  weekly: ContributionWeek[]
  all_regions_weekly: AllRegionsContributionWeek[]
  aggregates: ContributionAggregate[]
}

export interface SegmentEffect {
  pooling: Pooling
  segment_id: string
  channel: Channel
  maximum_effect_units: Summary
  synthetic_truth_units: number
  interval_contains_truth: boolean
}

export interface SegmentData {
  schema_version: 'm4-2'
  bundle_id: string
  effect_definition: string
  interval_definition: string
  interpretation: string
  models: Record<Pooling, {
    diagnostics: { divergences: number; max_rhat: number; min_bulk_ess: number; parameters_with_rhat_above_1_01: string[] }
    conditional_holdout: {
      mae_units: number; wape: number; bias_units_predicted_minus_observed: number
      predictive_90_coverage: number; segment_mae_units: Record<string, number>
    }
    coefficient_recovery: { coefficient_90_coverage: number; coefficient_mean_absolute_error_units: number }
  }>
  effects: SegmentEffect[]
  segment_profiles: { segment_id: string; training_mean_sales_units: number; training_spend_cv: ChannelMap<number> }[]
}

export interface SimulatorDraw {
  joint_draw_index: number
  chain_index: number
  chain_draw_index: number
  intercept_scaled_by_segment: number[]
  control_coef: number[]
  beta_scaled_by_segment_channel: number[][]
  adstock_alpha: number[]
  half_saturation_thousands_usd: number[]
  noise_scaled_by_segment: number[]
}

export interface SimulatorSegment {
  segment_id: string
  history_spend_usd: number[][]
  baseline_plan_usd: number[][]
  fixed_controls: number[][]
  spend_limits_usd: {
    channel: Channel; min_usd: number; max_usd: number
    training_max_usd: number; training_p95_usd: number
  }[]
}

export interface SimulatorData extends PayloadBase {
  draw_selection_seed: number
  draw_count: number
  source_posterior_draw_count: number
  chain_count: number
  draws_per_chain: number
  channel_order: Channel[]
  segment_order: string[]
  control_order: string[]
  horizon_week_starts: string[]
  history_week_starts: string[]
  scenario_context: string
  transformation: {
    adstock: string; saturation: string; baseline: string; channel: string
    sales_scale: number; spend_scale_usd: number
  }
  spend_support: string
  segments: SimulatorSegment[]
  draws: SimulatorDraw[]
}

export interface ModelDataBundle {
  manifest: ExportManifest
  overview: OverviewData
  contributions: ContributionsData
  segments: SegmentData
  simulator: SimulatorData
}
