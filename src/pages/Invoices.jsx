import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, ChevronDown } from 'lucide-react'
import { format } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import db from '../lib/db'
import { supabase } from '../lib/supabase'
import { upsertServerRow } from '../lib/sync'
import { cleanupLeftoverInvoices } from '../lib/localCleanup'
import EmptyState from '../components/ui/EmptyState'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Badge from '../components/ui/Badge'
import PageHeader from '../components/layout/PageHeader'

const FILTERS = [
  { label: 'All',     value: 'all'     },
  { label: 'Unpaid',  value: 'unpaid'  },
  { label: 'Partial', value: 'partial' },
  { label: 'Paid',    value: 'paid'    },
  { label: 'Quote',   value: 'quote'   },
]

// A missing status shows as "Unpaid", so it gets the Unpaid colors too.
const pillClass = (status) =>
  status == null || status === 'unpaid' ? 'status-pill--unpaid'
  : status === 'paid' ? 'status-pill--paid'
  : ''

const PAYMENT_STATUS_OPTIONS = ['unpaid', 'partial', 'paid', 'quote']

const OFFLINE_STATUS_MSG = 'You are offline. The payment status was not changed. Try again when you have signal.'
const FAILED_STATUS_MSG = 'Could not save the payment status, so it was put back. Check your signal and try again.'

