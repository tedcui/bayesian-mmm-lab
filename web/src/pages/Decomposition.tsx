import { useState } from 'react'
import { PlotChart, type PlotTrace } from '../components/PlotChart'
import { MetricCard } from '../components/MetricCard'
import { ALL_REGIONS, channelColor, channelLabel, channelOrder, decompositionTotals,
  filterWeeks, matchingAggregate, regionLabel, type WeeklyFilter } from '../lib/analytics'
import { dateLabel, units } from '../lib/format'
import type { Channel, ModelDataBundle } from '../types/modelData'

export function Decomposition({ bundle, filter }: { bundle: ModelDataBundle; filter: WeeklyFilter }) {
  const [channel, setChannel] = useState<Channel>('coupon')
  const allRegions = filter.segmentId === ALL_REGIONS
  const rows = allRegions
    ? bundle.contributions.all_regions_weekly.filter(row => row.week_start >= filter.startWeek && row.week_start <= filter.endWeek)
    : filterWeeks(bundle.contributions.weekly, filter)
  if (!rows.length) return <div className="empty-panel" role="status">No contribution weeks match this view and date range.</div>
  const totals = decompositionTotals(rows)
  const promo = channelOrder.reduce((sum, name) => sum + totals.channels[name], 0)
  const dates = bundle.manifest.dates
  const aggregate = matchingAggregate(bundle.contributions.aggregates, filter,
    dates.first_week, dates.last_training_week, dates.first_holdout_week, dates.last_week)
  const x = rows.map(row => row.week_start)
  const stack: PlotTrace[] = [
    { x, y: rows.map(row => row.baseline_units.mean), type: 'scatter', mode: 'lines',
      stackgroup: 'one', name: 'Modeled baseline', line: { color: '#405c5a', width: 0.5 },
      fillcolor: '#405c5a', hovertemplate: '%{x}<br>Baseline: %{y:,.0f} units<extra></extra>' },
    ...channelOrder.map(name => ({ x, y: rows.map(row => row.channels_units[name].mean),
      type: 'scatter', mode: 'lines', stackgroup: 'one', name: channelLabel[name],
      line: { color: channelColor[name], width: 0.5 }, fillcolor: channelColor[name],
      hovertemplate: `%{x}<br>${channelLabel[name]}: %{y:,.0f} units<extra></extra>` })),
    { x, y: rows.map(row => row.observed_sales_units), type: 'scatter', mode: 'lines',
      name: 'Observed sales', line: { color: '#b7774b', width: 2.5 },
      hovertemplate: '%{x}<br>Observed: %{y:,.0f} units<extra></extra>' },
  ]
  const band: PlotTrace[] = [
    { x, y: rows.map(row => row.channels_units[channel].p05), type: 'scatter', mode: 'lines',
      line: { width: 0 }, showlegend: false, hoverinfo: 'skip' },
    { x, y: rows.map(row => row.channels_units[channel].p95), type: 'scatter', mode: 'lines',
      fill: 'tonexty', fillcolor: `${channelColor[channel]}33`, line: { width: 0 },
      name: '90% credible interval', hovertemplate: 'Upper bound: %{y:,.0f} units<extra></extra>' },
    { x, y: rows.map(row => row.channels_units[channel].mean), type: 'scatter', mode: 'lines',
      name: 'Modeled average', line: { color: channelColor[channel], width: 3 },
      hovertemplate: '%{x}<br>Modeled contribution: %{y:,.0f} units<extra></extra>' },
  ]

  return <div className="page-stack">
    <div className="section-intro"><span className="section-kicker">02 / SALES BREAKDOWN</span>
      <h2>What contributes to expected sales</h2>
      <p>{regionLabel(filter.segmentId)} · {dateLabel(filter.startWeek)}–{dateLabel(filter.endWeek)} · {rows.length} weeks</p>
    </div>
    <div className="metric-grid">
      <MetricCard label="Modeled baseline" value={units(totals.baseline)} sub="Estimated units in selected weeks"
        tip="Estimated sales without the three modeled marketing contributions." />
      <MetricCard label="Three channel contributions" value={units(promo)} sub="Estimated units in selected weeks"
        tip="Estimated contribution from coupons, retailer promotions, and digital advertising under the model's assumptions." />
      <MetricCard label="Expected sales" value={units(totals.expected)} sub="Baseline plus channel means" />
      <MetricCard label="Observed − expected" value={`${totals.residual >= 0 ? '+' : ''}${units(totals.residual)}`}
        sub="Difference in units; may be negative" tip="Observed sales minus modeled expected sales." />
    </div>
    <section className="chart-card"><div className="card-header"><div><p className="section-kicker">WEEKLY COMPONENTS</p><h3>Baseline and modeled channel response</h3></div><span className="tiny-badge">UNITS</span></div>
      <PlotChart label={`Modeled baseline and three channel contributions with observed sales for ${regionLabel(filter.segmentId)}`}
        traces={stack} height={390} layout={{ xaxis: { title: 'Week starting Monday', type: 'date', showgrid: false },
          yaxis: { title: 'Sales units', rangemode: 'tozero', gridcolor: '#dedfd5' } }} />
      <p className="chart-caption">Stacked areas show modeled baseline and channel contributions{allRegions ? ' across all regions' : ''}. Observed sales may differ. The marketing contributions depend on model assumptions and are not proven causal lift.</p>
    </section>
    <div className="two-column decomposition-lower">
      <section className="chart-card"><div className="card-header"><div><p className="section-kicker">UNCERTAINTY</p><h3>Channel contribution band</h3></div>
        <label className="compact-label">Channel<select aria-label="Contribution channel" value={channel}
          onChange={event => setChannel(event.target.value as Channel)}>
          {channelOrder.map(name => <option value={name} key={name}>{channelLabel[name]}</option>)}
        </select></label></div>
        <PlotChart label={`Weekly modeled ${channelLabel[channel]} contribution for ${regionLabel(filter.segmentId)} with 90% credible interval`}
          traces={band} height={295} layout={{ xaxis: { title: 'Week starting Monday', type: 'date', showgrid: false },
            yaxis: { title: 'Contribution units', rangemode: 'tozero', gridcolor: '#dedfd5' } }} />
        <p className="chart-caption">The shaded area is a <strong>90% credible interval</strong> for this channel's modeled weekly contribution{allRegions ? ' across all regions' : ''}. It does not describe future observed sales.</p>
      </section>
      <section className="detail-card"><p className="section-kicker">SALES BREAKDOWN</p><h3>Modeled vs observed</h3>
        <div className="equation"><span>Modeled expected sales</span><strong>{units(totals.expected)}</strong></div>
        <div className="equation"><span>Difference from observed</span><strong>{totals.residual >= 0 ? '+' : ''}{units(totals.residual)}</strong></div>
        <div className="equation total"><span>Observed sales</span><strong>{units(totals.observed)}</strong></div>
        <div className="detail-rule" />
        <h4>Modeled contribution by channel</h4>
        {channelOrder.map(name => <div className="contribution-row" key={name}>
          <span className="legend-dot" style={{ background: channelColor[name] }} />
          <span>{channelLabel[name]}</span><strong>{units(totals.channels[name])}</strong>
        </div>)}
        {aggregate && <p className="detail-note">{channelLabel[channel]} total: 90% credible interval of {units(aggregate.channels_units[channel].p05)}–{units(aggregate.channels_units[channel].p95)} units.</p>}
        {!aggregate && <p className="detail-note">A total interval is available for the All weeks, Training, and Holdout ranges.</p>}
      </section>
    </div>
  </div>
}
