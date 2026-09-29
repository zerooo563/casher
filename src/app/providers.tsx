import { QueryClientProvider }  from '@tanstack/react-query'
import { ReactQueryDevtools }   from '@tanstack/react-query-devtools'
import { AuthProvider }         from '@/features/auth/authContext'
import { queryClient }          from '@/lib/queryClient'
import type { ReactNode }       from 'react'

/**
 * Root providers wrapper — order matters:
 * 1. QueryClientProvider (TanStack Query) — outermost, needed by all hooks
 * 2. AuthProvider — depends on Supabase client (no query dependency)
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {children}
      </AuthProvider>
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
