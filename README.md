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

Copy `.env.example` to `.env.local` and populate only the values needed for local development. `.env.example` is the complete variable-name inventory and contains no credentials.

Never commit `.env.local` or put a server secret in a `NEXT_PUBLIC_*` variable. Preview and Production use the same variable names with environment-scoped values in Vercel. See `ARCHITECTURE.md` for the confirmed Supabase and deployment mapping.

### Setting up Stripe

1. Create a Stripe account and get your API keys
2. Create a Product and Price in Stripe Dashboard (monthly subscription)
3. Copy the Price ID to `STRIPE_PRICE_ID_PRO`
4. Set up webhook endpoint in Stripe Dashboard:
   - URL: `https://yourdomain.com/api/webhooks/stripe`
   - Events to listen for:
     - `checkout.session.completed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
5. Copy the webhook signing secret to `STRIPE_WEBHOOK_SECRET`

### Database Setup

The active database chain contains one canonical baseline plus future forward-only migrations. Historical SQL is archived under `supabase/migrations_legacy/` and must not be replayed.

```bash
supabase start
supabase db reset
```

These commands target the local Supabase stack. Do not run hosted `db push`, migration repair, or manual SQL without explicit authorization and an exact project-ref preflight.

### Retention Job Setup

The template includes `POST /api/internal/retention` to enforce support ticket deletion after a configurable retention period.

Use your scheduler (for example Vercel Cron, GitHub Actions, or your own worker) to call:

```bash
curl -X POST "https://yourdomain.com/api/internal/retention" \
  -H "Authorization: Bearer $RETENTION_CRON_SECRET"
```

Optional dry run:

```bash
curl -X POST "https://yourdomain.com/api/internal/retention?dryRun=1" \
  -H "Authorization: Bearer $RETENTION_CRON_SECRET"
```

### Optional Scheduled Xero Sync Setup

The template includes `POST /api/internal/xero/scheduled-sync` for conservative background syncing.

By default it is disabled and it only targets:
- users with an active Xero connection (`auth_state = 'active'`)
- connections that still have an OAuth grant
- users with recent `last_sign_in_at` activity inside `XERO_SCHEDULED_SYNC_ACTIVITY_WINDOW_HOURS`

It also includes an internal run lock and cadence gate (`XERO_SCHEDULED_SYNC_MIN_INTERVAL_MINUTES`) to avoid overlapping/frequent runs.

Suggested invocation:

```bash
curl -X POST "https://yourdomain.com/api/internal/xero/scheduled-sync" \
  -H "Authorization: Bearer $XERO_SYNC_INTERNAL_SECRET"
```

Dry run (eligibility preview only):

```bash
curl -X POST "https://yourdomain.com/api/internal/xero/scheduled-sync?dryRun=1" \
  -H "Authorization: Bearer $XERO_SYNC_INTERNAL_SECRET"
```

### Privacy Requests (GDPR / UK GDPR)

The template includes auditable data-subject rights APIs under `/api/privacy/*`:

- `POST /api/privacy/requests` create a request (`ACCESS_EXPORT`, `RECTIFICATION`, `RESTRICTION`, `OBJECTION`, `ERASURE`)
- `GET /api/privacy/requests` list your requests (includes `due_at` and computed `overdue`)
- `GET /api/privacy/requests/:id` view one request + event history
- `POST /api/privacy/export` generate a JSON export bundle
- `GET /api/privacy/export/:exportId` get a short-lived signed download URL
- `GET /api/privacy/export/:exportId/download?token=...` download export
- `POST /api/privacy/rectify` submit rectification requests (self-serve preference fields can auto-fulfill)
- `POST /api/privacy/restrict` apply processing restriction / opt-out flags
- `POST /api/privacy/object` apply objection-related opt-out flags

Admin review endpoint:

- `PATCH /api/admin/privacy/requests/:id` update request status (`IN_PROGRESS`, `FULFILLED`, `DENIED`) and append an audit event

Admin access is controlled by:

- `PRIVACY_ADMIN_EMAILS` comma-separated list of admin email addresses.

Export signing configuration:

- `PRIVACY_EXPORT_SIGNING_SECRET` secret used to sign download URLs.
- Fallback: `RETENTION_CRON_SECRET` if `PRIVACY_EXPORT_SIGNING_SECRET` is unset.

Recent-session requirement:

- Export and account deletion require a recently issued session token (default max age: 30 minutes).

Run privacy tests:

```bash
pnpm test:privacy
```

## Learn More

To learn more about Next.js, take a look at the following  resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
