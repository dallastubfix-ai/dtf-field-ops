// Mileage engine: Chicago day keys, finding a day's stops, building the route,
// calling the Maps Routes library, and saving the day row.
import { supabase } from './supabase'
import db from './db'
import { upsertLocal } from './sync'
import { loadHomeAddress } from './appSettings'

const TZ = 'America/Chicago'
const METERS_PER_MILE = 1609.344
const MAPS_WAIT_MS = 5000
const IMPORT_TIMEOUT_MS = 10000
const ROUTE_TIMEOUT_MS = 20000
const MAX_INTERMEDIATES = 25

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
})

// Chicago calendar day (YYYY-MM-DD) for any timestamp. Never the phone's zone.
export function chicagoDayKey(value = new Date()) {
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : dayFormat.format(d)
}

// Date arithmetic on noon UTC so DST can never shift the day.
export function addDays(dayKey, n) {
  const d = new Date(`${dayKey}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return dayFormat.format(d)
}

export const todayKey = () => chicagoDayKey(new Date())

// 'YYYY-MM' helpers. Inputs are already Chicago keys, so slicing a key is safe.
export const monthKeyOf = (dayKey) => dayKey.slice(0, 7)

export function shiftMonth(monthKey, n) {
  const [y, m] = monthKey.split('-').map(Number)
  return dayFormat.format(new Date(Date.UTC(y, m - 1 + n, 1, 12))).slice(0, 7)
}

export function monthRange(monthKey) {
  return { start: `${monthKey}-01`, end: addDays(`${shiftMonth(monthKey, 1)}-01`, -1) }
}

class MileageError extends Error {
  constructor(reason) { super(reason); this.reason = reason }
}

// Error codes only. Never addresses, names, or the request.
const logCode = (where, code) => console.error('[mileage]', where, code)

const MESSAGES = {
  offline: 'You are offline. Connect to the internet and try again.',
  timeout: 'Google took too long to answer. We will try again later.',
  quota: 'Google is busy right now. We will try again later.',
  library: 'The map service is not available right now. We will try again later.',
  denied: 'Google refused the request. The map key settings may need attention.',
  unknown: 'Something went wrong calculating this day. We will try again later.',
  address_not_found: 'Google could not find a route. Check the addresses on this day.',
  too_many_stops: 'This day has too many stops to calculate in one trip.',
  no_home: 'Set your home address in Settings first.',
  future: 'This day has not happened yet.',
  save: 'The result could not be saved. Please try again.',
  network: 'Could not reach the server. Please try again.',
}
export const friendlyReason = (reason) => MESSAGES[reason] ?? MESSAGES.unknown

// ---------- finding a day's stops ----------

function cityFromAddress(address) {
  const parts = (address ?? '').split(',').map(p => p.trim()).filter(Boolean)
  if (/^(USA|United States)$/i.test(parts[parts.length - 1] ?? '')) parts.pop()
  if (parts.length < 3) return ''
  return /^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/.test(parts[parts.length - 1]) ? parts[parts.length - 2] : ''
}

const stopLabel = (s, i) => {
  const base = s.job_number ?? `Stop ${i + 1}`
  return s.city ? `${base}, ${s.city}` : base
}

// One query for a range of Chicago days. Returns { [dayKey]: { stops, skipped } }
// and only includes days that have at least one counted stop or skipped item.
export async function fetchDayGroups(startKey, endKey) {
  const { data: appts, error } = await supabase
    .from('appointments')
    .select('id, job_id, appointment_datetime, location_address, starts_from_home, created_at')
    .gte('appointment_datetime', `${startKey}T00:00:00Z`)
    .lt('appointment_datetime', `${addDays(endKey, 2)}T00:00:00Z`)
  if (error) throw new MileageError('network')

  const inRange = (appts ?? []).filter(a => {
    const k = chicagoDayKey(a.appointment_datetime)
    return k && k >= startKey && k <= endKey
  })
  const jobIds = [...new Set(inRange.map(a => a.job_id).filter(Boolean))]
  if (!jobIds.length) return {}

  const { data: jobs, error: jobErr } = await supabase
    .from('jobs')
    .select('id, job_number, status, is_test')
    .in('id', jobIds)
  if (jobErr) throw new MileageError('network')
  const jobById = new Map((jobs ?? []).map(j => [j.id, j]))

  inRange.sort((a, b) =>
    Date.parse(a.appointment_datetime) - Date.parse(b.appointment_datetime) ||
    Date.parse(a.created_at) - Date.parse(b.created_at) ||
    String(a.id).localeCompare(String(b.id)))

  const groups = {}
  for (const a of inRange) {
    const job = jobById.get(a.job_id)
    if (!job || job.status === 'cancelled' || job.is_test === true) continue
    const key = chicagoDayKey(a.appointment_datetime)
    const group = (groups[key] ??= { stops: [], skipped: [] })
    const address = (a.location_address ?? '').trim()
    if (!address) {
      group.skipped.push({ appointment_id: a.id, job_number: job.job_number ?? null })
    } else {
      group.stops.push({
        appointment_id: a.id,
        job_number: job.job_number ?? null,
        city: cityFromAddress(address),
        address,
        starts_from_home: a.starts_from_home === true,
      })
    }
  }
  return groups
}

export async function findStopsForDay(dayKey) {
  const groups = await fetchDayGroups(dayKey, dayKey)
  return groups[dayKey] ?? { stops: [], skipped: [] }
}

// ---------- building the route ----------

// Home is origin and destination. A stop flagged starts_from_home (that is not
// the first stop) gets an extra Home intermediate before it.
export function buildRoute(home, stops) {
  const labels = ['Home']
  const intermediates = []
  stops.forEach((s, i) => {
    if (s.starts_from_home && i > 0) {
      intermediates.push({ location: home })
      labels.push('Home')
    }
    intermediates.push({ location: s.address })
    labels.push(stopLabel(s, i))
  })
  labels.push('Home')
  return { origin: home, destination: home, intermediates, labels }
}

// ---------- calling Google ----------

function withTimeout(promise, ms, reason) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new MileageError(reason)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function waitForMaps() {
  const deadline = Date.now() + MAPS_WAIT_MS
  while (!window.google?.maps?.importLibrary) {
    if (Date.now() > deadline) throw new MileageError('library')
    await new Promise(r => setTimeout(r, 100))
  }
}

function classifyError(err) {
  if (err instanceof MileageError) return err.reason
  const text = [err?.code, err?.status, err?.name, err?.message].filter(Boolean).join(' ').toUpperCase()
  if (/OVER_QUERY_LIMIT|RESOURCE_EXHAUSTED|\b429\b|RATE_LIMIT|QUOTA/.test(text)) return 'quota'
  if (/PERMISSION_DENIED|REQUEST_DENIED|\b403\b|API[_ -]?KEY|REFERER|REFERRER|NOT AUTHORIZED|NOT ENABLED/.test(text)) return 'denied'
  if (/ZERO_RESULTS|NOT_FOUND/.test(text)) return 'address_not_found'
  if (!navigator.onLine || /NETWORK|FAILED TO FETCH|UNAVAILABLE/.test(text)) return 'offline'
  return 'unknown'
}

// Returns { legs, totalMeters }. Throws MileageError or a Google error.
async function computeLegs(plan) {
  await waitForMaps()
  let Route
  try {
    ;({ Route } = await withTimeout(window.google.maps.importLibrary('routes'), IMPORT_TIMEOUT_MS, 'library'))
  } catch (err) {
    throw err instanceof MileageError ? err : new MileageError('library')
  }
  if (!Route?.computeRoutes) throw new MileageError('library')

  const { routes } = await withTimeout(
    Route.computeRoutes({
      origin: plan.origin,
      destination: plan.destination,
      intermediates: plan.intermediates,
      travelMode: 'DRIVING',
      routingPreference: 'TRAFFIC_UNAWARE',
      fields: ['legs'],
    }),
    ROUTE_TIMEOUT_MS,
    'timeout'
  )
  const routeLegs = routes?.[0]?.legs
  if (!routeLegs?.length) throw new MileageError('address_not_found')
  if (routeLegs.length !== plan.labels.length - 1) throw new MileageError('unknown')

  let totalMeters = 0
  const legs = routeLegs.map((leg, i) => {
    const meters = leg.distanceMeters
    if (!Number.isFinite(meters)) throw new MileageError('unknown')
    totalMeters += meters
    return {
      from: plan.labels[i],
      to: plan.labels[i + 1],
      meters,
      miles: Math.round((meters / METERS_PER_MILE) * 10) / 10,
    }
  })
  return { legs, totalMeters }
}

// ---------- saving ----------

async function fetchDayRow(dayKey) {
  const { data, error } = await supabase.from('daily_mileage').select('*').eq('id', dayKey).maybeSingle()
  if (error) throw new MileageError('network')
  return data
}

// Server-confirmed upsert, then cache in Dexie. Throws if the server did not confirm.
async function saveDayRow(row) {
  const { data, error } = await supabase
    .from('daily_mileage')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single()
  if (error || !data || data.id !== row.id) throw new MileageError('save')
  try {
    await upsertLocal('daily_mileage', { ...data, _synced: true })
  } catch {
    // server has it; the local copy refreshes on the next load
  }
  return data
}

async function deleteDayRow(dayKey) {
  const { error } = await supabase.from('daily_mileage').delete().eq('id', dayKey)
  if (error) throw new MileageError('save')
  try {
    await db.daily_mileage.where('id').equals(dayKey).delete()
  } catch {
    // local cache only
  }
}

// Pulls the server rows for a range into Dexie so the page works from one source.
export async function refreshMileageRows(startKey, endKey) {
  const { data, error } = await supabase
    .from('daily_mileage').select('*').gte('id', startKey).lte('id', endKey)
  if (error) throw new MileageError('network')
  for (const row of data ?? []) {
    try { await upsertLocal('daily_mileage', { ...row, _synced: true }) } catch { /* cache only */ }
  }
}

// pending / failed. A day that already has a good total keeps its total and
// legs: only the status columns change (partial upsert leaves the rest alone).
async function saveNonSuccess(dayKey, existing, found, status, reason) {
  const now = new Date().toISOString()
  const row = {
    id: dayKey,
    status,
    status_reason: reason,
    updated_at: now,
    ...(status === 'pending' ? { attempts: (existing?.attempts ?? 0) + 1 } : {}),
  }
  if (existing?.total_miles == null && found) {
    row.stops = found.stops
    row.skipped = found.skipped
  }
  return saveDayRow(row)
}

// ---------- the one entry point ----------

const inFlight = new Map()

// Only one calculation per day at a time: a second call gets the same promise.
export function calculateDay(dayKey) {
  if (inFlight.has(dayKey)) return inFlight.get(dayKey)
  const promise = runCalculation(dayKey)
    .catch(err => {
      logCode('calculate', err instanceof MileageError ? err.reason : 'unexpected')
      return { ok: false, status: 'error', message: friendlyReason('unknown') }
    })
    .finally(() => inFlight.delete(dayKey))
  inFlight.set(dayKey, promise)
  return promise
}

const stopped = (reason) => ({ ok: false, status: 'blocked', reason, message: friendlyReason(reason) })
const finished = (status, row = null) => ({ ok: true, status, row })

async function runCalculation(dayKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || dayKey > todayKey()) return stopped('future')
  if (!navigator.onLine) return stopped('offline') // nothing is written offline

  let existing
  try { existing = await fetchDayRow(dayKey) } catch { return stopped('network') }

  let found
  try {
    found = await findStopsForDay(dayKey)
  } catch (err) {
    return failWith(dayKey, existing, null, classifyError(err))
  }

  try {
    if (!found.stops.length && !found.skipped.length) {
      await deleteDayRow(dayKey)
      return finished('empty')
    }
    if (!found.stops.length) {
      const now = new Date().toISOString()
      const row = await saveDayRow({
        id: dayKey, status: 'calculated', total_miles: 0, legs: [], stops: [],
        skipped: found.skipped, status_reason: null, attempts: 0,
        home_address_used: existing?.home_address_used ?? null,
        calculated_at: now, updated_at: now,
      })
      return finished('calculated', row)
    }
  } catch {
    return stopped('save')
  }

  let home = existing?.home_address_used
  if (!home) home = (await loadHomeAddress(true))?.home_address
  if (!home) return stopped('no_home')

  const plan = buildRoute(home, found.stops)
  if (plan.intermediates.length > MAX_INTERMEDIATES) {
    return failWith(dayKey, existing, found, 'too_many_stops', 'failed')
  }

  let computed
  try {
    computed = await computeLegs(plan)
  } catch (err) {
    return failWith(dayKey, existing, found, classifyError(err))
  }

  try {
    const now = new Date().toISOString()
    const row = await saveDayRow({
      id: dayKey,
      status: 'calculated',
      total_miles: Math.round((computed.totalMeters / METERS_PER_MILE) * 10) / 10,
      legs: computed.legs,
      stops: found.stops,
      skipped: found.skipped,
      home_address_used: home,
      calculated_at: now,
      status_reason: null,
      attempts: 0,
      updated_at: now,
    })
    return finished('calculated', row)
  } catch {
    return stopped('save')
  }
}

async function failWith(dayKey, existing, found, reason, forceStatus) {
  logCode('route', reason)
  const status = forceStatus ?? (reason === 'address_not_found' ? 'failed' : 'pending')
  try {
    const row = await saveNonSuccess(dayKey, existing, found, status, reason)
    return { ok: false, status, reason, row, message: friendlyReason(reason) }
  } catch {
    return { ok: false, status: 'blocked', reason, message: friendlyReason(reason) }
  }
}
