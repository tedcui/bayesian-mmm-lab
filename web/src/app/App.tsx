import { useEffect, useState } from 'react'
import { loadModelData } from '../lib/data'
import { ALL_REGIONS, regionLabel, type WeeklyFilter } from '../lib/analytics'
import { dateLabel } from '../lib/format'
import { Overview } from '../pages/Overview'
import { Decomposition } from '../pages/Decomposition'
import { Segments } from '../pages/Segments'
import { Simulator } from '../pages/Simulator'
import type { ModelDataBundle } from '../types/modelData'

type Page = 'overview' | 'decomposition' | 'segments' | 'simulator'
const nav: { id: Page; label: string; detail: string }[] = [
  { id: 'overview', label: 'Overview', detail: 'Sales & spend' },
  { id: 'decomposition', label: 'Decomposition', detail: 'Modeled drivers' },
  { id: 'segments', label: 'Region comparison', detail: 'Compare estimates' },
  { id: 'simulator', label: 'Decision simulator', detail: '12-week replay' },
]

function pageFromHash(): Page {
  const value = window.location.hash.replace(/^#\/?/, '')
  return nav.find(item => item.id === value)?.id ?? 'overview'
}

export function App() {
  const [bundle, setBundle] = useState<ModelDataBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [page, setPage] = useState<Page>(pageFromHash)
  const [filter, setFilter] = useState<WeeklyFilter | null>(null)
  const [allRegions, setAllRegions] = useState(true)

  useEffect(() => {
    const update = () => setPage(pageFromHash())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])

  useEffect(() => {
    let active = true
    loadModelData().then(data => {
      if (!active) return
      setBundle(data)
      setFilter({ segmentId: data.manifest.segments[0], startWeek: data.manifest.dates.first_week,
        endWeek: data.manifest.dates.last_week })
      setError(null)
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Unknown data loading error')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [attempt])

  const weeks = bundle ? bundle.overview.weekly
    .filter(row => row.segment_id === bundle.manifest.segments[0]).map(row => row.week_start) : []
  const selected = nav.find(item => item.id === page)!
  const regionalAnalysis = page === 'overview' || page === 'decomposition'
  const displayFilter = filter && allRegions && regionalAnalysis
    ? { ...filter, segmentId: ALL_REGIONS } : filter
  const activePeriod = filter && bundle
    ? filter.startWeek === bundle.manifest.dates.first_week && filter.endWeek === bundle.manifest.dates.last_week ? 'all'
      : filter.startWeek === bundle.manifest.dates.first_week && filter.endWeek === bundle.manifest.dates.last_training_week ? 'training'
        : filter.startWeek === bundle.manifest.dates.first_holdout_week && filter.endWeek === bundle.manifest.dates.last_week ? 'holdout' : 'custom'
    : 'custom'

  return <div className="app-shell editorial-theme">
    <a className="skip-link" href="#main-content" onClick={event => {
      event.preventDefault()
      document.getElementById('main-content')?.focus()
    }}>Skip to main content</a>
    <header className="site-header">
      <div className="brand"><span className="brand-mark" aria-hidden="true">M</span><span>THE MIX <i>/</i> LAB</span></div>
      <nav aria-label="Analytical pages">
        {nav.map(item => <a key={item.id} href={`#/${item.id}`}
          className={`nav-link ${page === item.id ? 'active' : ''}`}
          aria-current={page === item.id ? 'page' : undefined}>
          {item.label}
        </a>)}
      </nav>
      <div className="site-disclosure">SYNTHETIC DATA</div>
    </header>

    <div className="content-shell">
      <main id="main-content" className="main-content" tabIndex={-1}>
        {loading && <div className="state-panel" role="status"><div className="loading-ring" />
          <h1>Loading dashboard</h1><p>Preparing sales and marketing results.</p></div>}
        {!loading && error && <div className="state-panel" role="alert">
          <h1>Dashboard data is unavailable</h1>
          <p>Please check your connection and try again.</p>
          <button className="primary-button" type="button" onClick={() => { setLoading(true); setError(null); setAttempt(v => v + 1) }}>Retry loading</button>
        </div>}
        {!loading && bundle && filter && <>
          <div className="page-heading">
            <div><p className="eyebrow">SYNTHETIC RETAIL <span> / </span> {selected.label.toUpperCase()}</p>
              <h1>{page === 'overview' ? 'What shaped sales?' : selected.label}</h1>
              <p className="lead">{page === 'overview' ? 'Observed demand and model predictions across the retail calendar.'
                : page === 'decomposition' ? 'See how the model divides expected sales among baseline demand and marketing channels.'
                  : page === 'segments' ? 'Compare estimated marketing effects across regions and models.'
                    : 'Explore how a 12-week marketing plan could change modeled sales.'}</p></div>
          </div>
          <section className="filter-panel" aria-label="Analysis filters">
            <div className="filter-heading"><strong>VIEW CONTROLS</strong><span>{page === 'segments' ? 'Choose a region to highlight' : page === 'simulator' ? 'Choose a region for the 12-week scenario' : 'Select a region and calendar window'}</span></div>
            <div className="filter-grid">
              <label>Business region<select aria-label="Business region" value={displayFilter!.segmentId}
                onChange={event => {
                  if (event.target.value === ALL_REGIONS) setAllRegions(true)
                  else { setAllRegions(false); setFilter({ ...filter, segmentId: event.target.value }) }
                }}>
                {regionalAnalysis && <option value={ALL_REGIONS}>All regions</option>}
                {bundle.manifest.segments.map(id => <option value={id} key={id}>{regionLabel(id)}</option>)}
              </select></label>
              {page !== 'segments' && page !== 'simulator' && <>
                <label>From week<select aria-label="From week" value={filter.startWeek}
                  onChange={event => setFilter({ ...filter, startWeek: event.target.value,
                    endWeek: event.target.value > filter.endWeek ? event.target.value : filter.endWeek })}>
                  {weeks.map(week => <option key={week} value={week}>{dateLabel(week)}</option>)}
                </select></label>
                <label>Through week (inclusive)<select aria-label="Through week" value={filter.endWeek}
                  onChange={event => setFilter({ ...filter, endWeek: event.target.value,
                    startWeek: event.target.value < filter.startWeek ? event.target.value : filter.startWeek })}>
                  {weeks.map(week => <option key={week} value={week}>{dateLabel(week)}</option>)}
                </select></label>
              </>}
              <div className="filter-meta"><span>MODEL USED FOR RESULTS</span><strong>Hierarchical partial pooling</strong></div>
            </div>
            {regionalAnalysis && <div className="period-presets" role="group" aria-label="Quick date ranges">
              <span>QUICK RANGE</span>
              {([
                ['all', 'All weeks', bundle.manifest.dates.first_week, bundle.manifest.dates.last_week],
                ['training', 'Training · weeks 1–100', bundle.manifest.dates.first_week, bundle.manifest.dates.last_training_week],
                ['holdout', 'Holdout · weeks 101–120', bundle.manifest.dates.first_holdout_week, bundle.manifest.dates.last_week],
              ] as const).map(([id, label, startWeek, endWeek]) => <button key={id} type="button"
                aria-pressed={activePeriod === id} onClick={() => setFilter({ ...filter, startWeek, endWeek })}>
                {label}</button>)}
            </div>}
            {page === 'segments' && <p className="filter-note">The selected region is highlighted below.</p>}
            {page === 'simulator' && <p className="filter-note">Explore the last 12 weeks for one region at a time. Changing regions resets the spending controls.</p>}
          </section>
          {page === 'overview' && <Overview bundle={bundle} filter={displayFilter!} />}
          {page === 'decomposition' && <Decomposition bundle={bundle} filter={displayFilter!} />}
          {page === 'segments' && <Segments bundle={bundle} filter={filter} />}
          {page === 'simulator' && <Simulator key={filter.segmentId} bundle={bundle} segmentId={filter.segmentId} />}
          <footer className="page-footer">
            <p>{bundle.manifest.disclosure}. Regions are defined by store geography.</p>
            <p>Marketing contributions are model estimates, not proven causal lift. Scenarios replay past conditions; they are not future forecasts.</p>
            <p>Credible intervals show uncertainty in modeled averages. Predictive intervals also include sales variability.</p>
          </footer>
        </>}
      </main>
    </div>
  </div>
}
