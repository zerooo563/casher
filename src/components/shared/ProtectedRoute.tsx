import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/config/constants'
import type { ReactNode } from 'react'

interface ProtectedRouteProps {
  children: ReactNode
}

/**
 * Wraps a route to require authentication.
 *
 * - If auth is still loading: show a minimal loading indicator
 * - If not logged in: redirect to /login, saving the current path for redirect-back
 * - If logged in but missing tenant context: show a clear error
 *   (user exists in auth but has no tenant_users record)
 * - Otherwise: render children
 *
 * NOTE: This is a UX guard only. Server-side RLS enforces access at the
 * database level regardless of what the frontend renders.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isLoading, isLoggedIn, tenantId } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm animate-pulse">
          جارٍ التحميل...
        </div>
      </div>
    )
  }

  if (!isLoggedIn) {
    return (
      <Navigate
        to={ROUTES.LOGIN}
        state={{ from: location }}
        replace
      />
    )
  }

  // User is authenticated but has no tenant context
  // (e.g. auth user exists but not added to tenant_users yet)
  if (!tenantId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="max-w-sm text-center space-y-2">
          <h2 className="font-semibold text-foreground">
            لم يتم ربط الحساب بمستأجر
          </h2>
          <p className="text-sm text-muted-foreground">
            تواصل مع مدير النظام لربط حسابك بالشركة.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
