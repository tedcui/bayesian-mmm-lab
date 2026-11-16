import { useEffect, useRef, useState } from 'react'

export type PlotTrace = Record<string, unknown>
export type PlotLayout = Record<string, unknown>

interface Props {
  label: string
  traces: PlotTrace[]
  layout?: PlotLayout
  height?: number
}

const emptyLayout: PlotLayout = {}

/** Load Plotly only after the validated data has loaded and a chart is visible. */
export function PlotChart({ label, traces, layout = emptyLayout, height = 340 }: Props) {
  const element = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const node = element.current
    if (!node) return
    let active = true
    let plotly: typeof import('plotly.js-basic-dist-min').default | undefined
    let observer: ResizeObserver | undefined
    import('plotly.js-basic-dist-min').then(async module => {
      if (!active) return
      plotly = module.default
      await plotly.react(node, traces, {
        autosize: true,
        height,
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { family: 'Inter, system-ui, sans-serif', color: '#526a60', size: 12 },
        margin: { l: 55, r: 16, t: 28, b: 50 },
        hovermode: 'x unified',
        legend: { orientation: 'h', y: -0.25, x: 0 },
        ...layout,
      }, { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['lasso2d', 'select2d'] })
      if (active && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => plotly?.Plots.resize(node))
        observer.observe(node)
      }
    }).catch(() => { if (active) setError('Chart could not be rendered.') })
    return () => {
      active = false
      observer?.disconnect()
      if (plotly) plotly.purge(node)
    }
  }, [traces, layout, height])

  return <div className="chart-host" role="img" aria-label={label}>
    {error ? <p role="alert" className="text-red-700">{error}</p> : <div ref={element} className="w-full" />}
  </div>
}
