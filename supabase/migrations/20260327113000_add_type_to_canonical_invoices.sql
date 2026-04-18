alter table if exists public.canonical_invoices
  add column if not exists type text null;
