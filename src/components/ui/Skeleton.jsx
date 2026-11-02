// Loading placeholders shaped like the real content. The group announces "Loading";
// every piece inside it is hidden from screen readers.

export function SkeletonGroup({ className = '', children }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className={className}>
      {children}
    </div>
  )
}

// Text line: pill-shaped, height of one line of small text
function Line({ className = '' }) {
  return <div className={`skeleton h-3 rounded-full ${className}`} />
}

export function SkeletonHeader() {
  return (
    <div aria-hidden="true" className="page-header-wrap">
      <div className="page-header">
        <Line className="h-5 w-40" />
      </div>
    </div>
  )
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <div aria-hidden="true" className="glass-card space-y-3">
      <Line className="h-4 w-32" />
      {Array.from({ length: lines }, (_, i) => (
        <Line key={i} className={i === lines - 1 ? 'w-2/3' : 'w-full'} />
      ))}
    </div>
  )
}

// Jobs list row: ID and status, name, two text lines
export function SkeletonJobRow() {
  return (
    <div aria-hidden="true" className="glass-row job-row">
      <div className="flex items-center justify-between gap-2">
        <Line className="h-4 w-24" />
        <Line className="h-5 w-16" />
      </div>
      <Line className="h-4 w-40" />
      <Line className="w-full" />
      <Line className="w-2/3" />
    </div>
  )
}

export function SkeletonStatTile() {
  return (
    <div aria-hidden="true" className="glass-row home-stat space-y-2">
      <div className="skeleton h-[33px] w-10" />
      <Line className="w-16" />
    </div>
  )
}

// Schedule, calendar, chat and invoice rows
export function SkeletonRow({ className = 'glass-row p-4' }) {
  return (
    <div aria-hidden="true" className={`${className} space-y-2`}>
      <Line className="h-4 w-20" />
      <Line className="w-40" />
      <Line className="w-2/3" />
    </div>
  )
}

export function SkeletonSummary() {
  return (
    <div aria-hidden="true" className="invoice-summary">
      <Line className="h-4 w-32" />
      <Line className="h-6 w-24" />
    </div>
  )
}

// Chat transcript: alternating customer and assistant bubbles
export function SkeletonBubbles({ count = 4 }) {
  return (
    <div aria-hidden="true" className="space-y-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}>
          <div className={`skeleton h-14 rounded-[var(--radius-lg)] ${i % 2 === 0 ? 'w-2/3' : 'w-3/4'}`} />
        </div>
      ))}
    </div>
  )
}
