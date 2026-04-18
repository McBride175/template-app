import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  buildXeroAuthorizationUrl,
  createOAuthState,
  XERO_STATE_COOKIE_NAME,
  XERO_STATE_USER_COOKIE_NAME,
} from '@/lib/xero/server'

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.redirect(new URL('/login?next=/account', request.url))
    }

    const state = createOAuthState()
    const authorizationUrl = buildXeroAuthorizationUrl({ state })

    const response = NextResponse.redirect(authorizationUrl)
    response.cookies.set({
      name: XERO_STATE_COOKIE_NAME,
      value: state,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/xero',
      maxAge: 60 * 10,
    })
    response.cookies.set({
      name: XERO_STATE_USER_COOKIE_NAME,
      value: user.id,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/xero',
      maxAge: 60 * 10,
    })

    return response
  } catch (error) {
    console.error('[xero.connect] Failed to start OAuth flow', {
      message: error instanceof Error ? error.message : 'Unknown error',
    })

    return NextResponse.json(
      { error: 'Unable to connect to Xero right now.' },
      { status: 500 }
    )
  }
}
