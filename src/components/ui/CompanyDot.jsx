import { companyFor, workingFor } from '../../lib/jobLabel'

// Small company-colored dot, shown after a job's label: DTF blue, BBR Tangerine, TTR Basil.
// The ring uses the glass border token so the dot stays visible on dark glass.
export default function CompanyDot({ job, className = '' }) {
  if (!job) return null
  const company = companyFor(workingFor(job))
  if (!company.dot) return null
  return (
    <span
      role="img"
      aria-label={company.name}
      title={company.name}
      className={`inline-block w-2.5 h-2.5 shrink-0 rounded-full ${className}`}
      style={{ background: company.dot, boxShadow: '0 0 0 1.5px var(--glass-border)' }}
    />
  )
}
