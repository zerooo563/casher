import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { TenantContext, TenantSettings } from '@/types/auth'

import { isSupabaseConfigured } from '@/config/env'

const DEFAULT_SETTINGS: TenantSettings = {
  currency:                'ILS',
  currency_symbol:         '₪',
  language:                'ar',
  timezone:                'Asia/Jerusalem',
  date_format:             'DD/MM/YYYY',
  fiscal_year_start_month: 1,
}

/**
 * Fetches and caches the current tenant's data.
 * Currency and other settings come from the database — never hardcoded.
 *
 * Returns null if the user has no tenant context (JWT has no tenant_id).
 */
export function useTenant(): {
  tenant:    TenantContext | null
  isLoading: boolean
  error:     Error | null
} {
  const { tenantId, isLoggedIn } = useAuth()

  const { data, isLoading, error } = useQuery({
    queryKey: ['tenant', tenantId],
    enabled:  isLoggedIn && !!tenantId,
    queryFn:  async () => {
      if (!tenantId) return null

      // In local preview mode before cloud credentials are provided:
      if (!isSupabaseConfigured) {
        return {
          id: tenantId,
          name: 'كاشر للتجارة (بيئة التطوير)',
          slug: 'casher-dev',
          settings: DEFAULT_SETTINGS,
        } satisfies TenantContext
      }

      const { data, error } = await supabase
        .from('tenants')
        .select('id, name, slug, settings')
        .eq('id', tenantId)
        .single()

      if (error) throw new Error(error.message)
      if (!data)  throw new Error('Tenant not found')

      return {
        id:       data.id,
        name:     data.name,
        slug:     data.slug,
        settings: { ...DEFAULT_SETTINGS, ...(data.settings as Partial<TenantSettings>) },
      } satisfies TenantContext
    },
    staleTime: 5 * 60 * 1000, // tenant data is stable — cache 5 minutes
  })

  return {
    tenant:    data ?? null,
    isLoading,
    error:     error as Error | null,
  }
}
