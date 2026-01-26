/**
 * API Route: Debug Billing Configuration
 * 
 * TEMPLATE CODE: Debug endpoint to check billing environment configuration.
 * Only enabled in non-production environments for safety.
 */
import { NextResponse } from 'next/server'

export async function GET() {
  // Only enable in non-production environments
  if (process.env.VERCEL_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    VERCEL_ENV: process.env.VERCEL_ENV,
    STRIPE_SECRET_KEY_prefix: (process.env.STRIPE_SECRET_KEY ?? '').slice(0, 8),
    STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID,
    STRIPE_WEBHOOK_SECRET_prefix: (process.env.STRIPE_WEBHOOK_SECRET ?? '').slice(0, 8),
  })
}
