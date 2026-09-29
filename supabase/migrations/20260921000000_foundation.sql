-- =============================================================
-- Phase 0 Foundation Migration
-- Project: Casher ERP/POS/Inventory SaaS
-- Date: 2026-09-21
-- Author: Antigravity Agent
--
-- Creates:
--   tenants, tenant_users, roles, permissions, role_permissions,
--   branches, fiscal_years, audit_log
--   SECURITY DEFINER helper functions
--   Custom Access Token Hook function
--   RLS policies on all tables
-- =============================================================

-- --------------- EXTENSIONS ---------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================
-- TABLES
-- =============================================================

-- ---- tenants -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  settings    JSONB NOT NULL DEFAULT '{
    "currency": "ILS",
    "currency_symbol": "₪",
    "language": "ar",
    "timezone": "Asia/Jerusalem",
    "date_format": "DD/MM/YYYY",
    "fiscal_year_start_month": 1
  }'::jsonb,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tenants IS
  'Top-level tenant (company/business). One row per SaaS customer.';
COMMENT ON COLUMN public.tenants.settings IS
  'Per-tenant configuration: currency (default ILS), language, timezone, etc. Currency is NEVER hardcoded in business logic.';

-- ---- permissions -------------------------------------------
-- System-wide permission registry. No tenant scope.
CREATE TABLE IF NOT EXISTS public.permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,   -- e.g. 'pos.checkout'
  description TEXT,
  module      TEXT NOT NULL           -- e.g. 'pos', 'inventory', 'accounting'
);

COMMENT ON TABLE public.permissions IS
  'Global permission registry. Managed via migrations only. No direct user mutations.';

-- ---- roles -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- NULL tenant_id = system role (available to all tenants)
  name        TEXT NOT NULL,
  description TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

COMMENT ON TABLE public.roles IS
  'Roles available in the system. System roles (tenant_id IS NULL) are seeded and cannot be deleted.';

-- ---- role_permissions --------------------------------------
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id       UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ---- tenant_users ------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id     UUID NOT NULL REFERENCES public.roles(id),
  -- NO free-text role column: role is resolved via role_id -> roles
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

COMMENT ON TABLE public.tenant_users IS
  'Maps auth.users to tenants. role_id is the ONLY role reference — no duplicate text role column.';

-- ---- branches ----------------------------------------------
CREATE TABLE IF NOT EXISTS public.branches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  name_ar     TEXT NOT NULL,
  address     TEXT,
  phone       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES auth.users(id),
  updated_by  UUID REFERENCES auth.users(id),
  is_deleted  BOOLEAN NOT NULL DEFAULT false
);

-- ---- fiscal_years ------------------------------------------
CREATE TABLE IF NOT EXISTS public.fiscal_years (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  is_closed   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES auth.users(id),
  updated_by  UUID REFERENCES auth.users(id),
  CONSTRAINT fiscal_year_dates_check CHECK (end_date > start_date)
);

-- ---- audit_log ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id),
  action      TEXT NOT NULL,        -- e.g. 'create', 'update', 'void', 'post'
  entity_type TEXT NOT NULL,        -- e.g. 'sale', 'journal', 'product'
  entity_id   UUID,
  old_value   JSONB,
  new_value   JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  -- NO updated_at: audit records are immutable
);

COMMENT ON TABLE public.audit_log IS
  'Append-only audit trail. No UPDATE or DELETE allowed via RLS.';

