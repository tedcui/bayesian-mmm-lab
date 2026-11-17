import { useMemo, useState } from 'react'
import { MetricCard } from '../components/MetricCard'
import { PlotChart } from '../components/PlotChart'
import { channelColor, channelLabel, channelOrder } from '../lib/analytics'
import { dateLabel, decimal, dollars, units } from '../lib/format'
import { budgetBounds, optimizeFixedBudget, type OptimizationResult } from '../lib/optimizer'
import { evaluateScenario, prepareScenario, scaleBaselinePlan, type PreparedScenario, type ScenarioResult } from '../lib/scenario'
import type { Channel, ModelDataBundle, Summary } from '../types/modelData'

const interval = (value: Summary) => `${units(value.p05)} to ${units(value.p95)} units`
const signedUnits = (value: number) => `${value > 0 ? '+' : ''}${units(value)}`
const signedDollars = (value: number) => `${value > 0 ? '+' : ''}${dollars(value)}`
const credibleErrors = (values: Summary[]) => ({
  type: 'data', symmetric: false,
  array: values.map(value => value.p95 - value.mean),
  arrayminus: values.map(value => value.mean - value.p05),
})
const credibleHover = '%{customdata[2]}: %{y:,.0f} units<br>90% credible: %{customdata[0]:,.0f}–%{customdata[1]:,.0f}<extra>%{fullData.name}</extra>'
const baselineChannelColor: Record<Channel, string> = {
  coupon: '#678f91',
  retailer_promotion: '#b39a88',
  digital: '#a0adb0',
}
const dollarsCents = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(value)

function usePrepared(bundle: ModelDataBundle, segmentId: string): { prepared?: PreparedScenario; error?: string } {
  return useMemo(() => {
    try { return { prepared: prepareScenario(bundle, segmentId) } }
    catch (cause) { return { error: cause instanceof Error ? cause.message : 'Scenario setup failed' } }
  }, [bundle, segmentId])
}

