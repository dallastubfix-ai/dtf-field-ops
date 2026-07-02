import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [providerToken, setProviderToken] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      const saved = localStorage.getItem('dtf_google_token')
      if (saved) setProviderToken(saved)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
        if (session?.provider_token) {
          localStorage.setItem('dtf_google_token', session.provider_token)
          localStorage.setItem('dtf_google_token_obtained_at', Date.now().toString())
          setProviderToken(session.provider_token)
        }
        if (session?.provider_refresh_token) {
          fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/store-google-token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ refresh_token: session.provider_refresh_token }),
          }).catch((error) => {
            console.error(error)
            window.alert(
              'Google connection could not be saved fully — if Calendar or video features stop working later, sign out and sign back in.'
            )
          })
        }
      }
    )
    return () => subscription.unsubscribe()
  }, [])

  const signInWithGoogle = () =>
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.file',
        redirectTo: window.location.origin,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent'
        }
      }
    })

  const signOut = async () => {
    localStorage.removeItem('dtf_google_token')
    setProviderToken(null)
    return supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, loading, providerToken, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
