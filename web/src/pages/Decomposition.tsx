import { useState } from 'react'
import { PlotChart, type PlotTrace } from '../components/PlotChart'
import { MetricCard } from '../components/MetricCard'
import { channelColor, channelLabel, channelOrder, decompositionTotals, filterWeeks,
  matchingAggregate, regionLabel, type WeeklyFilter } from '../lib/analytics'
import { dateLabel, decimal, units } from '../lib/format'
import type { Channel, ModelDataBundle } from '../types/modelData'

export function Decomposition({ bundle, filter }: { bundle: ModelDataBundle; filter: WeeklyFilter }) {
  const [channel, setChannel] = useState<Channel>('coupon')
  const rows = filterWeeks(bundle.contributions.weekly, filter)
  if (!rows.length) return <div className="empty-panel" role="status">No contribution weeks match this region and date range.</div>
  const totals = decompositionTotals(rows)
  const promo = channelOrder.reduce((sum, name) => sum + totals.channels[name], 0)
  const dates = bundle.manifest.dates
  const aggregate = matchingAggregate(bundle.contributions.aggregates, filter,
    dates.first_week, dates.last_training_week, dates.first_holdout_week, dates.last_week)
  const x = rows.map(row => row.week_start)
  const stack: PlotTrace[] = [
    { x, y: rows.map(row => row.baseline_units.mean), type: 'scatter', mode: 'lines',
      stackgroup: 'one', name: 'Modeled baseline', line: { color: '#293e51', width: 0.5 },
      fillcolor: '#293e51', hovertemplate: '%{x}<br>Baseline: %{y:,.0f} units<extra></extra>' },
    ...channelOrder.map(name => ({ x, y: rows.map(row => row.channels_units[name].mean),
      type: 'scatter', mode: 'lines', stackgroup: 'one', name: channelLabel[name],
      line: { color: channelColor[name], width: 0.5 }, fillcolor: channelColor[name],
      hovertemplate: `%{x}<br>${channelLabel[name]}: %{y:,.0f} units<extra></extra>` })),
    { x, y: rows.map(row => row.observed_sales_units), type: 'scatter', mode: 'lines',
      name: 'Observed sales', line: { color: '#d07058', width: 2.5 },
      hovertemplate: '%{x}<br>Observed: %{y:,.0f} units<extra></extra>' },
  ]
  const band: PlotTrace[] = [
    { x, y: rows.map(row => row.channels_units[channel].p05), type: 'scatter', mode: 'lines',
      line: { width: 0 }, showlegend: false, hoverinfo: 'skip' },
    { x, y: rows.map(row => row.channels_units[channel].p95), type: 'scatter', mode: 'lines',
      fill: 'tonexty', fillcolor: `${channelColor[channel]}33`, line: { width: 0 },
      name: '90% credible interval', hovertemplate: 'Upper bound: %{y:,.0f} units<extra></extra>' },
    { x, y: rows.map(row => row.channels_units[channel].mean), type: 'scatter', mode: 'lines',
      name: 'Posterior mean', line: { color: channelColor[channel], width: 3 },
      hovertemplate: '%{x}<br>Modeled contribution: %{y:,.0f} units<extra></extra>' },
  ]
  const reconciliation = totals.expected + totals.residual
  const roundingDifference = totals.observed - reconciliation

  return <div className="page-stack">
    <div className="section-intro"><span className="section-kicker">02 / MODEL DECOMPOSITION</span>
      <h2>Where expected units are assigned</h2>
      <p>{regionLabel(filter.segmentId)} · {dateLabel(filter.startWeek)}–{dateLabel(filter.endWeek)} · {rows.length} weeks</p>
    </div>
    <div className="metric-grid">
      <MetricCard label="Modeled baseline" value={units(totals.baseline)} sub="Posterior mean units, selected weeks"
        tip="Expected demand assigned to the intercept and nonmarketing controls by the fitted model." />
      <MetricCard label="Three channel contributions" value={units(promo)} sub="Sum of posterior mean units"
        tip="Coupons, retailer promotions and digital advertising modeled together. These are not experiment-validated causal effects." />
      <MetricCard label="Expected sales" value={units(totals.expected)} sub="Baseline plus channel means" />
      <MetricCard label="Observed − expected" value={`${totals.residual >= 0 ? '+' : ''}${units(totals.residual)}`}
        sub="Residual units; may be negative" tip="Observed sales minus the fitted posterior mean of expected sales. It is not another channel contribution." />
    </div>
    <section className="chart-card"><div className="card-header"><div><p className="section-kicker">WEEKLY COMPONENTS</p><h3>Baseline and modeled channel response</h3></div><span className="tiny-badge">UNITS</span></div>
      <PlotChart label={`Modeled baseline and three channel contributions with observed sales for ${regionLabel(filter.segmentId)}`}
        traces={stack} height={390} layout={{ xaxis: { title: 'Week starting Monday', type: 'date', showgrid: false },
          yaxis: { title: 'Sales units', rangemode: 'tozero', gridcolor: '#e9edf0' } }} />
      <p className="chart-caption">Stacked areas sum the <strong>posterior mean</strong> baseline and modeled channel contributions. The observed line can differ because sales include residual variation. Campaigns are correlated and targeted; this allocation is assumption dependent.</p>
    </section>
    <div className="two-column decomposition-lower">
      <section className="chart-card"><div className="card-header"><div><p className="section-kicker">UNCERTAINTY</p><h3>Channel contribution band</h3></div>
        <label className="compact-label">Channel<select aria-label="Contribution channel" value={channel}
          onChange={event => setChannel(event.target.value as Channel)}>
          {channelOrder.map(name => <option value={name} key={name}>{channelLabel[name]}</option>)}
        </select></label></div>
        <PlotChart label={`Weekly modeled ${channelLabel[channel]} contribution with 90% credible interval`}
          traces={band} height={295} layout={{ xaxis: { title: 'Week starting Monday', type: 'date', showgrid: false },
            yaxis: { title: 'Contribution units', rangemode: 'tozero', gridcolor: '#e9edf0' } }} />
        <p className="chart-caption">The shaded 5th–95th percentile band is a <strong>90% credible interval for each week's expected channel contribution</strong>, not a prediction interval for observed sales.</p>
      </section>
      <section className="detail-card"><p className="section-kicker">ACCOUNTING CHECK</p><h3>Reconciliation</h3>
        <div className="equation"><span>Expected sales</span><strong>{units(totals.expected)}</strong></div>
        <div className="equation"><span>+ Residual</span><strong>{totals.residual >= 0 ? '+' : ''}{units(totals.residual)}</strong></div>
        <div className="equation total"><span>= Observed sales</span><strong>{units(totals.observed)}</strong></div>
        <p className="detail-note">Observed minus (expected + residual) is {decimal(roundingDifference, 3)} units; any small difference comes from four-decimal export rounding.</p>
        <div className="detail-rule" />
        <h4>Selected-period component means</h4>
        {channelOrder.map(name => <div className="contribution-row" key={name}>
          <span className="legend-dot" style={{ background: channelColor[name] }} />
          <span>{channelLabel[name]}</span><strong>{units(totals.channels[name])}</strong>
        </div>)}
        {aggregate && <p className="detail-note">For this exact {aggregate.period} period, the {channelLabel[channel].toLowerCase()} total has a draw-first 90% credible interval of {units(aggregate.channels_units[channel].p05)}–{units(aggregate.channels_units[channel].p95)} units.</p>}
        {!aggregate && <p className="detail-note">Custom-window total intervals are unavailable in this export. Weekly interval endpoints cannot be summed.</p>}
      </section>
    </div>
    <p className="method-note"><strong>Interpretation</strong> · {bundle.contributions.interpretation} Model-based contributions are conditional on the synthetic data-generating assumptions. They are not experimentally established causal lift or a measure of profit. Partial pooling missed some known synthetic channel effects in M3.</p>
  </div>
}
