import { QueryClient } from '@tanstack/react-query'

/**
 * TanStack Query client — created outside React tree (singleton).
 * Default settings optimized for a business ERP application:
 * - staleTime: 30s — data stays fresh for 30 seconds before background refetch
 * - gcTime: 5min — cache retained for 5 minutes after unmount
 * - retry: 1 — retry failed requests once before showing error
 * - refetchOnWindowFocus: false — ERP users stay on same screen for long periods
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:           30 * 1000,       // 30 seconds
      gcTime:              5 * 60 * 1000,   // 5 minutes
      retry:               1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
})
