/** Runtime checks for M4's five files before any page can use model numbers. */
import type { ModelDataBundle, Summary } from '../types/modelData'

const channels = ['coupon', 'retailer_promotion', 'digital'] as const
const models = ['complete', 'none', 'partial'] as const
const fileNames = ['overview.json', 'contributions.json', 'segments.json', 'simulator.json'] as const
const controls = ['price_delta', 'distribution_delta', 'competitor_delta', 'trend',
  'season_sin', 'season_cos', 'holiday']

type RecordValue = Record<string, unknown>

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`)
}

function object(value: unknown, path: string): RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected object')
  return value as RecordValue
}

function array(value: unknown, path: string, length?: number): unknown[] {
  if (!Array.isArray(value) || (length !== undefined && value.length !== length)) {
    fail(path, `expected array${length === undefined ? '' : ` of length ${length}`}`)
  }
  return value
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value) fail(path, 'expected nonempty string')
  return value
}

function number(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'expected finite number')
  return value
}

function finiteDeep(value: unknown, path: string): void {
  if (typeof value === 'number') { number(value, path); return }
  if (Array.isArray(value)) { value.forEach((item, i) => finiteDeep(item, `${path}[${i}]`)); return }
  if (value !== null && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => finiteDeep(item, `${path}.${key}`))
  }
}

function nonnegative(value: unknown, path: string): number {
  const result = number(value, path)
  if (result < 0) fail(path, 'expected nonnegative number')
  return result
}

function integer(value: unknown, path: string): number {
  const result = number(value, path)
  if (!Number.isSafeInteger(result)) fail(path, 'expected safe integer')
  return result
}

function count(value: unknown, path: string): number {
  const result = integer(value, path)
  if (result < 0) fail(path, 'expected nonnegative count')
  return result
}

function same(a: unknown, b: unknown, path: string): void {
  if (a !== b) fail(path, `expected ${String(b)}, found ${String(a)}`)
}

function sameList(value: unknown, expected: readonly string[], path: string): void {
  const rows = array(value, path, expected.length)
  rows.forEach((item, i) => same(item, expected[i], `${path}[${i}]`))
}

function sameKeys(value: RecordValue, expected: readonly string[], path: string): void {
  const keys = Object.keys(value)
  if (keys.length !== expected.length || keys.some(key => !expected.includes(key))) {
    fail(path, `expected keys ${expected.join(', ')}`)
  }
}

function hash(value: unknown, path: string): void {
  if (!/^[0-9a-f]{64}$/.test(string(value, path))) fail(path, 'expected SHA-256 hex digest')
}

function summary(value: unknown, path: string): Summary {
  const row = object(value, path)
  const mean = number(row.mean, `${path}.mean`)
  const p05 = number(row.p05, `${path}.p05`)
  const p50 = number(row.p50, `${path}.p50`)
  const p95 = number(row.p95, `${path}.p95`)
  if (p05 > p50 || p50 > p95) fail(path, 'quantiles out of order')
  return { mean, p05, p50, p95 }
}

function channelMap(value: unknown, path: string, check: (v: unknown, p: string) => unknown): void {
  const row = object(value, path)
  sameKeys(row, channels, `${path} keys`)
  channels.forEach(name => check(row[name], `${path}.${name}`))
}

function numericMatrix(value: unknown, path: string, rows: number, cols: number,
  check: (v: unknown, p: string) => number = number): void {
  array(value, path, rows).forEach((row, i) => {
    array(row, `${path}[${i}]`, cols).forEach((item, j) => check(item, `${path}[${i}][${j}]`))
  })
}

function isoMonday(value: unknown, path: string): string {
  const date = string(value, path)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).getUTCDay() !== 1 ||
      Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) fail(path, 'expected Monday ISO date')
  return date
}

function weekFrom(first: string, offset: number): string {
  const date = new Date(`${first}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 7 * offset)
  return date.toISOString().slice(0, 10)
}

