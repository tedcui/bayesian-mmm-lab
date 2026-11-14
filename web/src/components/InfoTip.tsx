import type { ReactNode } from 'react'

export function InfoTip({ children, text }: { children: ReactNode; text: string }) {
  return <span className="inline-flex items-center gap-1">
    {children}<span className="info-tip" tabIndex={0} role="note" aria-label={text} title={text}>i</span>
  </span>
}
