import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, Briefcase } from 'lucide-react'
import { format } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import db from '../lib/db'
import { supabase } from '../lib/supabase'
import { formatEnum } from '../lib/formatEnum'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'

const FILTERS = [
  { label: 'All',        value: 'all'        },
  { label: 'Contacts',   value: 'contact'    },
  { label: 'Quotes',     value: 'quote'      },
  { label: 'Scheduled',  value: 'appointment'},
  { label: 'Active',     value: 'active'     },
  { label: 'Completed',  value: 'completed'  },
  { label: 'Cancelled',  value: 'cancelled'  },
]

export default function Jobs() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all')
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [customers, setCustomers] = useState({})

  useEffect(() => {
    db.customers.toArray().then(cs => {
      const map = {}
      cs.forEach(c => { map[c.id] = c })
      setCustomers(map)
    })

    // Background refresh — replace jobs table entirely so deleted records don't linger
    supabase.from('jobs').select('*, customers(*)').order('created_at', { ascending: false })
      .then(async ({ data }) => {
        if (!data) return
        const jobRows = []
        for (const j of data) {
          const { customers: cust, ...job } = j
          jobRows.push({ ...job, _synced: true })
          if (cust) await db.customers.put({ ...cust, _synced: true })
        }
        await db.jobs.clear()
        await db.jobs.bulkPut(jobRows)
      }).catch(console.error)
  }, [])

  const jobs = useLiveQuery(async () => {
    let all = await db.jobs.orderBy('created_at').reverse().toArray()
    if (filter !== 'all') all = all.filter(j => j.status === filter)
    if (query.trim()) {
      const q = query.toLowerCase()
      const cids = Object.values(customers)
        .filter(c => c.full_name?.toLowerCase().includes(q) || c.phone?.includes(q))
        .map(c => c.id)
      all = all.filter(j =>
        j.job_number?.toLowerCase().includes(q) ||
        cids.includes(j.customer_id)
      )
    }
    return all
  }, [filter, query, customers])

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      {/* Header */}
      <header className="bg-navy px-4 py-4 flex items-center justify-between">
        <h1 className="text-white font-bold text-lg">Jobs</h1>
        <button onClick={() => { setSearchOpen(s => !s); setQuery('') }} className="text-white">
          {searchOpen ? <X size={20} /> : <Search size={20} />}
        </button>
      </header>

      {searchOpen && (
        <div className="bg-white px-4 py-3 border-b border-[#E5E7EB]">
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, phone, or job #…"
            className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy"
          />
        </div>
      )}

      {/* Mobile: dropdown selector */}
      <div className="lg:hidden bg-white border-b border-[#E5E7EB] px-4 py-3">
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="w-full border border-[#E5E7EB] rounded-lg px-3 py-2.5 text-sm font-medium text-[#1F2937] bg-white focus:outline-none focus:ring-2 focus:ring-[#1E40AF] appearance-none"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', paddingRight: '36px' }}
        >
          {FILTERS.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      {/* Desktop: full tab bar */}
      <div className="hidden lg:block bg-white border-b border-[#E5E7EB]">
        <div className="flex px-4">
          {FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                filter === f.value
                  ? 'border-[#1E40AF] text-[#1E40AF]'
                  : 'border-transparent text-[#6B7280] hover:text-[#1F2937]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Job list */}
      <div className="px-4 py-4 space-y-3">
        {!jobs || jobs.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title="No jobs yet"
            subtitle="Tap + to log your first call."
          />
        ) : (
          jobs.map(job => {
            const customer = customers[job.customer_id]
            return (
              <div
                key={job.id || job._localId}
                onClick={() => navigate(`/jobs/${job.id}`)}
                className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-4 cursor-pointer hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-1">
                  <span className="text-xs font-semibold text-navy">{job.job_number}</span>
                  <Badge status={job.status} />
                </div>
                <div className="font-bold text-[#1F2937]">
                  {customer?.full_name ?? 'Unknown Customer'}
                </div>
                <div className="text-sm text-[#6B7280] mt-0.5">{customer?.phone}</div>
                {(job.fixture_type || job.surface_type) && (
                  <div className="text-xs text-[#9CA3AF] mt-1">
                    {[job.fixture_type, job.surface_type].filter(Boolean).map(formatEnum).join(' · ')}
                  </div>
                )}
                <div className="text-xs text-[#9CA3AF] mt-1">
                  {job.created_at ? format(new Date(job.created_at), 'MMM d, yyyy') : ''}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
