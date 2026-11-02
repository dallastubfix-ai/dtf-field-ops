import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, Briefcase, CloudOff } from 'lucide-react'
import { format } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import db from '../lib/db'
import { supabase } from '../lib/supabase'
import { mergeServerRows, upsertServerRow } from '../lib/sync'
import { summarizeJobFixtures } from '../lib/fixtures'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import PageHeader from '../components/layout/PageHeader'
import { SkeletonGroup, SkeletonJobRow } from '../components/ui/Skeleton'

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

    // Background refresh — merge server jobs; local rows with queued changes are kept
    supabase.from('jobs').select('*, customers(*)').order('created_at', { ascending: false })
      .then(async ({ data, error }) => {
        if (error || !data) return
        const jobRows = []
        for (const j of data) {
          const { customers: cust, ...job } = j
          jobRows.push(job)
          if (cust) await upsertServerRow('customers', cust)
        }
        // The query is the whole table, so jobs missing from it were deleted on the
        // server. Skip removal at the row cap: the list may be cut off.
        await mergeServerRows('jobs', jobRows, { removeMissing: data.length < 1000 })

        // Re-read the customer map now that Dexie is fresh, otherwise job
        // cards render 'Unknown Customer' until the next mount.
        const cs = await db.customers.toArray()
        setCustomers(cs.reduce((m, c) => { m[c.id] = c; return m }, {}))
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
    <div className="min-h-screen">
      {/* Header */}
      <PageHeader title="Jobs">
        <button
          type="button"
          onClick={() => { setSearchOpen(s => !s); setQuery('') }}
          className="icon-btn"
          aria-label={searchOpen ? 'Close search' : 'Search jobs'}
          aria-expanded={searchOpen}
        >
          {searchOpen ? <X size={20} aria-hidden="true" /> : <Search size={20} aria-hidden="true" />}
        </button>
      </PageHeader>

      {searchOpen && (
        <div className="px-4 pt-3">
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, phone, or job #…"
            aria-label="Search jobs"
            className="ui-field ui-field-h w-full px-3 py-2.5"
          />
        </div>
      )}

      {/* Mobile: dropdown selector */}
      <div className="lg:hidden px-4 pt-3">
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          aria-label="Filter jobs by status"
          className="ui-field ui-field-h w-full px-3 py-2.5 appearance-none"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center', paddingRight: '36px' }}
        >
          {FILTERS.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      </div>

      {/* Desktop: full tab bar */}
      <div className="hidden lg:block px-4 pt-3">
        <div className="flex">
          {FILTERS.map(f => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              aria-pressed={filter === f.value}
              className="job-tab"
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Job list */}
      <div className="px-4 pt-3 pb-4 space-y-[10px]">
        {jobs === undefined ? (
          <SkeletonGroup className="space-y-[10px]">
            {[0, 1, 2, 3].map(i => <SkeletonJobRow key={i} />)}
          </SkeletonGroup>
        ) : !jobs || jobs.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title="No jobs yet"
            subtitle="Tap + to log your first call."
          />
        ) : (
          jobs.map(job => {
            const customer = customers[job.customer_id]
            const fixtureSummary = summarizeJobFixtures(job)
            return (
              <button
                type="button"
                key={job.id || job._localId}
                onClick={() => navigate(`/jobs/${job.id}`)}
                className="glass-row job-row"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {job._synced === false ? (
                      <span
                        role="img"
                        aria-label="Waiting to sync"
                        title="Waiting to sync"
                        className="flex shrink-0 text-[var(--text-secondary)]"
                      >
                        <CloudOff size={14} aria-hidden="true" />
                      </span>
                    ) : (
                      <span
                        role="img"
                        aria-label="Synced"
                        title="Synced"
                        className="w-2 h-2 shrink-0 rounded-full bg-[var(--status-dot-success)]"
                      />
                    )}
                    <span className="job-id">{job.job_number}</span>
                  </div>
                  <Badge status={job.status} />
                </div>
                <div className="job-name">
                  {customer?.full_name ?? 'Unknown Customer'}
                </div>
                {customer?.phone && <div className="job-phone">{customer.phone}</div>}
                {fixtureSummary && <div className="job-meta">{fixtureSummary}</div>}
                {job.created_at && (
                  <div className="job-meta">{format(new Date(job.created_at), 'MMM d, yyyy')}</div>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