function validateWeekly(bundle: RecordValue, segmentIds: string[], firstWeek: string): void {
  const overview = object(bundle.overview, 'overview')
  const contributions = object(bundle.contributions, 'contributions')
  const overviewWeeks = array(overview.weekly, 'overview.weekly', 720)
  const contributionWeeks = array(contributions.weekly, 'contributions.weekly', 720)
  for (let s = 0; s < 6; s++) for (let t = 0; t < 120; t++) {
    const index = s * 120 + t
    const expectedDate = weekFrom(firstWeek, t)
    const expectedPeriod = t < 100 ? 'training' : 'holdout'
    const a = object(overviewWeeks[index], `overview.weekly[${index}]`)
    const b = object(contributionWeeks[index], `contributions.weekly[${index}]`)
    for (const [label, row] of [['overview', a], ['contributions', b]] as const) {
      const path = `${label}.weekly[${index}]`
      same(row.segment_id, segmentIds[s], `${path}.segment_id`)
      same(isoMonday(row.week_start, `${path}.week_start`), expectedDate, `${path}.week_start`)
      same(integer(row.time_index, `${path}.time_index`), t + 1, `${path}.time_index`)
      same(row.period, expectedPeriod, `${path}.period`)
      count(row.observed_sales_units, `${path}.observed_sales_units`)
      const predicted = summary(row.expected_sales_units, `${path}.expected_sales_units`)
      const residual = number(row.residual_to_expected_mean_units, `${path}.residual_to_expected_mean_units`)
      if (Math.abs(number(row.observed_sales_units, path) - predicted.mean - residual) > 0.0002) {
        fail(path, 'observed sales do not reconcile to expected mean plus residual')
      }
    }
    channelMap(a.planned_spend_usd, `overview.weekly[${index}].planned_spend_usd`, nonnegative)
    summary(a.predictive_sales_units, `overview.weekly[${index}].predictive_sales_units`)
    const baseline = summary(b.baseline_units, `contributions.weekly[${index}].baseline_units`)
    let sum = baseline.mean
    channelMap(b.channels_units, `contributions.weekly[${index}].channels_units`, (v, p) => {
      sum += summary(v, p).mean
    })
    if (Math.abs(sum - summary(b.expected_sales_units, 'expected').mean) > 0.0003) {
      fail(`contributions.weekly[${index}]`, 'component means do not reconcile')
    }
    same(b.observed_sales_units, a.observed_sales_units, `weekly[${index}].observed_sales_units`)
    if (Math.abs(summary(a.expected_sales_units, 'expected').mean -
                 summary(b.expected_sales_units, 'expected').mean) > 0.0001) {
      fail(`weekly[${index}]`, 'overview/contribution expected means disagree')
    }
  }
  const allOverview = array(overview.all_regions_weekly, 'overview.all_regions_weekly', 120)
  const allContributions = array(contributions.all_regions_weekly, 'contributions.all_regions_weekly', 120)
  for (let t = 0; t < 120; t++) {
    const a = object(allOverview[t], `overview.all_regions_weekly[${t}]`)
    const b = object(allContributions[t], `contributions.all_regions_weekly[${t}]`)
    const regionalOverview = segmentIds.map((_, s) => object(overviewWeeks[s * 120 + t], `overview.weekly[${s * 120 + t}]`))
    const regionalContributions = segmentIds.map((_, s) => object(contributionWeeks[s * 120 + t], `contributions.weekly[${s * 120 + t}]`))
    const observedTotal = regionalOverview.reduce((total, row) => total + number(row.observed_sales_units, 'observed'), 0)
    for (const [label, row] of [['overview', a], ['contributions', b]] as const) {
      const path = `${label}.all_regions_weekly[${t}]`
      same(row.segment_id, null, `${path}.segment_id`)
      same(isoMonday(row.week_start, `${path}.week_start`), weekFrom(firstWeek, t), `${path}.week_start`)
      same(integer(row.time_index, `${path}.time_index`), t + 1, `${path}.time_index`)
      same(row.period, t < 100 ? 'training' : 'holdout', `${path}.period`)
      same(count(row.observed_sales_units, `${path}.observed_sales_units`), observedTotal, `${path}.observed_sales_units`)
      const expected = summary(row.expected_sales_units, `${path}.expected_sales_units`)
      const regionalExpected = regionalOverview.reduce((total, part) => total + summary(part.expected_sales_units, 'expected').mean, 0)
      if (Math.abs(expected.mean - regionalExpected) > 0.001) fail(path, 'expected mean does not match regional sum')
      const residual = number(row.residual_to_expected_mean_units, `${path}.residual_to_expected_mean_units`)
      if (Math.abs(observedTotal - expected.mean - residual) > 0.0002) fail(path, 'residual does not reconcile')
    }
    summary(a.predictive_sales_units, `overview.all_regions_weekly[${t}].predictive_sales_units`)
    channelMap(a.planned_spend_usd, `overview.all_regions_weekly[${t}].planned_spend_usd`, nonnegative)
    channels.forEach(name => {
      const regionalSpend = regionalOverview.reduce((total, part) => total + number(object(part.planned_spend_usd, 'planned_spend_usd')[name], 'spend'), 0)
      if (Math.abs(number(object(a.planned_spend_usd, 'planned_spend_usd')[name], 'spend') - regionalSpend) > 0.001) {
        fail(`overview.all_regions_weekly[${t}].planned_spend_usd.${name}`, 'spend does not match regional sum')
      }
    })
    let componentMean = summary(b.baseline_units, `contributions.all_regions_weekly[${t}].baseline_units`).mean
    const regionalBaseline = regionalContributions.reduce((total, part) => total + summary(part.baseline_units, 'baseline').mean, 0)
    if (Math.abs(componentMean - regionalBaseline) > 0.001) fail(`contributions.all_regions_weekly[${t}]`, 'baseline mean does not match regional sum')
    channelMap(b.channels_units, `contributions.all_regions_weekly[${t}].channels_units`, (value, path) => {
      const name = path.split('.').at(-1) as typeof channels[number]
      const mean = summary(value, path).mean
      componentMean += mean
      const regionalMean = regionalContributions.reduce((total, part) => total + summary(object(part.channels_units, 'channels_units')[name], 'channel').mean, 0)
      if (Math.abs(mean - regionalMean) > 0.001) fail(path, 'channel mean does not match regional sum')
    })
    if (Math.abs(componentMean - summary(b.expected_sales_units, 'expected').mean) > 0.0003) {
      fail(`contributions.all_regions_weekly[${t}]`, 'component means do not reconcile')
    }
    if (Math.abs(summary(a.expected_sales_units, 'expected').mean - summary(b.expected_sales_units, 'expected').mean) > 0.0001) {
      fail(`all_regions_weekly[${t}]`, 'overview/contribution expected means disagree')
    }
  }
  for (const [label, rows] of [['overview', overview.aggregates], ['contributions', contributions.aggregates]] as const) {
    array(rows, `${label}.aggregates`, 21).forEach((entry, i) => {
      const row = object(entry, `${label}.aggregates[${i}]`)
      same(row.segment_id, i < 3 ? null : segmentIds[Math.floor(i / 3) - 1], `${label}.aggregates[${i}].segment_id`)
      same(row.period, ['all', 'training', 'holdout'][i % 3], `${label}.aggregates[${i}].period`)
      count(row.observed_sales_units, `${label}.aggregates[${i}].observed_sales_units`)
      channelMap(row.planned_spend_usd, `${label}.aggregates[${i}].planned_spend_usd`, nonnegative)
      const expected = summary(row.expected_sales_units, `${label}.aggregates[${i}].expected_sales_units`)
      summary(row.predictive_sales_units, `${label}.aggregates[${i}].predictive_sales_units`)
      if (Math.abs(number(row.observed_sales_units, 'observed') - expected.mean -
                   number(row.residual_to_expected_mean_units, 'residual')) > 0.0002) {
        fail(`${label}.aggregates[${i}]`, 'aggregate residual does not reconcile')
      }
      if (label === 'contributions') {
        let sum = summary(row.baseline_units, 'baseline').mean
        channelMap(row.channels_units, 'channels', (v, p) => { sum += summary(v, p).mean })
        if (Math.abs(sum - expected.mean) > 0.0003) fail(`${label}.aggregates[${i}]`, 'aggregate components do not reconcile')
      }
    })
  }
}

