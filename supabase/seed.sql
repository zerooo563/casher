-- =============================================================
-- Phase 0 Development Seed Data
-- DEV ONLY — NOT FOR PRODUCTION
-- =============================================================

-- 1. Development Tenant (Default currency: ILS - Israeli New Shekel)
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

-- 2. Default Branch for Dev Tenant
INSERT INTO public.branches (id, tenant_id, name, name_ar, is_active)
VALUES (
  'c1000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  'Main Branch',
  'الفرع الرئيسي',
  true
)
ON CONFLICT (id) DO NOTHING;

-- 3. Default Fiscal Year (2026) for Dev Tenant
INSERT INTO public.fiscal_years (id, tenant_id, name, start_date, end_date, is_closed)
VALUES (
  'd1000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  '2026',
  '2026-01-01',
  '2026-12-31',
  false
)
ON CONFLICT (id) DO NOTHING;

-- 4. Dev Admin User Link (DEV ONLY)
-- In Supabase Cloud, after creating your user in the Supabase Auth Dashboard (e.g. admin@casher.dev):
-- Map the user ID to tenant_users:
--
-- INSERT INTO public.tenant_users (tenant_id, user_id, role_id, is_active)
-- VALUES (
--   'a1000000-0000-0000-0000-000000000001',
--   '<AUTH_USER_UUID_FROM_SUPABASE_DASHBOARD>',
--   'b1000000-0000-0000-0000-000000000001', -- Owner role
--   true
-- )
-- ON CONFLICT (tenant_id, user_id) DO NOTHING;
