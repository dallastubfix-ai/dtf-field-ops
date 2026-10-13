import { getToken, onMessage } from 'firebase/messaging'
import { supabase } from './supabase'
import { messaging } from './firebase'

// Last FCM token this phone saved to push_subscriptions. Used only to find and
// remove the old row when the token changes. Never log this value.
const LAST_TOKEN_KEY = 'dtf_push_token'

let status = { state: 'checking', message: 'Checking notifications...', checkedAt: null }
const listeners = new Set()
let foregroundHandler = null
let unsubscribeForeground = null
let inFlight = null

function setStatus(state, message) {
  status = { state, message, checkedAt: new Date() }
  listeners.forEach((fn) => fn(status))
  return status
}

export function getPushStatus() {
  return status
}

export function subscribePushStatus(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function bindForeground() {
  if (!foregroundHandler) return
  unsubscribeForeground?.()
  unsubscribeForeground = onMessage(messaging, foregroundHandler)
}

// Attached on every app load, and re-attached after each successful registration.
export function attachForegroundListener(handler) {
  foregroundHandler = handler
  bindForeground()
  return () => {
    unsubscribeForeground?.()
    unsubscribeForeground = null
    foregroundHandler = null
  }
}

// Makes sure this phone has a row in push_subscriptions. Checks the database
// every time, because the server deletes rows when Firebase rejects a token.
// prompt: true is only passed from the "Turn on notifications" button.
export function ensurePushRegistration({ prompt = false } = {}) {
  if (!inFlight) {
    inFlight = run(prompt)
      .catch(() => setStatus('error', 'Something went wrong while checking notifications. Close and reopen the app to try again.'))
      .finally(() => { inFlight = null })
  }
  return inFlight
}

async function run(prompt) {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return setStatus('unsupported', 'This browser cannot receive notifications.')
  }

  let permission = Notification.permission
  if (permission === 'default' && prompt) {
    permission = await Notification.requestPermission()
  }
  if (permission === 'denied') {
    return setStatus('blocked', 'Notifications are blocked on this phone. To allow them, open Android Settings > Apps > DTF Field Ops > Notifications and turn them on.')
  }
  if (permission !== 'granted') {
    return setStatus('needs_permission', 'Notifications are not turned on for this phone yet.')
  }
  if (!navigator.onLine) {
    return setStatus('error', "You're offline. Notifications will be checked the next time the app opens with a connection.")
  }

  let token
  try {
    token = await getToken(messaging, { vapidKey: import.meta.env.VITE_VAPID_PUBLIC_KEY })
  } catch (err) {
    console.error('Push: could not get a device token:', err?.code ?? 'unknown')
  }
  if (!token) {
    return setStatus('error', 'Could not reach the notification service. Check your connection, then close and reopen the app.')
  }

  const { data: rows, error: findError } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('endpoint', token)
    .limit(1)

  if (findError) {
    console.error('Push: registration lookup failed:', findError.code ?? 'unknown')
    return setStatus('error', "Could not check this phone's notification registration. Check your connection, then close and reopen the app.")
  }

  if (!rows || rows.length === 0) {
    const { error: saveError } = await supabase
      .from('push_subscriptions')
      .insert({ endpoint: token, p256dh: 'fcm', auth_key: 'fcm' })

    // 23505 = a row for this token already exists, which is what we want.
    if (saveError && saveError.code !== '23505') {
      console.error('Push: registration save failed:', saveError.code ?? 'unknown')
      return setStatus('error', 'Could not save this phone for notifications. Check your connection, then close and reopen the app.')
    }
  }

  // Token changed since last time: remove the old row.
  const previous = localStorage.getItem(LAST_TOKEN_KEY)
  let cleanupFailed = false
  if (previous && previous !== token) {
    const { error: deleteError } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', previous)

    if (deleteError) {
      console.error('Push: old registration cleanup failed:', deleteError.code ?? 'unknown')
      cleanupFailed = true
    }
  }
  // Keep the old token on failure so the cleanup is retried next app open.
  if (!cleanupFailed) localStorage.setItem(LAST_TOKEN_KEY, token)
  localStorage.removeItem('pushEnabled')

  bindForeground()

  return setStatus(
    'registered',
    cleanupFailed
      ? 'This phone will receive notifications. An old registration could not be removed yet; the app will try again next time it opens.'
      : 'This phone will receive notifications'
  )
}