function validateSegments(value: unknown, segments: string[]): void {
  const data = object(value, 'segments')
  string(data.effect_definition, 'segments.effect_definition')
  string(data.interval_definition, 'segments.interval_definition')
  string(data.interpretation, 'segments.interpretation')
  const modelRecords = object(data.models, 'segments.models')
  sameList(Object.keys(modelRecords), models, 'segments.models keys')
  models.forEach(name => {
    const model = object(modelRecords[name], `segments.models.${name}`)
    const diagnostics = object(model.diagnostics, `${name}.diagnostics`)
    nonnegative(diagnostics.divergences, `${name}.divergences`)
    number(diagnostics.max_rhat, `${name}.max_rhat`)
    nonnegative(diagnostics.min_bulk_ess, `${name}.min_bulk_ess`)
    array(diagnostics.parameters_with_rhat_above_1_01, `${name}.rhat_flags`)
    const holdout = object(model.conditional_holdout, `${name}.conditional_holdout`)
    for (const field of ['mae_units', 'wape', 'bias_units_predicted_minus_observed', 'predictive_90_coverage']) {
      number(holdout[field], `${name}.${field}`)
    }
    const mae = object(holdout.segment_mae_units, `${name}.segment_mae_units`)
    sameKeys(mae, segments, `${name}.segment_mae_units keys`)
    segments.forEach(segment => nonnegative(mae[segment], `${name}.mae.${segment}`))
    const recovery = object(model.coefficient_recovery, `${name}.coefficient_recovery`)
    number(recovery.coefficient_90_coverage, `${name}.coverage`)
    nonnegative(recovery.coefficient_mean_absolute_error_units, `${name}.coefficient_mae`)
  })
  const effects = array(data.effects, 'segments.effects', 54)
  const seen = new Set<string>()
  effects.forEach((entry, i) => {
    const row = object(entry, `segments.effects[${i}]`)
    const key = `${row.pooling}/${row.segment_id}/${row.channel}`
    if (!models.includes(row.pooling as typeof models[number]) || !segments.includes(String(row.segment_id)) ||
        !channels.includes(row.channel as typeof channels[number]) || seen.has(key)) fail(`segments.effects[${i}]`, 'invalid or duplicate key')
    seen.add(key)
    const estimate = summary(row.maximum_effect_units, `segments.effects[${i}].maximum_effect_units`)
    const truth = nonnegative(row.synthetic_truth_units, `segments.effects[${i}].synthetic_truth_units`)
    same(row.interval_contains_truth, estimate.p05 <= truth && truth <= estimate.p95, `segments.effects[${i}].interval_contains_truth`)
  })
  const profiles = array(data.segment_profiles, 'segments.segment_profiles', 6)
  profiles.forEach((entry, i) => {
    const row = object(entry, `segments.segment_profiles[${i}]`)
    same(row.segment_id, segments[i], `segments.segment_profiles[${i}].segment_id`)
    nonnegative(row.training_mean_sales_units, `segments.segment_profiles[${i}].training_mean_sales_units`)
    channelMap(row.training_spend_cv, `segments.segment_profiles[${i}].training_spend_cv`, nonnegative)
  })
}

