/** Bounded, deterministic fixed-budget search over the exported weekly spend profile. */
import { channelOrder } from './analytics'
import { evaluateScenario, scaleBaselinePlan, type PreparedScenario, type ScenarioResult, type SpendPlan } from './scenario'
import type { Channel } from '../types/modelData'

export interface BudgetBounds {
  baselineTotals: Record<Channel, number>
  maximumTotals: Record<Channel, number>
  maximumBudget: number
}
export type OptimizationResult =
  | { status: 'infeasible'; reason: string; requestedBudgetUsd: number; maximumBudgetUsd: number }
  | { status: 'feasible'; requestedBudgetUsd: number; allocationsUsd: Record<Channel, number>;
      boundaryChannels: { channel: Channel; bound: 'minimum' | 'maximum' }[];
      scenario: ScenarioResult; evaluations: number; method: string }

export function budgetBounds(prepared: PreparedScenario): BudgetBounds {
  const plan = prepared.segment.baseline_plan_usd
  const baselineTotals = {} as Record<Channel, number>
  const maximumTotals = {} as Record<Channel, number>
  for (let c = 0; c < 3; c++) {
    const channel = channelOrder[c]
    const limit = prepared.segment.spend_limits_usd[c]
    if (limit.channel !== channel || limit.min_usd !== 0 || !Number.isFinite(limit.max_usd) || limit.max_usd < 0) {
      throw new Error(`Invalid spend bounds for ${channel}`)
    }
    baselineTotals[channel] = plan.reduce((sum, week) => sum + week[c], 0)
    const positive = plan.map(week => week[c]).filter(value => value > 0)
    // Fixed weekly proportions mean a single high week can bind the whole channel.
    const factor = positive.length ? Math.min(...positive.map(value => limit.max_usd / value)) : 0
    maximumTotals[channel] = baselineTotals[channel] * factor
  }
  return { baselineTotals, maximumTotals,
    maximumBudget: channelOrder.reduce((sum, channel) => sum + maximumTotals[channel], 0) }
}

export function optimizeFixedBudget(prepared: PreparedScenario, requestedBudgetUsd: number): OptimizationResult {
  const { baselineTotals, maximumTotals, maximumBudget } = budgetBounds(prepared)
  if (!Number.isFinite(requestedBudgetUsd) || requestedBudgetUsd < 0) {
    return { status: 'infeasible', reason: 'Budget must be a finite, nonnegative 12-week USD total.',
      requestedBudgetUsd, maximumBudgetUsd: maximumBudget }
  }
  const tolerance = Math.max(1e-6, maximumBudget * 1e-10)
  if (requestedBudgetUsd > maximumBudget) {
    return { status: 'infeasible', reason: 'Requested budget exceeds the fixed-profile observed spend caps.',
      requestedBudgetUsd, maximumBudgetUsd: maximumBudget }
  }
  const budget = Math.min(requestedBudgetUsd, maximumBudget)
  const base = channelOrder.map(channel => baselineTotals[channel])
  const cap = channelOrder.map(channel => maximumTotals[channel])
  const baseTotal = base.reduce((sum, value) => sum + value, 0)
  // Start with the baseline proportions, capped, then fill remaining capacity.
  const allocation = base.map((value, c) => Math.min(cap[c], baseTotal > 0 ? budget * value / baseTotal : 0))
  let remainder = budget - allocation.reduce((sum, value) => sum + value, 0)
  for (let c = 0; c < 3 && remainder > tolerance; c++) {
    const addition = Math.min(remainder, cap[c] - allocation[c])
    allocation[c] += addition
    remainder -= addition
  }
  if (Math.abs(remainder) > tolerance) throw new Error('Budget initialization failed to preserve the requested total')
  const baselinePlan: SpendPlan = prepared.segment.baseline_plan_usd
  const evaluate = (values: number[]) => evaluateScenario(prepared, baselinePlan,
    scaleBaselinePlan(baselinePlan, values.map((value, c) => base[c] > 0 ? value / base[c] : 0)))
  let current = evaluate(allocation)
  let evaluations = 1
  // Pairwise transfers preserve the fixed total. Decreasing steps search local improvements;
  // this is a bounded heuristic, so the UI does not claim a global optimum.
  for (const divisor of [8, 32, 128, 512, 2048]) {
    const step = Math.max(budget / divisor, 0.01)
    for (let iteration = 0; iteration < 80; iteration++) {
      let best: { from: number; to: number; amount: number; result: ScenarioResult } | null = null
      let bestMean = current.summary.incremental_expected_units.mean
      for (let from = 0; from < 3; from++) for (let to = 0; to < 3; to++) {
        if (from === to) continue
        const amount = Math.min(step, allocation[from], cap[to] - allocation[to])
        if (amount < 0.005) continue
        const candidate = [...allocation]
        candidate[from] -= amount
        candidate[to] += amount
        const result = evaluate(candidate)
        evaluations++
        const mean = result.summary.incremental_expected_units.mean
        if (mean > bestMean + 1e-10) {
          bestMean = mean
          best = { from, to, amount, result }
        }
      }
      if (!best) break
      allocation[best.from] -= best.amount
      allocation[best.to] += best.amount
      current = best.result
    }
  }
  const allocationsUsd = {} as Record<Channel, number>
  const boundaryChannels: { channel: Channel; bound: 'minimum' | 'maximum' }[] = []
  for (let c = 0; c < 3; c++) {
    const channel = channelOrder[c]
    allocationsUsd[channel] = allocation[c]
    if (allocation[c] <= tolerance) boundaryChannels.push({ channel, bound: 'minimum' })
    else if (cap[c] - allocation[c] <= tolerance) boundaryChannels.push({ channel, bound: 'maximum' })
  }
  if (Math.abs(current.alternative_spend_usd.total - budget) > tolerance ||
      current.alternative_support.outside_observed_bounds) {
    throw new Error('Optimizer produced an invalid allocation')
  }
  return { status: 'feasible', requestedBudgetUsd, allocationsUsd, boundaryChannels,
    scenario: current, evaluations, method: 'deterministic pairwise transfers; local search' }
}
