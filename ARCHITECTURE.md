# Architecture Documentation

## Critical Gotchas

1. **`subscriptions` table design**: PRIMARY KEY is `user_id` (one row per user, one-to-one relationship). `stripe_customer_id` and `stripe_subscription_id` are UNIQUE constraints to prevent duplicates.

2. **Authentication pattern**: Application reads use ANON key + RLS policies (users can only read their own data). Webhooks and checkout write using SERVICE ROLE key (bypasses RLS, never exposed to client).

3. **Webhook ordering**: Webhook events are not guaranteed to arrive in order. `customer.subscription.created` or `.updated` can arrive before `checkout.session.completed`. Duplicate events can also occur. All handlers use idempotent upsert logic to handle these cases.

4. **`current_period_end` nullability**: `current_period_end` can be `null` temporarily (e.g., pending subscriptions before first billing period). The `hasActive` logic in `GET /api/subscription` handles this by treating `null` as "active if status is active/trialing".

5. **Vercel environment scoping**: Use the same environment variable names across all environments. Scope values in Vercel: Preview = test-mode Stripe keys, Production = live-mode Stripe keys. Vercel automatically injects the correct values based on deployment environment.

---

## Systems of Record

### Supabase Auth
- **Primary system** for user authentication and identity
- Stores user accounts (`auth.users` table)
- Manages OAuth sessions via cookies (httpOnly, secure)
- Session refreshed on every request via Next.js middleware
- User ID (`user_id`) is the primary key linking all user data

### Stripe
- **Source of truth** for subscription state and billing
- Stores customer records, subscriptions, payment methods
- Webhooks deliver subscription lifecycle events
- Subscription status, period dates, and customer IDs originate here

### Supabase Database (Cache)
- **Cached/denormalized** subscription data for fast reads
- `subscriptions` table: mirrors Stripe subscription state
- `stripe_customers` table: maps `stripe_customer_id` → `user_id`
- Updated via webhooks, not directly by application code
- Used for authorization checks and UI display

**Key Principle**: Stripe is authoritative. Supabase DB is a cache that must be kept in sync via webhooks.

---

## Database Schema

### `subscriptions` Table

**Columns:**
- `user_id` (UUID, PRIMARY KEY) - References `auth.users(id)` ON DELETE CASCADE
- `stripe_customer_id` (TEXT, UNIQUE, NOT NULL) - Stripe customer ID
- `stripe_subscription_id` (TEXT, UNIQUE, NOT NULL) - Stripe subscription ID
- `stripe_price_id` (TEXT, NULLABLE) - Stripe price ID for plan mapping
- `status` (TEXT, NOT NULL) - Subscription status: `active`, `trialing`, `past_due`, `canceled`, `pending`
- `current_period_end` (TIMESTAMPTZ, NULLABLE) - End of current billing period (nullable for pending subscriptions)
- `created_at` (TIMESTAMPTZ) - Row creation timestamp
- `updated_at` (TIMESTAMPTZ) - Auto-updated on row modification

**Indexes:**
- `idx_subscriptions_stripe_customer_id` on `stripe_customer_id`
- `idx_subscriptions_stripe_subscription_id` on `stripe_subscription_id`
- `idx_subscriptions_status` on `status`

**RLS Policies:**
- `Users can view own subscription`: SELECT allowed where `auth.uid() = user_id`
- Service role key required for INSERT/UPDATE (webhooks and checkout)

### `stripe_customers` Table

**Columns:**
- `stripe_customer_id` (TEXT, PRIMARY KEY) - Stripe customer ID
- `user_id` (UUID, NOT NULL) - References `auth.users(id)` ON DELETE CASCADE
- `created_at` (TIMESTAMPTZ) - Row creation timestamp

**Indexes:**
- `idx_stripe_customers_user_id` on `user_id`

**RLS Policies:**
- Service role key required for all operations (bypasses RLS)
- Used by webhooks to resolve `user_id` when Stripe metadata is missing

**Purpose**: Enables webhook handlers to map `stripe_customer_id` → `user_id` when subscription events lack metadata.

---

## Request Flows