-- =============================================================
-- INDEXES (for RLS performance + FK lookups)
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant_id ON public.tenant_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_user_id   ON public.tenant_users(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_role_id   ON public.tenant_users(role_id);
CREATE INDEX IF NOT EXISTS idx_roles_tenant_id         ON public.roles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role   ON public.role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_branches_tenant_id      ON public.branches(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_years_tenant_id  ON public.fiscal_years(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_id     ON public.audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id       ON public.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity        ON public.audit_log(entity_type, entity_id);

-- =============================================================
-- SECURITY DEFINER HELPER FUNCTIONS
-- (bypass RLS safely for authorization lookups)
-- =============================================================

-- Returns the tenant_id from the JWT app_metadata claim
CREATE OR REPLACE FUNCTION public.auth_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid;
$$;

-- Returns the role name from the JWT app_metadata claim
CREATE OR REPLACE FUNCTION public.auth_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.jwt() -> 'app_metadata' ->> 'role';
$$;

-- Checks if the current user has a named permission
-- Uses SECURITY DEFINER so it can bypass RLS on auth tables safely
CREATE OR REPLACE FUNCTION public.auth_has_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    JOIN public.permissions      p  ON p.id  = rp.permission_id
    JOIN public.tenant_users     tu ON tu.role_id = rp.role_id
    WHERE tu.user_id   = auth.uid()
      AND tu.is_active = true
      AND p.name       = p_permission
  );
$$;

GRANT EXECUTE ON FUNCTION public.auth_tenant_id()           TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_role()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_has_permission(text)  TO authenticated;

-- =============================================================
-- CUSTOM ACCESS TOKEN HOOK
-- Single mechanism for injecting tenant_id, role_id, role into JWT.
-- No database trigger for JWT claims — only this hook.
-- =============================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id  uuid;
  v_role_id    uuid;
  v_role_name  text;
  v_claims     jsonb;
BEGIN
  -- Lookup user's active tenant membership and resolved role name
  SELECT
    tu.tenant_id,
    tu.role_id,
    r.name
  INTO
    v_tenant_id,
    v_role_id,
    v_role_name
  FROM public.tenant_users tu
  JOIN public.roles r ON r.id = tu.role_id
  WHERE tu.user_id  = (event ->> 'user_id')::uuid
    AND tu.is_active = true
  LIMIT 1;

  -- If no tenant membership found, return event unmodified
  -- (user can log in but will have no tenant context)
  IF v_tenant_id IS NULL THEN
    RETURN event;
  END IF;

  -- Inject into app_metadata (server-controlled, not user-editable)
  v_claims := coalesce(event -> 'claims', '{}'::jsonb);
  v_claims := jsonb_set(v_claims, '{app_metadata}',
    coalesce(v_claims -> 'app_metadata', '{}'::jsonb)
    || jsonb_build_object(
        'tenant_id', v_tenant_id::text,
        'role_id',   v_role_id::text,
        'role',      v_role_name
      )
  );

  RETURN jsonb_set(event, '{claims}', v_claims);
END;
$$;

-- Grant to supabase_auth_admin only
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb)
  TO supabase_auth_admin;

REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb)
  FROM PUBLIC, anon, authenticated;

-- =============================================================
-- ROW LEVEL SECURITY
-- =============================================================

-- ---- tenants -----------------------------------------------
-- Tenants can only read their own row.
-- Only service_role (migrations) can insert/update/delete.
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select_own" ON public.tenants
  FOR SELECT
  USING (id = public.auth_tenant_id());

-- ---- permissions -------------------------------------------
-- Global table, readable by all authenticated users. Not tenant-scoped.
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "permissions_read_authenticated" ON public.permissions
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- ---- roles -------------------------------------------------
-- System roles (tenant_id IS NULL) and this tenant's roles are visible.
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roles_read_tenant" ON public.roles
  FOR SELECT
  USING (
    tenant_id IS NULL
    OR tenant_id = public.auth_tenant_id()
  );

-- ---- role_permissions --------------------------------------
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "role_permissions_read_tenant" ON public.role_permissions
  FOR SELECT
  USING (
    role_id IN (
      SELECT id FROM public.roles
      WHERE tenant_id IS NULL
         OR tenant_id = public.auth_tenant_id()
    )
  );

-- ---- tenant_users ------------------------------------------
-- Use direct JWT claim — NOT a subquery on tenant_users itself (avoids recursion).
ALTER TABLE public.tenant_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_users_read_tenant" ON public.tenant_users
  FOR SELECT
  USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

