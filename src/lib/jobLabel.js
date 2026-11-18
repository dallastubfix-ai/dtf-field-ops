// Which company a job is done for, and how to name a job on screen.
// DTF is the default. BBR and TTR are subcontract jobs: no DTF job number, invoice or warranty.
// To add a company later, add one row here (key must also be allowed by the jobs.working_for CHECK).
// colorId is the Google Calendar event color; hex is the matching dot color in the app. DTF has none.
export const COMPANIES = [
  { key: 'dtf', tag: 'DTF', name: 'Dallas Tub Fix' },
  { key: 'bbr', tag: 'BBR', name: 'Best in the Business Refinishing', colorId: '6', hex: '#F4511E' },   // Tangerine
  { key: 'ttr', tag: 'TTR', name: 'Texas Tub, Chip, and Crack Repair', colorId: '10', hex: '#0B8043' }, // Basil
]

export const DEFAULT_COMPANY = 'dtf'

export const isCompanyKey = (key) => COMPANIES.some(c => c.key === key)

// The company row for a key; anything unknown reads as DTF.
export const companyFor = (key) => COMPANIES.find(c => c.key === key) ?? COMPANIES[0]

// Always read the field through this: jobs saved before the column existed have no value.
export function workingFor(job) {
  return job?.working_for ?? DEFAULT_COMPANY
}

// A subcontract job is any job done for a company other than DTF (BBR, TTR).
export const isSubcontract = (job) => workingFor(job) !== DEFAULT_COMPANY

// Subcontract jobs use only these three statuses. 'appointment' is shown as "Scheduled".
export const SUBCONTRACT_STATUS_OPTIONS = [
  { value: 'appointment', label: 'Scheduled' },
  { value: 'completed',   label: 'Completed' },
  { value: 'cancelled',   label: 'Cancelled' },
]

// The status text a pill should show. DTF jobs show their stored status, unchanged.
export function displayStatus(job) {
  if (!job) return undefined
  return isSubcontract(job) && job.status === 'appointment' ? 'scheduled' : job.status
}

// Job number when there is one; otherwise "BBR - <partner invoice no>" or "BBR - No invoice No.".
export function jobLabel(job) {
  if (!job) return ''
  if (job.job_number) return String(job.job_number)
  const tag = String(workingFor(job)).toUpperCase()
  const partnerNo = typeof job.partner_invoice_no === 'string' ? job.partner_invoice_no.trim() : ''
  return `${tag} - ${partnerNo || 'No invoice No.'}`
}
