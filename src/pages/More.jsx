import { useNavigate } from 'react-router-dom'
import { ChevronRight, Settings, Check, CloudOff, Car } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import db from '../lib/db'
import PageHeader from '../components/layout/PageHeader'
import { todayKey, monthKeyOf, monthRange, summarizeCalculated } from '../lib/mileage'

export default function More() {
  const navigate = useNavigate()
  // Read-only count: the queue itself is processed by AppShell's SyncIndicator.
  const pendingCount = useLiveQuery(() => db.sync_queue.count(), []) ?? 0
  const mileageRows = useLiveQuery(() => db.daily_mileage.toArray(), [])
  const { start: monthStart, end: monthEnd } = monthRange(monthKeyOf(todayKey()))
  const monthSummary = summarizeCalculated(mileageRows, monthStart, monthEnd)

  return (
    <div className="min-h-screen">
      <PageHeader title="More" />

      <div className="px-4 pt-3 pb-4 space-y-3">
        {/* Sync status */}
        <div className="sync-block">
          <span className={`sync-icon${pendingCount > 0 ? '' : ' sync-icon--ok'}`}>
            {pendingCount > 0
              ? <CloudOff size={18} aria-hidden="true" />
              : <Check size={18} strokeWidth={2.6} aria-hidden="true" />}
          </span>
          <span className="sync-text">
            {pendingCount > 0 ? `${pendingCount} item${pendingCount > 1 ? 's' : ''} pending sync` : 'All synced'}
          </span>
        </div>

        {/* Tools */}
        <div className="space-y-3">
          <h2 className="section-label uppercase">Tools</h2>
          <button type="button" onClick={() => navigate('/more/mileage')} className="more-row">
            <span className="more-row-icon"><Car size={20} aria-hidden="true" /></span>
            <span className="more-row-label">Mileage</span>
            {monthSummary.days > 0 && (
              <span className="more-row-extra">{monthSummary.miles} mi</span>
            )}
            <ChevronRight size={20} className="text-[var(--text-secondary)]" aria-hidden="true" />
          </button>
        </div>

        {/* App */}
        <div className="space-y-3">
          <h2 className="section-label uppercase">App</h2>
          <button type="button" onClick={() => navigate('/settings')} className="more-row">
            <span className="more-row-icon"><Settings size={20} aria-hidden="true" /></span>
            <span className="more-row-label">Settings</span>
            <ChevronRight size={20} className="text-[var(--text-secondary)]" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}
