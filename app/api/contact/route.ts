import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { resend } from '@/lib/resend'

const WINDOW_MS = 60_000
const MAX_REQUESTS_PER_WINDOW = 5

type RateLimitEntry = {
  count: number
  windowStart: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown'
  }

  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp

  return 'unknown'
}

function isRateLimited(ip: string) {
  const now = Date.now()
  const existing = rateLimitStore.get(ip)

  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, windowStart: now })
    return false
  }

  if (existing.count >= MAX_REQUESTS_PER_WINDOW) {
    return true
  }

  existing.count += 1
  rateLimitStore.set(ip, existing)
  return false
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

export async function POST(request: NextRequest) {
  const ip = getClientIp(request)
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    const payload: unknown = await request.json().catch(() => null)

    if (
      payload &&
      typeof payload === 'object' &&
      'company' in payload &&
      typeof (payload as { company?: unknown }).company === 'string' &&
      (payload as { company?: string }).company?.trim()
    ) {
      return NextResponse.json({ ok: true }, { status: 200 })
    }

    if (!isValidInput(payload)) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }

    const email = payload.email.trim()
    const subject = payload.subject.trim()
    const message = payload.message.trim()

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

    const { error: insertError } = await admin.from('support_tickets').insert({
      user_id: user?.id ?? null,
      email,
      subject,
      message,
      status: 'open',
    })

    if (insertError) {
      throw insertError
    }

    const supportInboxEmail = process.env.SUPPORT_INBOX_EMAIL
    if (!supportInboxEmail) {
      throw new Error('SUPPORT_INBOX_EMAIL is missing')
    }

    await resend.emails.send({
      to: supportInboxEmail,
      from: process.env.SUPPORT_FROM_EMAIL || 'Support <support@yourdomain.com>',
      subject: `New support ticket: ${subject}`,
      text: [
        `Email: ${email}`,
        user?.id ? `User ID: ${user.id}` : 'User ID: (not signed in)',
        '',
        'Message:',
        message,
      ].join('\n'),
    })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (error: any) {
    console.error('[contact]', error?.message ?? 'Unknown error')
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
