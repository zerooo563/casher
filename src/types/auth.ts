/**
 * Local store types (no accounts).
 */

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
