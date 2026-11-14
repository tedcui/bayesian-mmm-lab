import { describe, expect, it } from 'vitest'
import manifest from '../../public/model-data/manifest.json'
import overview from '../../public/model-data/overview.json'
import contributions from '../../public/model-data/contributions.json'
import segments from '../../public/model-data/segments.json'
import simulator from '../../public/model-data/simulator.json'
import { validateModelDataBundle } from '../lib/data'
import { decompositionTotals, filterWeeks, holdoutMetrics, matchingAggregate, spendTotals } from '../lib/analytics'

const bundle = validateModelDataBundle({ manifest, overview, contributions, segments, simulator })
const dates = bundle.manifest.dates
const first = bundle.manifest.segments[0]

describe('M5 export-derived selectors', () => {
  it('filters exactly one region and time window and calculates holdout error from weekly rows', () => {
    const filter = { segmentId: first, startWeek: dates.first_holdout_week, endWeek: dates.last_week }
    const rows = filterWeeks(bundle.overview.weekly, filter)
    expect(rows).toHaveLength(20)
    expect(rows.every(row => row.segment_id === first && row.period === 'holdout')).toBe(true)
    const error = holdoutMetrics(rows)!
    expect(error.maeUnits).toBeCloseTo(bundle.segments.models.partial.conditional_holdout.segment_mae_units[first], 2)
    expect(holdoutMetrics(filterWeeks(bundle.overview.weekly,
      { segmentId: first, startWeek: dates.first_week, endWeek: dates.last_training_week }))).toBeNull()
    expect(filterWeeks(bundle.overview.weekly,
      { segmentId: first, startWeek: dates.last_week, endWeek: dates.first_week })).toHaveLength(0)
  })

  it('matches planned-spend and decomposition sums while preserving draw-first aggregate intervals', () => {
    const filter = { segmentId: first, startWeek: dates.first_week, endWeek: dates.last_week }
    const overviewRows = filterWeeks(bundle.overview.weekly, filter)
    const contributionRows = filterWeeks(bundle.contributions.weekly, filter)
    const spend = spendTotals(overviewRows)
    const overviewAggregate = matchingAggregate(bundle.overview.aggregates, filter,
      dates.first_week, dates.last_training_week, dates.first_holdout_week, dates.last_week)!
    expect(spend.coupon).toBeCloseTo(overviewAggregate.planned_spend_usd.coupon, 2)
    const total = decompositionTotals(contributionRows)
    expect(total.observed).toBe(overviewAggregate.observed_sales_units)
    expect(total.observed).toBeCloseTo(total.expected + total.residual, 1)
    expect(total.expected).toBeCloseTo(total.baseline + Object.values(total.channels).reduce((sum, value) => sum + value, 0), 1)
    const aggregate = matchingAggregate(bundle.contributions.aggregates, filter,
      dates.first_week, dates.last_training_week, dates.first_holdout_week, dates.last_week)!
    expect(aggregate.channels_units.coupon.p05).not.toBeCloseTo(
      contributionRows.reduce((sum, row) => sum + row.channels_units.coupon.p05, 0), 0)
    expect(matchingAggregate(bundle.contributions.aggregates,
      { ...filter, startWeek: dates.first_holdout_week }, dates.first_week,
      dates.last_training_week, dates.first_holdout_week, dates.last_week)).toBeTruthy()
    expect(matchingAggregate(bundle.contributions.aggregates,
      { ...filter, endWeek: dates.last_training_week }, dates.first_week,
      dates.last_training_week, dates.first_holdout_week, dates.last_week)).toBeTruthy()
    expect(matchingAggregate(bundle.contributions.aggregates,
      { ...filter, startWeek: dates.last_training_week }, dates.first_week,
      dates.last_training_week, dates.first_holdout_week, dates.last_week)).toBeNull()
  })
})
