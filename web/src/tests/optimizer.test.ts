import { describe, expect, it } from 'vitest'
import manifest from '../../public/model-data/manifest.json'
import overview from '../../public/model-data/overview.json'
import contributions from '../../public/model-data/contributions.json'
import segments from '../../public/model-data/segments.json'
import simulator from '../../public/model-data/simulator.json'
import { validateModelDataBundle } from '../lib/data'
import { budgetBounds, optimizeFixedBudget } from '../lib/optimizer'
import { evaluateScenario, prepareScenario } from '../lib/scenario'
import { channelOrder } from '../lib/analytics'

const bundle = validateModelDataBundle({ manifest, overview, contributions, segments, simulator })

describe('M6B fixed-total-budget search', () => {
  it('keeps every candidate within observed weekly caps and accounts for the exact requested total', () => {
    for (const segmentId of bundle.manifest.segments) {
      const prepared = prepareScenario(bundle, segmentId)
      const bounds = budgetBounds(prepared)
      const baselineBudget = Object.values(bounds.baselineTotals).reduce((sum, value) => sum + value, 0)
      const baseline = evaluateScenario(prepared, prepared.segment.baseline_plan_usd, prepared.segment.baseline_plan_usd)
      const optimized = optimizeFixedBudget(prepared, baselineBudget)
      expect(optimized.status).toBe('feasible')
      if (optimized.status !== 'feasible') continue
      expect(optimized.scenario.alternative_spend_usd.total).toBeCloseTo(baselineBudget, 5)
      expect(optimized.scenario.alternative_support.outside_observed_bounds).toBe(false)
      expect(optimized.scenario.summary.incremental_expected_units.mean).toBeGreaterThanOrEqual(
        baseline.summary.incremental_expected_units.mean - 1e-8)
      for (const channel of channelOrder) {
        expect(optimized.allocationsUsd[channel]).toBeGreaterThanOrEqual(-1e-7)
        expect(optimized.allocationsUsd[channel]).toBeLessThanOrEqual(bounds.maximumTotals[channel] + 1e-6)
      }
      for (let week = 0; week < 12; week++) for (let c = 0; c < 3; c++) {
        const channel = channelOrder[c]
        const factor = optimized.allocationsUsd[channel] / bounds.baselineTotals[channel]
        expect(prepared.segment.baseline_plan_usd[week][c] * factor)
          .toBeLessThanOrEqual(prepared.segment.spend_limits_usd[c].max_usd + 1e-7)
      }
    }
  })

  it('rejects infeasible budgets and reports zero/max boundaries repeatably', () => {
    const prepared = prepareScenario(bundle, 'northeast')
    const bounds = budgetBounds(prepared)
    const impossible = optimizeFixedBudget(prepared, bounds.maximumBudget + 1)
    expect(impossible.status).toBe('infeasible')
    const negative = optimizeFixedBudget(prepared, -1)
    expect(negative.status).toBe('infeasible')
    const zero = optimizeFixedBudget(prepared, 0)
    expect(zero.status).toBe('feasible')
    if (zero.status === 'feasible') {
      expect(zero.scenario.alternative_spend_usd.total).toBe(0)
      expect(zero.boundaryChannels).toHaveLength(3)
      expect(zero.boundaryChannels.every(item => item.bound === 'minimum')).toBe(true)
    }
    const capped = optimizeFixedBudget(prepared, bounds.maximumBudget)
    expect(capped.status).toBe('feasible')
    if (capped.status === 'feasible') {
      expect(capped.boundaryChannels).toHaveLength(3)
      expect(capped.boundaryChannels.every(item => item.bound === 'maximum')).toBe(true)
      expect(capped.scenario.alternative_support.outside_observed_bounds).toBe(false)
    }
    expect(optimizeFixedBudget(prepared, 0)).toEqual(zero)
  })
})
