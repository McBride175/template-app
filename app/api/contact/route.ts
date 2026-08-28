import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { createServerSupabaseClient } from '@/lib/supabase-server'

const RATE_LIMIT_WINDOW_MS = 10 * 60_000
const MAX_REQUESTS_PER_IP = 5
const MAX_REQUESTS_PER_EMAIL = 3
const DEFAULT_SUPPORT_FROM_EMAIL = 'onboarding@resend.dev'

type RateLimitEntry = {
  count: number
  windowStart: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()
const emailRateLimitStore = new Map<string, RateLimitEntry>()

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown'
  }

  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp

  return 'unknown'
}

function isRateLimited(
  store: Map<string, RateLimitEntry>,
  key: string,
  maxRequests: number
) {
  const now = Date.now()
  const existing = store.get(key)

  if (!existing || now - existing.windowStart >= RATE_LIMIT_WINDOW_MS) {
    store.set(key, { count: 1, windowStart: now })
    return false
  }

  if (existing.count >= maxRequests) {
    return true
  }

  existing.count += 1
  store.set(key, existing)
  return false
}

function createRequestId() {
  return crypto.randomUUID()
}

function logContactRequest(result: 'accepted' | 'rejected', reason: string, requestId: string) {
  const logger = result === 'accepted' ? console.info : console.warn
  logger('[contact] request', {
    result,
    reason,
    request_id: requestId,
  })
}

function isValidInput(input: unknown): input is { email: string; subject: string; message: string; company?: string } {
  if (!input || typeof input !== 'object') return false

  const value = input as { email?: unknown; subject?: unknown; message?: unknown; company?: unknown }

  if (typeof value.email !== 'string' || typeof value.subject !== 'string' || typeof value.message !== 'string') {
    return false
  }

  const email = value.email.trim()
  const subject = value.subject.trim()
  const message = value.message.trim()

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (!email || !emailRegex.test(email)) return false
  if (!subject || subject.length > 120) return false
  if (!message || message.length > 4000) return false
  if (value.company !== undefined && typeof value.company !== 'string') return false

  return true
}

function isMissingSupportTicketsTableError(error: unknown) {
  if (!error || typeof error !== 'object') return false

  const value = error as { code?: unknown; message?: unknown }
  const code = typeof value.code === 'string' ? value.code : ''
  const message = typeof value.message === 'string' ? value.message.toLowerCase() : ''

  if (code === 'PGRST205') return true
  return message.includes('support_tickets') && message.includes('could not find the table')
}

function getErrorMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== 'object') return fallback

  const message = (error as { message?: unknown }).message
  if (typeof message !== 'string' || !message.trim()) return fallback

  return message
}

export async function POST(request: NextRequest) {
  const requestId = createRequestId()
  const ip = getClientIp(request)

  try {
    const payload: unknown = await request.json().catch(() => null)

    // Honeypot trap: bots filling hidden fields get a successful no-op response.
    if (
      payload &&
      typeof payload === 'object' &&
      'company' in payload &&
      typeof (payload as { company?: unknown }).company === 'string' &&
      (payload as { company?: string }).company?.trim()
    ) {
      logContactRequest('rejected', 'honeypot_triggered', requestId)
      return NextResponse.json({ ok: true, emailSent: false }, { status: 200 })
    }

    if (!isValidInput(payload)) {
      logContactRequest('rejected', 'invalid_input', requestId)
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }

    const email = payload.email.trim()
    const subject = payload.subject.trim()
    const message = payload.message.trim()
    const normalizedEmail = email.toLowerCase()

    // In-memory fixed-window limits to reduce abuse with minimal user friction.
    if (isRateLimited(rateLimitStore, ip, MAX_REQUESTS_PER_IP)) {
      logContactRequest('rejected', 'rate_limit_ip', requestId)
      return NextResponse.json(
        { ok: false, error: 'Too many requests. Please try again later.' },
        { status: 429 }
      )
    }

    if (isRateLimited(emailRateLimitStore, normalizedEmail, MAX_REQUESTS_PER_EMAIL)) {
      logContactRequest('rejected', 'rate_limit_email', requestId)
      return NextResponse.json(
        { ok: false, error: 'Too many requests. Please try again later.' },
        { status: 429 }
      )
    }

    const supabaseSessionClient = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabaseSessionClient.auth.getUser()

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    )

    const { data: insertedTicket, error: insertError } = await admin
      .from('support_tickets')
      .insert({
        user_id: user?.id ?? null,
        email,
        subject,
        message,
        status: 'open',
      })
      .select('id')
      .single()

    if (insertError) {
      if (isMissingSupportTicketsTableError(insertError)) {
        logContactRequest('rejected', 'support_ticket_table_missing', requestId)
        return NextResponse.json(
          {
            error:
              'Support ticket storage is not configured yet. Please run the latest database migrations.',
          },
          { status: 503 }
        )
      }
      throw insertError
    }

    const ticketId = insertedTicket?.id
    if (!ticketId) {
      throw new Error('Support ticket insert succeeded but ticket id was missing')
    }

    let emailSent = false
    let emailFailureCode = ''

    const supportInboxEmail = process.env.SUPPORT_INBOX_EMAIL?.trim()
    const resendApiKey = process.env.RESEND_API_KEY?.trim()
    const supportFromEmail =
      process.env.SUPPORT_FROM_EMAIL?.trim() || DEFAULT_SUPPORT_FROM_EMAIL

    if (!supportInboxEmail) {
      emailFailureCode = 'missing_support_inbox_email'
    } else if (!resendApiKey) {
      emailFailureCode = 'missing_resend_api_key'
    } else {
      try {
        const resendClient = new Resend(resendApiKey)
        const { error: resendError } = await resendClient.emails.send({
          to: supportInboxEmail,
          from: supportFromEmail,
          subject: `New support ticket: ${subject}`,
          text: [
            `Email: ${email}`,
            user?.id ? `User ID: ${user.id}` : 'User ID: (not signed in)',
            '',
            'Message:',
            message,
          ].join('\n'),
        })

        if (resendError) {
          emailFailureCode = 'resend_send_failed'
        } else {
          emailSent = true
        }
      } catch {
        emailFailureCode = 'resend_send_failed'
      }
    }

    if (!emailSent) {
      console.warn('[contact] support_email_not_sent', {
        ticket_id: ticketId,
        failure_code: emailFailureCode || 'email_delivery_skipped',
      })
    }

    logContactRequest('accepted', emailSent ? 'accepted' : 'accepted_email_pending', requestId)
    return NextResponse.json({ ok: true, emailSent }, { status: 200 })
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error, 'Unknown error')
    logContactRequest('rejected', 'server_error', requestId)
    console.error('[contact] request_failed', {
      request_id: requestId,
      error_type: errorMessage === 'Unknown error' ? 'unknown' : 'runtime_error',
    })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
