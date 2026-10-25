import { supabase } from './supabase'
import db from './db'

const refersTo = (op, ids) =>
  ids.has(op.payload?.id) || ids.has(op.payload?.job_id) || ids.has(op.payload?.invoice_id)

// Remove a deleted test job and everything tied to it from this phone.
// Call ONLY after delete-test-job reported success (or job_not_found): the
// server has already checked is_test and deleted these rows. The customer is
// kept, as on the server.
export async function removeJobLocally(jobId) {
  await db.transaction('rw',
    [db.jobs, db.invoices, db.warranties, db.appointments, db.images, db.videos, db.sync_queue],
    async () => {
      const invoiceIds = (await db.invoices.where('job_id').equals(jobId).toArray())
        .map(i => i.id).filter(Boolean)
      const warrantyIds = [
        ...(await db.warranties.where('job_id').equals(jobId).toArray()),
        ...(invoiceIds.length ? await db.warranties.where('invoice_id').anyOf(invoiceIds).toArray() : []),
      ].map(w => w.id).filter(Boolean)

      await db.warranties.where('job_id').equals(jobId).delete()
      if (invoiceIds.length) await db.warranties.where('invoice_id').anyOf(invoiceIds).delete()
      await db.invoices.where('job_id').equals(jobId).delete()
      await db.appointments.where('job_id').equals(jobId).delete()
      await db.images.where('job_id').equals(jobId).delete()
      await db.videos.where('job_id').equals(jobId).delete()
      await db.jobs.where('id').equals(jobId).delete()

      // Queued uploads for rows that no longer exist would fail forever.
      const ids = new Set([jobId, ...invoiceIds, ...warrantyIds])
      await db.sync_queue.filter(op => refersTo(op, ids)).delete()
    })
}

const MAX_PER_RUN = 25

// Removes phone-only copies of invoices whose job was deleted on the server.
// Never touches anything that could be unsynced work. Every check must pass:
//  1. invoice has an id and a job_id
//  2. invoice is marked synced
//  3. its job is not on this phone, or the phone copy is a synced test job
//  4. nothing in sync_queue mentions the invoice or its job
//  5. none of its warranties on this phone is unsynced
//  6. signed in, and the server confirms both the job and the invoice are gone
//  7. more than 25 candidates means something is wrong: remove nothing
// Returns how many invoices were removed.
export async function cleanupLeftoverInvoices() {
  if (!navigator.onLine) return 0
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return 0

  const [invoices, jobs, warranties, queue] = await Promise.all([
    db.invoices.toArray(), db.jobs.toArray(), db.warranties.toArray(), db.sync_queue.toArray(),
  ])
  const phoneJobs = new Map(jobs.map(j => [j.id, j]))
  const queued = new Set(
    queue.flatMap(op => [op.payload?.id, op.payload?.job_id, op.payload?.invoice_id]).filter(Boolean)
  )
  const unsyncedWarranty = new Set(warranties.filter(w => w._synced !== true).map(w => w.invoice_id))

  const candidates = invoices.filter(inv => {
    if (!inv.id || !inv.job_id || inv._synced !== true) return false
    const job = phoneJobs.get(inv.job_id)
    if (job && !(job.is_test === true && job._synced === true)) return false
    return !queued.has(inv.id) && !queued.has(inv.job_id) && !unsyncedWarranty.has(inv.id)
  })
  if (candidates.length === 0 || candidates.length > MAX_PER_RUN) return 0

  const [jobRes, invRes] = await Promise.all([
    supabase.from('jobs').select('id').in('id', [...new Set(candidates.map(i => i.job_id))]),
    supabase.from('invoices').select('id').in('id', candidates.map(i => i.id)),
  ])
  if (jobRes.error || invRes.error || !jobRes.data || !invRes.data) return 0
  const serverJobs = new Set(jobRes.data.map(j => j.id))
  const serverInvoices = new Set(invRes.data.map(i => i.id))
  const leftoverIds = candidates
    .filter(i => !serverJobs.has(i.job_id) && !serverInvoices.has(i.id))
    .map(i => i.id)
  if (leftoverIds.length === 0) return 0

  let removed = 0
  await db.transaction('rw', [db.invoices, db.warranties], async () => {
    for (const invId of leftoverIds) {
      const row = await db.invoices.where('id').equals(invId).first()
      if (row?._synced !== true) continue // changed since the checks above
      await db.warranties.where('invoice_id').equals(invId).delete()
      await db.invoices.where('id').equals(invId).delete()
      removed++
    }
  })
  return removed
}
