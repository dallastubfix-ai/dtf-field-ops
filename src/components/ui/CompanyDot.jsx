import { companyFor, isSubcontract, workingFor } from '../../lib/jobLabel'

// Small company-colored dot for BBR / TTR jobs. DTF jobs get nothing (renders null).
// The ring uses the glass border token so the dot stays visible on dark glass.
export default function CompanyDot({ job, className = '' }) {
  if (!isSubcontract(job)) return null
  const company = companyFor(workingFor(job))
  if (!company.hex) return null
  return (
    <span
      role="img"
      aria-label={company.name}
      title={company.name}
      className={`inline-block w-2.5 h-2.5 shrink-0 rounded-full ${className}`}
      style={{ background: company.hex, boxShadow: '0 0 0 1.5px var(--glass-border)' }}
    />
  )
}
