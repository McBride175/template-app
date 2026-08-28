-- TEMPLATE CODE: Add stripe_price_id to subscriptions for plan mapping

ALTER TABLE public.subscriptions
ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_price_id
ON public.subscriptions(stripe_price_id);
