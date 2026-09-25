'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import MultiCurrencyPlanGate from '@/app/collections/MultiCurrencyPlanGate'
import Button from '@/app/components/Button'
import { buildLoginPath } from '@/lib/auth-flow'
import { fetchXeroConnectionStatus } from '@/lib/xero/account-status'
import FirstValueResultView, { type FirstValueResultPayload } from './FirstValueResultView'

type Props = {
  tenantId: string | null
}

type ResultResponse = Partial<FirstValueResultPayload> & {
  ok?: boolean
  code?: string
  tenantId?: string
  error?: string
  entitlement?: {
    freeUsageDaysLimit: number
  }
  experience?: {
    hasPriorCollectionActivity: boolean
  }
}

type LoadedResult = {
  data: FirstValueResultPayload
  tenantId: string
  organisationName: string | null
  lastSyncedAt: string | null
}

function dashboardPath(tenantId: string) {
  return `/dashboard?tenantId=${encodeURIComponent(tenantId)}`
}

export default function FirstValueResultClient({ tenantId }: Props) {
  const router = useRouter()
  const [version, setVersion] = useState(0)
  const [loaded, setLoaded] = useState<LoadedResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gate, setGate] = useState<'multi_currency' | 'usage_limit' | null>(null)

  const loadResult = useCallback(async () => {
    setLoading(true)
    setError(null)
    setGate(null)

    try {
      const params = new URLSearchParams({ limit: '200', overdueOnly: 'true' })
      if (tenantId) params.set('tenantId', tenantId)

      const statusPromise = fetchXeroConnectionStatus(tenantId).catch(() => null)
      const response = await fetch(`/api/collections/actions?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'include',
      })

      if (response.status === 401) {
        const nextPath = tenantId
          ? `/start/result?tenantId=${encodeURIComponent(tenantId)}`
          : '/start/result'
        router.replace(buildLoginPath(nextPath, 'session_expired'))
        return
      }

      const payload = (await response.json().catch(() => null)) as ResultResponse | null

      if (payload?.code === 'MULTI_CURRENCY_REQUIRES_PRO') {
        setGate('multi_currency')
        return
      }

      if (payload?.code === 'ACTION_USAGE_LIMIT_REACHED') {
        setGate('usage_limit')
        return
      }

      if (payload?.code === 'NO_XERO_TENANT') {
        router.replace('/start')
        return
      }

      if (
        !response.ok ||
        !payload?.ok ||
        !payload.tenantId ||
        !payload.rows ||
        !payload.actionsTakenByCustomerId ||
        !payload.queue ||
        !payload.currencyHealth
      ) {
        throw new Error(payload?.error || 'Yuohme could not load your priorities.')
      }

      if (payload.experience?.hasPriorCollectionActivity) {
        router.replace(dashboardPath(payload.tenantId))
        return
      }

      const status = await statusPromise
      setLoaded({
        data: payload as FirstValueResultPayload,
        tenantId: payload.tenantId,
        organisationName: status?.tenantName ?? null,
        lastSyncedAt: status?.lastSyncedAt ?? null,
      })
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Yuohme could not load your priorities.'
      )
    } finally {
      setLoading(false)
    }
  }, [router, tenantId])

  useEffect(() => {
    void loadResult()
  }, [loadResult, version])

  if (loading) {
    return (
      <FocusedResultState
        eyebrow="Analysis complete"
        title="Opening your priorities"
        message="Yuohme is loading your priorities from the latest Xero data."
      />
    )
  }

  if (gate === 'multi_currency') {
    return (
      <div className="mx-auto max-w-xl py-8 sm:py-12">
        <MultiCurrencyPlanGate />
      </div>
    )
  }

  if (gate === 'usage_limit') {
    return (
      <FocusedResultState
        eyebrow="Free allowance complete"
        title="Choose a plan to continue"
        message="Your five free collection-use days have been used. Your Xero data and existing Yuohme work remain unchanged."
        action={<Link href="/pricing" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-gray-900 px-6 py-3 text-sm font-semibold text-white hover:bg-gray-800">View plans</Link>}
      />
    )
  }

  if (error) {
    return (
      <FocusedResultState
        eyebrow="Result unavailable"
        title="Yuohme could not open your priorities"
        message={error}
        action={<Button className="min-h-12 rounded-xl px-6" onClick={() => setVersion((current) => current + 1)}>Try again</Button>}
      />
    )
  }

  if (!loaded) {
    return (
      <FocusedResultState
        eyebrow="Checking result"
        title="Opening your priorities"
        message="Yuohme is checking your latest priorities."
      />
    )
  }

  return (
    <FirstValueResultView
      data={loaded.data}
      tenantId={loaded.tenantId}
      organisationName={loaded.organisationName}
      lastSyncedAt={loaded.lastSyncedAt}
    />
  )
}

function FocusedResultState({
  eyebrow,
  title,
  message,
  action,
}: {
  eyebrow: string
  title: string
  message: string
  action?: React.ReactNode
}) {
  return (
    <section className="mx-auto max-w-xl py-8 sm:py-12">
      <div className="rounded-3xl border border-gray-200 bg-white p-7 shadow-sm sm:p-10">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-gray-500">{eyebrow}</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-gray-950">{title}</h1>
        <p className="mt-4 leading-relaxed text-gray-600">{message}</p>
        {action && <div className="mt-7">{action}</div>}
      </div>
    </section>
  )
}
