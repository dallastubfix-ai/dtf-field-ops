import { supabase } from './supabase'
import db from './db'
import { upsertLocal } from './sync'

const pick = ({ id, job_number, status }) => ({ id, job_number, status })

// Other jobs that share this job's customer record. Dexie answers first so it
// works offline; a successful server answer replaces it. A failed server call
// keeps the Dexie answer. Never logs anything but a static message and the code.
export async function getOtherJobsForCustomer(job, isOnline) {
  if (!job?.customer_id) return []

  let others = []
  try {
    others = (await db.jobs.where('customer_id').equals(job.customer_id).toArray())
      .filter(j => j.id !== job.id)
      .map(pick)
  } catch {
    console.error('Shared customer lookup failed on this phone')
  }

  if (isOnline) {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('id, job_number, status')
        .eq('customer_id', job.customer_id)
        .neq('id', job.id)
      if (error) console.error('Shared customer lookup failed:', error.code)
      else if (data) others = data.map(pick)
    } catch {
      console.error('Shared customer lookup failed: network')
    }
  }

  return others.sort((a, b) => (a.job_number ?? '').localeCompare(b.job_number ?? ''))
}

const COPIED_FIELDS = [
  'full_name', 'phone', 'email', 'address', 'city_state_zip', 'lead_source', 'referred_by',
]

const MSG = {
  offline: 'Needs an internet connection.',
  unsynced: "This phone has changes that haven't synced yet. Try again once they've finished syncing.",
  notShared: "This customer isn't shared anymore, so nothing was changed.",
  moved: "This job's customer was changed on another device. Reopen the job to see the latest. Nothing was changed.",
  readFailed: "Couldn't check this customer. Nothing was changed.",
  createFailed: "Couldn't create the new customer. Nothing was changed.",
  switchFailed: "Couldn't switch this job to the new customer. Nothing was changed.",
}

const fail = (message, refresh = false) => ({ ok: false, message, refresh })

// Best effort. Nothing points at the new row yet, so ON DELETE RESTRICT is not in the way.
async function removeNewCustomer(id) {
  try {
    const { error } = await supabase.from('customers').delete().eq('id', id)
    if (error) console.error('Cleanup of the new customer failed:', error.code)
  } catch {
    console.error('Cleanup of the new customer failed: network')
  }
}

// Online only. Gives this job its own copy of its customer. Never throws: returns
// { ok: true, customer, job } or { ok: false, message, refresh }. Writes straight to
// Supabase (no sync_queue), then brings Dexie in line. Logs static text and error.code only.
export async function separateCustomer(job, isOnline) {
  if (!isOnline) return fail(MSG.offline)
  if (!job?.id || !job.customer_id) return fail(MSG.readFailed)

  const oldId = job.customer_id
  const newId = crypto.randomUUID()
  let step = 'read' // read -> create -> switch
  let switched = false

  try {
    // A queued job update spreads the whole job and would put the old customer_id back.
    const pending = await db.sync_queue
      .filter(op =>
        (op.table_name === 'jobs' && op.payload?.id === job.id) ||
        (op.table_name === 'customers' && op.payload?.id === oldId))
      .count()
    if (pending > 0) return fail(MSG.unsynced)

    // Server truth, not Dexie: the job still points at the old customer ...
    const { data: serverJob, error: jobError } = await supabase
      .from('jobs').select('id, customer_id').eq('id', job.id).maybeSingle()
    if (jobError) {
      console.error('Separate customer: job check failed:', jobError.code)
      return fail(MSG.readFailed)
    }
    if (!serverJob || serverJob.customer_id !== oldId) return fail(MSG.moved)

    // ... and at least one other job still shares it.
    const { data: others, error: othersError } = await supabase
      .from('jobs').select('id').eq('customer_id', oldId).neq('id', job.id).limit(1)
    if (othersError) {
      console.error('Separate customer: shared check failed:', othersError.code)
      return fail(MSG.readFailed)
    }
    if (!others || others.length === 0) return fail(MSG.notShared, true)

    const { data: current, error: currentError } = await supabase
      .from('customers').select(COPIED_FIELDS.join(', ')).eq('id', oldId).maybeSingle()
    if (currentError) {
      console.error('Separate customer: customer read failed:', currentError.code)
      return fail(MSG.readFailed)
    }
    if (!current) return fail(MSG.readFailed)

    const now = new Date().toISOString()
    const newCustomer = {
      id: newId,
      ...Object.fromEntries(COPIED_FIELDS.map(f => [f, current[f] ?? null])),
      created_at: now,
      updated_at: now,
    }

    step = 'create'
    const { data: inserted, error: insertError } = await supabase
      .from('customers').insert(newCustomer).select('id')
    if (insertError) console.error('Separate customer: create failed:', insertError.code)
    if (insertError || inserted?.length !== 1) return fail(MSG.createFailed)

    step = 'switch'
    const { data: updated, error: updateError } = await supabase
      .from('jobs')
      .update({ customer_id: newId, updated_at: now })
      .eq('id', job.id)
      .eq('customer_id', oldId)
      .select('id')
    if (updateError) console.error('Separate customer: switch failed:', updateError.code)
    if (updateError || updated?.length !== 1) return fail(MSG.switchFailed)
    switched = true

    // The server is already correct. If this phone's copy can't be updated, the
    // list pages refresh it, so this is logged and not treated as a failure.
    try {
      await upsertLocal('customers', { ...newCustomer, _synced: true })
      await db.jobs.where('id').equals(job.id).modify({ customer_id: newId, updated_at: now, _synced: true })
    } catch {
      console.error("Separate customer: could not update this phone's copy")
    }

    return { ok: true, customer: newCustomer, job: { ...job, customer_id: newId, updated_at: now } }
  } catch {
    console.error('Separate customer failed unexpectedly')
    return fail(step === 'read' ? MSG.readFailed : step === 'create' ? MSG.createFailed : MSG.switchFailed)
  } finally {
    // Any exit after the insert was attempted that did not switch the job.
    if (step !== 'read' && !switched) await removeNewCustomer(newId)
  }
}