### Login Flow
1. User clicks "Sign in with Google" → `app/login/page.tsx`
2. Client calls `supabase.auth.signInWithOAuth()` with redirect to `/auth/callback`
3. User authenticates with Google OAuth provider
4. OAuth provider redirects to `/auth/callback?code=...`
5. `app/auth/callback/route.ts` exchanges code for session via `supabase.auth.exchangeCodeForSession()`
6. Session cookies set (httpOnly, secure)
7. Redirect to `/dashboard`
8. Middleware refreshes session on every subsequent request

### Notes CRUD Flow
1. **Read**: Client calls `fetchNotes()` → Supabase client queries `notes` table with RLS
2. **Create**: Client calls `addNote(content, userId)` → Supabase client inserts into `notes` table
3. **Delete**: Client calls `deleteNote(id)` → Supabase client deletes from `notes` table
4. All operations use Supabase client with session cookies (RLS enforces user isolation)

### Subscribe → Checkout → Stripe → Webhook → DB → UI Flow

1. **User initiates subscription** (`app/dashboard/page.tsx`)
   - Client calls `POST /api/checkout` with session cookies

2. **Checkout API** (`app/api/checkout/route.ts`)
   - Authenticates user via session cookies or Bearer token
   - Checks for existing subscription in `subscriptions` table
   - Creates Stripe customer if missing (with `supabase_user_id` metadata)
   - Upserts `stripe_customers` mapping (customer_id → user_id)
   - Creates Stripe Checkout Session
   - Returns checkout URL to client

3. **User completes payment** (Stripe-hosted checkout page)
   - User enters payment details on Stripe
   - Stripe processes payment and creates subscription

4. **Stripe webhook events** (delivered to `/api/webhooks/stripe`)
   - `checkout.session.completed`: Creates/updates subscription record with `status='pending'`, `current_period_end=null`
   - `customer.subscription.created`: Updates subscription with full details (status, `current_period_end`)
   - `customer.subscription.updated`: Updates subscription status and period dates
   - `customer.subscription.deleted`: Sets `status='canceled'`

5. **Webhook handler** (`app/api/webhooks/stripe/route.ts`)
   - Verifies webhook signature
   - Resolves `user_id` via `stripe_customers` table or existing subscription record
   - Updates `subscriptions` table using service role key (bypasses RLS)
   - Upserts `stripe_customers` mapping (non-critical, logs warning on failure)

6. **UI updates** (`app/dashboard/page.tsx`)
   - Client polls `GET /api/subscription` to check status
   - `SubscriptionStatus` component displays current subscription state
   - `SubscribeSection` shows subscribe button or active status

---

## API Routes

### `POST /api/checkout`
**Purpose**: Create Stripe Checkout Session for authenticated user

**Authentication**: Session cookies or Bearer token

**Reads:**
- `subscriptions` table (checks for existing subscription)

**Writes:**
- Stripe API (creates customer, creates checkout session)
- `stripe_customers` table (upserts customer mapping via service role)

**Returns**: `{ url: string }` - Stripe Checkout URL

**Error Handling**: Returns 500 if Stripe API fails or `STRIPE_PRICE_ID_PRO` missing

### `POST /api/webhooks/stripe`
**Purpose**: Handle Stripe webhook events and sync subscription state to database

**Authentication**: Webhook signature verification (not user auth)

**Reads:**
- Stripe API (retrieves full subscription object for `.created` and `.updated` events)
- `stripe_customers` table (resolves user_id from customer_id)
- `subscriptions` table (fallback user_id resolution, checks for existing records)

**Writes:**
- `subscriptions` table (upserts subscription records via service role)
- `stripe_customers` table (upserts customer mapping via service role, non-critical)

**Events Handled:**
- `checkout.session.completed`: Creates pending subscription record
- `customer.subscription.created`: Updates subscription with full details
- `customer.subscription.updated`: Updates subscription status/period
- `customer.subscription.deleted`: Marks subscription as canceled

**Returns**: `{ received: true }` on success, `{ error: string }` on failure (triggers Stripe retry)

### `GET /api/subscription`
**Purpose**: Get current user's subscription status

**Authentication**: Session cookies (via Supabase client)

**Reads:**
- `subscriptions` table (queries by `user_id` with RLS)

**Writes**: None

**Returns**: `{ hasActive: boolean, status: string | null, current_period_end: string | null }`

**Caching**: No-cache headers set (subscription status must be fresh)