export default function Invoices() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all')
  const [customers, setCustomers] = useState({})
  const [jobs, setJobs] = useState({})
  const [error, setError] = useState(null)
  const [statusMenuFor, setStatusMenuFor] = useState(null)
  const [savingStatusFor, setSavingStatusFor] = useState(null)
  const [toast, setToast] = useState(null) // { text, kind }

  const flash = (text, kind = 'ok') => {
    setToast({ text, kind })
    setTimeout(() => setToast(null), kind === 'ok' ? 1800 : 4500)
  }

  const updatePaymentStatus = async (invoiceId, newStatus) => {
    setStatusMenuFor(null)
    const current = await db.invoices.where('id').equals(invoiceId).first()
    const prevStatus = current?.payment_status
    if (prevStatus === newStatus) return
    if (!navigator.onLine) { flash(OFFLINE_STATUS_MSG, 'error'); return }

    setSavingStatusFor(invoiceId)
    await db.invoices.where('id').equals(invoiceId).modify({ payment_status: newStatus })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    try {
      const { data, error } = await supabase.from('invoices').update({
        payment_status: newStatus,
        updated_at: new Date().toISOString(),
      }).eq('id', invoiceId).select('id').abortSignal(controller.signal)
      if (error) throw error
      // No error but no row changed: the server refused or has no such invoice.
      if (!data || data.length !== 1) throw new Error('no_row_changed')
      flash('Payment status saved')
    } catch (err) {
      // Error code only. Postgres error details can contain the whole row.
      console.error('Payment status update failed:', err?.code || err?.name || 'unknown')
      await db.invoices.where('id').equals(invoiceId).modify({ payment_status: prevStatus })
      flash(FAILED_STATUS_MSG, 'error')
    } finally {
      clearTimeout(timer)
      setSavingStatusFor(null)
    }
  }

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
          await upsertServerRow('invoices', { ...invoice, _synced: true }, { honorUnsyncedFlag: true })
          if (jobData) {
            const { customers: cust, ...job } = jobData
            await upsertServerRow('jobs', { ...job, _synced: true })
            if (cust) await upsertServerRow('customers', { ...cust, _synced: true })
          }
        }
        // Re-read the lookup maps now that Dexie is fresh, otherwise names
        // for newly-fetched jobs/customers render as '--'.
        const cs = await db.customers.toArray()
        setCustomers(cs.reduce((m, c) => { m[c.id] = c; return m }, {}))
        const js = await db.jobs.toArray()
        setJobs(js.reduce((m, j) => { m[j.id] = j; return m }, {}))

        // Only after a download that returned rows: an expired sign-in can
        // return an empty list with no error, and then every server check
        // below would wrongly say "gone".
        if (data.length > 0) {
          try {
            const removed = await cleanupLeftoverInvoices()
            if (removed > 0) flash(`Removed ${removed} old test invoice${removed === 1 ? '' : 's'} from this phone`)
          } catch (err) {
            console.error('Leftover invoice cleanup failed:', err?.name || 'unknown')
          }
        }
      })
      .catch(err => setError(err.message))
  }, [])

  const invoices = useLiveQuery(async () => {
    // Test-job invoices are never listed. The TEST- number also catches
    // leftovers whose job is no longer on this phone. Hiding only.
    const testJobIds = new Set(
      (await db.jobs.filter(j => j.is_test === true).toArray()).map(j => j.id)
    )
    let all = (await db.invoices.orderBy('created_at').reverse().toArray())
      .filter(inv => !testJobIds.has(inv.job_id))
      .filter(inv => !String(inv.invoice_number ?? '').startsWith('TEST-'))
    if (filter !== 'all') all = all.filter(inv => inv.payment_status === filter)
    return all
  }, [filter])

  const outstanding = (invoices ?? [])
    .filter(i => i.payment_status === 'unpaid' || i.payment_status === 'partial')
    .filter(i => jobs[i.job_id]?.status !== 'cancelled')
    .filter(i => jobs[i.job_id]?.status !== 'quote')
    .reduce((sum, i) => sum + (Number(i.total) || 0), 0)

  if (error) return (
    <div className="min-h-screen">
      <PageHeader title="Invoices" />
      <div className="px-4 py-8 text-center">
        <p className="text-[var(--message-red)] font-medium">Failed to load invoices</p>
        <p className="text-sm text-[var(--text-secondary)] mt-1">{error}</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen">
      {statusMenuFor && (
        <div className="fixed inset-0 z-40" onClick={() => setStatusMenuFor(null)} />
      )}
      <PageHeader title="Invoices" />

      {toast && (
        <div className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 text-white text-sm px-4 py-2 rounded-lg shadow-lg max-w-[90vw] text-center ${toast.kind === 'error' ? 'bg-red-600' : 'bg-green-600'}`}>
          {toast.text}
        </div>
      )}

      <div className="px-4 pt-3 pb-4 space-y-3">
        {/* Summary strip */}
        {outstanding > 0 && (
          <div className="invoice-summary">
            <span className="invoice-summary-label">Total Outstanding</span>
            <span className="invoice-summary-amount">
              ${outstanding.toFixed(2)}
            </span>
          </div>
        )}

        {/* Filter tabs */}
        <div className="filter-tabs" role="group" aria-label="Filter invoices">
          {FILTERS.map(f => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className="filter-tab"
            >
              {f.label}
            </button>
          ))}
        </div>

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
                className="glass-row invoice-card"
              >
                <div className="invoice-top">
                  <span className="invoice-num">
                    #{inv.invoice_number ?? job?.job_number ?? '--'}
                  </span>
                  <div className="relative">
                    <button
                      type="button"
                      disabled={savingStatusFor === inv.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        setStatusMenuFor(statusMenuFor === inv.id ? null : inv.id)
                      }}
                      className="status-btn"
                    >
                      <span className={`status-pill ${pillClass(inv.payment_status)}`}>
                        {inv.payment_status ?? 'Unpaid'}
                        <ChevronDown size={14} strokeWidth={2.4} aria-hidden="true" />
                      </span>
                    </button>
                    {statusMenuFor === inv.id && (
                      <div className="status-menu">
                        {PAYMENT_STATUS_OPTIONS.map(val => (
                          <button
                            key={val}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              updatePaymentStatus(inv.id, val)
                            }}
                            className="status-menu-item"
                          >
                            {val}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {job?.status === 'cancelled' && (
                  <div className="mt-1">
                    <Badge status="cancelled" />
                  </div>
                )}
                <div className="invoice-customer">
                  {customer?.full_name ?? '--'} · {job?.job_number ?? '--'}
                </div>
                <div className="invoice-amount">
                  ${Number(inv.total ?? 0).toFixed(2)}
                </div>
                {inv.service_date && (
                  <div className="invoice-date">
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
