// send-notification
//
// Sends a push to every phone in push_subscriptions.
//
// Caller must be a signed-in Supabase user. The anon key is itself a valid
// JWT, so the caller's token is checked with auth.getUser() here and not only
// at the gateway.
//
// SECURITY: never log or return device tokens, the private key, the access
// token, notification text, or any response body from Google. Counts only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

const FCM_PROJECT_ID   = Deno.env.get("FCM_PROJECT_ID")!
const FCM_CLIENT_EMAIL = Deno.env.get("FCM_CLIENT_EMAIL")!
const FCM_PRIVATE_KEY  = Deno.env.get("FCM_PRIVATE_KEY")!.replace(/\\n/g, '\n')

const MAX_DELAY_SECONDS   = 30
const DEFAULT_TTL_SECONDS = 60
const MAX_TTL_SECONDS     = 86400

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

// ─── Base64url encode ─────────────────────────────────────────────────────────

function b64urlEncode(buf: Uint8Array | ArrayBuffer): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// ─── Build and sign a service-account JWT (RS256) ────────────────────────────

async function buildServiceAccountJwt(): Promise<string> {
  const enc = new TextEncoder()
  const now = Math.floor(Date.now() / 1000)

  const header  = b64urlEncode(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const payload = b64urlEncode(enc.encode(JSON.stringify({
    iss:   FCM_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  })))

  const sigInput = `${header}.${payload}`

  const pemBody = FCM_PRIVATE_KEY
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '')
  const keyBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, enc.encode(sigInput))

  return `${sigInput}.${b64urlEncode(sig)}`
}

// ─── Exchange service-account JWT for an OAuth2 access token ─────────────────

async function getAccessToken(): Promise<string> {
  const jwt = await buildServiceAccountJwt()

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  })

  // Do not read the error body: it may echo sensitive material.
  if (!res.ok) throw new Error('oauth_failed')

  const { access_token } = await res.json() as { access_token?: string }
  if (!access_token) throw new Error('oauth_failed')
  return access_token
}

// ─── Send one data-only FCM v1 push ──────────────────────────────────────────

type PushData   = Record<string, string>
type SendResult = 'sent' | 'unregistered' | 'failed'

async function sendFcmPush(
  fcmToken: string,
  accessToken: string,
  data: PushData,
  ttlSeconds: number
): Promise<SendResult> {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        message: {
          token: fcmToken,
          data,
          webpush: { headers: { Urgency: 'high', TTL: String(ttlSeconds) } },
        },
      }),
    }
  )

  if (res.ok) {
    await res.body?.cancel()
    return 'sent'
  }

  // Read only the error code. Never log or return this body.
  const err = await res.json().catch(() => null)
  const details = err?.error?.details
  const unregistered = Array.isArray(details)
    && details.some((d: { errorCode?: string }) => d?.errorCode === 'UNREGISTERED')
  return unregistered ? 'unregistered' : 'failed'
}

// ─── Send to every phone, then remove tokens Firebase says are gone ──────────

type Subscription = { id: string; endpoint: string }

async function sendToAll(subs: Subscription[], data: PushData, ttlSeconds: number) {
  if (subs.length === 0) return { sent: 0, failed: 0, removed: 0 }

  const accessToken = await getAccessToken()

  const results = await Promise.all(subs.map(async (sub): Promise<SendResult> => {
    // Token is stored directly or as a legacy FCM URL
    const fcmToken = sub.endpoint.startsWith('https://')
      ? sub.endpoint.split('/').pop()
      : sub.endpoint
    if (!fcmToken) return 'failed'
    try {
      return await sendFcmPush(fcmToken, accessToken, data, ttlSeconds)
    } catch {
      return 'failed'
    }
  }))

  const sent = results.filter(r => r === 'sent').length
  const staleIds = subs.filter((_, i) => results[i] === 'unregistered').map(s => s.id)

  let removed = 0
  if (staleIds.length > 0) {
    const { error, count } = await supabase
      .from('push_subscriptions')
      .delete({ count: 'exact' })
      .in('id', staleIds)
    if (error) console.error('send-notification: stale registration cleanup failed')
    else removed = count ?? 0
  }

  return { sent, failed: subs.length - sent - removed, removed }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  // Signed-in users only. The anon key has no user, so getUser rejects it.
  const callerToken = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!callerToken) return json({ error: 'unauthorized' }, 401)
  const { data: userData, error: userError } = await supabase.auth.getUser(callerToken)
  if (userError || !userData?.user) return json({ error: 'unauthorized' }, 401)

  let input: Record<string, unknown>
  try {
    input = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const rawUrl = str(input?.url, 200)
  const tag    = str(input?.tag, 64)
  const data: PushData = {
    title: str(input?.title, 100) || 'DTF Field Ops',
    body:  str(input?.body, 300),
    url:   rawUrl.startsWith('/') && !rawUrl.startsWith('//') ? rawUrl : '/',
  }
  if (tag) data.tag = tag

  const delaySeconds = clamp(input?.delay_seconds, 0, 0, MAX_DELAY_SECONDS)
  const ttlSeconds   = clamp(input?.ttl_seconds, DEFAULT_TTL_SECONDS, 0, MAX_TTL_SECONDS)

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint')

  if (error) {
    console.error('send-notification: registration lookup failed')
    return json({ error: 'lookup_failed' }, 500)
  }

  const devices = (subs ?? []) as Subscription[]

  // Delayed test: answer now and send in the background, so the send still
  // happens after the phone locks or the app goes to the drawer.
  if (delaySeconds > 0 && devices.length > 0) {
    const task = (async () => {
      await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000))
      try {
        const c = await sendToAll(devices, data, ttlSeconds)
        console.log(`send-notification: delayed send sent=${c.sent} failed=${c.failed} removed=${c.removed}`)
      } catch {
        console.error('send-notification: delayed send failed')
      }
    })()
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(task)
    return json({ scheduled: true, delay_seconds: delaySeconds, devices: devices.length })
  }

  try {
    return json(await sendToAll(devices, data, ttlSeconds))
  } catch {
    console.error('send-notification: send failed')
    return json({ error: 'send_failed' }, 500)
  }
})
