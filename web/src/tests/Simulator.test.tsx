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
import { loadModelData, validateModelDataBundle } from '../lib/data'
import { dollars, units } from '../lib/format'

vi.mock('../lib/data', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/data')>(),
  loadModelData: vi.fn(),
}))
vi.mock('../components/PlotChart', () => ({
  PlotChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
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
    expect(screen.getAllByText(dollars(caseRow.baseline_spend_usd.total)).length).toBeGreaterThan(0)
    fireEvent.change(coupon, { target: { value: '125' } })
    expect(screen.getByRole('slider', { name: /Retailer promotions/ }).getAttribute('value')).toBe('100')
    expect(screen.getByRole('slider', { name: /Digital advertising/ }).getAttribute('value')).toBe('100')
    expect(screen.getByText(dollars(caseRow.baseline_spend_usd.total +
      caseRow.baseline_spend_usd.by_channel.coupon * 0.25))).toBeTruthy()
    fireEvent.change(retailer, { target: { value: '75' } })
    fireEvent.change(digital, { target: { value: '110' } })
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
