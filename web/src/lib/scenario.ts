/** M6A conditional replay using the exact M3 mean equation and M4 joint draws.
 * Call prepareScenario only with a bundle returned by loadModelData or
 * validateModelDataBundle; those functions check hashes and the full schema.
 */
import type { Channel, ModelDataBundle, SimulatorData, SimulatorSegment, Summary } from '../types/modelData'

const channels: Channel[] = ['coupon', 'retailer_promotion', 'digital']
const controls = ['price_delta', 'distribution_delta', 'competitor_delta', 'trend',
  'season_sin', 'season_cos', 'holiday']
const transformText = {
  adstock: 'state[t] = spend_usd[t]/1000 + alpha * state[t-1]; initial state = 0',
  saturation: 'state/(state + half_saturation_thousands_usd)',
  baseline: 'sales_scale * intercept_scaled * (1 + dot(fixed_controls, control_coef))',
  channel: 'sales_scale * beta_scaled * saturation',
}
export const scenarioVersion = 'm6a-1'
export type SpendPlan = number[][] // 12 Monday-start weeks × [coupon, retailer promotion, digital], USD/week

export interface SpendSupport {
  by_channel: Record<Channel, { above_training_max_weeks: number; above_observed_max_weeks: number }>
  extrapolates_beyond_training: boolean
  outside_observed_bounds: boolean
}
export interface ScenarioDrawResult {
  joint_draw_index: number
  baseline_expected_units: number
  alternative_expected_units: number
  incremental_expected_units: number
  channel_difference_units: Record<Channel, number>
}
export interface ScenarioResult {
  scenario_version: typeof scenarioVersion
  bundle_id: string
  segment_id: string
  horizon_week_starts: string[]
  draw_count: number
  uncertainty: string
  baseline_spend_usd: { by_channel: Record<Channel, number>; total: number }
  alternative_spend_usd: { by_channel: Record<Channel, number>; total: number }
  baseline_support: SpendSupport
  alternative_support: SpendSupport
  draws: ScenarioDrawResult[]
  summary: {
    baseline_expected_units: Summary
    alternative_expected_units: Summary
    incremental_expected_units: Summary
    channel_difference_units: Record<Channel, Summary>
  }
}
export interface PreparedScenario {
  bundleId: string
  segmentId: string
  segmentIndex: number
  simulator: SimulatorData
  segment: SimulatorSegment
  historyStates: number[][]
  nonmarketingTotals: number[]
}

function matrix(value: unknown, rows: number, columns: number, name: string, nonnegative: boolean): number[][] {
  if (!Array.isArray(value) || value.length !== rows || value.some(row =>
    !Array.isArray(row) || row.length !== columns || row.some(cell =>
      typeof cell !== 'number' || !Number.isFinite(cell) || (nonnegative && cell < 0)))) {
    throw new Error(`${name} must be a finite ${rows}x${columns} ${nonnegative ? 'nonnegative ' : ''}matrix`)
  }
  return value as number[][]
}

