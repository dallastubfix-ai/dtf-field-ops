// Mileage engine: Chicago day keys, finding a day's stops, building the route,
// calling the Maps Routes library, and saving the day row.
import { liveQuery } from 'dexie'
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

export function yearRange(monthKey) {
  const y = monthKey.slice(0, 4)
  return { start: `${y}-01-01`, end: `${y}-12-31` }
}

// Calculated days only. Returns { miles, days } for rows with id in [from, to].
export function summarizeCalculated(rows, from, to) {
  let total = 0
  let days = 0
  for (const r of rows ?? []) {
    if (r.status !== 'calculated' || r.id < from || r.id > to) continue
    total += Number(r.total_miles) || 0
    days += 1
  }
  return { miles: Math.round(total * 10) / 10, days }
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
  budget: 'Daily limit reached. Mileage will continue tomorrow.',
  recalc: 'Updating after a change.',
  flip_save: 'Could not save that change. Please try again.',
  syncing: 'Still saving your latest changes. Try again in a moment.',
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

// ---------- daily request budget ----------
// Google's quota resets at midnight Pacific, so the counter is keyed by Pacific date.
// The counter is per device (localStorage); Google's quota is shared across devices.

const BUDGET_KEY = 'dtf_mileage_budget'
const DAILY_BUDGET = 400

const pacificFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
})
let memoryBudget = { day: null, count: 0 } // fallback if localStorage is unavailable

function readBudget() {
  const day = pacificFormat.format(new Date())
  let stored = null
  try { stored = JSON.parse(localStorage.getItem(BUDGET_KEY)) } catch { /* use memory copy */ }
  const src = stored && typeof stored.count === 'number' ? stored : memoryBudget
  return { day, count: src.day === day ? src.count : 0 }
}

function countRequest() {
  const b = readBudget()
  const next = { day: b.day, count: b.count + 1 }
  memoryBudget = next
  try { localStorage.setItem(BUDGET_KEY, JSON.stringify(next)) } catch { /* memory copy still counts */ }
}

export const budgetExhausted = () => readBudget().count >= DAILY_BUDGET

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

  countRequest()
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
  if ((await db.sync_queue.count()) > 0) return stopped('syncing')

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
  if (budgetExhausted()) return stopped('budget')

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

// ---------- the Went-home switch ----------

const flipChains = new Map() // appointment id -> last write, so taps land in order

async function mergeLocalAppointment(id, value, synced) {
  try {
    await db.appointments.where('id').equals(id).modify({ starts_from_home: value, _synced: synced })
  } catch {
    // the phone's copy is optional
  }
}

async function writeStartsFromHome(id, value) {
  const failed = { ok: false, message: friendlyReason('flip_save') }
  try {
    // Offline, or older changes still queued: queue this one behind them so order is kept.
    if (!navigator.onLine || (await db.sync_queue.count()) > 0) {
      await db.sync_queue.add({
        table_name: 'appointments',
        operation: 'update',
        payload: { id, starts_from_home: value },
        created_at: new Date().toISOString(),
      })
      await mergeLocalAppointment(id, value, false)
      return { ok: true, queued: true }
    }
    const { data, error } = await supabase
      .from('appointments')
      .update({ starts_from_home: value })
      .eq('id', id)
      .select('id, starts_from_home')
      .single()
    if (error || !data || data.starts_from_home !== value) return failed
    await mergeLocalAppointment(id, value, true)
    return { ok: true, queued: false }
  } catch {
    return failed
  }
}

// Saves only that appointment's starts_from_home. Resolves { ok, queued } or { ok: false, message }.
export function setStartsFromHome(appointmentId, value) {
  const prior = flipChains.get(appointmentId) ?? Promise.resolve()
  const next = prior.then(() => writeStartsFromHome(appointmentId, value))
  flipChains.set(appointmentId, next.catch(() => {}))
  return next
}

