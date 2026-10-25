import { useNavigate } from 'react-router-dom'
import { ChevronRight, Settings, CheckCircle } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import db from '../lib/db'

export default function More() {
  const navigate = useNavigate()
  // Read-only count: the queue itself is processed by AppShell's SyncIndicator.
  const pendingCount = useLiveQuery(() => db.sync_queue.count(), []) ?? 0

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <header className="bg-navy px-4 py-4">
        <h1 className="text-white font-bold text-lg">More</h1>
      </header>

      <div className="px-4 py-4 space-y-5">
        {/* Sync status */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <CheckCircle size={18} className={pendingCount > 0 ? 'text-amber-500' : 'text-green-500'} />
            <span className="text-sm text-[#1F2937]">
              {pendingCount > 0 ? `${pendingCount} item${pendingCount > 1 ? 's' : ''} pending sync` : 'All synced ✓'}
            </span>
          </div>
        </div>

        {/* App */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6B7280] mb-3">
            App
          </h2>
          <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm overflow-hidden">
            <button
              onClick={() => navigate('/settings')}
              className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-[#F3F4F6] transition-colors"
            >
              <Settings size={18} className="text-navy" />
              <span className="flex-1 text-sm font-medium text-[#1F2937] text-left">Settings</span>
              <ChevronRight size={16} className="text-[#9CA3AF]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
