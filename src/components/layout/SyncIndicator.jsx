import { RefreshCw } from 'lucide-react'
import { useSyncQueue } from '../../hooks/useSyncQueue'

export default function SyncIndicator() {
  const { syncing, pendingCount } = useSyncQueue()

  if (!syncing && pendingCount === 0) return null

  return (
    <div className="flex items-center gap-1 text-xs text-dtf-sub">
      <RefreshCw size={12} className={syncing ? 'animate-spin text-navy' : 'text-dtf-sub'} />
      {syncing ? 'Syncing…' : `${pendingCount} pending`}
    </div>
  )
}