// ---------- recalculation requests ----------
// Phase 7 will call requestRecalc(dayKey) when an appointment changes. Requests are
// remembered in localStorage (sync, no Dexie schema change, same approach as the
// budget counter) so they survive offline and reloads.

const RECALC_KEY = 'dtf_mileage_recalc'
const RECALC_SETTLE_MS = 8000
let memoryRecalc = {}
let recalcSnapshot = null
let recalcWakeTimer = null
const recalcListeners = new Set()

function readRecalc() {
  try {
    const v = JSON.parse(localStorage.getItem(RECALC_KEY))
    if (v && typeof v === 'object' && !Array.isArray(v)) return v
  } catch { /* use memory copy */ }
  return memoryRecalc
}

function writeRecalc(map) {
  memoryRecalc = map
  try { localStorage.setItem(RECALC_KEY, JSON.stringify(map)) } catch { /* memory copy still works this session */ }
  const days = Object.keys(map).sort()
  if (!recalcSnapshot || recalcSnapshot.join() !== days.join()) {
    recalcSnapshot = days
    recalcListeners.forEach(fn => fn())
  }
}

function forgetRecalc(day, at) {
  const map = { ...readRecalc() }
  if (map[day] === at) { // a newer request for the same day stays
    delete map[day]
    writeRecalc(map)
  }
}

// For useSyncExternalStore on the page.
export const subscribeRecalc = (fn) => { recalcListeners.add(fn); return () => recalcListeners.delete(fn) }
export function getRecalcDays() {
  if (!recalcSnapshot) recalcSnapshot = Object.keys(readRecalc()).sort()
  return recalcSnapshot
}

// One day key or an array. Future days are ignored (calculated on the day);
// repeat requests for a day collapse into one entry whose timestamp moves forward.
export function requestRecalc(dayKeys) {
  const today = todayKey()
  const days = (Array.isArray(dayKeys) ? dayKeys : [dayKeys])
    .filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today)
  if (!days.length) return
  const map = { ...readRecalc() }
  const now = Date.now()
  for (const d of days) map[d] = now
  writeRecalc(map)
  // Wake the runner once things have settled (restarted by every new request).
  clearTimeout(recalcWakeTimer)
  recalcWakeTimer = setTimeout(() => { void runRetryPass() }, RECALC_SETTLE_MS + 500)
}

// ---------- automatic retry of pending days ----------
// One module-level runner. AppShell calls startMileageRetry(); mounting twice or
// re-mounting AppShell never creates a second timer, listener, or overlapping run.

export const MAX_AUTO_ATTEMPTS = 8
const RETRY_TICK_MS = 2 * 60 * 1000
const RETRY_PACE_MS = 3000
const MAX_SESSION_RUNS = 50
const BACKOFF_CAP_MIN = 360
const MIN_REPEAT_MS = 10 * 60 * 1000

// attempts 1, 2, 3, 4 ... wait 2, 4, 8, 16 ... minutes, capped at 6 hours
export const retryWaitMs = (attempts) => Math.min(2 ** attempts, BACKOFF_CAP_MIN) * 60 * 1000

