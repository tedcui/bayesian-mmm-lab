// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import manifest from '../../public/model-data/manifest.json'
import overview from '../../public/model-data/overview.json'
import contributions from '../../public/model-data/contributions.json'
import segments from '../../public/model-data/segments.json'
import simulator from '../../public/model-data/simulator.json'
import fixture from './fixtures/scenario_parity.json'
import { App } from '../app/App'
import { channelColor } from '../lib/analytics'
import { loadModelData, validateModelDataBundle } from '../lib/data'
import { dollars, units } from '../lib/format'

vi.mock('../lib/data', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/data')>(),
  loadModelData: vi.fn(),
}))
vi.mock('../components/PlotChart', () => ({
  PlotChart: ({ label, traces, layout }: { label: string; traces: unknown[]; layout: unknown }) =>
    <div role="img" aria-label={label} data-traces={JSON.stringify(traces)} data-layout={JSON.stringify(layout)} />,
}))
const bundle = validateModelDataBundle({ manifest, overview, contributions, segments, simulator })
const loadMock = vi.mocked(loadModelData)
beforeEach(() => {
  window.location.hash = '#/simulator'
  loadMock.mockReset()
  loadMock.mockResolvedValue(bundle)
})
afterEach(() => cleanup())

describe('M6B simulator UI', () => {
  it('resets to exact zero, scales one weekly channel, and agrees with the Python parity fixture', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Adjust planned spend' })
    expect(screen.queryByLabelText('From week')).toBeNull()
    expect(screen.getByText(/This is a historical scenario, not a future forecast/i)).toBeTruthy()
    const caseRow = fixture.cases.find(row => row.segment_id === 'northeast')!
    const coupon = screen.getByRole('slider', { name: /Coupons/ })
    const retailer = screen.getByRole('slider', { name: /Retailer promotions/ })
    const digital = screen.getByRole('slider', { name: /Digital advertising/ })
    expect(coupon.getAttribute('value')).toBe('100')
    const comparisonChart = screen.getByRole('img', { name: /Expected sales and three marketing channel contributions/ })
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(comparisonChart.getAttribute('data-layout')).toContain('"overlaying":"y"')
    expect(JSON.parse(comparisonChart.getAttribute('data-traces')!)).toHaveLength(4)
    expect(screen.getAllByText(dollars(caseRow.baseline_spend_usd.total)).length).toBeGreaterThan(0)
    fireEvent.change(coupon, { target: { value: '125' } })
    expect(screen.getByRole('slider', { name: /Retailer promotions/ }).getAttribute('value')).toBe('100')
    expect(screen.getByRole('slider', { name: /Digital advertising/ }).getAttribute('value')).toBe('100')
    expect(screen.getByText(dollars(caseRow.baseline_spend_usd.total +
      caseRow.baseline_spend_usd.by_channel.coupon * 0.25))).toBeTruthy()
    fireEvent.change(retailer, { target: { value: '75' } })
    fireEvent.change(digital, { target: { value: '110' } })
    const traces = JSON.parse(comparisonChart.getAttribute('data-traces')!) as {
      name: string; y: number[]; yaxis?: string; marker: { color: string | string[] };
      error_y: { array: number[]; arrayminus: number[] }
    }[]
    expect(traces.map(trace => trace.name)).toEqual([
      'Baseline plan', 'Baseline plan', 'Alternative plan', 'Alternative plan',
    ])
    expect(traces.every(trace => !('text' in trace))).toBe(true)
    expect(traces[0].marker.color).toBe('#708a91')
    expect(traces[2].marker.color).toBe('#176d70')
    expect(traces[1].marker.color).toEqual(['#678f91', '#b39a88', '#a0adb0'])
    expect(traces[3].marker.color).toEqual(bundle.manifest.channels.map(channel => channelColor[channel]))
    expect(traces[0].y[0]).toBeCloseTo(caseRow.summary.baseline_expected_units.mean, 6)
    expect(traces[2].y[0]).toBeCloseTo(caseRow.summary.alternative_expected_units.mean, 6)
    for (const [index, key] of [[0, 'baseline_expected_units'], [2, 'alternative_expected_units']] as const) {
      const expected = caseRow.summary[key]
      expect(traces[index].error_y.array[0]).toBeCloseTo(expected.p95 - expected.mean, 6)
      expect(traces[index].error_y.arrayminus[0]).toBeCloseTo(expected.mean - expected.p05, 6)
    }
    for (const [traceIndex, key] of [[1, 'baseline_channel_units'], [3, 'alternative_channel_units']] as const) {
      const trace = traces[traceIndex]
      expect(trace.yaxis).toBe('y2')
      bundle.manifest.channels.forEach((channel, index) => {
        const expected = caseRow.summary[key][channel]
        expect(trace.y[index]).toBeCloseTo(expected.mean, 6)
        expect(trace.error_y.array[index]).toBeCloseTo(expected.p95 - expected.mean, 6)
        expect(trace.error_y.arrayminus[index]).toBeCloseTo(expected.mean - expected.p05, 6)
      })
    }
    expect(screen.getByText(`${caseRow.summary.incremental_expected_units.mean > 0 ? '+' : ''}${units(caseRow.summary.incremental_expected_units.mean)}`)).toBeTruthy()
    expect(screen.getByText(dollars(caseRow.alternative_spend_usd.total))).toBeTruthy()
    expect(screen.getByText(/Outside the observed spending range/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reset to baseline' }))
    expect(screen.getByRole('slider', { name: /Coupons/ }).getAttribute('value')).toBe('100')
    expect(screen.getByText('0', { selector: '.metric-value' })).toBeTruthy()
  })

  it('reports infeasible budgets, finds a feasible allocation, and resets on region change', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Allocate one 12-week budget' })
    const input = screen.getByLabelText(/Total planned budget/)
    fireEvent.change(input, { target: { value: '999999999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find allocation' }))
    expect(screen.getByText(/Cannot allocate this budget/)).toBeTruthy()
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find allocation' }))
    expect(screen.getByText('Suggested allocation')).toBeTruthy()
    expect(screen.getByText(/Allocated \$0 across 12 weeks/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply to controls' }))
    expect(screen.getByRole('slider', { name: /Coupons/ }).getAttribute('value')).toBe('0')
    expect(screen.getAllByText('$0').length).toBeGreaterThan(0)
    fireEvent.change(screen.getByLabelText('Business region'), { target: { value: 'mountain_west' } })
    expect(screen.getByRole('slider', { name: /Coupons/ }).getAttribute('value')).toBe('100')
    expect(screen.queryByText('Suggested allocation')).toBeNull()
  })
})
