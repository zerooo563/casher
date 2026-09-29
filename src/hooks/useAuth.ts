import { useAuthContext } from '@/features/auth/authContext'

/**
 * Convenience hook for reading auth state.
 * Returns the typed AuthUser, loading state, and login status.
 *
 * The user's tenant_id, role_id, and role come from JWT app_metadata
 * which is set exclusively by the server-side Custom Access Token Hook.
 */
export function useAuth() {
  const { user, session, isLoading, isLoggedIn, signIn, signOut } = useAuthContext()

  return {
    user,
    session,
    isLoading,
    isLoggedIn,
    signIn,
    signOut,
    // Convenience accessors for JWT claims
    tenantId: user?.app_metadata.tenant_id ?? null,
    roleId:   user?.app_metadata.role_id   ?? null,
    role:     user?.app_metadata.role      ?? null,
  }
}
