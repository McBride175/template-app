import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import {
  canAccessPrivacyResource,
  isOverdue,
  isSessionRecent,
  isAdminEmail,
} from '@/lib/privacy-utils.mjs'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const PRIVACY_MAX_SESSION_AGE_SECONDS = 30 * 60

export type PrivacyRequestType =
  | 'ACCESS_EXPORT'
  | 'RECTIFICATION'
  | 'RESTRICTION'
  | 'OBJECTION'
  | 'ERASURE'

export type PrivacyRequestStatus =
  | 'RECEIVED'
  | 'VERIFYING'
  | 'IN_PROGRESS'
  | 'FULFILLED'
  | 'DENIED'

export type PrivacyRequestRow = {
  id: string
  user_id: string | null
  type: PrivacyRequestType
  status: PrivacyRequestStatus
  details: Record<string, unknown>
  created_at: string
  updated_at: string
  due_at: string
  fulfilled_at: string | null
  denial_reason: string | null
}

export function withOverdue<T extends { due_at: string; status: PrivacyRequestStatus }>(item: T) {
  return {
    ...item,
    overdue: isOverdue(item.due_at, item.status),
  }
}

export async function getAuthenticatedContext() {
  const supabase = await createServerSupabaseClient()

  const [{ data: userData, error: authError }, { data: sessionData }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession(),
  ])

  if (authError || !userData.user) {
    return { user: null, session: null }
  }

  return {
    user: userData.user,
    session: sessionData.session,
  }
}

export function hasRecentSession(accessToken: string | undefined) {
  return isSessionRecent(accessToken, PRIVACY_MAX_SESSION_AGE_SECONDS)
}

export function isAdminUser(email: string | undefined | null) {
  return isAdminEmail(email ?? '', process.env.PRIVACY_ADMIN_EMAILS)
}

export function canAccessRequest(
  actorUserId: string,
  ownerUserId: string | null,
  admin: boolean
) {
  return canAccessPrivacyResource({
    actorUserId,
    ownerUserId,
    isAdmin: admin,
  })
}

export function createPrivacyAdminClient() {
  return createSupabaseAdminClient()
}

export async function createPrivacyRequest(params: {
  userId: string
  type: PrivacyRequestType
  status?: PrivacyRequestStatus
  details?: Record<string, unknown>
  denialReason?: string | null
  fulfilledAt?: string | null
}) {
  const admin = createPrivacyAdminClient()
  const now = new Date().toISOString()

  const { data, error } = await admin
    .from('privacy_requests')
    .insert({
      user_id: params.userId,
      type: params.type,
      status: params.status ?? 'RECEIVED',
      details: params.details ?? {},
      denial_reason: params.denialReason ?? null,
      fulfilled_at: params.fulfilledAt ?? null,
      updated_at: now,
    })
    .select('*')
    .single<PrivacyRequestRow>()

  if (error) {
    throw error
  }

  return data
}

export async function appendPrivacyEvent(params: {
  requestId: string
  actorUserId?: string | null
  actorRole: 'user' | 'admin' | 'system'
  action: string
  note?: string
}) {
  const admin = createPrivacyAdminClient()

  const { error } = await admin.from('privacy_request_events').insert({
    request_id: params.requestId,
    actor_user_id: params.actorUserId ?? null,
    actor_role: params.actorRole,
    action: params.action,
    note: params.note ?? null,
  })

  if (error) {
    throw error
  }
}

export async function upsertPrivacyPreferences(params: {
  userId: string
  processing_restricted: boolean
  marketing_opt_out: boolean
  analytics_opt_out: boolean
  ai_processing_opt_out: boolean
}) {
  const admin = createPrivacyAdminClient()

  const { data, error } = await admin
    .from('user_privacy_preferences')
    .upsert(
      {
        user_id: params.userId,
        processing_restricted: params.processing_restricted,
        marketing_opt_out: params.marketing_opt_out,
        analytics_opt_out: params.analytics_opt_out,
        ai_processing_opt_out: params.ai_processing_opt_out,
      },
      {
        onConflict: 'user_id',
      }
    )
    .select('*')
    .single()

  if (error) {
    throw error
  }

  return data
}

export async function getPrivacyPreferences(userId: string) {
  const admin = createPrivacyAdminClient()

  const { data, error } = await admin
    .from('user_privacy_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw error
  }

  return (
    data ?? {
      user_id: userId,
      processing_restricted: false,
      marketing_opt_out: true,
      analytics_opt_out: false,
      ai_processing_opt_out: false,
    }
  )
}
