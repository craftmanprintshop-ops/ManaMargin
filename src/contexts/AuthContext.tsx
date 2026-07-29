import React, { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import type { User, Session } from '@supabase/supabase-js'

interface AuthContextValue {
  user: User | null
  session: Session | null
  loading: boolean
  signInWithEmail: (email: string) => Promise<{ error: string | null }>
  verifyEmailCode: (email: string, code: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  loading: true,
  signInWithEmail: async () => ({ error: null }),
  verifyEmailCode: async () => ({ error: null }),
  signOut: async () => {},
})

export const useAuth = () => useContext(AuthContext)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const signInWithEmail = async (email: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.origin + '/inventory',
      },
    })
    return { error: error?.message ?? null }
  }

  // Verifies the 6-digit code from the sign-in email, entered directly in the
  // still-open app. This exists because tapping the magic link instead opens
  // Safari, which does not share storage with an installed home-screen app —
  // on iOS that silently signs the user in "in Safari" while the PWA (the
  // only place push notifications work) stays logged out. Typing a code
  // avoids the context switch entirely.
  const verifyEmailCode = async (email: string, code: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type: 'email' })
    return { error: error?.message ?? null }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{
      user: session?.user ?? null,
      session,
      loading,
      signInWithEmail,
      verifyEmailCode,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}
