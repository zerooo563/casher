import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { parseUUID } from '@/lib/utils'
import type { AuthUser, AppMetadataClaims } from '@/types/auth'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthContextValue {
  user:        AuthUser | null
  session:     Session | null
  isLoading:   boolean
  isLoggedIn:  boolean
  signIn:      (email: string, password: string) => Promise<{ error: string | null }>
  signInDemo:  () => void
  signOut:     () => Promise<void>
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null)

// ---------------------------------------------------------------------------
// Helper: map Supabase session user → typed AuthUser
// ---------------------------------------------------------------------------

function mapSessionToUser(session: Session | null): AuthUser | null {
  if (!session?.user) return null

  const meta = session.user.app_metadata as Partial<AppMetadataClaims>

  return {
    id:           session.user.id,
    email:        session.user.email,
    app_metadata: {
      tenant_id: parseUUID(meta?.tenant_id) ?? '',
      role_id:   parseUUID(meta?.role_id)   ?? '',
      role:      typeof meta?.role === 'string' ? meta.role : '',
    },
    created_at: session.user.created_at,
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session,   setSession]   = useState<Session | null>(null)
  const [user,      setUser]      = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Check if there was a saved demo session for quick preview
    const savedDemo = sessionStorage.getItem('casher_demo_user')
    if (savedDemo) {
      try {
        const parsed = JSON.parse(savedDemo)
        setUser(parsed)
        setIsLoading(false)
        return
      } catch {
        sessionStorage.removeItem('casher_demo_user')
      }
    }

    // Restore existing Supabase session on mount
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setUser(mapSessionToUser(data.session))
      setIsLoading(false)
    }).catch(() => {
      setIsLoading(false)
    })

    // Subscribe to auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession)
        setUser(mapSessionToUser(newSession))
        setIsLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    return { error: null }
  }, [])

  const signInDemo = useCallback(() => {
    const demoUser: AuthUser = {
      id: 'demo-user-001',
      email: 'admin@casher.dev',
      app_metadata: {
        tenant_id: 'a1000000-0000-0000-0000-000000000001',
        role_id:   'b1000000-0000-0000-0000-000000000001',
        role:      'owner',
      },
      created_at: new Date().toISOString(),
    }
    sessionStorage.setItem('casher_demo_user', JSON.stringify(demoUser))
    setUser(demoUser)
    setIsLoading(false)
  }, [])

  const signOut = useCallback(async () => {
    sessionStorage.removeItem('casher_demo_user')
    setUser(null)
    setSession(null)
    try {
      await supabase.auth.signOut()
    } catch {
      // ignore network errors if offline/demo
    }
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        isLoggedIn: !!user || !!session,
        signIn,
        signInDemo,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuthContext must be used inside <AuthProvider>')
  }
  return ctx
}