---

## Environment Variable Strategy

### Variable Names (Same Across All Environments)

**Public (Client-Exposed):**
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key

**Server-Only (Never Exposed to Client):**
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key (bypasses RLS)
- `STRIPE_SECRET_KEY` - Stripe secret key (`sk_test_...` or `sk_live_...`)
- `STRIPE_PRICE_ID_PRO` - Comma-separated Stripe Price IDs for Pro (live + test allowed)
- `STRIPE_PRICE_ID_BASIC` - Comma-separated Stripe Price IDs for Basic (live + test allowed)
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signing secret

### Environment Scoping in Vercel

**Local Development:**
- Set variables in `.env.local` (gitignored)
- Use test-mode Stripe keys and test webhook secret

**Vercel Preview:**
- Set variables in Vercel project settings → Environment Variables
- Scope to "Preview" environment
- Use test-mode Stripe keys and preview webhook endpoint secret

**Vercel Production:**
- Set variables in Vercel project settings → Environment Variables
- Scope to "Production" environment
- Use live-mode Stripe keys and production webhook endpoint secret

**Key Principle**: Same variable names, different values per environment. Vercel automatically injects the correct values based on deployment environment.

---

## Invariants & Failure Modes

### Invariants

1. **One subscription per user**: `subscriptions.user_id` is PRIMARY KEY (one-to-one relationship)
2. **Stripe is authoritative**: Database state must match Stripe state (enforced via webhooks)
3. **Customer mapping must exist**: `stripe_customers` table should have entry for every active subscription
4. **Webhook idempotency**: Webhook handlers use upsert logic to handle duplicate events safely

### Failure Modes

#### Webhook Ordering Issues
**Problem**: Webhooks may arrive out of order (e.g., `customer.subscription.created` before `checkout.session.completed`)

**Mitigation**:
- `checkout.session.completed` handler uses UPDATE-then-INSERT pattern (avoids NOT NULL violations)
- `customer.subscription.created` handler retrieves full subscription from Stripe API (ensures complete data)
- Both handlers use upsert logic to handle race conditions

#### Missing Metadata
**Problem**: Stripe webhook events may lack `supabase_user_id` in metadata (e.g., subscription created via Stripe Dashboard)

**Mitigation**:
- Webhook handlers resolve `user_id` via `stripe_customers` table lookup (primary strategy)
- Fallback: query `subscriptions` table by `stripe_subscription_id` to get existing `user_id`
- If `user_id` cannot be resolved, webhook returns 200 with warning log (no DB write, prevents infinite retries)

#### Duplicate Webhook Events
**Problem**: Stripe may deliver the same webhook event multiple times

**Mitigation**:
- All webhook handlers use upsert operations (UPDATE preferred, INSERT if row missing)
- Unique constraints on `user_id`, `stripe_customer_id`, `stripe_subscription_id` prevent duplicates
- Handlers are idempotent (safe to retry)

#### `current_period_end` Null
**Problem**: `current_period_end` may be null for pending subscriptions (before first billing period starts)

**Mitigation**:
- Column is nullable (migration `20260127182739_make_current_period_end_nullable.sql`)
- `checkout.session.completed` sets `current_period_end=null` (subscription pending)
- `customer.subscription.created` and `.updated` retrieve period from Stripe API and set value
- `GET /api/subscription` treats null `current_period_end` as "active if status is active/trialing"

#### Webhook Signature Verification Failure
**Problem**: Invalid or missing webhook signature header

**Mitigation**:
- Webhook handler verifies signature before processing
- Returns 400 if signature missing or invalid (prevents unauthorized webhook calls)

#### Database Write Failures
**Problem**: Supabase database write fails during webhook processing

**Mitigation**:
- Webhook handler returns 500 on DB errors (triggers Stripe retry)
- Structured logging includes operation type, user_id, subscription_id for debugging
- Customer mapping upsert failures are non-critical (logged as warnings, don't fail webhook)

#### Checkout Session Creation Failure
**Problem**: Stripe API fails or environment misconfiguration

**Mitigation**:
- Returns 500 with error details (debug info only in non-production)
- Validates `STRIPE_PRICE_ID_PRO` exists before creating session
- Optional: Validates Stripe key mode matches price ID mode (live key with test price = error)
