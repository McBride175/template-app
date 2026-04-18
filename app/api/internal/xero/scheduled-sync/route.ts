import { NextRequest, NextResponse } from 'next/server'
import { runScheduledXeroSyncJob } from '@/lib/xero/scheduled-sync'

function isAuthorized(request: NextRequest) {
  const configuredSecret = process.env.XERO_SYNC_INTERNAL_SECRET ?? process.env.CRON_SECRET ?? ''

  if (!configuredSecret) {
    return { ok: false as const, reason: 'missing_secret' as const }
  }

  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : ''

  if (token !== configuredSecret) {
    return { ok: false as const, reason: 'invalid_secret' as const }
  }

  return { ok: true as const }
}

function parseLimit(value: string | null) {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

export async function POST(request: NextRequest) {
  const auth = isAuthorized(request)

  if (!auth.ok) {
    if (auth.reason === 'missing_secret') {
      return NextResponse.json({ error: 'Xero internal sync secret is not configured' }, { status: 500 })
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1'
  const limit = parseLimit(request.nextUrl.searchParams.get('limit'))

  return runScheduledXeroSyncJob({
    dryRun,
    limitOverride: limit,
  })
}
