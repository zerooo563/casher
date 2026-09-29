import { createClient } from '@supabase/supabase-js'
import { env } from '@/config/env'
import type { Database } from '@/types/database'

/**
 * Supabase JS client singleton — browser/anon key only.
 *
 * SECURITY:
 * - Uses VITE_SUPABASE_PUBLISHABLE_KEY (anon key) — safe for browser
 * - The service_role key is NEVER used here
 * - Row Level Security on the database enforces tenant isolation
 * - JWT custom claims (tenant_id, role_id, role) are injected server-side
 *   via the Custom Access Token Hook — the frontend cannot forge these
 */
export const supabase = createClient<Database>(
  env.supabase.url,
  env.supabase.publishableKey,
  {
    auth: {
      autoRefreshToken:    true,
      persistSession:      true,
      detectSessionInUrl:  true,
    },
  }
)
