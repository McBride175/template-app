import type { HTMLAttributes, ReactNode } from 'react'
import Card from './Card'
import { cn } from '@/lib/utils'

interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode
  description?: ReactNode
}

// Content and actions belong to features; no domain variants or automatic live region.
export default function EmptyState({ title, description, children, className, ...props }: EmptyStateProps) {
  return (
    <Card className={cn('p-6 text-center', className)} {...props}>
      <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
      {description && <p className="mt-2 text-sm text-text-secondary">{description}</p>}
      {children && <div className="mt-4">{children}</div>}
    </Card>
  )
}
