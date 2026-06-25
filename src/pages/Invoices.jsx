import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { format } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import db from '../lib/db'
import { supabase } from '../lib/supabase'
import EmptyState from '../components/ui/EmptyState'
import LoadingSpinner from '../components/ui/LoadingSpinner'

const FILTERS = [
  { label: 'All',     value: 'all'     },
  { label: 'Unpaid',  value: 'unpaid'  },
  { label: 'Partial', value: 'partial' },
  { label: 'Paid',    value: 'paid'    },
]

const paymentPill = {
  unpaid:  'bg-red-100 text-red-600',
  partial: 'bg-amber-100 text-amber-700',
  paid:    'bg-green-100 text-green-700',
}

export default function Invoices() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all')
  const [customers, setCustomers] = useState({})
  const [jobs, setJobs] = useState({})
  const [error, setError] = useState(null)

  useEffect(() => {
    db.customers.toArray()
      .then(cs => { const m = {}; cs.forEach(c => { m[c.id] = c }); setCustomers(m) })
      .catch(console.error)
    db.jobs.toArray()
      .then(js => { const m = {}; js.forEach(j => { m[j.id] = j }); setJobs(m) })
      .catch(console.error)

    supabase.from('invoices').select('*, jobs(*, customers(*))').order('created_at', { ascending: false })
      .then(async ({ data, error: fetchError }) => {
        if (fetchError) { setError(fetchError.message); return }
        if (!data) return
        for (const inv of data) {
          const { jobs: jobData, ...invoice } = inv
          await db.invoices.put({ ...invoice, _synced: true })
          if (jobData) {
            const { customers: cust, ...job } = jobData
            await db.jobs.put({ ...job, _synced: true })
            if (cust) await db.customers.put({ ...cust, _synced: true })
          }
        }
      })
      .catch(err => setError(err.message))
  }, [])

  const invoices = useLiveQuery(async () => {
    let all = await db.invoices.orderBy('created_at').reverse().toArray()
    if (filter !== 'all') all = all.filter(inv => inv.payment_status === filter)
    return all
  }, [filter])

  const outstanding = (invoices ?? [])
    .filter(i => i.payment_status === 'unpaid' || i.payment_status === 'partial')
    .reduce((sum, i) => sum + (Number(i.total_amount) || 0), 0)

  if (error) return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <header className="bg-navy px-4 py-4">
        <h1 className="text-white font-bold text-lg">Invoices</h1>
      </header>
      <div className="px-4 py-8 text-center">
        <p className="text-red-600 font-medium">Failed to load invoices</p>
        <p className="text-sm text-[#6B7280] mt-1">{error}</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <header className="bg-navy px-4 py-4">
        <h1 className="text-white font-bold text-lg">Invoices</h1>
      </header>

      {/* Summary strip */}
      {outstanding > 0 && (
        <div className="bg-red-50 border-b border-red-100 px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-medium text-red-700">Total Outstanding</span>
          <span className="text-lg font-bold text-red-600">
            ${outstanding.toFixed(2)}
          </span>
        </div>
      )}

      {/* Filter tabs */}
      <div className="bg-white border-b border-[#E5E7EB] overflow-x-auto">
        <div className="flex px-4">
          {FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                filter === f.value
                  ? 'border-navy text-navy'
                  : 'border-transparent text-[#6B7280] hover:text-[#1F2937]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-4 space-y-3">
        {invoices === undefined ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="lg" />
          </div>
        ) : invoices.length === 0 ? (
          <EmptyState icon={FileText} title="No invoices yet" subtitle="Build an invoice from a job." />
        ) : (
          invoices.map(inv => {
            const job = jobs[inv.job_id]
            const customer = job ? customers[job.customer_id] : null
            return (
              <div
                key={inv.id || inv._localId}
                onClick={() => navigate(`/invoices/${inv.id}`)}
                className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-4 cursor-pointer hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-1">
                  <span className="font-bold text-[#1F2937] text-base">
                    #{inv.invoice_number ?? job?.job_number ?? '—'}
                  </span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${paymentPill[inv.payment_status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {inv.payment_status ?? 'Unpaid'}
                  </span>
                </div>
                <div className="text-sm text-[#6B7280]">
                  {customer?.full_name ?? '—'} · {job?.job_number ?? '—'}
                </div>
                <div className="text-2xl font-bold text-navy mt-1">
                  ${Number(inv.total_amount ?? 0).toFixed(2)}
                </div>
                {inv.service_date && (
                  <div className="text-xs text-[#9CA3AF] mt-1">
                    Service: {format(new Date(inv.service_date), 'MMM d, yyyy')}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
