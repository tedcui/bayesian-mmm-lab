import { useState } from 'react'
import { PlotChart, type PlotTrace } from '../components/PlotChart'
import { channelLabel, channelOrder, regionLabel, type WeeklyFilter } from '../lib/analytics'
import { decimal, percent, units } from '../lib/format'
import type { Channel, ModelDataBundle, Pooling, SegmentEffect } from '../types/modelData'

const poolOrder: Pooling[] = ['complete', 'none', 'partial']
const poolLabel: Record<Pooling, string> = {
  complete: 'Complete pooling', none: 'No pooling', partial: 'Partial pooling',
}
const poolColor: Record<Pooling, string> = {
  complete: '#708a91', none: '#b7774b', partial: '#176d70',
}
const offsets: Record<Pooling, number> = { complete: -0.22, none: 0, partial: 0.22 }

function findEffect(effects: SegmentEffect[], pooling: Pooling, segmentId: string, channel: Channel) {
  const effect = effects.find(row => row.pooling === pooling && row.segment_id === segmentId && row.channel === channel)
  if (!effect) throw new Error(`Missing fitted effect: ${pooling}/${segmentId}/${channel}`)
  return effect
}

export function Segments({ bundle, filter }: { bundle: ModelDataBundle; filter: WeeklyFilter }) {
  const [channel, setChannel] = useState<Channel>('coupon')
  const { segments } = bundle
  const ids = bundle.manifest.segments
  const selectedProfile = segments.segment_profiles.find(row => row.segment_id === filter.segmentId)!
  const selectedEffects = poolOrder.map(pooling => findEffect(segments.effects, pooling, filter.segmentId, channel))
  const traces: PlotTrace[] = poolOrder.map(pooling => {
    const values = ids.map(id => findEffect(segments.effects, pooling, id, channel))
    return { type: 'scatter', mode: 'markers', name: poolLabel[pooling],
      x: values.map(row => row.maximum_effect_units.mean),
      y: ids.map((_, index) => index + offsets[pooling]),
      marker: { color: poolColor[pooling], size: 9, symbol: pooling === 'partial' ? 'diamond' : 'circle' },
      error_x: { type: 'data', symmetric: false, visible: true, thickness: 1.6, width: 4,
        array: values.map(row => row.maximum_effect_units.p95 - row.maximum_effect_units.mean),
        arrayminus: values.map(row => row.maximum_effect_units.mean - row.maximum_effect_units.p05) },
      customdata: values.map(row => [regionLabel(row.segment_id), row.maximum_effect_units.p05, row.maximum_effect_units.p95]),
      hovertemplate: '%{customdata[0]}<br>Mean: %{x:,.1f} units<br>90% credible interval: %{customdata[1]:,.1f}–%{customdata[2]:,.1f}<extra>%{fullData.name}</extra>',
    }
  })
  return <div className="page-stack">
    <div className="section-intro"><span className="section-kicker">03 / REGION COMPARISON</span>
      <h2>How model estimates compare</h2>
      <p>Compare how three models estimate marketing effects across six regions.</p>
    </div>
    <div className="model-grid">
      {poolOrder.map(pooling => {
        const model = segments.models[pooling]
        return <article className={`model-card ${pooling === 'partial' ? 'reference' : ''}`} key={pooling}>
          <div className="model-card-top"><span className="model-mark" style={{ background: poolColor[pooling] }} />
            <span>{pooling === 'partial' ? 'USED IN DASHBOARD' : 'ALTERNATIVE MODEL'}</span></div>
          <h3>{poolLabel[pooling]}</h3>
          <p>{pooling === 'complete' ? 'One shared channel effect for every region.' : pooling === 'none' ? 'Independent effects for each region.' : 'Regional effects share a population distribution.'}</p>
          <div className="model-stat"><span>Holdout sales error</span><strong>{percent(model.conditional_holdout.wape)}</strong></div>
        </article>
      })}
    </div>
    <section className="chart-card"><div className="card-header"><div><p className="section-kicker">REGIONAL EFFECTS</p><h3>Maximum modeled channel effect</h3></div>
      <label className="compact-label">Channel<select aria-label="Effect channel" value={channel}
        onChange={event => setChannel(event.target.value as Channel)}>
        {channelOrder.map(name => <option value={name} key={name}>{channelLabel[name]}</option>)}
      </select></label></div>
      <div className="chart-toolbar"><span>Selected region: <strong>{regionLabel(filter.segmentId)}</strong></span></div>
      <PlotChart label={`${channelLabel[channel]} maximum-effect estimates and 90% credible intervals across six business regions`}
        traces={traces} height={410} layout={{ margin: { l: 135, r: 24, t: 15, b: 72 },
          xaxis: { title: 'Maximum modeled weekly contribution (units)', rangemode: 'tozero', gridcolor: '#dedfd5' },
          yaxis: { tickvals: ids.map((_, index) => index), ticktext: ids.map(regionLabel),
            range: [-0.6, ids.length - 0.4], autorange: 'reversed', showgrid: false, zeroline: false } }} />
      <p className="chart-caption">Points show each model's estimated maximum weekly contribution; bars show <strong>90% credible intervals</strong>. These estimates describe the model's response at full saturation, not sales per dollar or proven causal lift.</p>
    </section>
    <div className="two-column segment-lower">
      <section className="detail-card"><p className="section-kicker">SELECTED REGION</p><h3>{regionLabel(filter.segmentId)} · {channelLabel[channel]}</h3>
        <p className="detail-note">Average weekly sales during training: <strong>{units(selectedProfile.training_mean_sales_units)} units</strong>.</p>
        <div className="effect-table" role="table" aria-label="Selected regional effect estimates">
          <div className="effect-table-head" role="row"><span role="columnheader">Model</span><span role="columnheader">Mean</span><span role="columnheader">90% credible interval</span></div>
          {selectedEffects.map(effect => <div className="effect-table-row" role="row" key={effect.pooling}>
            <span role="cell"><span className="legend-dot" style={{ background: poolColor[effect.pooling] }} /> {poolLabel[effect.pooling]}</span>
            <strong role="cell">{decimal(effect.maximum_effect_units.mean)} units</strong>
            <span role="cell">{decimal(effect.maximum_effect_units.p05)}–{decimal(effect.maximum_effect_units.p95)}</span>
          </div>)}
        </div>
      </section>
      <section className="detail-card insight-card"><p className="section-kicker">REGIONAL DIFFERENCES</p><h3>Why the model estimates differ</h3>
        <p>Smaller regions such as Pacific Coast and Mountain West provide less information about each channel's effect.</p>
        <p>Partial pooling shares information across regions. That can steady an estimate, but it can also smooth over a real difference.</p>
        <div className="insight-stat"><span>Partial-pooling effect here</span><strong>{decimal(selectedEffects[2].maximum_effect_units.mean)} units</strong></div>
        <div className="insight-stat"><span>No-pooling effect here</span><strong>{decimal(selectedEffects[1].maximum_effect_units.mean)} units</strong></div>
        <p className="detail-note">Here, partial pooling can understate real regional differences. A good sales fit does not confirm each channel's effect.</p>
      </section>
    </div>
  </div>
}