function validateSimulator(value: unknown, segments: string[], firstWeek: string): void {
  const data = object(value, 'simulator')
  same(data.reference_model, 'partial', 'simulator.reference_model')
  sameList(data.channel_order, channels, 'simulator.channel_order')
  sameList(data.segment_order, segments, 'simulator.segment_order')
  sameList(data.control_order, controls, 'simulator.control_order')
  const history = array(data.history_week_starts, 'simulator.history_week_starts', 108)
  const horizon = array(data.horizon_week_starts, 'simulator.horizon_week_starts', 12)
  history.forEach((week, i) => same(week, weekFrom(firstWeek, i), `simulator.history_week_starts[${i}]`))
  horizon.forEach((week, i) => same(week, weekFrom(firstWeek, i + 108), `simulator.horizon_week_starts[${i}]`))
  string(data.scenario_context, 'simulator.scenario_context')
  string(data.spend_support, 'simulator.spend_support')
  integer(data.draw_selection_seed, 'simulator.draw_selection_seed')
  const count = integer(data.draw_count, 'simulator.draw_count')
  const total = integer(data.source_posterior_draw_count, 'simulator.source_posterior_draw_count')
  const chainCount = integer(data.chain_count, 'simulator.chain_count')
  const drawsPerChain = integer(data.draws_per_chain, 'simulator.draws_per_chain')
  if (chainCount < 2 || drawsPerChain < 1 || chainCount * drawsPerChain !== total) {
    fail('simulator', 'posterior chain/draw dimensions do not reconcile')
  }
  if (count < 1 || count > total) fail('simulator.draw_count', 'invalid draw count')
  const transformation = object(data.transformation, 'simulator.transformation')
  for (const name of ['adstock', 'saturation', 'baseline', 'channel']) string(transformation[name], `simulator.transformation.${name}`)
  same(transformation.sales_scale, 100, 'simulator.transformation.sales_scale')
  same(transformation.spend_scale_usd, 1000, 'simulator.transformation.spend_scale_usd')
  array(data.segments, 'simulator.segments', 6).forEach((entry, s) => {
    const row = object(entry, `simulator.segments[${s}]`)
    same(row.segment_id, segments[s], `simulator.segments[${s}].segment_id`)
    numericMatrix(row.history_spend_usd, `simulator.segments[${s}].history_spend_usd`, 108, 3, nonnegative)
    numericMatrix(row.baseline_plan_usd, `simulator.segments[${s}].baseline_plan_usd`, 12, 3, nonnegative)
    numericMatrix(row.fixed_controls, `simulator.segments[${s}].fixed_controls`, 12, 7)
    array(row.spend_limits_usd, `simulator.segments[${s}].spend_limits_usd`, 3).forEach((entry, c) => {
      const limit = object(entry, `simulator.segments[${s}].spend_limits_usd[${c}]`)
      same(limit.channel, channels[c], `simulator.segments[${s}].spend_limits_usd[${c}].channel`)
      const max = nonnegative(limit.max_usd, 'max_usd')
      same(limit.min_usd, 0, 'min_usd')
      if (nonnegative(limit.training_max_usd, 'training_max_usd') > max ||
          nonnegative(limit.training_p95_usd, 'training_p95_usd') > max) fail('spend_limits_usd', 'training support exceeds allowed maximum')
      array(row.baseline_plan_usd, 'baseline_plan_usd').forEach((week, t) => {
        if (number(array(week, `baseline_plan_usd[${t}]`)[c], 'baseline spend') > max + 0.001) fail('baseline_plan_usd', 'exceeds allowed maximum')
      })
    })
  })
  const seen = new Set<number>()
  array(data.draws, 'simulator.draws', count).forEach((entry, i) => {
    const draw = object(entry, `simulator.draws[${i}]`)
    const id = integer(draw.joint_draw_index, `simulator.draws[${i}].joint_draw_index`)
    if (id < 0 || id >= total || seen.has(id)) fail(`simulator.draws[${i}]`, 'invalid or duplicate joint draw index')
    seen.add(id)
    same(integer(draw.chain_index, 'chain_index'), Math.floor(id / drawsPerChain), 'chain_index')
    same(integer(draw.chain_draw_index, 'chain_draw_index'), id % drawsPerChain, 'chain_draw_index')
    array(draw.intercept_scaled_by_segment, 'intercept_scaled_by_segment', 6).forEach((v, s) => number(v, `intercept[${s}]`))
    array(draw.control_coef, 'control_coef', 7).forEach((v, c) => number(v, `control_coef[${c}]`))
    numericMatrix(draw.beta_scaled_by_segment_channel, 'beta_scaled_by_segment_channel', 6, 3, nonnegative)
    array(draw.adstock_alpha, 'adstock_alpha', 3).forEach((v, c) => {
      const alpha = number(v, `adstock_alpha[${c}]`)
      if (alpha < 0 || alpha >= 1) fail(`adstock_alpha[${c}]`, 'outside [0,1)')
    })
    array(draw.half_saturation_thousands_usd, 'half_saturation_thousands_usd', 3).forEach((v, c) => nonnegative(v, `half_saturation[${c}]`))
    array(draw.noise_scaled_by_segment, 'noise_scaled_by_segment', 6).forEach((v, s) => nonnegative(v, `noise[${s}]`))
  })
}

