// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import manifest from '../../public/model-data/manifest.json'
import overview from '../../public/model-data/overview.json'
import contributions from '../../public/model-data/contributions.json'
import segments from '../../public/model-data/segments.json'
import simulator from '../../public/model-data/simulator.json'
import { App } from '../app/App'
import { loadModelData, validateModelDataBundle } from '../lib/data'
import { ALL_REGIONS, filterWeeks, holdoutMetrics } from '../lib/analytics'
import { percent, units } from '../lib/format'

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
  window.location.hash = '#/overview'
  loadMock.mockReset()
  loadMock.mockResolvedValue(bundle)
})
afterEach(() => cleanup())

describe('M5 analytical UI', () => {
  it('loads the dashboard, explains intervals and updates region/date filters', async () => {
    render(<App />)
    expect(screen.getByRole('status').textContent).toContain('Loading dashboard')
    await screen.findByRole('heading', { name: 'Observed vs modeled demand' })
    expect((screen.getByLabelText('Business region') as HTMLSelectElement).value).toBe(ALL_REGIONS)
    expect(screen.getByText((_, element) => element?.className === 'chart-caption' &&
      (element.textContent?.includes('90% predictive interval') ?? false))).toBeTruthy()
    expect(screen.getByText(/Regions are defined by store geography/)).toBeTruthy()
    expect(screen.getByText(/Credible intervals show uncertainty/)).toBeTruthy()
    expect(screen.queryByText(/m4-2|verified export|bundle [0-9a-f]/i)).toBeNull()
    expect(screen.getByRole('button', { name: /All weeks/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /Holdout · weeks 101–120/ }))
    expect((screen.getByLabelText('From week') as HTMLSelectElement).value).toBe(manifest.dates.first_holdout_week)
    expect(screen.getByRole('button', { name: /Holdout · weeks 101–120/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /Training · weeks 1–100/ }))
    expect((screen.getByLabelText('Through week') as HTMLSelectElement).value).toBe(manifest.dates.last_training_week)
    fireEvent.change(screen.getByLabelText('From week'), { target: { value: bundle.overview.weekly[1].week_start } })
    expect(screen.getByRole('button', { name: /Training · weeks 1–100/ }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: /All weeks/ }))

    fireEvent.change(screen.getByLabelText('Business region'), { target: { value: 'mountain_west' } })
    fireEvent.change(screen.getByLabelText('From week'), { target: { value: manifest.dates.first_holdout_week } })
    expect(screen.getByText(/Mountain West sales pulse/)).toBeTruthy()
    expect(screen.getByText(/20 weeks/)).toBeTruthy()
    const rows = filterWeeks(bundle.overview.weekly, { segmentId: 'mountain_west',
      startWeek: manifest.dates.first_holdout_week, endWeek: manifest.dates.last_week })
    expect(screen.getByText(percent(holdoutMetrics(rows)!.wape))).toBeTruthy()
  })

  it('navigates to decomposition and compares three models without diagnostic controls', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Observed vs modeled demand' })
    fireEvent.click(screen.getByRole('link', { name: /Decomposition/ }))
    await screen.findByRole('heading', { name: 'What contributes to expected sales' })
    expect(screen.getByText((_, element) => element?.className === 'chart-caption' &&
      (element.textContent?.includes("this channel's modeled weekly contribution") ?? false))).toBeTruthy()
    expect(screen.getAllByText(/not proven causal lift/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('link', { name: /Region comparison/ }))
    await screen.findByRole('heading', { name: 'How model estimates compare' })
    fireEvent.click(screen.getByRole('link', { name: 'Skip to main content' }))
    expect(window.location.hash).toBe('#/segments')
    expect(document.activeElement?.id).toBe('main-content')
    expect(screen.getAllByText('Complete pooling').length).toBeGreaterThan(0)
    expect(screen.getAllByText('No pooling').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Partial pooling').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Max R-hat|Known effects in 90% interval/)).toBeNull()
    expect(screen.queryByLabelText(/Show known synthetic truth/)).toBeNull()
  })

  it('defaults to all-region totals with draw-first weekly intervals', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Observed vs modeled demand' })
    expect(screen.getByText('All regions sales pulse')).toBeTruthy()
    expect(screen.getByText(units(bundle.overview.aggregates[0].observed_sales_units))).toBeTruthy()
    expect(screen.getByRole('img', { name: /90% predictive interval for All regions/ })).toBeTruthy()
    expect(screen.getByText(/Estimated total sales:/)).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: /Decomposition/ }))
    await screen.findByRole('heading', { name: 'What contributes to expected sales' })
    expect(screen.getByRole('img', { name: /All regions with 90% credible interval/ })).toBeTruthy()
    expect(screen.getByText((_, element) => element?.className === 'chart-caption' &&
      (element.textContent?.includes("this channel's modeled weekly contribution") ?? false))).toBeTruthy()
    fireEvent.change(screen.getByLabelText('From week'),
      { target: { value: manifest.dates.first_holdout_week } })
    expect(screen.getByText(/Coupons total: 90% credible interval/)).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: /Region comparison/ }))
    await screen.findByRole('heading', { name: 'How model estimates compare' })
    expect((screen.getByLabelText('Business region') as HTMLSelectElement).value)
      .toBe(bundle.manifest.segments[0])
    expect(screen.queryByRole('option', { name: 'All regions' })).toBeNull()
  })

  it('shows load failure and succeeds on retry', async () => {
    loadMock.mockRejectedValueOnce(new Error('overview.json: SHA-256 differs from manifest'))
    render(<App />)
    await screen.findByRole('alert')
    expect(screen.getByText(/Please try again/)).toBeTruthy()
    expect(screen.getByText(/SHA-256 differs/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Observed vs modeled demand' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Observed vs modeled demand' })).toBeTruthy())
  })
})
