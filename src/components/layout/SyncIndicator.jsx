import { RefreshCw } from 'lucide-react'
import { useSyncQueue } from '../../hooks/useSyncQueue'

export default function SyncIndicator() {
  const { syncing, pendingCount } = useSyncQueue()

  if (!syncing && pendingCount === 0) return null

  return (
    <div className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
      <RefreshCw size={12} className={syncing ? 'animate-spin motion-reduce:[animation-duration:2s] text-[var(--accent-text)]' : 'text-[var(--text-secondary)]'} />
      {syncing ? 'Syncing…' : `${pendingCount} pending`}
    </div>
  )
}
