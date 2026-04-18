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
- `STRIPE_PRICE_ID_PRO` - Your Stripe Price ID for the Pro subscription plan
- `STRIPE_PRICE_ID_BASIC` - Your Stripe Price ID for the Basic subscription plan
- `STRIPE_WEBHOOK_SECRET` - Webhook signing secret from Stripe Dashboard
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (for webhook operations)

### Required for Contact Support Notifications
- `SUPPORT_INBOX_EMAIL` - Destination inbox that receives support notification emails. If missing, tickets are still created and API returns `ok: true` with `emailSent: false`.
- `RESEND_API_KEY` - Required only for sending support notification emails. If missing, tickets are still created and API returns `ok: true` with `emailSent: false`.
- `SUPPORT_FROM_EMAIL` - Optional sender identity for support emails. Defaults to `onboarding@resend.dev` when unset.

### Required for Xero Connection Management
- `XERO_CLIENT_ID` - OAuth client ID from your Xero app
- `XERO_CLIENT_SECRET` - OAuth client secret from your Xero app
- `XERO_REDIRECT_URI` - OAuth callback URL (must match `/api/xero/callback`)
- `XERO_TOKEN_ENCRYPTION_KEY` - 32-byte key (base64 or 64-char hex) used to encrypt Xero OAuth tokens at rest

### Optional for Internal Xero Sync Jobs
- `XERO_SYNC_INTERNAL_SECRET` - Secret used by `/api/internal/xero/sync` and `/api/internal/xero/scheduled-sync` (or use `CRON_SECRET`)
- `XERO_SCHEDULED_SYNC_ENABLED` - Off-switch flag for scheduled sync path. Defaults to disabled (`false`).
- `XERO_SCHEDULED_SYNC_BATCH_SIZE` - Maximum eligible connections processed per run. Defaults to `25`.
- `XERO_SCHEDULED_SYNC_ACTIVITY_WINDOW_HOURS` - Only users with `last_sign_in_at` in this recent window are eligible. Defaults to `168` (7 days).
- `XERO_SCHEDULED_SYNC_MIN_INTERVAL_MINUTES` - Minimum interval between run starts. Defaults to `120` (2 hours).
- `XERO_SCHEDULED_SYNC_RUN_LOCK_TTL_SECONDS` - Safety TTL for the scheduled run lock. Defaults to `900` (15 minutes).

### Optional for Xero Activity-Based Auto Sync
- `XERO_AUTO_SYNC_STALE_MINUTES` - Data freshness threshold used by `/api/xero/sync/auto` before triggering background sync (defaults to `60`)
- `XERO_AUTO_SYNC_COOLDOWN_SECONDS` - Minimum delay between automatic sync triggers per tenant (defaults to `300`)
- `XERO_AUTO_SYNC_LOCK_TTL_SECONDS` - Lock TTL used to prevent duplicate in-flight automatic syncs per tenant (defaults to `180`)

### Required for Retention Cleanup Automation
- `RETENTION_CRON_SECRET` - Secret used by `/api/internal/retention` (or use `CRON_SECRET`)

### Optional GDPR Template Metadata
- `DATA_CONTROLLER_NAME` - Displayed in the privacy policy controller section
- `DATA_CONTROLLER_EMAIL` - Privacy request email shown in the privacy policy
- `DATA_PROTECTION_OFFICER_CONTACT` - DPO contact shown in privacy policy (if appointed)
- `EU_REPRESENTATIVE_CONTACT` - EU representative contact shown in privacy policy (if required)
- `SUPPORT_TICKET_RETENTION_DAYS` - Retention period for support tickets (defaults to `365`)

Server-only variables must be set in Vercel Preview and Production environments. Do not expose them as `NEXT_PUBLIC_*`.

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
