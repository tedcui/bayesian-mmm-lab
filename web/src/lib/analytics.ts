import type { Aggregate, Channel, ChannelMap, ContributionAggregate, ContributionWeek,
  OverviewWeek, Period } from '../types/modelData'

export const ALL_REGIONS = '__all_regions__'

interface MeanSummary { mean: number }

export interface OverviewMeanWeek {
  week_start: string
  period: Period
  observed_sales_units: number
  planned_spend_usd: ChannelMap<number>
  expected_sales_units: MeanSummary
}

export interface ContributionMeanWeek {
  week_start: string
  period: Period
  observed_sales_units: number
  baseline_units: MeanSummary
  channels_units: ChannelMap<MeanSummary>
  expected_sales_units: MeanSummary
  residual_to_expected_mean_units: number
}

export interface WeeklyFilter {
  segmentId: string
  startWeek: string
  endWeek: string
}

export const channelOrder: Channel[] = ['coupon', 'retailer_promotion', 'digital']

export const channelLabel: Record<Channel, string> = {
  coupon: 'Coupons',
  retailer_promotion: 'Retailer promotions',
  digital: 'Digital advertising',
}

export const channelColor: Record<Channel, string> = {
  coupon: '#167d89',
  retailer_promotion: '#e89c50',
  digital: '#8b78ae',
}

export function regionLabel(id: string): string {
  if (id === ALL_REGIONS) return 'All regions'
  return id.split('_').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')
}

export function filterWeeks<T extends { segment_id: string; week_start: string }>(
  rows: T[], filter: WeeklyFilter,
): T[] {
  if (filter.startWeek > filter.endWeek) return []
  return rows.filter(row => row.segment_id === filter.segmentId &&
    row.week_start >= filter.startWeek && row.week_start <= filter.endWeek)
}

function completeRegionalWeeks<T extends { segment_id: string; week_start: string; period: Period }>(
  rows: T[], filter: WeeklyFilter, segmentIds: string[],
): T[][] {
  if (filter.startWeek > filter.endWeek) return []
  const byWeek = new Map<string, T[]>()
  for (const row of rows) {
    if (row.week_start < filter.startWeek || row.week_start > filter.endWeek) continue
    const week = byWeek.get(row.week_start) ?? []
    week.push(row)
    byWeek.set(row.week_start, week)
  }
  return [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, week]) => {
    if (week.length !== segmentIds.length ||
        !segmentIds.every(id => week.some(row => row.segment_id === id)) ||
        !week.every(row => row.period === week[0].period)) {
      throw new Error(`Incomplete or inconsistent all-region week: ${date}`)
    }
    return week
  })
}

/** Add only additive means and observed values. Weekly interval endpoints are not additive. */
export function rollupOverviewWeeks(rows: OverviewWeek[], filter: WeeklyFilter,
  segmentIds: string[]): OverviewMeanWeek[] {
  return completeRegionalWeeks(rows, filter, segmentIds).map(week => ({
    week_start: week[0].week_start,
    period: week[0].period,
    observed_sales_units: week.reduce((sum, row) => sum + row.observed_sales_units, 0),
    expected_sales_units: { mean: week.reduce((sum, row) => sum + row.expected_sales_units.mean, 0) },
    planned_spend_usd: Object.fromEntries(channelOrder.map(channel => [channel,
      week.reduce((sum, row) => sum + row.planned_spend_usd[channel], 0)])) as ChannelMap<number>,
  }))
}

export function rollupContributionWeeks(rows: ContributionWeek[], filter: WeeklyFilter,
  segmentIds: string[]): ContributionMeanWeek[] {
  return completeRegionalWeeks(rows, filter, segmentIds).map(week => ({
    week_start: week[0].week_start,
    period: week[0].period,
    observed_sales_units: week.reduce((sum, row) => sum + row.observed_sales_units, 0),
    baseline_units: { mean: week.reduce((sum, row) => sum + row.baseline_units.mean, 0) },
    channels_units: Object.fromEntries(channelOrder.map(channel => [channel, { mean:
      week.reduce((sum, row) => sum + row.channels_units[channel].mean, 0) }])) as ChannelMap<MeanSummary>,
    expected_sales_units: { mean: week.reduce((sum, row) => sum + row.expected_sales_units.mean, 0) },
    residual_to_expected_mean_units: week.reduce((sum, row) => sum + row.residual_to_expected_mean_units, 0),
  }))
}

export function holdoutMetrics(rows: OverviewMeanWeek[]): { weeks: number; maeUnits: number; wape: number; biasUnits: number } | null {
  const holdout = rows.filter(row => row.period === 'holdout')
  if (!holdout.length) return null
  const errors = holdout.map(row => row.expected_sales_units.mean - row.observed_sales_units)
  const absoluteError = errors.reduce((sum, value) => sum + Math.abs(value), 0)
  const sales = holdout.reduce((sum, row) => sum + row.observed_sales_units, 0)
  return { weeks: holdout.length,
    maeUnits: absoluteError / holdout.length,
    wape: sales > 0 ? absoluteError / sales : 0,
    biasUnits: errors.reduce((sum, value) => sum + value, 0) / holdout.length }
}

export function spendTotals(rows: OverviewMeanWeek[]): Record<Channel, number> {
  return Object.fromEntries(channelOrder.map(channel => [channel,
    rows.reduce((sum, row) => sum + row.planned_spend_usd[channel], 0)])) as Record<Channel, number>
}

export function decompositionTotals(rows: ContributionMeanWeek[]) {
  const baseline = rows.reduce((sum, row) => sum + row.baseline_units.mean, 0)
  const channels = Object.fromEntries(channelOrder.map(channel => [channel,
    rows.reduce((sum, row) => sum + row.channels_units[channel].mean, 0)])) as Record<Channel, number>
  const expected = rows.reduce((sum, row) => sum + row.expected_sales_units.mean, 0)
  const observed = rows.reduce((sum, row) => sum + row.observed_sales_units, 0)
  const residual = rows.reduce((sum, row) => sum + row.residual_to_expected_mean_units, 0)
  return { baseline, channels, expected, observed, residual }
}

/** An aggregate interval exists only for the exact M4 all/training/holdout ranges. */
export function matchingAggregate<T extends Aggregate | ContributionAggregate>(
  aggregates: T[], filter: WeeklyFilter, firstWeek: string, lastTrainingWeek: string,
  firstHoldoutWeek: string, lastWeek: string,
): T | null {
  const period = filter.startWeek === firstWeek && filter.endWeek === lastWeek ? 'all'
    : filter.startWeek === firstWeek && filter.endWeek === lastTrainingWeek ? 'training'
      : filter.startWeek === firstHoldoutWeek && filter.endWeek === lastWeek ? 'holdout' : null
  const segmentId = filter.segmentId === ALL_REGIONS ? null : filter.segmentId
  return period ? aggregates.find(row => row.segment_id === segmentId && row.period === period) ?? null : null
}
