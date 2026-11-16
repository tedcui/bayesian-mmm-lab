import { describe, expect, it } from 'vitest'
import manifest from '../../public/model-data/manifest.json'
import overview from '../../public/model-data/overview.json'
import { demandAxisRange, regionSizeRank } from '../lib/chartAxis'
import type { OverviewWeek } from '../types/modelData'

const weekly = overview.weekly as unknown as OverviewWeek[]
const allRegions = overview.all_regions_weekly as unknown as OverviewWeek[]

function assertVisible(rows: OverviewWeek[], range: [number, number]) {
  for (const row of rows) {
    expect(range[0]).toBeLessThan(row.predictive_sales_units.p05)
    expect(range[0]).toBeLessThan(row.observed_sales_units)
    expect(range[0]).toBeLessThan(row.expected_sales_units.mean)
    expect(range[1]).toBeGreaterThan(row.predictive_sales_units.p95)
    expect(range[1]).toBeGreaterThan(row.observed_sales_units)
    expect(range[1]).toBeGreaterThan(row.expected_sales_units.mean)
  }
}

function centerPosition(rows: OverviewWeek[], range: [number, number]): number {
  const values = rows.flatMap(row => [row.observed_sales_units, row.expected_sales_units.mean,
    row.predictive_sales_units.p05, row.predictive_sales_units.p95])
  return ((Math.min(...values) + Math.max(...values)) / 2 - range[0]) / (range[1] - range[0])
}

describe('sales chart axis', () => {
  it('gives large regions more space below and small regions more space above', () => {
    const northeast = weekly.filter(row => row.segment_id === 'northeast')
    const pacific = weekly.filter(row => row.segment_id === 'pacific_coast')
    const allRange = demandAxisRange(allRegions, regionSizeRank(weekly, manifest.segments, null))
    const largeRange = demandAxisRange(northeast, regionSizeRank(weekly, manifest.segments, 'northeast'))
    const smallRange = demandAxisRange(pacific, regionSizeRank(weekly, manifest.segments, 'pacific_coast'))
    assertVisible(allRegions, allRange)
    assertVisible(northeast, largeRange)
    assertVisible(pacific, smallRange)
    expect(centerPosition(allRegions, allRange)).toBeGreaterThan(0.55)
    expect(centerPosition(northeast, largeRange)).toBeGreaterThan(0.55)
    expect(centerPosition(pacific, smallRange)).toBeLessThan(0.45)
  })

  it('recalculates the range for selected weeks', () => {
    const fullRange = demandAxisRange(allRegions, 1)
    const holdoutRange = demandAxisRange(allRegions.slice(-20), 1)
    assertVisible(allRegions.slice(-20), holdoutRange)
    expect(holdoutRange).not.toEqual(fullRange)
  })
})
