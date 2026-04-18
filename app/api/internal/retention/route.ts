import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const DEFAULT_SUPPORT_TICKET_RETENTION_DAYS = 365

function getPositiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function isAuthorized(request: NextRequest) {
  const configuredSecret =
    process.env.RETENTION_CRON_SECRET ?? process.env.CRON_SECRET ?? ''

  if (!configuredSecret) {
    return { ok: false as const, reason: 'missing_secret' as const }
  }

  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : ''

  if (token !== configuredSecret) {
    return { ok: false as const, reason: 'invalid_secret' as const }
  }

  return { ok: true as const }
}

export async function POST(request: NextRequest) {
  const auth = isAuthorized(request)

  if (!auth.ok) {
    if (auth.reason === 'missing_secret') {
      return NextResponse.json(
        { error: 'Retention secret is not configured' },
        { status: 500 }
      )
    }

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: 'Supabase admin credentials are not configured' },
      { status: 500 }
    )
  }

  const retentionDays = getPositiveInteger(
    process.env.SUPPORT_TICKET_RETENTION_DAYS,
    DEFAULT_SUPPORT_TICKET_RETENTION_DAYS
  )
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const cutoffIso = cutoffDate.toISOString()

  const dryRun = request.nextUrl.searchParams.get('dryRun') === '1'

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  if (dryRun) {
    const [{ count: supportCount, error: supportError }, { count: exportCount, error: exportError }] =
      await Promise.all([
        admin
          .from('support_tickets')
          .select('id', { count: 'exact', head: true })
          .lt('created_at', cutoffIso),
        admin
          .from('privacy_exports')
          .select('id', { count: 'exact', head: true })
          .lt('expires_at', new Date().toISOString()),
      ])

    if (supportError || exportError) {
      console.error('[retention] dry_run_failed', {
        support_error: supportError?.message,
        export_error: exportError?.message,
      })
      return NextResponse.json(
        { error: 'Retention dry run failed' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      dryRun: true,
      support_ticket_retention_days: retentionDays,
      support_ticket_cutoff: cutoffIso,
      support_tickets_eligible_for_deletion: supportCount ?? 0,
      privacy_exports_eligible_for_deletion: exportCount ?? 0,
    })
  }

  const [{ count: supportDeleted, error: supportError }, { count: exportsDeleted, error: exportsError }] =
    await Promise.all([
      admin
        .from('support_tickets')
        .delete({ count: 'exact' })
        .lt('created_at', cutoffIso),
      admin
        .from('privacy_exports')
        .delete({ count: 'exact' })
        .lt('expires_at', new Date().toISOString()),
    ])

  if (supportError || exportsError) {
    console.error('[retention] delete_failed', {
      support_error: supportError?.message,
      export_error: exportsError?.message,
    })
    return NextResponse.json(
      { error: 'Retention cleanup failed' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    dryRun: false,
    support_ticket_retention_days: retentionDays,
    support_ticket_cutoff: cutoffIso,
    support_tickets_deleted: supportDeleted ?? 0,
    privacy_exports_deleted: exportsDeleted ?? 0,
  })
}
