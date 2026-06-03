import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getMyProfile } from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session,  setSession]  = useState(undefined) // undefined = loading
  const [employee, setEmployee] = useState(null)
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    // Initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) loadEmployee(session.user.id)
      else setLoading(false)
    })

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) loadEmployee(session.user.id)
      else { setEmployee(null); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadEmployee(userId) {
    try {
      const profile = await getMyProfile(userId)
      setEmployee(profile)
    } catch (err) {
      console.error('Could not load employee profile:', err.message)
    } finally {
      setLoading(false)
    }
  }

  const value = {
    session,
    employee,
    loading,
    isHR: employee?.role_type === 'hr' || employee?.role_type === 'admin',
    isAdmin: employee?.role_type === 'admin',
    refetchEmployee: () => session && loadEmployee(session.user.id),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
