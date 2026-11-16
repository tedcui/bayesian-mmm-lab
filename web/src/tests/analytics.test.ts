import { describe, expect, it } from 'vitest'
import manifest from '../../public/model-data/manifest.json'
import overview from '../../public/model-data/overview.json'
import contributions from '../../public/model-data/contributions.json'
import segments from '../../public/model-data/segments.json'
import simulator from '../../public/model-data/simulator.json'
import { validateModelDataBundle } from '../lib/data'
import { ALL_REGIONS, decompositionTotals, filterWeeks, holdoutMetrics, matchingAggregate,
  rollupContributionWeeks, rollupOverviewWeeks, spendTotals } from '../lib/analytics'

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

  it('matches exported all-region intervals to regional means without a seventh fitting segment', () => {
    const filter = { segmentId: ALL_REGIONS, startWeek: dates.first_week, endWeek: dates.last_week }
    const overviewRows = rollupOverviewWeeks(bundle.overview.weekly, filter, bundle.manifest.segments)
    const contributionRows = rollupContributionWeeks(bundle.contributions.weekly, filter, bundle.manifest.segments)
    const overviewAggregate = matchingAggregate(bundle.overview.aggregates, filter,
      dates.first_week, dates.last_training_week, dates.first_holdout_week, dates.last_week)!
    const contributionAggregate = matchingAggregate(bundle.contributions.aggregates, filter,
      dates.first_week, dates.last_training_week, dates.first_holdout_week, dates.last_week)!
    expect(overviewRows).toHaveLength(120)
    expect(contributionRows).toHaveLength(120)
    expect(bundle.overview.all_regions_weekly).toHaveLength(120)
    expect(bundle.contributions.all_regions_weekly).toHaveLength(120)
    expect(overviewRows.reduce((sum, row) => sum + row.observed_sales_units, 0))
      .toBe(overviewAggregate.observed_sales_units)
    expect(overviewRows.reduce((sum, row) => sum + row.expected_sales_units.mean, 0))
      .toBeCloseTo(overviewAggregate.expected_sales_units.mean, 0)
    expect(spendTotals(overviewRows).digital).toBeCloseTo(overviewAggregate.planned_spend_usd.digital, 2)
    expect(decompositionTotals(contributionRows).channels.coupon)
      .toBeCloseTo(contributionAggregate.channels_units.coupon.mean, 0)
    expect(bundle.overview.all_regions_weekly[0].expected_sales_units.mean)
      .toBeCloseTo(overviewRows[0].expected_sales_units.mean, 3)
    expect(bundle.contributions.all_regions_weekly[0].channels_units.coupon.mean)
      .toBeCloseTo(contributionRows[0].channels_units.coupon.mean, 3)
    expect(bundle.overview.all_regions_weekly[0].predictive_sales_units.p95)
      .toBeGreaterThan(bundle.overview.all_regions_weekly[0].predictive_sales_units.p05)
    expect(bundle.contributions.all_regions_weekly[0].channels_units.coupon.p95)
      .toBeGreaterThan(bundle.contributions.all_regions_weekly[0].channels_units.coupon.p05)
    expect(matchingAggregate(bundle.overview.aggregates,
      { ...filter, endWeek: dates.last_training_week }, dates.first_week,
      dates.last_training_week, dates.first_holdout_week, dates.last_week)?.period).toBe('training')
    expect(matchingAggregate(bundle.overview.aggregates,
      { ...filter, startWeek: dates.first_holdout_week }, dates.first_week,
      dates.last_training_week, dates.first_holdout_week, dates.last_week)?.period).toBe('holdout')
    expect(matchingAggregate(bundle.overview.aggregates,
      { ...filter, startWeek: dates.last_training_week }, dates.first_week,
      dates.last_training_week, dates.first_holdout_week, dates.last_week)).toBeNull()
    expect(() => rollupOverviewWeeks(bundle.overview.weekly.slice(120), filter,
      bundle.manifest.segments)).toThrow(/Incomplete or inconsistent all-region week/)
    expect(holdoutMetrics(overviewRows)?.weeks).toBe(20)
  })
})