const retry = {
  mounts: 0,
  running: false,
  sessionRuns: 0,
  timer: null,
  onOnline: null,
  queueSub: null,
  triedAt: new Map(), // dayKey -> last automatic try this session
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function hasSession() {
  try {
    const { data } = await supabase.auth.getSession()
    return !!data?.session
  } catch {
    return false
  }
}

async function findDuePendingDays() {
  const { data, error } = await supabase
    .from('daily_mileage')
    .select('id, attempts, updated_at')
    .eq('status', 'pending')
    .lte('id', todayKey())
    .order('id')
  if (error) throw new MileageError('network')
  const now = Date.now()
  return (data ?? []).filter(r => {
    const attempts = r.attempts ?? 0
    if (attempts >= MAX_AUTO_ATTEMPTS) return false
    const last = retry.triedAt.get(r.id)
    if (last && now - last < MIN_REPEAT_MS) return false
    if (attempts === 0) return true
    const t = Date.parse(r.updated_at)
    return Number.isNaN(t) || now - t >= retryWaitMs(attempts)
  }).map(r => r.id)
}

// Marks remembered days pending (attempts 0) on the server so the normal retry flow
// recalculates them. No Google calls. A day is forgotten only after the server confirms.
async function flushRecalcRequests() {
  try {
    const now = Date.now()
    for (const [day, at] of Object.entries(readRecalc())) {
      if (now - at < RECALC_SETTLE_MS) continue // still being toggled
      if ((await db.sync_queue.count()) > 0) return // a change was just queued
      await saveDayRow({
        id: day, status: 'pending', status_reason: 'recalc', attempts: 0,
        updated_at: new Date().toISOString(),
      })
      forgetRecalc(day, at)
      retry.triedAt.delete(day) // lift the 10-minute repeat guard for this day
    }
  } catch {
    logCode('recalc', 'flush')
  }
}

// Outcomes specific to one day: the pass carries on to the next day.
const dayLevelReasons = new Set(['address_not_found', 'too_many_stops'])

export async function runRetryPass() {
  if (retry.running || retry.mounts === 0) return
  retry.running = true
  try {
    if (!navigator.onLine || !(await hasSession())) return
    if ((await db.sync_queue.count()) > 0) return // never calculate from stale data

    await flushRecalcRequests() // no Google calls, so no budget check

    if (retry.sessionRuns >= MAX_SESSION_RUNS || budgetExhausted()) return

    const due = await findDuePendingDays()
    if (!due.length) return
    if (!(await loadHomeAddress(true))?.home_address) return

    for (const dayKey of due) {
      if (retry.mounts === 0 || !navigator.onLine) break
      if (retry.sessionRuns >= MAX_SESSION_RUNS || budgetExhausted()) break
      if ((await db.sync_queue.count()) > 0) break

      retry.sessionRuns += 1
      retry.triedAt.set(dayKey, Date.now())
      const result = await calculateDay(dayKey)
      if (!result.ok && !dayLevelReasons.has(result.reason)) break // quota, denied, offline...
      await sleep(RETRY_PACE_MS)
    }
  } catch {
    logCode('retry', 'unexpected')
  } finally {
    retry.running = false
  }
}

// Cheap: one query, no Google calls. Keeps the current month in Dexie.
async function refreshCurrentMonth() {
  if (!navigator.onLine || !(await hasSession())) return
  try {
    const { start, end } = monthRange(monthKeyOf(todayKey()))
    await refreshMileageRows(start, end)
  } catch {
    logCode('refresh', 'network')
  }
}

function activateRetry() {
  retry.onOnline = () => { void runRetryPass() }
  window.addEventListener('online', retry.onOnline)
  retry.timer = setInterval(() => { void runRetryPass() }, RETRY_TICK_MS)

  // sync_queue going from non-empty to empty
  let wasEmpty = null
  retry.queueSub = liveQuery(() => db.sync_queue.count()).subscribe({
    next: (n) => {
      const empty = n === 0
      if (empty && wasEmpty === false) void runRetryPass()
      wasEmpty = empty
    },
    error: () => logCode('queue', 'watch'),
  })

  void refreshCurrentMonth().then(() => runRetryPass())
}

function deactivateRetry() {
  window.removeEventListener('online', retry.onOnline)
  clearInterval(retry.timer)
  retry.queueSub?.unsubscribe()
  retry.onOnline = retry.timer = retry.queueSub = null
}

// Returns a once-only stop function, so it can be used directly as an effect cleanup.
export function startMileageRetry() {
  retry.mounts += 1
  if (retry.mounts === 1) activateRetry()
  let stoppedOnce = false
  return () => {
    if (stoppedOnce) return
    stoppedOnce = true
    retry.mounts = Math.max(0, retry.mounts - 1)
    if (retry.mounts === 0) deactivateRetry()
  }
}
