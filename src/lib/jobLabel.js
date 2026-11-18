// Which company a job is done for, and how to name a job on screen.
// DTF is the default. BBR and TTR are subcontract jobs: no DTF job number, invoice or warranty.
// To add a company later, add one row here (key must also be allowed by the jobs.working_for CHECK).
export const COMPANIES = [
  { key: 'dtf', tag: 'DTF', name: 'Dallas Tub Fix' },
  { key: 'bbr', tag: 'BBR', name: 'Best in the Business Refinishing' },
  { key: 'ttr', tag: 'TTR', name: 'Texas Tub, Chip, and Crack Repair' },
]

export const DEFAULT_COMPANY = 'dtf'

export const isCompanyKey = (key) => COMPANIES.some(c => c.key === key)

// The company row for a key; anything unknown reads as DTF.
export const companyFor = (key) => COMPANIES.find(c => c.key === key) ?? COMPANIES[0]

// Always read the field through this: jobs saved before the column existed have no value.
export function workingFor(job) {
  return job?.working_for ?? DEFAULT_COMPANY
}

// Job number when there is one; otherwise "BBR - <partner invoice no>" or "BBR - No invoice No.".
export function jobLabel(job) {
  if (!job) return ''
  if (job.job_number) return String(job.job_number)
  const tag = String(workingFor(job)).toUpperCase()
  const partnerNo = typeof job.partner_invoice_no === 'string' ? job.partner_invoice_no.trim() : ''
  return `${tag} - ${partnerNo || 'No invoice No.'}`
}
