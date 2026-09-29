// Environment variable types and validation
// All variables must be prefixed with VITE_ to be exposed to the browser

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const rawKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const isSupabaseConfigured = Boolean(
  rawUrl &&
  rawKey &&
  rawUrl.trim() !== '' &&
  rawKey.trim() !== '' &&
  !rawUrl.includes('your-project-ref') &&
  !rawKey.includes('your-anon')
)

export const env = {
  supabase: {
    url:            isSupabaseConfigured ? rawUrl! : 'https://placeholder.supabase.co',
    publishableKey: isSupabaseConfigured ? rawKey! : 'placeholder-key',
    // NEVER expose service_role key here — it must only exist server-side
  },
  isConfigured: isSupabaseConfigured,
  isDev:        import.meta.env.DEV,
  isProd:       import.meta.env.PROD,
} as const
