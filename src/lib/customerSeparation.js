import { supabase } from './supabase'
import db from './db'

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
