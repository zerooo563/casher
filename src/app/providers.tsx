import { QueryClientProvider }  from '@tanstack/react-query'
import { ReactQueryDevtools }   from '@tanstack/react-query-devtools'
import { queryClient }          from '@/lib/queryClient'
import type { ReactNode }       from 'react'

/**
 * Root providers wrapper.
 * No accounts: the app works fully offline-first on this device.
 * Supabase is used only for the temporary shared product catalog sync.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  )
}
