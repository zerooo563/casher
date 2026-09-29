/**
 * TypeScript types for Supabase Auth session and JWT claims.
 *
 * JWT custom claims are injected server-side by the Custom Access Token Hook.
 * Path: app_metadata.tenant_id / app_metadata.role_id / app_metadata.role
 *
 * The frontend reads these claims from the session JWT — it can NEVER write them.
 */

/** Typed representation of our custom JWT app_metadata claims */
export interface AppMetadataClaims {
  tenant_id: string   // UUID as string — the user's current tenant
  role_id:   string   // UUID as string — FK to roles table
  role:      string   // Role name string — e.g. 'owner', 'cashier'
}

/** Typed Supabase User extended with our custom claims */
export interface AuthUser {
  id:            string
  email:         string | undefined
  app_metadata:  AppMetadataClaims
  created_at:    string
}

/** Auth state shape used throughout the app */
export interface AuthState {
  user:       AuthUser | null
  isLoading:  boolean
  isLoggedIn: boolean
}

/** Tenant settings stored in tenants.settings JSONB */
export interface TenantSettings {
  currency:                string   // ISO 4217 — e.g. 'ILS'
  currency_symbol:         string   // e.g. '₪'
  language:                string   // e.g. 'ar'
  timezone:                string   // e.g. 'Asia/Jerusalem'
  date_format:             string   // e.g. 'DD/MM/YYYY'
  fiscal_year_start_month: number   // 1–12
}

/** Current tenant context */
export interface TenantContext {
  id:       string
  name:     string
  slug:     string
  settings: TenantSettings
}
