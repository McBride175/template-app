import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import {
  buildXeroAuthorizationUrl,
  createOAuthState,
  XERO_RETURN_COOKIE_NAME,
  XERO_STATE_COOKIE_NAME,
  XERO_STATE_USER_COOKIE_NAME,
} from '@/lib/xero/server'
import { buildLoginPath } from '@/lib/auth-flow'
import {
  buildXeroCallbackDestination,
  buildXeroConnectPath,
  sanitizeXeroReturnPath,
} from '@/lib/xero/oauth-return'

export async function GET(request: NextRequest) {
  const returnTo = sanitizeXeroReturnPath(request.nextUrl.searchParams.get('returnTo'))

  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.redirect(
        new URL(buildLoginPath(buildXeroConnectPath(returnTo)), request.url)
      )
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
    response.cookies.set({
      name: XERO_RETURN_COOKIE_NAME,
      value: returnTo,
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

    return NextResponse.redirect(
      new URL(
        buildXeroCallbackDestination({
          returnTo,
          result: 'error',
          reason: 'connect_failed',
        }),
        request.url
      )
    )
  }
}
