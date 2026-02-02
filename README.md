This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Environment Variables

### Required for Supabase Auth
- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Your Supabase anonymous key

### Required for Stripe Subscriptions
- `STRIPE_SECRET_KEY` - Your Stripe secret key (starts with `sk_`)
- `STRIPE_PRICE_ID_PRO` - Comma-separated Stripe Price IDs for Pro (live + test allowed)
- `STRIPE_PRICE_ID_BASIC` - Comma-separated Stripe Price IDs for Basic (live + test allowed)
- `STRIPE_WEBHOOK_SECRET` - Webhook signing secret from Stripe Dashboard
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (for webhook operations)

### Setting up Stripe

1. Create a Stripe account and get your API keys
2. Create a Product and Price in Stripe Dashboard (monthly subscription)
3. Copy the Price ID to `STRIPE_PRICE_ID_PRO`
4. Set up webhook endpoint in Stripe Dashboard:
   - URL: `https://yourdomain.com/api/webhooks/stripe`
   - Events to listen for:
     - `checkout.session.completed`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
5. Copy the webhook signing secret to `STRIPE_WEBHOOK_SECRET`

### Database Setup

Run the migration to create the subscriptions table:

```bash
# If using Supabase CLI
supabase db push

# Or run the SQL manually in Supabase Dashboard SQL Editor
# File: supabase/migrations/001_create_subscriptions_table.sql
```

## Learn More

To learn more about Next.js, take a look at the following  resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