/** Validate matching versions, keys, units, finite numbers, and numeric reconciliation. */
export function validateModelDataBundle(value: unknown): ModelDataBundle {
  finiteDeep(value, 'bundle')
  const bundle = object(value, 'bundle')
  const manifest = object(bundle.manifest, 'manifest')
  same(manifest.schema_version, 'm4-2', 'manifest.schema_version')
  hash(manifest.bundle_id, 'manifest.bundle_id')
  const generatedAt = string(manifest.generated_at_utc, 'manifest.generated_at_utc')
  if (!/(Z|\+00:00)$/.test(generatedAt) || Number.isNaN(Date.parse(generatedAt))) {
    fail('manifest.generated_at_utc', 'expected UTC timestamp')
  }
  same(manifest.reference_model, 'partial', 'manifest.reference_model')
  string(manifest.reference_model_note, 'manifest.reference_model_note')
  sameList(manifest.models, models, 'manifest.models')
  sameList(manifest.channels, channels, 'manifest.channels')
  const segmentIds = array(manifest.segments, 'manifest.segments', 6).map((x, i) => string(x, `manifest.segments[${i}]`))
  if (new Set(segmentIds).size !== 6) fail('manifest.segments', 'duplicate segment')
  const units = object(manifest.units, 'manifest.units')
  same(units.sales, 'units', 'manifest.units.sales')
  same(units.planned_spend, 'USD', 'manifest.units.planned_spend')
  same(units.time, 'Monday-start week', 'manifest.units.time')
  const dates = object(manifest.dates, 'manifest.dates')
  const firstWeek = isoMonday(dates.first_week, 'manifest.dates.first_week')
  same(dates.last_week, weekFrom(firstWeek, 119), 'manifest.dates.last_week')
  same(dates.last_training_week, weekFrom(firstWeek, 99), 'manifest.dates.last_training_week')
  same(dates.first_holdout_week, weekFrom(firstWeek, 100), 'manifest.dates.first_holdout_week')
  const lineage = object(manifest.lineage, 'manifest.lineage')
  for (const name of ['source_manifest_sha256', 'source_schema_sha256', 'etl_manifest_sha256',
    'model_input_sha256', 'fit_manifest_sha256', 'evaluation_sha256']) hash(lineage[name], `manifest.lineage.${name}`)
  same(lineage.etl_version, 'm2b-1', 'manifest.lineage.etl_version')
  same(lineage.model_version, 'm3-1', 'manifest.lineage.model_version')
  const posteriorHashes = object(lineage.posterior_sha256, 'manifest.lineage.posterior_sha256')
  sameKeys(posteriorHashes, models, 'manifest.lineage.posterior_sha256 keys')
  models.forEach(name => hash(posteriorHashes[name], `manifest.lineage.posterior_sha256.${name}`))
  const files = object(manifest.files, 'manifest.files')
  sameKeys(files, fileNames, 'manifest.files keys')
  fileNames.forEach(name => {
    const info = object(files[name], `manifest.files.${name}`)
    hash(info.sha256, `manifest.files.${name}.sha256`)
    if (integer(info.bytes, `manifest.files.${name}.bytes`) <= 0) fail(`manifest.files.${name}.bytes`, 'empty payload')
  })
  array(manifest.limitations, 'manifest.limitations').forEach((item, i) => string(item, `manifest.limitations[${i}]`))
  string(manifest.disclosure, 'manifest.disclosure')
  for (const name of ['overview', 'contributions', 'segments', 'simulator']) {
    const payload = object(bundle[name], name)
    same(payload.schema_version, 'm4-2', `${name}.schema_version`)
    same(payload.bundle_id, manifest.bundle_id, `${name}.bundle_id`)
    if (name === 'overview' || name === 'contributions') same(payload.reference_model, 'partial', `${name}.reference_model`)
  }
  const overview = object(bundle.overview, 'overview')
  const intervals = object(overview.intervals, 'overview.intervals')
  string(intervals.expected_sales_units, 'overview.intervals.expected_sales_units')
  string(intervals.predictive_sales_units, 'overview.intervals.predictive_sales_units')
  string(object(bundle.contributions, 'contributions').interpretation, 'contributions.interpretation')
  validateWeekly(bundle, segmentIds, firstWeek)
  validateSegments(bundle.segments, segmentIds)
  validateSimulator(bundle.simulator, segmentIds, firstWeek)
  return value as ModelDataBundle
}

async function fetchVerified(base: string, name: string, expectedHash: string, expectedBytes: number): Promise<unknown> {
  const response = await fetch(`${base}${name}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength !== expectedBytes) throw new Error(`${name}: byte count differs from manifest`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const actualHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
  if (actualHash !== expectedHash) throw new Error(`${name}: SHA-256 differs from manifest`)
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

/** Load static assets with content hashes; no backend or inference file is requested. */
export async function loadModelData(base = `${import.meta.env.BASE_URL}model-data/`): Promise<ModelDataBundle> {
  const response = await fetch(`${base}manifest.json`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`manifest.json: HTTP ${response.status}`)
  const manifest = await response.json() as RecordValue
  const files = object(manifest.files, 'manifest.files')
  const payloads = await Promise.all(fileNames.map(name => {
    const info = object(files[name], `manifest.files.${name}`)
    return fetchVerified(base, name, string(info.sha256, 'sha256'), number(info.bytes, 'bytes'))
  }))
  return validateModelDataBundle({ manifest, overview: payloads[0], contributions: payloads[1],
    segments: payloads[2], simulator: payloads[3] })
}
