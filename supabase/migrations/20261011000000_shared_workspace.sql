-- Shared workspace bootstrap for the account-less collaborative data-entry phase.
-- Guarantees the fixed workspace tenant row exists (the catalog FK points to it).
-- Idempotent: safe to re-apply. Matches slug/settings from supabase/seed.sql.

INSERT INTO public.tenants (id, name, slug, settings, is_active)
VALUES (
  'a1000000-0000-0000-0000-000000000001',
  'كاشر للتجارة (بيئة التطوير)',
  'casher-dev',
  '{
    "currency": "ILS",
    "currency_symbol": "₪",
    "language": "ar",
    "timezone": "Asia/Jerusalem",
    "date_format": "DD/MM/YYYY",
    "fiscal_year_start_month": 1
  }'::jsonb,
  true
)
ON CONFLICT (slug) DO UPDATE
SET settings = EXCLUDED.settings;
