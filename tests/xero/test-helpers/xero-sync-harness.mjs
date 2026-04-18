import { loadTypeScriptModule } from './ts-module-loader.mjs'

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function createNextServerMock() {
  return {
    NextResponse: {
      json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status ?? 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    },
  }
}

function createFakeSupabaseAdminClient(state) {
  function tableRows(table) {
    if (table === 'xero_connections_public') return state.connections
    if (table === 'xero_oauth_grants') return state.grants
    if (table === 'xero_raw') return state.rawRows
    throw new Error(`Unsupported table: ${table}`)
  }

  function selectColumns(row, selectClause) {
    if (!selectClause || selectClause.trim() === '*' || selectClause.includes('*')) {
      return { ...row }
    }

    const columns = selectClause
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value.split(/\s+/)[0])

    const output = {}
    for (const column of columns) {
      output[column] = row[column]
    }
    return output
  }

  function createQuery(table) {
    const context = {
      mode: 'select',
      selectClause: null,
      updatePayload: null,
      filters: [],
      order: null,
      limit: null,
    }

    function applyFilters() {
      const rows = tableRows(table)
      return rows.filter((row) => context.filters.every((predicate) => predicate(row)))
    }

    function applyOrderAndLimit(rows) {
      let output = rows.slice()
      if (context.order) {
        const { column, ascending } = context.order
        output.sort((a, b) => {
          const left = a[column]
          const right = b[column]
          if (left === right) return 0
          if (left == null) return ascending ? 1 : -1
          if (right == null) return ascending ? -1 : 1
          if (left < right) return ascending ? -1 : 1
          return ascending ? 1 : -1
        })
      }
      if (typeof context.limit === 'number') {
        output = output.slice(0, context.limit)
      }
      return output
    }

    function execute() {
      if (context.mode === 'update') {
        const matchingRows = applyFilters()
        for (const row of matchingRows) {
          Object.assign(row, context.updatePayload ?? {})
        }
        const selectedRows = matchingRows.map((row) => selectColumns(row, context.selectClause))
        return Promise.resolve({ data: selectedRows, error: null })
      }

      const rows = applyOrderAndLimit(applyFilters())
      return Promise.resolve({
        data: rows.map((row) => selectColumns(row, context.selectClause)),
        error: null,
      })
    }

    const query = {
      select(clause) {
        context.selectClause = clause
        return query
      },
      update(payload) {
        context.mode = 'update'
        context.updatePayload = payload
        return query
      },
      eq(column, value) {
        context.filters.push((row) => row[column] === value)
        return query
      },
      neq(column, value) {
        context.filters.push((row) => row[column] !== value)
        return query
      },
      order(column, options = {}) {
        context.order = {
          column,
          ascending: options.ascending !== false,
        }
        return query
      },
      limit(limit) {
        context.limit = limit
        return query
      },
      maybeSingle() {
        return execute().then((result) => ({
          data: result.data[0] ?? null,
          error: result.error,
        }))
      },
      single() {
        return execute().then((result) => ({
          data: result.data[0] ?? null,
          error: result.error,
        }))
      },
      then(resolve, reject) {
        return execute().then(resolve, reject)
      },
    }

    return query
  }

  return {
    from(table) {
      return {
        ...createQuery(table),
        upsert(rows) {
          if (table !== 'xero_raw') {
            throw new Error(`Unsupported upsert table: ${table}`)
          }

          for (const row of rows) {
            const existing = state.rawRows.find(
              (candidate) =>
                candidate.user_id === row.user_id &&
                candidate.tenant_id === row.tenant_id &&
                candidate.resource_type === row.resource_type &&
                candidate.source_id === row.source_id
            )

            if (existing) {
              Object.assign(existing, row)
            } else {
              state.rawRows.push({ ...row })
            }
          }

          return Promise.resolve({ error: null })
        },
      }
    },
    async rpc(fn, args) {
      if (fn === 'acquire_xero_grant_refresh_lock') {
        const lock = state.grantLocks.get(args.p_grant_id)
        const now = Date.now()
        if (!lock || lock.expiresAtMs <= now || lock.lockId === args.p_lock_id) {
          const expiresAtMs = now + (args.p_ttl_seconds ?? 45) * 1000
          state.grantLocks.set(args.p_grant_id, {
            lockId: args.p_lock_id,
            expiresAtMs,
          })
          const grant = state.grants.find((row) => row.id === args.p_grant_id)
          if (grant) {
            grant.refresh_lock_id = args.p_lock_id
            grant.refresh_lock_expires_at = new Date(expiresAtMs).toISOString()
          }
          return { data: true, error: null }
        }
        return { data: false, error: null }
      }

      if (fn === 'release_xero_grant_refresh_lock') {
        const lock = state.grantLocks.get(args.p_grant_id)
        if (lock?.lockId === args.p_lock_id) {
          state.grantLocks.delete(args.p_grant_id)
          const grant = state.grants.find((row) => row.id === args.p_grant_id)
          if (grant) {
            grant.refresh_lock_id = null
            grant.refresh_lock_expires_at = null
          }
        }
        return { data: true, error: null }
      }

      throw new Error(`Unsupported RPC function: ${fn}`)
    },
  }
}

