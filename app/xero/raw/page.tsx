'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Card from '@/app/components/Card'
import { supabase } from '@/lib/supabase'

type ResourceType = 'accounts' | 'contacts' | 'invoices'
type XeroAuthState = 'active' | 'reauth_required' | 'disconnected' | 'error'

interface XeroRawRow {
  id: string
  tenant_id: string
  resource_type: ResourceType
  source_id: string
  raw_json: unknown
  fetched_at: string
  updated_at: string
}

interface XeroStatusConnection {
  tenantId: string
  tenantName: string | null
  authState: XeroAuthState
}

interface XeroStatusResponse {
  tenantId: string | null
  connections: XeroStatusConnection[]
}

const RESOURCE_TABS: Array<{ key: ResourceType; label: string }> = [
  { key: 'accounts', label: 'Accounts' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'invoices', label: 'Invoices' },
]

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Invalid date'
  return date.toLocaleString()
}

function parseTenantId(value: string | null) {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export default function XeroRawPage() {
  const router = useRouter()
  const [activeResource, setActiveResource] = useState<ResourceType>('accounts')
  const [rows, setRows] = useState<XeroRawRow[]>([])
  const [connections, setConnections] = useState<XeroStatusConnection[]>([])
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadStatus = async () => {
      const { data } = await supabase.auth.getSession()
      if (!data.session?.user) {
        router.replace('/login?next=/xero/raw')
        return
      }

      const requestedTenantId = parseTenantId(
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('tenantId')
          : null
      )

      const params = new URLSearchParams()
      if (requestedTenantId) {
        params.set('tenantId', requestedTenantId)
      }

      const statusUrl =
        params.size > 0 ? `/api/xero/status?${params.toString()}` : '/api/xero/status'
      const response = await fetch(statusUrl, {
        cache: 'no-store',
        credentials: 'include',
      })

      if (!response.ok) {
        setError('Failed to load tenant context.')
        setLoading(false)
        return
      }

      const payload = (await response.json()) as XeroStatusResponse
      setConnections(payload.connections ?? [])
      setSelectedTenantId(payload.tenantId ?? null)
    }

    void loadStatus()
  }, [router])

  useEffect(() => {
    const loadRows = async () => {
      if (!selectedTenantId) {
        setRows([])
        setLoading(false)
        return
      }

      const { data } = await supabase.auth.getSession()
      if (!data.session?.user) {
        router.replace('/login?next=/xero/raw')
        return
      }

      setLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({
          resourceType: activeResource,
          limit: '20',
          tenantId: selectedTenantId,
        })
        const response = await fetch(`/api/xero/raw?${params.toString()}`, {
          cache: 'no-store',
          credentials: 'include',
        })

        if (!response.ok) {
          let message = 'Failed to load Xero raw data.'
          try {
            const payload = await response.json()
            if (typeof payload?.error === 'string') {
              message = payload.error
            }
          } catch {
            // ignore parse failures
          }
          throw new Error(message)
        }

        const payload = (await response.json()) as { rows?: XeroRawRow[] }
        setRows(payload.rows ?? [])
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to load Xero raw data.')
      } finally {
        setLoading(false)
      }
    }

    void loadRows()
  }, [activeResource, router, selectedTenantId])

  const handleTenantChange = (tenantId: string) => {
    setSelectedTenantId(tenantId)
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      params.set('tenantId', tenantId)
      router.replace(`/xero/raw?${params.toString()}`)
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Xero Raw JSON</h1>
          <p className="mt-1 text-sm text-gray-600">
            Inspect raw Xero Accounting payloads stored in Supabase.
          </p>
        </div>
        <Link
          href="/admin"
          className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50"
        >
          Back to Admin
        </Link>
      </div>

      {connections.length > 0 && (
        <label className="block max-w-xl space-y-2 text-sm text-gray-700" htmlFor="raw-tenant-select">
          <span>Organisation</span>
          <select
            id="raw-tenant-select"
            value={selectedTenantId ?? ''}
            onChange={(event) => handleTenantChange(event.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900"
          >
            {connections.map((connection) => (
              <option key={connection.tenantId} value={connection.tenantId}>
                {(connection.tenantName?.trim() || connection.tenantId) + ` (${connection.authState})`}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        {RESOURCE_TABS.map((tab) => {
          const active = tab.key === activeResource
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveResource(tab.key)}
              className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-gray-900 text-white'
                  : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {loading && <p className="text-sm text-gray-600">Loading raw data…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && !error && !selectedTenantId && (
        <p className="text-sm text-gray-600">No tenant selected. Connect a Xero organisation first.</p>
      )}

      {!loading && !error && selectedTenantId && rows.length === 0 && (
        <Card>
          <p className="text-sm text-gray-700">No raw rows found for this resource yet.</p>
        </Card>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="space-y-4">
          {rows.map((row) => (
            <Card key={row.id}>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-700">
                  <p>
                    <span className="font-medium text-gray-900">resource_type:</span>{' '}
                    {row.resource_type}
                  </p>
                  <p>
                    <span className="font-medium text-gray-900">source_id:</span> {row.source_id}
                  </p>
                  <p>
                    <span className="font-medium text-gray-900">fetched_at:</span>{' '}
                    {formatDateTime(row.fetched_at)}
                  </p>
                </div>

                <details>
                  <summary className="cursor-pointer text-sm font-medium text-gray-900">
                    View raw JSON
                  </summary>
                  <pre className="mt-2 max-h-[24rem] overflow-auto rounded-md bg-gray-50 p-3 text-xs text-gray-800">
                    {JSON.stringify(row.raw_json, null, 2)}
                  </pre>
                </details>
              </div>
            </Card>
          ))}
        </div>
      )}
    </main>
  )
}
