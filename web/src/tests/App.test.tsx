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
  it('loads the verified export, shows precise interval labels and updates region/date filters', async () => {
    render(<App />)
    expect(screen.getByRole('status').textContent).toContain('Loading validated model results')
    await screen.findByRole('heading', { name: 'Observed vs modeled demand' })
    expect((screen.getByLabelText('Business region') as HTMLSelectElement).value).toBe(ALL_REGIONS)
    expect(screen.getByText((_, element) => element?.tagName === 'P' &&
      (element.textContent?.includes('90% predictive interval includes modeled observation noise') ?? false))).toBeTruthy()
    expect(screen.getByText(/business-defined regions from store geography/)).toBeTruthy()
    expect(screen.getByText(/90% credible intervals describe fitted expected outcomes/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Business region'), { target: { value: 'mountain_west' } })
    fireEvent.change(screen.getByLabelText('From week'), { target: { value: manifest.dates.first_holdout_week } })
    expect(screen.getByText(/Mountain West sales pulse/)).toBeTruthy()
    expect(screen.getByText(/20 Monday-start weeks/)).toBeTruthy()
    const rows = filterWeeks(bundle.overview.weekly, { segmentId: 'mountain_west',
      startWeek: manifest.dates.first_holdout_week, endWeek: manifest.dates.last_week })
    expect(screen.getByText(percent(holdoutMetrics(rows)!.wape))).toBeTruthy()
  })

  it('navigates to decomposition and compares three fitted models with optional truth', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Observed vs modeled demand' })
    fireEvent.click(screen.getByRole('link', { name: /Decomposition/ }))
    await screen.findByRole('heading', { name: 'Where expected units are assigned' })
    expect(screen.getByText(/90% credible interval for each week's expected channel contribution/)).toBeTruthy()
    expect(screen.getByText(/not experimentally established causal lift/)).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: /Segment comparison/ }))
    await screen.findByRole('heading', { name: 'What pooling changes' })
    fireEvent.click(screen.getByRole('link', { name: 'Skip to main content' }))
    expect(window.location.hash).toBe('#/segments')
    expect(document.activeElement?.id).toBe('main-content')
    expect(screen.getAllByText('Complete pooling').length).toBeGreaterThan(0)
    expect(screen.getAllByText('No pooling').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Partial pooling').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Known synthetic truth:/)).toBeNull()
    fireEvent.click(screen.getByLabelText(/Show known synthetic truth/))
    expect(screen.getByText(/Known synthetic truth:/)).toBeTruthy()
  })

  it('defaults to all-region totals with draw-first weekly intervals', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Observed vs modeled demand' })
    expect(screen.getByText('All regions sales pulse')).toBeTruthy()
    expect(screen.getByText(units(bundle.overview.aggregates[0].observed_sales_units))).toBeTruthy()
    expect(screen.getByRole('img', { name: /90% predictive interval for All regions/ })).toBeTruthy()
    expect(screen.getByText(/summed across six regions within each joint posterior draw/)).toBeTruthy()
    expect(screen.getByText(/For this exact all period/)).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: /Decomposition/ }))
    await screen.findByRole('heading', { name: 'Where expected units are assigned' })
    expect(screen.getByRole('img', { name: /All regions with 90% credible interval/ })).toBeTruthy()
    expect(screen.getByText(/90% credible interval for each week's expected channel contribution/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('From week'),
      { target: { value: manifest.dates.first_holdout_week } })
    expect(screen.getByText(/For this exact holdout period/)).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: /Segment comparison/ }))
    await screen.findByRole('heading', { name: 'What pooling changes' })
    expect((screen.getByLabelText('Business region') as HTMLSelectElement).value)
      .toBe(bundle.manifest.segments[0])
    expect(screen.queryByRole('option', { name: 'All regions' })).toBeNull()
  })

  it('shows load failure and succeeds on retry', async () => {
    loadMock.mockRejectedValueOnce(new Error('overview.json: SHA-256 differs from manifest'))
    render(<App />)
    await screen.findByRole('alert')
    expect(screen.getByText(/SHA-256 differs/)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Observed vs modeled demand' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Observed vs modeled demand' })).toBeTruthy())
  })
})
