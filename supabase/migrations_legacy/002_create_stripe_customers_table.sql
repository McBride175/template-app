-- TEMPLATE CODE: Create stripe_customers table to map Stripe customer IDs to Supabase user IDs
-- This table enables webhook handlers to resolve user_id when metadata is missing

CREATE TABLE IF NOT EXISTS stripe_customers (
  stripe_customer_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups by user_id
CREATE INDEX IF NOT EXISTS idx_stripe_customers_user_id ON stripe_customers(user_id);

-- Enable Row Level Security (RLS)
ALTER TABLE stripe_customers ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can manage all customer mappings (for webhooks and checkout)
-- Note: This requires the service role key, not the anon key
