import { getToken } from 'firebase/messaging'
import { supabase } from './supabase'
import { messaging } from './firebase'

// Last FCM token this phone saved to push_subscriptions. Used only to find and
// remove the old row when the token changes. Never log this value.
const LAST_TOKEN_KEY = 'dtf_push_token'

// The Firebase SDK registers /firebase-messaging-sw.js at this scope.
const PUSH_SW_SCOPE = '/firebase-cloud-messaging-push-scope'
const ENGINE_VERSION = 'v2'

// engine: null (not checked yet) | 'none' (no push worker) | 'current' | 'old'
let status = { state: 'checking', message: 'Checking notifications...', checkedAt: null, engine: null }
const listeners = new Set()
let inFlight = null

function setStatus(state, message) {
  status = { ...status, state, message, checkedAt: new Date() }
  listeners.forEach((fn) => fn(status))
  return status
}

function setEngine(engine) {
  status = { ...status, engine }
  listeners.forEach((fn) => fn(status))
}

export function getPushStatus() {
  return status
}

export function subscribePushStatus(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function waitForActivation(worker, ms) {
  return new Promise((resolve) => {
    const done = () => worker.state === 'activated' || worker.state === 'redundant'
    if (done()) return resolve()
    const timer = setTimeout(resolve, ms)
    worker.addEventListener('statechange', () => {
      if (done()) { clearTimeout(timer); resolve() }
    })
  })
}

function askEngineVersion(worker) {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(null), 2000)
    channel.port1.onmessage = (event) => { clearTimeout(timer); resolve(event.data) }
    worker.postMessage({ type: 'dtf-engine-version' }, [channel.port2])
  })
}

// Asks the push worker to check for an update on every app open (its scope is
// never navigated, so Chrome would otherwise check about once a day), then
// asks it which version is live.
async function checkEngine() {
  try {
    const registration = await navigator.serviceWorker.getRegistration(PUSH_SW_SCOPE)
    // getRegistration falls back to the app's own worker (/sw.js) when the push
    // worker is missing. Never touch that one.
    if (!registration || new URL(registration.scope).pathname !== PUSH_SW_SCOPE) {
      return setEngine('none')
    }
    await registration.update().catch(() => {})
    const pending = registration.installing ?? registration.waiting
    if (pending) await waitForActivation(pending, 10000)
    const answer = registration.active ? await askEngineVersion(registration.active) : null
    setEngine(answer === ENGINE_VERSION ? 'current' : 'old')
  } catch {
    setEngine('old')
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
  // Not awaited: the registration check below does not depend on it.
  checkEngine()
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

  return setStatus(
    'registered',
    cleanupFailed
      ? 'This phone will receive notifications. An old registration could not be removed yet; the app will try again next time it opens.'
      : 'This phone will receive notifications'
  )
}
