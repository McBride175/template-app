'use client'

import * as Sentry from '@sentry/nextjs'
import {
  classifyAuthOperationalFailure,
  getAuthErrorCode,
  type AuthAction,
} from '@/lib/auth-flow'

type AuthErrorStatus = {
  status?: unknown
}

export function reportAuthOperationalFailure(error: unknown, action: AuthAction) {
  const category = classifyAuthOperationalFailure(error, action)
  if (!category) return

  const code = getAuthErrorCode(error) ?? 'unknown'
  const rawStatus = error && typeof error === 'object' ? (error as AuthErrorStatus).status : null
  const status = typeof rawStatus === 'number' ? rawStatus : null
  const fields = { action, category, code, status }

  console.warn('[auth] operational failure', fields)
  Sentry.captureMessage('Supabase Auth operational failure', {
    level: 'warning',
    tags: {
      auth_action: action,
      auth_failure_category: category,
      auth_error_code: code,
    },
    extra: { auth_status: status },
  })
}