export function buildBaseSyncState() {
  return {
    connections: [],
    grants: [],
    rawRows: [],
    grantLocks: new Map(),
  }
}

export function createSyncHarness(options) {
  const refreshCalls = []
  const refreshBehavior = options.refreshBehavior
  const fetchCalls = []
  const fakeSupabaseAdmin = createFakeSupabaseAdminClient(options.state)

  class XeroTokenRefreshError extends Error {
    constructor(params) {
      super('Token refresh failed')
      this.status = params.status
      this.code = params.code ?? null
      this.description = params.description ?? null
      this.requiresReauth = params.requiresReauth
    }
  }

  class XeroAccountingApiError extends Error {
    constructor(params) {
      super(`Failed to fetch ${params.resourceType}`)
      this.status = params.status
      this.resourceType = params.resourceType
      this.responseBody = params.responseBody ?? null
      this.isAuthRelated = params.status === 401 || params.status === 403
    }
  }

  const module = loadTypeScriptModule(options.syncModuleSpecifier, {
    mocks: {
      'next/server': createNextServerMock(),
      '@/lib/supabase-admin': {
        createSupabaseAdminClient() {
          return fakeSupabaseAdmin
        },
      },
      '@/lib/xero/accounting': {
        async refreshXeroAccessToken(refreshToken) {
          refreshCalls.push({ refreshToken })
          return refreshBehavior({ refreshToken, callCount: refreshCalls.length, sleep })
        },
        shouldRefreshXeroAccessToken(expiresAt) {
          if (!expiresAt) return true
          return new Date(expiresAt).getTime() <= Date.now()
        },
        async fetchXeroAccountingResource(resourceType, accessToken, tenantId) {
          fetchCalls.push({ resourceType, accessToken, tenantId })
          return [{ id: `${resourceType}-${tenantId}` }]
        },
        getXeroSourceId(_resourceType, record) {
          return typeof record.id === 'string' ? record.id : null
        },
        XeroTokenRefreshError,
        XeroAccountingApiError,
      },
      '@/lib/xero/secrets': {
        decryptXeroToken(value) {
          return value
        },
        encryptXeroToken(value) {
          return value
        },
      },
      ...(options.extraMocks ?? {}),
    },
  })

  return {
    syncXeroTenantForUser: module.syncXeroTenantForUser,
    parseTenantId: module.parseTenantId,
    state: options.state,
    refreshCalls,
    fetchCalls,
    XeroTokenRefreshError,
  }
}

export function createRouteHarness(options = {}) {
  const tenantLocks = options.tenantLocks ?? new Map()
  const inflightSyncCalls = []

  function lockKey(userId, tenantId) {
    return `${userId}:${tenantId}`
  }

  const mocks = {
    'next/server': createNextServerMock(),
    '@/lib/supabase-admin': {
      createSupabaseAdminClient() {
        return {}
      },
    },
    '@/lib/xero/tenant-sync-lock': {
      async acquireXeroTenantSyncLock(params) {
        const key = lockKey(params.userId, params.tenantId)
        if (tenantLocks.has(key)) {
          return { acquired: false, error: null }
        }
        tenantLocks.set(key, params.lockId)
        return { acquired: true, error: null }
      },
      async releaseXeroTenantSyncLock(params) {
        const key = lockKey(params.userId, params.tenantId)
        if (tenantLocks.get(key) === params.lockId) {
          tenantLocks.delete(key)
        }
        return null
      },
    },
  }

  if (options.manualUserId) {
    mocks['@/lib/supabase-server'] = {
      async createServerSupabaseClient() {
        return {
          auth: {
            async getUser() {
              return {
                data: { user: { id: options.manualUserId } },
                error: null,
              }
            },
          },
        }
      },
    }
  }

  mocks['@/lib/xero/sync'] = {
    parseTenantId(value) {
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    },
    async syncXeroTenantForUser(params) {
      inflightSyncCalls.push(params)
      if (options.syncDelayMs) {
        await sleep(options.syncDelayMs)
      }
      return new Response(
        JSON.stringify({
          ok: true,
          tenantId: params.tenantId,
          counts: { accounts: 1, contacts: 1, invoices: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    },
  }

  return {
    tenantLocks,
    inflightSyncCalls,
    loadRoute(specifier) {
      return loadTypeScriptModule(specifier, { mocks })
    },
  }
}

export { sleep }
