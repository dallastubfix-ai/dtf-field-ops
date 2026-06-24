import { useNavigate } from 'react-router-dom'
import { ChevronRight, Settings, CheckCircle } from 'lucide-react'
import { format } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import db from '../lib/db'
import { useSyncQueue } from '../hooks/useSyncQueue'
import Badge from '../components/ui/Badge'

export default function More() {
  const navigate = useNavigate()
  const { pendingCount } = useSyncQueue()

  const completed = useLiveQuery(
    () => db.jobs.where('status').equals('completed').reverse().sortBy('created_at'),
    []
  )
  const customers = useLiveQuery(() => db.customers.toArray(), [])
  const custMap = (customers ?? []).reduce((m, c) => { m[c.id] = c; return m }, {})

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <header className="bg-navy px-4 py-4">
        <h1 className="text-white font-bold text-lg">More</h1>
      </header>

      <div className="px-4 py-4 space-y-5">
        {/* Quick Links */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm overflow-hidden">
          <button
            onClick={() => navigate('/settings')}
            className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-[#F3F4F6] transition-colors border-b border-[#E5E7EB]"
          >
            <Settings size={18} className="text-navy" />
            <span className="flex-1 text-sm font-medium text-[#1F2937] text-left">Settings</span>
            <ChevronRight size={16} className="text-[#9CA3AF]" />
          </button>
          <div className="flex items-center gap-3 px-4 py-3.5">
            <CheckCircle size={18} className={pendingCount > 0 ? 'text-amber-500' : 'text-green-500'} />
            <span className="text-sm text-[#1F2937]">
              {pendingCount > 0 ? `${pendingCount} item${pendingCount > 1 ? 's' : ''} pending sync` : 'All synced ✓'}
            </span>
          </div>
        </div>

        {/* Completed Jobs */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6B7280] mb-3">
            Completed Jobs ({completed?.length ?? 0})
          </h2>
          {!completed || completed.length === 0 ? (
            <p className="text-sm text-[#9CA3AF] text-center py-8">No completed jobs yet.</p>
          ) : (
            <div className="space-y-3">
              {completed.map(job => {
                const customer = custMap[job.customer_id]
                return (
                  <div
                    key={job.id || job._localId}
                    onClick={() => navigate(`/jobs/${job.id}`)}
                    className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-4 cursor-pointer hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="text-xs font-semibold text-navy">{job.job_number}</div>
                        <div className="font-bold text-[#1F2937] mt-0.5">
                          {customer?.full_name ?? 'Unknown'}
                        </div>
                        <div className="text-xs text-[#9CA3AF] mt-0.5">
                          {job.created_at ? format(new Date(job.created_at), 'MMM d, yyyy') : ''}
                        </div>
                      </div>
                      <Badge status="completed" />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
