import { useMemo, useState } from 'react'
import { MetricCard } from '../components/MetricCard'
import { PlotChart } from '../components/PlotChart'
import { channelColor, channelLabel, channelOrder } from '../lib/analytics'
import { dateLabel, decimal, dollars, units } from '../lib/format'
import { budgetBounds, optimizeFixedBudget, type OptimizationResult } from '../lib/optimizer'
import { evaluateScenario, prepareScenario, scaleBaselinePlan, type PreparedScenario, type ScenarioResult } from '../lib/scenario'
import type { ModelDataBundle, Summary } from '../types/modelData'

const interval = (value: Summary) => `${units(value.p05)} to ${units(value.p95)} units`
const signedUnits = (value: number) => `${value > 0 ? '+' : ''}${units(value)}`
const signedDollars = (value: number) => `${value > 0 ? '+' : ''}${dollars(value)}`
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
    <h2>Scenario unavailable</h2><p>{preparationError || calculation.error}</p>
  </section>
  if (!prepared || !bounds || !calculation.result) return <section className="empty-panel" role="status">
    No validated scenario draws are available for this region.
  </section>

  const result = calculation.result
  const horizon = prepared.simulator.horizon_week_starts
  const spendDelta = result.alternative_spend_usd.total - result.baseline_spend_usd.total
  const warningChannels = channelOrder.filter(channel => result.alternative_support.by_channel[channel].above_training_max_weeks > 0)
  const overObserved = channelOrder.filter(channel => result.alternative_support.by_channel[channel].above_observed_max_weeks > 0)
  const chartTraces = [
    { type: 'bar', name: 'Baseline plan', x: ['Baseline plan'],
      y: [result.summary.baseline_expected_units.mean], marker: { color: '#8faab0' },
      error_y: { type: 'data', symmetric: false,
        array: [result.summary.baseline_expected_units.p95 - result.summary.baseline_expected_units.mean],
        arrayminus: [result.summary.baseline_expected_units.mean - result.summary.baseline_expected_units.p05] } },
    { type: 'bar', name: 'Alternative plan', x: ['Alternative plan'],
      y: [result.summary.alternative_expected_units.mean], marker: { color: '#167d89' },
      error_y: { type: 'data', symmetric: false,
        array: [result.summary.alternative_expected_units.p95 - result.summary.alternative_expected_units.mean],
        arrayminus: [result.summary.alternative_expected_units.mean - result.summary.alternative_expected_units.p05] } },
  ]
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
    <p className="method-note"><strong>Conditional historical replay · {dateLabel(horizon[0])}–{dateLabel(horizon[11])}.</strong>{' '}
      The fitted model replays the last 12 holdout weeks with price, distribution, competitor conditions, trend, seasonality, and holidays held fixed.
      This is not an ex-ante forecast. Plans are synthetic, pre-outcome marketing spend in USD.</p>

    <section className="detail-card" aria-labelledby="scenario-controls-title">
      <div className="card-header"><div><p className="section-kicker">01 / PLAN AN ALTERNATIVE</p>
        <h2 id="scenario-controls-title">Adjust planned spend</h2></div>
        <button className="secondary-button" type="button" onClick={() => {
          setMultipliers([1, 1, 1]); setOptimization(null); setOptimizationError(null)
        }}>Reset to baseline</button></div>
      <p className="simulator-help">Each control scales that channel's original 12 weekly values. 100% preserves its exported plan; 0% removes replay-window spend while historical adstock continues.</p>
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
      {overObserved.length > 0 && <p className="scenario-warning" role="alert"><strong>Outside observed spend bounds:</strong>{' '}
        {overObserved.map(channel => `${channelLabel[channel]} (${result.alternative_support.by_channel[channel].above_observed_max_weeks} weeks)`).join(', ')}.
        This scenario exceeds the exported maximum weekly spend and is unsupported extrapolation. The optimizer will not use it.</p>}
      {warningChannels.length > 0 && <p className="scenario-warning" role="status"><strong>Above training support:</strong>{' '}
        {warningChannels.map(channel => `${channelLabel[channel]} (${result.alternative_support.by_channel[channel].above_training_max_weeks} weeks)`).join(', ')}.
        Interpret the modeled response cautiously.</p>}
    </section>

    <div className="metric-grid" aria-live="polite">
      <MetricCard label="Paired incremental expected units" value={signedUnits(result.summary.incremental_expected_units.mean)}
        sub={`90% credible: ${interval(result.summary.incremental_expected_units)}`} />
      <MetricCard label="Baseline expected units" value={units(result.summary.baseline_expected_units.mean)}
        sub={`90% credible: ${interval(result.summary.baseline_expected_units)}`} />
      <MetricCard label="Alternative expected units" value={units(result.summary.alternative_expected_units.mean)}
        sub={`90% credible: ${interval(result.summary.alternative_expected_units)}`} />
      <MetricCard label="Planned spend change" value={signedDollars(spendDelta)} sub="Fixed 12-week USD input; no credible interval" />
    </div>

    <div className="two-column">
      <section className="chart-card"><div className="card-header"><div><p className="section-kicker">02 / EXPECTED DEMAND</p>
        <h2>Baseline vs alternative</h2></div></div>
        <PlotChart label="Baseline and alternative model expected units with 90 percent credible intervals"
          traces={chartTraces} layout={{ yaxis: { title: 'Expected sales units', rangemode: 'tozero' },
            showlegend: false, bargap: 0.45 }} height={305} />
        <p className="simulator-help">Bars are posterior means; whiskers show central 90% credible intervals for expected units. The incremental interval uses paired draw differences, not the distance between whiskers.</p>
      </section>
      <section className="detail-card"><p className="section-kicker">03 / CHANNEL RESPONSE</p><h2>Modeled change by channel</h2>
        <div className="scenario-response-table">
          {channelOrder.map(channel => <div className="scenario-response-row" key={channel}>
            <span>{channelLabel[channel]}</span>
            <strong>{signedUnits(result.summary.channel_difference_units[channel].mean)} units</strong>
            <small>90% credible: {interval(result.summary.channel_difference_units[channel])}</small>
          </div>)}
        </div>
        <p className="simulator-help">Channel changes sum within each posterior draw to the modeled total change. They are not experimentally identified causal lift.</p>
      </section>
    </div>

    <section className="detail-card" aria-labelledby="budget-title"><p className="section-kicker">04 / FIXED-BUDGET SEARCH</p>
      <h2 id="budget-title">Allocate one 12-week budget</h2>
      <p className="simulator-help">Enter an absolute total in USD for all three channels across the 12 weeks. The search preserves each channel's original weekly pattern, uses the same {result.draw_count} paired posterior draws, and maximizes mean modeled incremental expected units within observed weekly spend caps. It is a deterministic local search, not a certified global optimum.</p>
      <div className="budget-form"><label htmlFor="budget-usd">Total planned budget · 12 weeks (USD)</label>
        <div><input id="budget-usd" type="number" min="0" step="0.01" value={budgetText}
          onChange={event => { setBudgetText(event.target.value); setOptimization(null); setOptimizationError(null) }} />
          <button className="primary-button" type="button" onClick={runOptimizer}>Find allocation</button></div>
        <small>Feasible range: {dollarsCents(0)} to {dollarsCents(Math.floor(bounds.maximumBudget * 100) / 100)}. Baseline: {dollarsCents(result.baseline_spend_usd.total)}. Each channel has a zero minimum and an observed weekly cap.</small>
      </div>
      {optimizationError && <p className="scenario-warning" role="alert">{optimizationError}</p>}
      {optimization?.status === 'infeasible' && <p className="scenario-warning" role="alert"><strong>Cannot allocate this budget.</strong>{' '}
        {optimization.reason} Maximum feasible to cents: {dollarsCents(Math.floor(optimization.maximumBudgetUsd * 100) / 100)}.</p>}
      {optimization?.status === 'feasible' && <div className="optimization-results" role="status">
        <h3>Feasible allocation</h3>
        <p>Allocated {dollars(optimization.scenario.alternative_spend_usd.total)} across 12 weeks.
          Mean modeled incremental expected units vs baseline: <strong>{signedUnits(optimization.scenario.summary.incremental_expected_units.mean)}</strong>{' '}
          (90% credible: {interval(optimization.scenario.summary.incremental_expected_units)}).</p>
        <div className="allocation-grid">{channelOrder.map(channel => <div key={channel}>
          <span>{channelLabel[channel]}</span><strong>{dollars(optimization.allocationsUsd[channel])}</strong>
          <small>Baseline {dollars(bounds.baselineTotals[channel])} · Max {dollars(bounds.maximumTotals[channel])}</small></div>)}</div>
        <p>{optimization.boundaryChannels.length ? `At a spend boundary: ${optimization.boundaryChannels.map(item =>
          `${channelLabel[item.channel]} ${item.bound}`).join(', ')}.` : 'No channel is at its minimum or maximum cap.'}{' '}
          {optimization.scenario.alternative_support.extrapolates_beyond_training ? 'Some allocated weeks exceed the training maximum; interpret cautiously.' : 'Allocated weeks stay within training maxima.'}</p>
        <button className="secondary-button" type="button" onClick={() => {
          setMultipliers(channelOrder.map(channel => bounds.baselineTotals[channel] > 0 ?
            optimization.allocationsUsd[channel] / bounds.baselineTotals[channel] : 0))
        }}>Apply to controls</button>
      </div>}
    </section>

    <p className="method-note"><strong>How to read this.</strong> Geometric adstock carries earlier planned spend into later weeks; Hill saturation makes each additional dollar less responsive at higher spend.
      These 90% intervals describe parameter uncertainty in conditional expected sales from a subset of {result.draw_count} jointly indexed draws, excluding observation noise.
      Results depend on observational identification assumptions and are not demonstrated causal lift, profit, or ROI.
      In synthetic truth recovery, partial pooling covered 15/18 effects versus 17/18 for no pooling; the partial model is an educational reference, not a proven best effect model.</p>
  </div>
}
