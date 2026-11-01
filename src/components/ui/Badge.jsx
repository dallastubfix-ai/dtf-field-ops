// Only these three get their own look; contact, quote, appointment and any
// unknown status fall through to the neutral badge.
const statusColors = {
  active:    'ui-badge-active',
  completed: 'ui-badge-completed',
  cancelled: 'ui-badge-cancelled',
}

export default function Badge({ status, className = '' }) {
  const colors = statusColors[status] ?? 'ui-badge-neutral'
  return (
    <span className={`ui-badge inline-flex items-center capitalize ${colors} ${className}`}>
      {status}
    </span>
  )
}
