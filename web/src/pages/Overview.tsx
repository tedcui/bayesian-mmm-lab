import { PlotChart, type PlotTrace } from '../components/PlotChart'
import { MetricCard } from '../components/MetricCard'
import { ALL_REGIONS, filterWeeks, holdoutMetrics, matchingAggregate, regionLabel,
  spendTotals, channelOrder, channelLabel, channelColor, type WeeklyFilter } from '../lib/analytics'
import { dateLabel, dollars, percent, units } from '../lib/format'
import type { ModelDataBundle } from '../types/modelData'

export function Overview({ bundle, filter }: { bundle: ModelDataBundle; filter: WeeklyFilter }) {
  const allRegions = filter.segmentId === ALL_REGIONS
  const rows = allRegions
    ? bundle.overview.all_regions_weekly.filter(row => row.week_start >= filter.startWeek && row.week_start <= filter.endWeek)
    : filterWeeks(bundle.overview.weekly, filter)
  if (!rows.length) return <div className="empty-panel" role="status">No model weeks match this view and date range.</div>
  const dates = bundle.manifest.dates
  const observed = rows.reduce((sum, row) => sum + row.observed_sales_units, 0)
  const predicted = rows.reduce((sum, row) => sum + row.expected_sales_units.mean, 0)
  const metrics = holdoutMetrics(rows)
  const spend = spendTotals(rows)
  const totalSpend = channelOrder.reduce((sum, channel) => sum + spend[channel], 0)
  const aggregate = matchingAggregate(bundle.overview.aggregates, filter,
    dates.first_week, dates.last_training_week, dates.first_holdout_week, dates.last_week)
  const x = rows.map(row => row.week_start)
  const boundaryVisible = filter.startWeek <= dates.first_holdout_week && filter.endWeek >= dates.first_holdout_week
  const boundary = boundaryVisible ? [{ type: 'line', x0: dates.first_holdout_week,
    x1: dates.first_holdout_week, yref: 'paper', y0: 0, y1: 1,
    line: { color: '#d07058', width: 2, dash: 'dot' } }] : []
  const salesTraces: PlotTrace[] = [
    { x, y: rows.map(row => row.predictive_sales_units.p05), mode: 'lines', type: 'scatter',
      line: { width: 0 }, hoverinfo: 'skip', showlegend: false },
    { x, y: rows.map(row => row.predictive_sales_units.p95), mode: 'lines', type: 'scatter',
      fill: 'tonexty', fillcolor: 'rgba(22,125,137,0.15)', line: { width: 0 },
      name: '90% predictive interval', hovertemplate: 'Upper predictive bound: %{y:,.0f} units<extra></extra>' },
    { x, y: rows.map(row => row.expected_sales_units.mean), type: 'scatter', mode: 'lines',
      name: 'Modeled expected sales', line: { color: '#167d89', width: 3 },
      hovertemplate: '%{x}<br>Expected: %{y:,.0f} units<extra></extra>' },
    { x, y: rows.map(row => row.observed_sales_units), type: 'scatter', mode: 'lines+markers',
      name: 'Observed sales', line: { color: '#26394b', width: 1.5 }, marker: { size: 4 },
      hovertemplate: '%{x}<br>Observed: %{y:,.0f} units<extra></extra>' },
  ]
  const spendTraces: PlotTrace[] = channelOrder.map(channel => ({
    x, y: rows.map(row => row.planned_spend_usd[channel]), type: 'bar',
    name: channelLabel[channel], marker: { color: channelColor[channel] },
    hovertemplate: '%{x}<br>%{y:$,.0f} planned<extra></extra>',
  }))

  return <div className="page-stack">
    <div className="section-intro"><span className="section-kicker">01 / PERFORMANCE</span>
      <h2>{regionLabel(filter.segmentId)} sales pulse</h2>
      <p>{dateLabel(filter.startWeek)}–{dateLabel(filter.endWeek)} · {rows.length} weeks</p>
    </div>
    <div className="metric-grid">
      <MetricCard label="Observed sales" value={units(observed)} sub="Units in selected weeks" />
      <MetricCard label="Modeled expected sales" value={units(predicted)} sub="Estimated units in selected weeks"
        tip="The model's average sales estimate using the spending and market conditions recorded for these weeks." />
      <MetricCard label="Holdout sales error" value={metrics ? percent(metrics.wape) : '—'}
        sub={metrics ? `${metrics.weeks} selected holdout weeks` : 'Select holdout weeks to calculate'}
        tip="Total absolute model error as a share of observed sales in the selected holdout weeks." />
      <MetricCard label="Typical weekly error" value={metrics ? units(metrics.maeUnits) : '—'}
        sub={metrics ? 'Units per selected holdout week' : 'No holdout weeks in view'}
        tip="Average weekly difference between modeled and observed sales in the selected holdout weeks." />
    </div>
    <section className="chart-card">
      <div className="card-header"><div><p className="section-kicker">SALES TRAJECTORY</p><h3>Observed vs modeled demand</h3></div>
        <span className="tiny-badge">WEEKLY · UNITS</span></div>
      <PlotChart label={`Observed sales, expected sales and 90% predictive interval for ${regionLabel(filter.segmentId)}`}
        traces={salesTraces} height={390}
        layout={{ xaxis: { title: 'Week starting Monday', type: 'date', showgrid: false },
          yaxis: { title: 'Sales units', rangemode: 'tozero', gridcolor: '#e9edf0' },
          shapes: boundary, annotations: boundaryVisible ? [{ x: dates.first_holdout_week, y: 1.02,
            yref: 'paper', text: 'HOLDOUT START', showarrow: false, font: { size: 10, color: '#b05b47' } }] : [] }} />
      <p className="chart-caption">The shaded area is a <strong>90% predictive interval</strong> for weekly sales{allRegions ? ' across all regions' : ''}. The line shows modeled average sales. Holdout results use spending and market conditions recorded for those weeks, so they are a look back, not a future forecast. {boundaryVisible && `The dotted line marks the start of the holdout period, ${dateLabel(dates.first_holdout_week)}.`}</p>
    </section>
    <div className="two-column">
      <section className="chart-card"><div className="card-header"><div><p className="section-kicker">PLANNED INPUTS</p><h3>Marketing spend</h3></div><span className="tiny-badge">USD</span></div>
        <PlotChart label={`Weekly planned channel spend for ${regionLabel(filter.segmentId)}`}
          traces={spendTraces} height={300} layout={{ barmode: 'stack',
            xaxis: { title: 'Week starting Monday', type: 'date', showgrid: false },
            yaxis: { title: 'Planned spend (USD)', rangemode: 'tozero', gridcolor: '#e9edf0' } }} />
        <p className="chart-caption">Planned channel spending. Coupon redemptions and register discounts are not counted as planned spend.</p>
      </section>
      <section className="detail-card"><p className="section-kicker">SELECTED WINDOW</p><h3>Channel allocation</h3>
        <div className="spend-total">{dollars(totalSpend)}<small>Total planned spend</small></div>
        {channelOrder.map(channel => <div className="allocation-row" key={channel}>
          <div className="allocation-label"><span className="legend-dot" style={{ background: channelColor[channel] }} />
            {channelLabel[channel]}<strong>{dollars(spend[channel])}</strong></div>
          <div className="allocation-track"><span style={{ width: `${totalSpend ? spend[channel] / totalSpend * 100 : 0}%`, background: channelColor[channel] }} /></div>
        </div>)}
        <div className="detail-rule" />
        {aggregate ? <p className="detail-note">Estimated total sales: <strong>90% credible interval</strong> of {units(aggregate.expected_sales_units.p05)}–{units(aggregate.expected_sales_units.p95)} units.</p>
          : <p className="detail-note">A total interval is available for the All weeks, Training, and Holdout ranges.</p>}
      </section>
    </div>
  </div>
}
