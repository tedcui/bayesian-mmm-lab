import { describe, expect, it, vi } from 'vitest'
import manifest from '../../public/model-data/manifest.json'
import overview from '../../public/model-data/overview.json'
import contributions from '../../public/model-data/contributions.json'
import segments from '../../public/model-data/segments.json'
import simulator from '../../public/model-data/simulator.json'
import { loadModelData, validateModelDataBundle } from '../lib/data'

const files = { manifest, overview, contributions, segments, simulator }
const copy = (): unknown => structuredClone(files)

describe('M4 static export contract', () => {
  it('requests the current manifest and payloads after a release', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => manifest })
      .mockResolvedValue({ ok: false, status: 503 })
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(loadModelData('/bayesian-mmm-lab/model-data/')).rejects.toThrow(/HTTP 503/)
      expect(fetchMock).toHaveBeenCalledTimes(5)
      for (const [, options] of fetchMock.mock.calls) {
        expect(options).toEqual({ cache: 'no-store' })
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('accepts the actual fitted-model exports', () => {
    const bundle = validateModelDataBundle(copy())
    expect(bundle.overview.weekly).toHaveLength(720)
    expect(bundle.contributions.weekly).toHaveLength(720)
    expect(bundle.overview.all_regions_weekly).toHaveLength(120)
    expect(bundle.contributions.all_regions_weekly).toHaveLength(120)
    expect(bundle.segments.effects).toHaveLength(54)
    expect(bundle.simulator.draws).toHaveLength(96)
  })

  it('rejects mixed versions, wrong units and misaligned segments', () => {
    const wrongVersion = copy() as typeof files
    wrongVersion.contributions.bundle_id = '0'.repeat(64)
    expect(() => validateModelDataBundle(wrongVersion)).toThrow(/bundle_id/)

    const wrongUnits = copy() as typeof files
    wrongUnits.manifest.units.planned_spend = 'thousands of USD'
    expect(() => validateModelDataBundle(wrongUnits)).toThrow(/planned_spend/)

    const wrongSegment = copy() as typeof files
    wrongSegment.simulator.segment_order[0] = 'other'
    expect(() => validateModelDataBundle(wrongSegment)).toThrow(/segment_order/)
  })

  it('rejects invalid numbers, broken reconciliation and duplicate draws', () => {
    const invalid = copy() as typeof files
    invalid.overview.weekly[0].expected_sales_units.mean = Number.NaN
    expect(() => validateModelDataBundle(invalid)).toThrow(/finite number/)

    const broken = copy() as typeof files
    broken.contributions.weekly[0].channels_units.coupon.mean += 5
    expect(() => validateModelDataBundle(broken)).toThrow(/component means/)

    const duplicate = copy() as typeof files
    duplicate.simulator.draws[1].joint_draw_index = duplicate.simulator.draws[0].joint_draw_index
    expect(() => validateModelDataBundle(duplicate)).toThrow(/duplicate joint draw/)

    const wrongAllRegions = copy() as typeof files
    wrongAllRegions.overview.all_regions_weekly[0].observed_sales_units += 1
    expect(() => validateModelDataBundle(wrongAllRegions)).toThrow(/observed_sales_units/)

    const wrongInterval = copy() as typeof files
    wrongInterval.contributions.all_regions_weekly[0].channels_units.coupon.p05 =
      wrongInterval.contributions.all_regions_weekly[0].channels_units.coupon.p95 + 1
    expect(() => validateModelDataBundle(wrongInterval)).toThrow(/quantiles out of order/)
  })
})
