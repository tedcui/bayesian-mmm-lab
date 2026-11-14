import type { Aggregate, Channel, ContributionAggregate, ContributionWeek, OverviewWeek } from '../types/modelData'

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
  return id.split('_').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')
}

export function filterWeeks<T extends { segment_id: string; week_start: string }>(
  rows: T[], filter: WeeklyFilter,
): T[] {
  if (filter.startWeek > filter.endWeek) return []
  return rows.filter(row => row.segment_id === filter.segmentId &&
    row.week_start >= filter.startWeek && row.week_start <= filter.endWeek)
}

export function holdoutMetrics(rows: OverviewWeek[]): { weeks: number; maeUnits: number; wape: number; biasUnits: number } | null {
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

export function spendTotals(rows: OverviewWeek[]): Record<Channel, number> {
  return Object.fromEntries(channelOrder.map(channel => [channel,
    rows.reduce((sum, row) => sum + row.planned_spend_usd[channel], 0)])) as Record<Channel, number>
}

export function decompositionTotals(rows: ContributionWeek[]) {
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
  return period ? aggregates.find(row => row.segment_id === filter.segmentId && row.period === period) ?? null : null
}
