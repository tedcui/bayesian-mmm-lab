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
  { id: 'segments', label: 'Segment comparison', detail: 'Pooling effects' },
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

  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={event => {
      event.preventDefault()
      document.getElementById('main-content')?.focus()
    }}>Skip to main content</a>
    <aside className="sidebar" aria-label="Main navigation">
      <div className="brand">
        <div className="brand-symbol" aria-hidden="true"><span /><span /><span /></div>
        <div><strong>Bayesian MMM</strong><small>DECISION LAB</small></div>
      </div>
      <div className="sidebar-section">ANALYSIS</div>
      <nav aria-label="Analytical pages">
        {nav.map((item, index) => <a key={item.id} href={`#/${item.id}`}
          className={`nav-link ${page === item.id ? 'active' : ''}`}
          aria-current={page === item.id ? 'page' : undefined}>
          <span className="nav-index">0{index + 1}</span>
          <span><strong>{item.label}</strong><small>{item.detail}</small></span>
        </a>)}
      </nav>
      <div className="sidebar-footer">
        <span className="status-dot" /> Fitted model export
        <p>Synthetic retail data. Estimates depend on the model and its assumptions.</p>
      </div>
    </aside>

    <div className="content-shell">
      <header className="topbar">
        <div className="breadcrumb">ANALYSIS <span>/</span> {selected.label.toUpperCase()}</div>
        <div className="topbar-pill">SYNTHETIC DATA <span>·</span> ILLUSTRATIVE RESULTS</div>
      </header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        {loading && <div className="state-panel" role="status"><div className="loading-ring" />
          <h1>Loading validated model results</h1><p>Checking the versioned export bundle and its file hashes.</p></div>}
        {!loading && error && <div className="state-panel" role="alert">
          <h1>Model results are unavailable</h1>
          <p>The export bundle could not be loaded or validated: {error}</p>
          <button className="primary-button" type="button" onClick={() => { setLoading(true); setError(null); setAttempt(v => v + 1) }}>Retry loading</button>
        </div>}
        {!loading && bundle && filter && <>
          <div className="page-heading">
            <div><p className="eyebrow">MODEL ANALYSIS <span> / </span> M4 EXPORT</p>
              <h1>{selected.label}</h1>
              <p className="lead">{page === 'overview' ? 'Observed demand and model predictions across the retail calendar.'
                : page === 'decomposition' ? 'How the fitted reference model allocates expected units across baseline and planned channels.'
                  : page === 'segments' ? 'How complete, independent, and hierarchical pooling estimate channel response.'
                    : 'Replay a 12-week planned-spend alternative using paired fitted posterior draws.'}</p></div>
            <div className="export-badge"><span className="status-dot" /> VERIFIED EXPORT <small>{bundle.manifest.schema_version}</small></div>
          </div>
          <section className="filter-panel" aria-label="Analysis filters">
            <div className="filter-heading"><strong>VIEW CONTROLS</strong><span>{page === 'segments' ? 'Region focus · fitted on weeks 1–100' : page === 'simulator' ? 'Region focus · fixed 12-week replay' : 'Select a region and calendar window'}</span></div>
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
                <label>Through week<select aria-label="Through week" value={filter.endWeek}
                  onChange={event => setFilter({ ...filter, endWeek: event.target.value,
                    startWeek: event.target.value < filter.startWeek ? event.target.value : filter.startWeek })}>
                  {weeks.map(week => <option key={week} value={week}>{dateLabel(week)}</option>)}
                </select></label>
              </>}
              <div className="filter-meta"><span>REFERENCE FIT</span><strong>Hierarchical partial pooling</strong></div>
            </div>
            {page === 'segments' && <p className="filter-note">The region selector highlights a comparison row. Channel effects are fitted over the fixed training window, so changing a weekly date range cannot refit them.</p>}
            {page === 'simulator' && <p className="filter-note">The replay uses the exported final 12 holdout weeks. Region changes reset the spending controls and budget search.</p>}
          </section>
          {page === 'overview' && <Overview bundle={bundle} filter={displayFilter!} />}
          {page === 'decomposition' && <Decomposition bundle={bundle} filter={displayFilter!} />}
          {page === 'segments' && <Segments bundle={bundle} filter={filter} />}
          {page === 'simulator' && <Simulator key={filter.segmentId} bundle={bundle} segmentId={filter.segmentId} />}
          <footer className="page-footer">
            <p>{bundle.manifest.disclosure}. Six segments are business-defined regions from store geography, not clustering output.</p>
            <p>Holdout scenarios are conditional historical replays, not prospective forecasts. Channel contributions are model-based and not experimentally identified causal lift. The partial-pooling model covered {bundle.segments.effects.filter(effect => effect.pooling === 'partial' && effect.interval_contains_truth).length}/{bundle.segments.effects.filter(effect => effect.pooling === 'partial').length} known synthetic effects in 90% intervals, versus {bundle.segments.effects.filter(effect => effect.pooling === 'none' && effect.interval_contains_truth).length}/{bundle.segments.effects.filter(effect => effect.pooling === 'none').length} for no pooling.</p>
            <p>90% credible intervals describe fitted expected outcomes or effects; 90% predictive intervals also include modeled observation noise.</p>
            <p>Version {bundle.manifest.schema_version} · Bundle {bundle.manifest.bundle_id.slice(0, 12)} · Model intervals use fitted synthetic data.</p>
          </footer>
        </>}
      </main>
    </div>
  </div>
}
