import type { ReactNode } from 'react'

export default function InvoiceDetails({ compact, children, label = 'Invoice details & dispute actions' }: { compact: boolean; children: ReactNode; label?: ReactNode }) {
  if (!compact) return <>{children}</>
  return <details className="mt-2 border-t border-border-default">
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-focus">{label}</summary>
    <div className="pb-2">{children}</div>
  </details>
}
