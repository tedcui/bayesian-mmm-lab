import type { ReactNode } from 'react'
import { InfoTip } from './InfoTip'

export function MetricCard({ label, value, sub, tip }: {
  label: string; value: ReactNode; sub?: string; tip?: string
}) {
  return <div className="metric-card">
    <p className="metric-label">{tip ? <InfoTip text={tip}>{label}</InfoTip> : label}</p>
    <p className="metric-value">{value}</p>
    {sub && <p className="metric-sub">{sub}</p>}
  </div>
}
