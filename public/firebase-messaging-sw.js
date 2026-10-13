// Push worker for DTF Field Ops. Plain Push API, no Firebase SDK.
// Never log notification contents or tokens in this file.
const ENGINE_VERSION = 'v2'
const FALLBACK_TITLE = 'DTF Field Ops'
const ICON = '/icons/icon-192.svg'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function obj(value) {
  return value && typeof value === 'object' ? value : {}
}

// Same-origin path only; anything else opens the home screen.
function toPath(link) {
  try {
    const target = new URL(text(link) || '/', self.location.origin)
    if (target.origin !== self.location.origin) return '/'
    return target.pathname + target.search + target.hash
  } catch {
    return '/'
  }
}

function hash(value) {
  let h = 5381
  for (let i = 0; i < value.length; i++) h = ((h * 33) ^ value.charCodeAt(i)) >>> 0
  return h.toString(36)
}

// Handles both payload shapes:
//   { notification: { title, body }, fcmOptions: { link } }
//   { data: { title, body, url, tag } }
function parsePush(event) {
  try {
    const payload = obj(event.data ? event.data.json() : null)
    const notification = obj(payload.notification)
    const data = obj(payload.data)
    const title = text(notification.title) || text(data.title) || FALLBACK_TITLE
    const body = text(notification.body) || text(data.body)
    const link = text(obj(payload.fcmOptions).link) || text(obj(payload.fcm_options).link)
      || text(notification.click_action) || text(data.url) || text(data.link)
    const tag = text(data.tag) || text(notification.tag) || `dtf-${hash(`${title}\n${body}`)}`
    return { title, body, tag, url: toPath(link) }
  } catch {
    return { title: FALLBACK_TITLE, body: '', tag: 'dtf-fallback', url: '/' }
  }
}

self.addEventListener('push', (event) => {
  const { title, body, tag, url } = parsePush(event)
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: ICON,
      tag,
      renotify: true,
      data: { url },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = toPath(obj(event.notification.data).url)
  event.waitUntil((async () => {
    // This worker's scope controls no pages, so look at uncontrolled windows too.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const client = windows.find((w) => w.visibilityState === 'visible') ?? windows[0]
    if (client) {
      try {
        // "/" means no specific page: just bring the app forward as it is.
        if (url !== '/') client.postMessage({ type: 'dtf-notification-click', url })
        return await client.focus()
      } catch {
        // Fall through and open the app instead.
      }
    }
    return self.clients.openWindow(url)
  })())
})

// Settings asks which worker version is live.
self.addEventListener('message', (event) => {
  if (obj(event.data).type === 'dtf-engine-version') event.ports[0]?.postMessage(ENGINE_VERSION)
})
