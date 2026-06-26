import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

const FCM_PROJECT_ID   = Deno.env.get("FCM_PROJECT_ID")!
const FCM_CLIENT_EMAIL = Deno.env.get("FCM_CLIENT_EMAIL")!
const FCM_PRIVATE_KEY  = Deno.env.get("FCM_PRIVATE_KEY")!.replace(/\\n/g, '\n')

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

  if (!res.ok) throw new Error(`OAuth2 token exchange failed (${res.status}): ${await res.text()}`)

  const { access_token } = await res.json() as { access_token: string }
  return access_token
}

// ─── Send one FCM v1 push notification ───────────────────────────────────────

async function sendFcmPush(
  fcmToken: string,
  accessToken: string,
  title: string,
  body: string,
  url: string
): Promise<number> {
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
          notification: { title, body },
          webpush: { fcm_options: { link: url } },
        },
      }),
    }
  )

  return res.status
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    })
  }

  try {
    const { type, title, body, url = '/' } = await req.json() as {
      type: string
      title: string
      body: string
      url?: string
    }

    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth_key')

    if (error) throw error

    const accessToken = await getAccessToken()

    let sent = 0, failed = 0, removed = 0
    const toRemove: string[] = []

    for (const sub of subs ?? []) {
      // Token is stored directly or as a legacy FCM URL
      const fcmToken = sub.endpoint.startsWith('https://')
        ? sub.endpoint.split('/').pop()
        : sub.endpoint
      if (!fcmToken) { failed++; continue }

      try {
        const status = await sendFcmPush(fcmToken, accessToken, title, body, url)
        if (status === 404) {
          toRemove.push(sub.id)
          removed++
        } else if (status >= 200 && status < 300) {
          sent++
        } else {
          failed++
        }
      } catch {
        failed++
      }
    }

    if (toRemove.length > 0) {
      await supabase.from('push_subscriptions').delete().in('id', toRemove)
    }

    return new Response(JSON.stringify({ type, sent, failed, removed }), {
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }
})
