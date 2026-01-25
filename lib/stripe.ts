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

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set in environment variables')
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
  typescript: true,
})
