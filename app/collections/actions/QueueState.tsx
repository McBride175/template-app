import type { ReactNode } from 'react'
import EmptyState from '@/app/components/ui/EmptyState'
import Spinner from '@/app/components/ui/Spinner'

export default function QueueState({ title, description, loading = false, children }: {
  title: string; description?: string; loading?: boolean; children?: ReactNode
}) {
  return <EmptyState title={title} description={description} className="shadow-none" role={loading ? 'status' : undefined}>
    {loading && <Spinner label={null} />}
    {children}
  </EmptyState>
}