CREATE POLICY "tenant_users_insert_owner" ON public.tenant_users
  FOR INSERT
  WITH CHECK (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- ---- branches ----------------------------------------------
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "branches_tenant_isolation" ON public.branches
  FOR ALL
  USING (tenant_id = public.auth_tenant_id())
  WITH CHECK (tenant_id = public.auth_tenant_id());

-- ---- fiscal_years ------------------------------------------
ALTER TABLE public.fiscal_years ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fiscal_years_tenant_isolation" ON public.fiscal_years
  FOR ALL
  USING (tenant_id = public.auth_tenant_id())
  WITH CHECK (tenant_id = public.auth_tenant_id());

-- ---- audit_log ---------------------------------------------
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log_read_tenant" ON public.audit_log
  FOR SELECT
  USING (tenant_id = public.auth_tenant_id());

CREATE POLICY "audit_log_insert" ON public.audit_log
  FOR INSERT
  WITH CHECK (
    tenant_id = public.auth_tenant_id()
    AND user_id = auth.uid()
  );
-- NO UPDATE or DELETE policies on audit_log — records are immutable.

-- =============================================================
-- SEED: PERMISSIONS
-- Full system-wide permission registry.
-- =============================================================

INSERT INTO public.permissions (name, description, module) VALUES
  -- POS
  ('pos.checkout',           'Process POS checkout',                  'pos'),
  ('pos.void',               'Void a POS sale',                       'pos'),
  ('pos.hold_recall',        'Hold and recall POS carts',             'pos'),
  ('pos.discount',           'Apply discounts in POS',                'pos'),
  -- Inventory
  ('inventory.view',         'View inventory levels',                 'inventory'),
  ('inventory.adjust',       'Create stock adjustments',              'inventory'),
  ('inventory.transfer',     'Create stock transfers',                'inventory'),
  ('inventory.count',        'Perform stock counts',                  'inventory'),
  -- Products / Catalog
  ('catalog.view',           'View products and categories',          'catalog'),
  ('catalog.create',         'Create products',                       'catalog'),
  ('catalog.edit',           'Edit products',                         'catalog'),
  ('catalog.delete',         'Deactivate products',                   'catalog'),
  -- Sales
  ('sales.view',             'View sales invoices',                   'sales'),
  ('sales.create',           'Create sales invoices',                 'sales'),
  ('sales.void',             'Void sales invoices',                   'sales'),
  ('sales.return',           'Process sales returns',                 'sales'),
  -- Purchases
  ('purchases.view',         'View purchase invoices',                'purchases'),
  ('purchases.create',       'Create purchase invoices',              'purchases'),
  ('purchases.receive',      'Receive purchased goods',               'purchases'),
  ('purchases.return',       'Process purchase returns',              'purchases'),
  -- Customers
  ('customers.view',         'View customers',                        'customers'),
  ('customers.create',       'Create customers',                      'customers'),
  ('customers.edit',         'Edit customers',                        'customers'),
  -- Suppliers
  ('suppliers.view',         'View suppliers',                        'suppliers'),
  ('suppliers.create',       'Create suppliers',                      'suppliers'),
  ('suppliers.edit',         'Edit suppliers',                        'suppliers'),
  -- Cash
  ('cash.session',           'Open/close cash register sessions',     'cash'),
  ('cash.in_out',            'Record cash-in and cash-out',           'cash'),
  ('cash.reconcile',         'Reconcile cash registers',              'cash'),
  -- Expenses
  ('expenses.view',          'View expenses',                         'expenses'),
  ('expenses.create',        'Record expenses',                       'expenses'),
  ('expenses.approve',       'Approve expenses',                      'expenses'),
  -- Accounting
  ('accounting.view',        'View accounting records',               'accounting'),
  ('accounting.post',        'Post journal entries',                  'accounting'),
  ('accounting.reverse',     'Reverse journal entries',               'accounting'),
  -- Reports
  ('reports.sales',          'View sales reports',                    'reports'),
  ('reports.inventory',      'View inventory reports',                'reports'),
  ('reports.financial',      'View financial statements',             'reports'),
  ('reports.audit',          'View audit logs',                       'reports'),
  -- Admin
  ('admin.users',            'Manage users',                          'admin'),
  ('admin.roles',            'Manage roles and permissions',          'admin'),
  ('admin.branches',         'Manage branches',                       'admin'),
  ('admin.settings',         'Manage company settings',               'admin')
ON CONFLICT (name) DO NOTHING;

-- =============================================================
-- SEED: SYSTEM ROLES (tenant_id = NULL)
-- =============================================================

INSERT INTO public.roles (id, tenant_id, name, description, is_system) VALUES
  ('b1000000-0000-0000-0000-000000000001', NULL, 'owner',            'مالك الشركة — Company Owner',       true),
  ('b1000000-0000-0000-0000-000000000002', NULL, 'branch_manager',   'مدير الفرع — Branch Manager',       true),
  ('b1000000-0000-0000-0000-000000000003', NULL, 'cashier',          'كاشير — POS Cashier',               true),
  ('b1000000-0000-0000-0000-000000000004', NULL, 'accountant',       'محاسب — Accountant',                true),
  ('b1000000-0000-0000-0000-000000000005', NULL, 'inventory_manager','مدير المخزون — Inventory Manager',  true),
  ('b1000000-0000-0000-0000-000000000006', NULL, 'sales_rep',        'مندوب مبيعات — Sales Rep',          true),
  ('b1000000-0000-0000-0000-000000000007', NULL, 'purchasing',       'موظف مشتريات — Purchasing',         true),
  ('b1000000-0000-0000-0000-000000000008', NULL, 'employee',         'موظف عام — General Employee',       true)
ON CONFLICT (tenant_id, name) DO NOTHING;

-- =============================================================
-- SEED: ROLE → PERMISSIONS
-- =============================================================

-- Owner gets everything
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 'b1000000-0000-0000-0000-000000000001', id FROM public.permissions
ON CONFLICT DO NOTHING;

-- Branch Manager
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 'b1000000-0000-0000-0000-000000000002', id FROM public.permissions
WHERE name IN (
  'pos.checkout','pos.void','pos.hold_recall','pos.discount',
  'inventory.view','inventory.adjust','inventory.count',
  'catalog.view','catalog.create','catalog.edit',
  'sales.view','sales.create','sales.void','sales.return',
  'purchases.view','purchases.create','purchases.receive',
  'customers.view','customers.create','customers.edit',
  'suppliers.view',
  'cash.session','cash.in_out','cash.reconcile',
  'expenses.view','expenses.create','expenses.approve',
  'reports.sales','reports.inventory',
  'admin.users','admin.branches'
) ON CONFLICT DO NOTHING;

-- Cashier
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 'b1000000-0000-0000-0000-000000000003', id FROM public.permissions
WHERE name IN (
  'pos.checkout','pos.hold_recall','pos.discount',
  'catalog.view',
  'customers.view','customers.create',
  'cash.session','cash.in_out',
  'sales.view'
) ON CONFLICT DO NOTHING;

-- Accountant
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 'b1000000-0000-0000-0000-000000000004', id FROM public.permissions
WHERE name IN (
  'sales.view','purchases.view',
  'customers.view','suppliers.view',
  'expenses.view','expenses.create','expenses.approve',
  'accounting.view','accounting.post','accounting.reverse',
  'reports.sales','reports.inventory','reports.financial','reports.audit',
  'cash.reconcile'
) ON CONFLICT DO NOTHING;

-- Inventory Manager
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 'b1000000-0000-0000-0000-000000000005', id FROM public.permissions
WHERE name IN (
  'inventory.view','inventory.adjust','inventory.transfer','inventory.count',
  'catalog.view','catalog.create','catalog.edit',
  'purchases.view','purchases.receive',
  'reports.inventory'
) ON CONFLICT DO NOTHING;

-- Sales Rep
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 'b1000000-0000-0000-0000-000000000006', id FROM public.permissions
WHERE name IN (
  'pos.checkout','pos.hold_recall','pos.discount',
  'catalog.view',
  'sales.view','sales.create',
  'customers.view','customers.create','customers.edit',
  'reports.sales'
) ON CONFLICT DO NOTHING;

-- Purchasing
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 'b1000000-0000-0000-0000-000000000007', id FROM public.permissions
WHERE name IN (
  'catalog.view',
  'purchases.view','purchases.create','purchases.receive','purchases.return',
  'suppliers.view','suppliers.create','suppliers.edit',
  'inventory.view',
  'reports.inventory'
) ON CONFLICT DO NOTHING;

-- General Employee (minimal)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT 'b1000000-0000-0000-0000-000000000008', id FROM public.permissions
WHERE name IN (
  'catalog.view',
  'sales.view',
  'inventory.view'
) ON CONFLICT DO NOTHING;
