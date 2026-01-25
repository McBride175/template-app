/**
 * Stripe client initialization
 * 
 * TEMPLATE CODE: Server-side Stripe client setup.
 * Uses environment variables for API keys.
 * 
 * SECURITY: This file MUST NOT be imported in client components.
 * It uses STRIPE_SECRET_KEY which must never be exposed to the client.
 */
import 'server-only'
import Stripe from 'stripe'

const secretKey = process.env.STRIPE_SECRET_KEY

if (!secretKey) {
  throw new Error('Missing STRIPE_SECRET_KEY')
}

export const stripe = new Stripe(secretKey, {
  typescript: true,
  // ✅ Don’t set apiVersion in a reusable template.
  // Stripe will use your account’s API version.
})
