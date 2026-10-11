import type { TenantContext, TenantSettings } from '@/types/auth'

const LOCAL_SETTINGS: TenantSettings = {
  currency:                'ILS',
  currency_symbol:         '₪',
  language:                'ar',
  timezone:                'Asia/Jerusalem',
  date_format:             'DD/MM/YYYY',
  fiscal_year_start_month: 1,
}

const LOCAL_TENANT: TenantContext = {
  id:       'local',
  name:     'كاشر — المتجر المحلي',
  slug:     'local',
  settings: LOCAL_SETTINGS,
}

/**
 * Local store context — no accounts.
 * Every device works on its own local data; the shared cloud catalog
 * (temporary data-entry phase) is synced explicitly from the Sync page.
 */
export function useTenant(): {
  tenant:    TenantContext | null
  isLoading: boolean
  error:     Error | null
} {
  return {
    tenant:    LOCAL_TENANT,
    isLoading: false,
    error:     null,
  }
}
