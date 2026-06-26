import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

const VAPID_PUBLIC_KEY  = Deno.env.get("VAPID_PUBLIC_KEY")!
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!
const VAPID_SUBJECT     = Deno.env.get("VAPID_SUBJECT")!

// ─── Base64 helpers ───────────────────────────────────────────────────────────

function b64urlEncode(buf: Uint8Array | ArrayBuffer): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// Handles both base64url (- _) and standard base64 (+ /) — normalises before atob
function b64urlDecode(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ─── Byte array concat ────────────────────────────────────────────────────────

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) { out.set(a, offset); offset += a.length }
  return out
}

// ─── HKDF: manual Extract + Expand via HMAC-SHA-256 ──────────────────────────
// Web Crypto bundles Extract+Expand; splitting them is necessary for RFC 8291.

async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<CryptoKey> {
  const saltKey = await crypto.subtle.importKey(
    'raw',
    salt.length ? salt : new Uint8Array(32),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const prk = await crypto.subtle.sign('HMAC', saltKey, ikm)
  return crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

async function hkdfExpand(prk: CryptoKey, info: Uint8Array, length: number): Promise<Uint8Array> {
  const out = new Uint8Array(length)
  let prev = new Uint8Array(0)
  let offset = 0
  let counter = 1
  while (offset < length) {
    const block = new Uint8Array(
      await crypto.subtle.sign('HMAC', prk, concat(prev, info, new Uint8Array([counter++])))
    )
    const n = Math.min(block.length, length - offset)
    out.set(block.subarray(0, n), offset)
    offset += n
    prev = block
  }
  return out
}

// ─── VAPID JWT (ES256) ────────────────────────────────────────────────────────

async function buildVapidToken(endpoint: string): Promise<string> {
  const { protocol, host } = new URL(endpoint)
  const enc = new TextEncoder()

  const header  = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = b64urlEncode(enc.encode(JSON.stringify({
    aud: `${protocol}//${host}`,
    exp: Math.floor(Date.now() / 1000) + 43200,
    sub: VAPID_SUBJECT,
  })))
  const sigInput = `${header}.${payload}`

  // VAPID public key is the 65-byte uncompressed P-256 point in base64url:
  // byte 0 = 0x04, bytes 1-32 = x, bytes 33-64 = y
  const pubBytes  = b64urlDecode(VAPID_PUBLIC_KEY)
  const privBytes = b64urlDecode(VAPID_PRIVATE_KEY)

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      d: b64urlEncode(privBytes),
      x: b64urlEncode(pubBytes.slice(1, 33)),
      y: b64urlEncode(pubBytes.slice(33, 65)),
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )

  // Web Crypto ECDSA returns raw r||s (IEEE P1363), which is what JWT requires
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    enc.encode(sigInput)
  )

  return `${sigInput}.${b64urlEncode(sig)}`
}

// ─── Web Push Encryption (RFC 8291 / aes128gcm) ───────────────────────────────

async function encryptWebPush(
  plaintext: string,
  p256dh: string,   // standard base64 from btoa() in client
  authKey: string   // standard base64 from btoa() in client
): Promise<Uint8Array> {
  const enc = new TextEncoder()

  const receiverPub = b64urlDecode(p256dh)  // uncompressed EC point, 65 bytes
  const authSecret  = b64urlDecode(authKey) // 16-byte auth secret

  // Ephemeral sender key pair for ECDH
  const senderPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  )
  const senderPubRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', senderPair.publicKey)
  )

  // ECDH shared secret
  const receiverKey = await crypto.subtle.importKey(
    'raw',
    receiverPub,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  )
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: receiverKey },
      senderPair.privateKey,
      256
    )
  )

  const salt = crypto.getRandomValues(new Uint8Array(16))

  // RFC 8291 §3.3 two-stage key derivation
  // Stage 1: PRK_key = HKDF-Extract(salt=authSecret, IKM=sharedSecret)
  const prkKey = await hkdfExtract(authSecret, sharedSecret)

  // IKM = HKDF-Expand(PRK_key, "WebPush: info\x00" || ua_pub || as_pub, 32)
  const keyInfo = concat(enc.encode('WebPush: info\x00'), receiverPub, senderPubRaw)
  const ikm     = await hkdfExpand(prkKey, keyInfo, 32)

  // Stage 2: PRK = HKDF-Extract(salt=random_salt, IKM=IKM)
  const prk = await hkdfExtract(salt, ikm)

  // Derive 16-byte content encryption key and 12-byte nonce
  const cek   = await hkdfExpand(prk, enc.encode('Content-Encoding: aes128gcm\x00'), 16)
  const nonce = await hkdfExpand(prk, enc.encode('Content-Encoding: nonce\x00'), 12)

  // Encrypt: append 0x02 as the final-record delimiter (RFC 8188)
  const record = concat(enc.encode(plaintext), new Uint8Array([0x02]))
  const aesCek = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: 128 },
      aesCek,
      record
    )
  )

  // RFC 8188 content encoding header: salt(16) | rs(4 BE) | idlen(1) | keyid
  const rs = new Uint8Array(4)
  new DataView(rs.buffer).setUint32(0, 4096, false)

  return concat(salt, rs, new Uint8Array([senderPubRaw.length]), senderPubRaw, ciphertext)
}

// ─── Send one Web Push notification ──────────────────────────────────────────

async function sendPush(
  endpoint: string,
  p256dh: string,
  authKey: string,
  title: string,
  body: string,
  url: string
): Promise<number> {
  const [vapidToken, encrypted] = await Promise.all([
    buildVapidToken(endpoint),
    encryptWebPush(JSON.stringify({ title, body, url }), p256dh, authKey),
  ])

  // k= must be unpadded base64url
  const vapidPubKey = VAPID_PUBLIC_KEY.replace(/=/g, '')

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type':     'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Authorization':    `vapid t=${vapidToken},k=${vapidPubKey}`,
      'TTL':              '86400',
    },
    body: encrypted,
  })

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

    let sent = 0, failed = 0, removed = 0
    const toRemove: string[] = []

    for (const sub of subs ?? []) {
      try {
        const status = await sendPush(
          sub.endpoint, sub.p256dh, sub.auth_key, title, body, url
        )
        if (status === 410 || status === 404) {
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
