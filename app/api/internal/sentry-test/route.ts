import { timingSafeEqual } from 'node:crypto'
import * as Sentry from '@sentry/nextjs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function secretsMatch(provided: string, expected: string) {
  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)

  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  )
}

export async function GET(request: Request) {
  const expectedSecret = process.env.SENTRY_VERIFY_SECRET
  const providedSecret = request.headers.get('x-sentry-verify')

  if (
    process.env.VERCEL_ENV !== 'preview' ||
    process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT !== 'test-preview' ||
    !expectedSecret ||
    !providedSecret ||
    !secretsMatch(providedSecret, expectedSecret)
  ) {
    return new Response('Not found', { status: 404 })
  }

  const verificationError = new Error('Sentry server verification 2026-09-14')
  Sentry.captureException(verificationError)
  await Sentry.flush(2_000)
  throw verificationError
}