/** Validate source identity and precompute 108-week adstock state per draw. */
export function prepareScenario(bundle: ModelDataBundle, segmentId: string): PreparedScenario {
  const { manifest, simulator } = bundle
  if (manifest.schema_version !== 'm4-2' || simulator.schema_version !== 'm4-2' ||
      manifest.bundle_id !== simulator.bundle_id || manifest.reference_model !== 'partial' ||
      simulator.reference_model !== 'partial') throw new Error('Scenario source/version mismatch')
  if (simulator.channel_order.join() !== channels.join() || simulator.control_order.join() !== controls.join() ||
      simulator.segment_order.join() !== manifest.segments.join()) throw new Error('Scenario source coordinates mismatch')
  const transform = simulator.transformation
  if (transform.sales_scale !== 100 || transform.spend_scale_usd !== 1000 ||
      Object.entries(transformText).some(([name, expected]) => transform[name as keyof typeof transformText] !== expected)) {
    throw new Error('Scenario transformation/version mismatch')
  }
  if (simulator.history_week_starts.length !== 108 || simulator.horizon_week_starts.length !== 12) {
    throw new Error('Missing or incomplete scenario history/horizon')
  }
  const segmentIndex = simulator.segment_order.indexOf(segmentId)
  if (segmentIndex < 0) throw new Error(`Unknown scenario segment: ${segmentId}`)
  const segment = simulator.segments[segmentIndex]
  if (segment.segment_id !== segmentId) throw new Error('Scenario segment coordinates mismatch')
  const history = matrix(segment.history_spend_usd, 108, 3, 'history_spend_usd', true)
  matrix(segment.baseline_plan_usd, 12, 3, 'baseline_plan_usd', true)
  const fixed = matrix(segment.fixed_controls, 12, 7, 'fixed_controls', false)
  if (simulator.draws.length !== simulator.draw_count || !simulator.draws.length) {
    throw new Error('Scenario posterior draw count mismatch')
  }
  const seen = new Set<number>()
  const historyStates: number[][] = []
  const nonmarketingTotals: number[] = []
  for (const draw of simulator.draws) {
    if (!Number.isSafeInteger(draw.joint_draw_index) || seen.has(draw.joint_draw_index)) {
      throw new Error('Invalid or duplicate joint draw index')
    }
    seen.add(draw.joint_draw_index)
    const alpha = draw.adstock_alpha
    const half = draw.half_saturation_thousands_usd
    const beta = draw.beta_scaled_by_segment_channel
    const intercept = draw.intercept_scaled_by_segment
    const coef = draw.control_coef
    if (alpha.length !== 3 || half.length !== 3 || beta.length !== 6 || intercept.length !== 6 || coef.length !== 7 ||
        alpha.some(x => !Number.isFinite(x) || x < 0 || x >= 1) ||
        half.some(x => !Number.isFinite(x) || x <= 0) ||
        beta.some(row => row.length !== 3 || row.some(x => !Number.isFinite(x) || x < 0)) ||
        intercept.some(x => !Number.isFinite(x)) || coef.some(x => !Number.isFinite(x))) {
      throw new Error('Invalid posterior draw parameters')
    }
    const stock = [0, 0, 0]
    for (const week of history) for (let c = 0; c < 3; c++) {
      stock[c] = week[c] / 1000 + alpha[c] * stock[c]
    }
    historyStates.push(stock)
    let nonmarketing = 0
    for (const week of fixed) {
      let dot = 0
      for (let j = 0; j < 7; j++) dot += week[j] * coef[j]
      nonmarketing += 100 * intercept[segmentIndex] * (1 + dot)
    }
    nonmarketingTotals.push(nonmarketing)
  }
  return { bundleId: manifest.bundle_id, segmentId, segmentIndex, simulator, segment,
    historyStates, nonmarketingTotals }
}

/** The M6B controls will multiply each channel's original weekly profile. */
export function scaleBaselinePlan(baselinePlanUsd: SpendPlan, channelMultipliers: number[]): SpendPlan {
  const plan = matrix(baselinePlanUsd, 12, 3, 'baseline_plan_usd', true)
  if (channelMultipliers.length !== 3 || channelMultipliers.some(x => !Number.isFinite(x) || x < 0)) {
    throw new Error('channelMultipliers must be three finite nonnegative values')
  }
  return plan.map(week => week.map((value, c) => value * channelMultipliers[c]))
}

function support(plan: SpendPlan, limits: SimulatorSegment['spend_limits_usd']): SpendSupport {
  const byChannel = {} as SpendSupport['by_channel']
  for (let c = 0; c < 3; c++) {
    const limit = limits[c]
    if (!limit || limit.channel !== channels[c] || limit.min_usd !== 0 ||
        ![limit.max_usd, limit.training_max_usd, limit.training_p95_usd].every(Number.isFinite) ||
        limit.max_usd < limit.training_max_usd) throw new Error('Invalid scenario spend limits')
    byChannel[channels[c]] = {
      above_training_max_weeks: plan.filter(week => week[c] > limit.training_max_usd + 1e-9).length,
      above_observed_max_weeks: plan.filter(week => week[c] > limit.max_usd + 1e-9).length,
    }
  }
  return { by_channel: byChannel,
    extrapolates_beyond_training: channels.some(name => byChannel[name].above_training_max_weeks > 0),
    outside_observed_bounds: channels.some(name => byChannel[name].above_observed_max_weeks > 0) }
}

