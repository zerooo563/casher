import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

import { isSupabaseConfigured } from '@/config/env'

/**
 * Fetches the current user's resolved permissions from the database.
 *
 * IMPORTANT: This is for UX gating only (showing/hiding UI elements).
 * Actual authorization is enforced server-side by RLS and PL/pgSQL functions.
 * A user cannot gain access to server operations by manipulating the frontend.
 */
export function usePermissions(): {
  permissions: Set<string>
  isLoading:   boolean
  hasPermission: (name: string) => boolean
} {
  const { isLoggedIn, roleId } = useAuth()

  const { data: permissions = [], isLoading } = useQuery({
    queryKey: ['permissions', roleId],
    enabled:  isLoggedIn && !!roleId,
    queryFn:  async () => {
      if (!isSupabaseConfigured) {
        return ['*']
      }
      // Read permissions via the join: role_permissions → permissions
      const { data, error } = await supabase
        .from('role_permissions')
        .select('permissions(name)')
        .eq('role_id', roleId!)

      if (error) throw new Error(error.message)

      return (data ?? [])
        .map((row) => {
          const perm = row.permissions
          if (Array.isArray(perm)) return perm[0]?.name ?? null
          return (perm as { name: string } | null)?.name ?? null
        })
        .filter((name): name is string => name !== null)
    },
    staleTime: 5 * 60 * 1000, // permissions are stable
  })

  const permissionSet = new Set(permissions)

  return {
    permissions: permissionSet,
    isLoading,
    hasPermission: (name: string) => permissionSet.has(name),
  }
}