export function Simulator({ bundle, segmentId }: { bundle: ModelDataBundle; segmentId: string }) {
  const { prepared, error: preparationError } = usePrepared(bundle, segmentId)
  const [multipliers, setMultipliers] = useState([1, 1, 1])
  const [optimization, setOptimization] = useState<OptimizationResult | null>(null)
  const [optimizationError, setOptimizationError] = useState<string | null>(null)
  const bounds = useMemo(() => prepared ? budgetBounds(prepared) : null, [prepared])
  const [budgetText, setBudgetText] = useState(() => {
    if (!prepared) return ''
    return prepared.segment.baseline_plan_usd.flat().reduce((sum, value) => sum + value, 0).toFixed(2)
  })
  const calculation = useMemo((): { result?: ScenarioResult; error?: string } => {
    if (!prepared) return {}
    try {
      const baseline = prepared.segment.baseline_plan_usd
      return { result: evaluateScenario(prepared, baseline, scaleBaselinePlan(baseline, multipliers)) }
    } catch (cause) { return { error: cause instanceof Error ? cause.message : 'Scenario calculation failed' } }
  }, [prepared, multipliers])

  if (preparationError || calculation.error) return <section className="state-panel" role="alert">
    <h2>Scenario unavailable</h2><p>We could not calculate this scenario. Please reload the dashboard and try again.</p>
  </section>
  if (!prepared || !bounds || !calculation.result) return <section className="empty-panel" role="status">
    Scenario data is unavailable for this region.
  </section>

  const result = calculation.result
  const horizon = prepared.simulator.horizon_week_starts
  const spendDelta = result.alternative_spend_usd.total - result.baseline_spend_usd.total
  const warningChannels = channelOrder.filter(channel => result.alternative_support.by_channel[channel].above_training_max_weeks > 0)
  const overObserved = channelOrder.filter(channel => result.alternative_support.by_channel[channel].above_observed_max_weeks > 0)
  const planTraces = ([
    { name: 'Baseline plan', shift: -0.18, color: '#708a91', channelColors: baselineChannelColor,
      expected: result.summary.baseline_expected_units,
      channels: result.summary.baseline_channel_units },
    { name: 'Alternative plan', shift: 0.18, color: '#176d70', channelColors: channelColor,
      expected: result.summary.alternative_expected_units,
      channels: result.summary.alternative_channel_units },
  ]).flatMap(plan => {
    const channelValues = channelOrder.map(channel => plan.channels[channel])
    return [
      { type: 'bar', name: plan.name, x: [plan.shift], y: [plan.expected.mean], width: 0.32,
        marker: { color: plan.color },
        customdata: [[plan.expected.p05, plan.expected.p95, 'Expected sales']],
        error_y: credibleErrors([plan.expected]), hovertemplate: credibleHover },
      { type: 'bar', name: plan.name, x: channelOrder.map((_, index) => index + 1 + plan.shift),
        y: channelValues.map(value => value.mean), width: 0.32, yaxis: 'y2',
        marker: { color: channelOrder.map(channel => plan.channelColors[channel]) },
        customdata: channelValues.map((value, index) => [value.p05, value.p95, channelLabel[channelOrder[index]]]),
        error_y: credibleErrors(channelValues), hovertemplate: credibleHover },
    ]
  })
  const changeMultiplier = (index: number, percent: number) => {
    setMultipliers(current => current.map((value, c) => c === index ? percent / 100 : value))
    setOptimization(null)
    setOptimizationError(null)
  }
  const runOptimizer = () => {
    try {
      const outcome = optimizeFixedBudget(prepared, budgetText.trim() === '' ? Number.NaN : Number(budgetText))
      setOptimization(outcome)
      setOptimizationError(null)
    } catch (cause) {
      setOptimization(null)
      setOptimizationError(cause instanceof Error ? cause.message : 'Budget search failed')
    }
  }

  return <div className="page-stack">
    <p className="method-note"><strong>Weeks starting {dateLabel(horizon[0])}–{dateLabel(horizon[11])}.</strong>{' '}
      Explore how a different spending plan might have changed modeled sales during these 12 weeks. Other market conditions stay the same. This is a historical scenario, not a future forecast.</p>

    <section className="detail-card" aria-labelledby="scenario-controls-title">
      <div className="card-header"><div><p className="section-kicker">01 / PLAN AN ALTERNATIVE</p>
        <h2 id="scenario-controls-title">Adjust planned spend</h2></div>
        <button className="secondary-button" type="button" onClick={() => {
          setMultipliers([1, 1, 1]); setOptimization(null); setOptimizationError(null)
        }}>Reset to baseline</button></div>
      <p className="simulator-help">Each control adjusts one channel's spending across the 12 weeks. At 100%, the original plan is unchanged; at 0%, that channel has no new spending in this period.</p>
      <div className="spend-controls">
        {channelOrder.map((channel, c) => {
          const original = prepared.segment.baseline_plan_usd.map(week => week[c])
          const peak = Math.max(...original)
          const cap = prepared.segment.spend_limits_usd[c].max_usd
          const maxPercent = peak > 0 ? Math.max(125, Math.ceil((cap / peak) * 120 / 5) * 5) : 125
          return <div className="spend-control" key={channel}>
            <label htmlFor={`spend-${channel}`}><span className="channel-dot" style={{ background: channelColor[channel] }} />
              {channelLabel[channel]} <strong>{decimal(multipliers[c] * 100, 2)}%</strong></label>
            <input id={`spend-${channel}`} type="range" min="0" max={maxPercent} step="any"
              value={multipliers[c] * 100} onChange={event => changeMultiplier(c, Number(event.target.value))}
              aria-valuetext={`${decimal(multipliers[c] * 100, 2)} percent of baseline plan`} />
            <div className="control-totals"><span>Baseline {dollars(result.baseline_spend_usd.by_channel[channel])}</span>
              <strong>Alternative {dollars(result.alternative_spend_usd.by_channel[channel])}</strong></div>
          </div>
        })}
      </div>
      <div className="spend-summary"><span>12-week baseline planned spend <strong>{dollars(result.baseline_spend_usd.total)}</strong></span>
        <span>12-week alternative planned spend <strong>{dollars(result.alternative_spend_usd.total)}</strong></span>
        <span>Spend change <strong>{signedDollars(spendDelta)}</strong></span></div>
      {overObserved.length > 0 && <p className="scenario-warning" role="alert"><strong>Outside the observed spending range:</strong>{' '}
        {overObserved.map(channel => `${channelLabel[channel]} (${result.alternative_support.by_channel[channel].above_observed_max_weeks} weeks)`).join(', ')}.
        The model has not seen weekly spending this high. The budget search stays within the observed range.</p>}
      {warningChannels.length > 0 && <p className="scenario-warning" role="status"><strong>Above the training spending range:</strong>{' '}
        {warningChannels.map(channel => `${channelLabel[channel]} (${result.alternative_support.by_channel[channel].above_training_max_weeks} weeks)`).join(', ')}.
        These results rely on spending levels above those used to fit the model.</p>}
    </section>

    <div className="metric-grid" aria-live="polite">
      <MetricCard label="Change in expected sales" value={signedUnits(result.summary.incremental_expected_units.mean)}
        sub={`90% credible: ${interval(result.summary.incremental_expected_units)}`} />
      <MetricCard label="Original plan expected sales" value={units(result.summary.baseline_expected_units.mean)}
        sub={`90% credible: ${interval(result.summary.baseline_expected_units)}`} />
      <MetricCard label="New plan expected sales" value={units(result.summary.alternative_expected_units.mean)}
        sub={`90% credible: ${interval(result.summary.alternative_expected_units)}`} />
      <MetricCard label="Planned spend change" value={signedDollars(spendDelta)} sub="Across all 12 weeks" />
    </div>

    <div className="page-stack">
      <section className="chart-card"><div className="card-header"><div><p className="section-kicker">02 / EXPECTED DEMAND</p>
        <h2>Baseline vs alternative</h2></div></div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span><strong>Left bar:</strong> baseline plan, muted color</span>
          <span><strong>Right bar:</strong> alternative plan, channel color</span>
        </div>
        <PlotChart label="Expected sales and three marketing channel contributions by plan, each with a 90 percent credible interval"
          traces={planTraces} layout={{ hovermode: 'closest', showlegend: false,
            xaxis: { tickmode: 'array', tickvals: [0, 1, 2, 3],
              ticktext: ['Expected<br>sales', 'Coupons', 'Retailer<br>promotions', 'Digital<br>advertising'],
              range: [-0.55, 3.55], fixedrange: true },
            yaxis: { title: 'Total sales units', rangemode: 'tozero' },
            yaxis2: { title: 'Channel units', overlaying: 'y', side: 'right', rangemode: 'tozero' },
            margin: { l: 62, r: 74, t: 35, b: 68 } }} height={370} />
        <p className="simulator-help">Whiskers show each bar's 90% credible interval. Expected sales uses the left scale and includes nonmarketing demand; the three channel contributions use the right scale and exclude it. Channel effects depend on model assumptions and are not proven causal lift. Earlier spend can still contribute when new spend is zero.</p>
      </section>
      <section className="detail-card"><p className="section-kicker">03 / CHANNEL RESPONSE</p><h2>Modeled change by channel</h2>
        <div className="scenario-response-table">
          {channelOrder.map(channel => <div className="scenario-response-row" key={channel}>
            <span>{channelLabel[channel]}</span>
            <strong>{signedUnits(result.summary.channel_difference_units[channel].mean)} units</strong>
            <small>90% credible: {interval(result.summary.channel_difference_units[channel])}</small>
          </div>)}
        </div>
        <p className="simulator-help">These channel changes are model estimates, not proven causal lift.</p>
      </section>
    </div>

    <section className="detail-card" aria-labelledby="budget-title"><p className="section-kicker">04 / FIXED-BUDGET SEARCH</p>
      <h2 id="budget-title">Allocate one 12-week budget</h2>
      <p className="simulator-help">Set one total budget for the three channels. The search suggests a split that may increase modeled sales while keeping each channel's week-to-week spending pattern within the observed range. The search is approximate.</p>
      <div className="budget-form"><label htmlFor="budget-usd">Total planned budget · 12 weeks (USD)</label>
        <div><input id="budget-usd" type="number" min="0" step="0.01" value={budgetText}
          onChange={event => { setBudgetText(event.target.value); setOptimization(null); setOptimizationError(null) }} />
          <button className="primary-button" type="button" onClick={runOptimizer}>Find allocation</button></div>
        <small>Budget range: {dollarsCents(0)} to {dollarsCents(Math.floor(bounds.maximumBudget * 100) / 100)}. Original plan: {dollarsCents(result.baseline_spend_usd.total)}.</small>
      </div>
      {optimizationError && <p className="scenario-warning" role="alert">We could not calculate an allocation. Try a different budget.</p>}
      {optimization?.status === 'infeasible' && <p className="scenario-warning" role="alert"><strong>Cannot allocate this budget.</strong>{' '}
        {optimization.reason} Maximum available: {dollarsCents(Math.floor(optimization.maximumBudgetUsd * 100) / 100)}.</p>}
      {optimization?.status === 'feasible' && <div className="optimization-results" role="status">
        <h3>Suggested allocation</h3>
        <p>Allocated {dollars(optimization.scenario.alternative_spend_usd.total)} across 12 weeks.
          Estimated change in sales: <strong>{signedUnits(optimization.scenario.summary.incremental_expected_units.mean)}</strong>{' '}
          (90% credible: {interval(optimization.scenario.summary.incremental_expected_units)}).</p>
        <div className="allocation-grid">{channelOrder.map(channel => <div key={channel}>
          <span>{channelLabel[channel]}</span><strong>{dollars(optimization.allocationsUsd[channel])}</strong>
          <small>Baseline {dollars(bounds.baselineTotals[channel])} · Max {dollars(bounds.maximumTotals[channel])}</small></div>)}</div>
        {optimization.boundaryChannels.length > 0 && <p>At an allowed spending limit: {optimization.boundaryChannels.map(item =>
          `${channelLabel[item.channel]} (${item.bound})`).join(', ')}.</p>}
        {optimization.scenario.alternative_support.extrapolates_beyond_training && <p>Some weeks exceed spending levels used to fit the model.</p>}
        <button className="secondary-button" type="button" onClick={() => {
          setMultipliers(channelOrder.map(channel => bounds.baselineTotals[channel] > 0 ?
            optimization.allocationsUsd[channel] / bounds.baselineTotals[channel] : 0))
        }}>Apply to controls</button>
      </div>}
    </section>

  </div>
}