function quantile(sorted: number[], p: number): number {
  const position = (sorted.length - 1) * p
  const lower = Math.floor(position)
  const fraction = position - lower
  return sorted[lower] + fraction * (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower])
}
function summary(values: number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b)
  return { mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p05: quantile(sorted, 0.05), p50: quantile(sorted, 0.5), p95: quantile(sorted, 0.95) }
}

/** Paired expected-unit totals; no likelihood noise or new posterior sampling. */
export function evaluateScenario(prepared: PreparedScenario, baselinePlanUsd: SpendPlan,
  alternativePlanUsd: SpendPlan): ScenarioResult {
  const baseline = matrix(baselinePlanUsd, 12, 3, 'baseline_plan_usd', true)
  const alternative = matrix(alternativePlanUsd, 12, 3, 'alternative_plan_usd', true)
  const draws: ScenarioDrawResult[] = []
  for (let d = 0; d < prepared.simulator.draws.length; d++) {
    const draw = prepared.simulator.draws[d]
    const alpha = draw.adstock_alpha
    const half = draw.half_saturation_thousands_usd
    const beta = draw.beta_scaled_by_segment_channel[prepared.segmentIndex]
    const baseState = [...prepared.historyStates[d]]
    const altState = [...prepared.historyStates[d]]
    const baseChannel = [0, 0, 0]
    const altChannel = [0, 0, 0]
    for (let week = 0; week < 12; week++) for (let c = 0; c < 3; c++) {
      baseState[c] = baseline[week][c] / 1000 + alpha[c] * baseState[c]
      altState[c] = alternative[week][c] / 1000 + alpha[c] * altState[c]
      baseChannel[c] += 100 * beta[c] * baseState[c] / (baseState[c] + half[c])
      altChannel[c] += 100 * beta[c] * altState[c] / (altState[c] + half[c])
    }
    const baselineTotal = prepared.nonmarketingTotals[d] + baseChannel.reduce((sum, value) => sum + value, 0)
    const alternateTotal = prepared.nonmarketingTotals[d] + altChannel.reduce((sum, value) => sum + value, 0)
    if (!Number.isFinite(baselineTotal) || !Number.isFinite(alternateTotal)) {
      throw new Error('Scenario expected units overflowed')
    }
    const differences = {} as Record<Channel, number>
    for (let c = 0; c < 3; c++) differences[channels[c]] = altChannel[c] - baseChannel[c]
    draws.push({ joint_draw_index: draw.joint_draw_index, baseline_expected_units: baselineTotal,
      alternative_expected_units: alternateTotal, incremental_expected_units: alternateTotal - baselineTotal,
      channel_difference_units: differences })
  }
  const spend = (plan: SpendPlan) => {
    const byChannel = {} as Record<Channel, number>
    for (let c = 0; c < 3; c++) byChannel[channels[c]] = plan.reduce((sum, week) => sum + week[c], 0)
    return { by_channel: byChannel, total: channels.reduce((sum, name) => sum + byChannel[name], 0) }
  }
  const channelDifference = {} as Record<Channel, Summary>
  for (const name of channels) channelDifference[name] = summary(draws.map(row => row.channel_difference_units[name]))
  return { scenario_version: scenarioVersion, bundle_id: prepared.bundleId,
    segment_id: prepared.segmentId, horizon_week_starts: prepared.simulator.horizon_week_starts,
    draw_count: draws.length, uncertainty: 'parameter_credible_90; expected sales units; no observation noise',
    baseline_spend_usd: spend(baseline), alternative_spend_usd: spend(alternative),
    baseline_support: support(baseline, prepared.segment.spend_limits_usd),
    alternative_support: support(alternative, prepared.segment.spend_limits_usd), draws,
    summary: { baseline_expected_units: summary(draws.map(row => row.baseline_expected_units)),
      alternative_expected_units: summary(draws.map(row => row.alternative_expected_units)),
      incremental_expected_units: summary(draws.map(row => row.incremental_expected_units)),
      channel_difference_units: channelDifference } }
}
