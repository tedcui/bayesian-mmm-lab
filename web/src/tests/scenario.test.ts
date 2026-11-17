import { describe, expect, it } from 'vitest'
import manifest from '../../public/model-data/manifest.json'
import overview from '../../public/model-data/overview.json'
import contributions from '../../public/model-data/contributions.json'
import segments from '../../public/model-data/segments.json'
import simulator from '../../public/model-data/simulator.json'
import fixture from './fixtures/scenario_parity.json'
import { validateModelDataBundle } from '../lib/data'
import { evaluateScenario, prepareScenario, scaleBaselinePlan } from '../lib/scenario'

const bundle = validateModelDataBundle({ manifest, overview, contributions, segments, simulator })
const tolerance = fixture.numeric_tolerance
function close(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
    tolerance.absolute + tolerance.relative * Math.abs(expected))
}

describe('M6A posterior scenario engine', () => {
  it('matches Python genuine-draw fixture per draw and for joint-draw summaries', () => {
    expect(fixture.bundle_id).toBe(bundle.manifest.bundle_id)
    expect(fixture.simulator_sha256).toBe(bundle.manifest.files['simulator.json'].sha256)
    for (const scenario of fixture.cases) {
      const prepared = prepareScenario(bundle, scenario.segment_id)
      const baseline = prepared.segment.baseline_plan_usd
      const alternate = scaleBaselinePlan(baseline, scenario.channel_multipliers)
      const actual = evaluateScenario(prepared, baseline, alternate)
      expect(actual.draw_count).toBe(96)
      expect(actual.alternative_support).toEqual(scenario.alternative_support)
      for (const key of ['baseline_spend_usd', 'alternative_spend_usd'] as const) {
        close(actual[key].total, scenario[key].total)
        for (const channel of bundle.manifest.channels) close(actual[key].by_channel[channel], scenario[key].by_channel[channel])
      }
      expect(scenario.draw_rows).toHaveLength(96)
      scenario.draw_rows.forEach((expected, position) => {
        const row = actual.draws[position]
        expect(row.joint_draw_index).toBe(expected[0])
        close(row.baseline_expected_units, expected[1])
        close(row.alternative_expected_units, expected[2])
        close(row.incremental_expected_units, expected[3])
        bundle.manifest.channels.forEach((channel, c) => {
          close(row.channel_difference_units[channel], expected[c + 4])
          close(row.baseline_channel_units[channel], expected[c + 7])
          close(row.alternative_channel_units[channel], expected[c + 10])
          close(row.alternative_channel_units[channel] - row.baseline_channel_units[channel],
            row.channel_difference_units[channel])
        })
        close(row.baseline_expected_units - Object.values(row.baseline_channel_units).reduce((sum, value) => sum + value, 0),
          prepared.nonmarketingTotals[position])
        close(row.alternative_expected_units - Object.values(row.alternative_channel_units).reduce((sum, value) => sum + value, 0),
          prepared.nonmarketingTotals[position])
      })
      for (const key of ['baseline_expected_units', 'alternative_expected_units', 'incremental_expected_units'] as const) {
        for (const stat of ['mean', 'p05', 'p50', 'p95'] as const) close(actual.summary[key][stat], scenario.summary[key][stat])
      }
      for (const channel of bundle.manifest.channels) for (const stat of ['mean', 'p05', 'p50', 'p95'] as const) {
        close(actual.summary.baseline_channel_units[channel][stat], scenario.summary.baseline_channel_units[channel][stat])
        close(actual.summary.alternative_channel_units[channel][stat], scenario.summary.alternative_channel_units[channel][stat])
        close(actual.summary.channel_difference_units[channel][stat], scenario.summary.channel_difference_units[channel][stat])
      }
    }
  })

  it('returns exact per-draw zero on reset to the baseline plan', () => {
    const prepared = prepareScenario(bundle, 'northeast')
    const baseline = prepared.segment.baseline_plan_usd
    const changed = scaleBaselinePlan(baseline, [1.15, 0.9, 1])
    expect(evaluateScenario(prepared, baseline, changed).summary.incremental_expected_units.mean).not.toBe(0)
    const reset = scaleBaselinePlan(baseline, [1, 1, 1])
    const result = evaluateScenario(prepared, baseline, reset)
    expect(result.draws.every(row => row.incremental_expected_units === 0 &&
      Object.values(row.channel_difference_units).every(value => value === 0))).toBe(true)
    expect(result.summary.incremental_expected_units).toEqual({ mean: 0, p05: 0, p50: 0, p95: 0 })
    close(result.baseline_spend_usd.total, result.alternative_spend_usd.total)
  })

  it('retains prior adstock with zero replay spend and isolates changed channels and regions', () => {
    const prepared = prepareScenario(bundle, 'pacific_coast')
    const baseline = prepared.segment.baseline_plan_usd
    const zero = scaleBaselinePlan(baseline, [0, 0, 0])
    const result = evaluateScenario(prepared, baseline, zero)
    expect(result.alternative_spend_usd.total).toBe(0)
    expect(result.draws.every((row, i) => row.alternative_expected_units > prepared.nonmarketingTotals[i])).toBe(true)
    const coupon = evaluateScenario(prepared, baseline, scaleBaselinePlan(baseline, [1.1, 1, 1]))
    expect(coupon.draws.every(row => row.channel_difference_units.coupon > 0 &&
      row.channel_difference_units.retailer_promotion === 0 && row.channel_difference_units.digital === 0)).toBe(true)
    const northeast = prepareScenario(bundle, 'northeast')
    expect(northeast.nonmarketingTotals[0]).not.toBe(prepared.nonmarketingTotals[0])
    expect(evaluateScenario(prepared, baseline, zero)).toEqual(result)
  })

  it('rejects source/version mismatch, malformed plans and missing history; flags unsupported spend', () => {
    const mixed = structuredClone(bundle)
    mixed.simulator.bundle_id = '0'.repeat(64)
    expect(() => prepareScenario(mixed, 'northeast')).toThrow(/source\/version mismatch/)
    const missing = structuredClone(bundle)
    missing.simulator.segments[0].history_spend_usd = []
    expect(() => prepareScenario(missing, 'northeast')).toThrow(/history_spend_usd/)
    const prepared = prepareScenario(bundle, 'northeast')
    const baseline = prepared.segment.baseline_plan_usd
    expect(() => evaluateScenario(prepared, baseline, baseline.slice(1))).toThrow(/12x3/)
    expect(() => evaluateScenario(prepared, baseline, [[-1, 0, 0], ...baseline.slice(1)])).toThrow(/nonnegative/)
    expect(() => evaluateScenario(prepared, baseline, [[Number.NaN, 0, 0], ...baseline.slice(1)])).toThrow(/finite/)
    expect(() => scaleBaselinePlan(baseline, [1, Number.POSITIVE_INFINITY, 1])).toThrow(/channelMultipliers/)
    const above = baseline.map(() => prepared.segment.spend_limits_usd.map(limit => limit.max_usd + 1))
    const flagged = evaluateScenario(prepared, baseline, above)
    expect(flagged.alternative_support.outside_observed_bounds).toBe(true)
    expect(flagged.alternative_support.extrapolates_beyond_training).toBe(true)
    expect(flagged.alternative_support.by_channel.coupon.above_observed_max_weeks).toBe(12)
  })
})
