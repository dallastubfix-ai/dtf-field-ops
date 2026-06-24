const statusColors = {
  contact:     'bg-gray-100 text-gray-600',
  quote:       'bg-amber-100 text-amber-700',
  appointment: 'bg-blue-100 text-blue-700',
  active:      'bg-green-100 text-green-700',
  completed:   'bg-green-700 text-white',
  cancelled:   'bg-red-100 text-red-600',
}

export default function Badge({ status, className = '' }) {
  const colors = statusColors[status] ?? 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${colors} ${className}`}>
      {status}
    </span>
  )
}
