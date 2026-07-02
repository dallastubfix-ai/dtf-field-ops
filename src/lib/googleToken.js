import { supabase } from './supabase'

const TOKEN_MAX_AGE_MS = 50 * 60 * 1000

export async function getValidProviderToken() {
  const token = localStorage.getItem('dtf_google_token')
  const obtainedAt = Number(localStorage.getItem('dtf_google_token_obtained_at') || 0)
  const age = Date.now() - obtainedAt

  if (token && age < TOKEN_MAX_AGE_MS) {
    return token
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) {
    return null
  }

  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refresh-google-token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const body = await res.json()
    if (!res.ok) {
      console.error('Token refresh failed:', body?.error)
      return null
    }
    localStorage.setItem('dtf_google_token', body.access_token)
    localStorage.setItem('dtf_google_token_obtained_at', Date.now().toString())
    return body.access_token
  } catch (err) {
    console.error('Token refresh request failed:', err)
    return null
  }
}
