import type { OverviewWeek } from '../types/modelData'

type DemandRow = Pick<OverviewWeek, 'observed_sales_units' | 'expected_sales_units' | 'predictive_sales_units'>

/** Rank regions by their full-period average sales so date filters do not change the visual placement. */
export function regionSizeRank(weekly: readonly OverviewWeek[], segments: readonly string[], segmentId: string | null): number {
  if (segmentId === null) return 1
  const totals = new Map(segments.map(id => [id, { sum: 0, count: 0 }]))
  for (const row of weekly) {
    const total = totals.get(row.segment_id)
    if (total) {
      total.sum += row.observed_sales_units
      total.count += 1
    }
  }
  const ordered = [...segments].sort((a, b) => {
    const first = totals.get(a)!
    const second = totals.get(b)!
    return first.sum / first.count - second.sum / second.count || a.localeCompare(b)
  })
  const position = ordered.indexOf(segmentId)
  if (position < 0) throw new Error(`Unknown region: ${segmentId}`)
  return ordered.length === 1 ? 0.5 : position / (ordered.length - 1)
}

/** Give the selected sales lines room while keeping observations and predictive bounds visible. */
export function demandAxisRange(rows: readonly DemandRow[], sizeRank: number): [number, number] {
  const values = rows.flatMap(row => [row.observed_sales_units, row.expected_sales_units.mean,
    row.predictive_sales_units.p05, row.predictive_sales_units.p95])
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const span = Math.max(maximum - minimum, Math.abs(maximum) * 0.1, 1)
  const rank = Math.max(0, Math.min(1, sizeRank))
  const lowerPadding = span * (0.2 + 0.35 * rank)
  const upperPadding = span * (0.55 - 0.35 * rank)
  return [minimum < 0 ? minimum - lowerPadding : Math.max(0, minimum - lowerPadding), maximum + upperPadding]
}
