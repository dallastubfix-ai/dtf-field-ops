import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, isToday, startOfWeek, endOfWeek } from 'date-fns'
import { Briefcase, Calendar, FileText } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import db from '../lib/db'
import { supabase } from '../lib/supabase'
import { mergeServerRows, upsertServerRow } from '../lib/sync'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import PageHeader from '../components/layout/PageHeader'
import { SkeletonGroup, SkeletonStatTile, SkeletonRow } from '../components/ui/Skeleton'

export default function Home() {
  const navigate = useNavigate()
  const today = new Date()

  const appointments = useLiveQuery(async () => {
    const all = await db.appointments.toArray()
    return all.filter(a => a.appointment_datetime && isToday(new Date(a.appointment_datetime)))
  }, [])

  const weekAppointments = useLiveQuery(async () => {
    const all = await db.appointments.toArray()
    const start = startOfWeek(today)
    const end = endOfWeek(today)
    return all.filter(a => {
      if (!a.appointment_datetime) return false
      const d = new Date(a.appointment_datetime)
      return d >= start && d <= end
    })
  }, [])

  // Open invoices only: unpaid or partial, never quotes or test-job invoices.
  const unpaidInvoices = useLiveQuery(async () => {
    const testJobIds = new Set(
      (await db.jobs.filter(j => j.is_test === true).toArray()).map(j => j.id)
    )
    const open = await db.invoices.where('payment_status').anyOf('unpaid', 'partial').toArray()
    return open
      .filter(inv => !testJobIds.has(inv.job_id))
      .filter(inv => !String(inv.invoice_number ?? '').startsWith('TEST-'))
      .length
  }, [])

  const [jobs, setJobs] = useState({})
  const [customers, setCustomers] = useState({})

  useEffect(() => {
    // One-time cleanup of keys left by the removed reminder pushes.
    Object.keys(localStorage)
      .filter(k => k.startsWith('reminder_sent_') || k.startsWith('followup_sent_'))
      .forEach(k => localStorage.removeItem(k))

    db.jobs.toArray().then(js => {
      const map = {}
      js.forEach(j => { map[j.id] = j })
      setJobs(map)
    })
    db.customers.toArray().then(cs => {
      const map = {}
      cs.forEach(c => { map[c.id] = c })
      setCustomers(map)
    })

    // Only rows inside the fetched day can be judged "deleted on the server". The
    // server reads the naive day strings in an unknown timezone, so use the overlap
    // of the local-day and UTC-day windows. Rows with no datetime are never removed.
    const dayStr = format(today, 'yyyy-MM-dd')
    const lo = Math.max(new Date(`${dayStr}T00:00:00`), new Date(`${dayStr}T00:00:00Z`))
    const hi = Math.min(new Date(`${dayStr}T23:59:59`), new Date(`${dayStr}T23:59:59Z`))
    const inFetchedDay = r => {
      const t = new Date(r.appointment_datetime).getTime()
      return t >= lo && t <= hi
    }

    // Background refresh — merge today's appointments; queued local changes are kept
    const refresh = async () => {
      const { data: appts } = await supabase
        .from('appointments')
        .select('*, jobs(*, customers(*))')
        .gte('appointment_datetime', format(today, 'yyyy-MM-dd') + 'T00:00:00')
        .lte('appointment_datetime', format(today, 'yyyy-MM-dd') + 'T23:59:59')
      if (appts) {
        const apptRows = []
        for (const a of appts) {
          const { jobs: jobData, ...appt } = a
          apptRows.push(appt)
          if (jobData) {
            const { customers: cust, ...job } = jobData
            await upsertServerRow('jobs', { ...job, _synced: true })
            if (cust) await upsertServerRow('customers', { ...cust, _synced: true })
          }
        }
        await mergeServerRows('appointments', apptRows, { removeMissing: true, removeScope: inFetchedDay })

        // Re-read lookup maps now that Dexie is fresh, otherwise today's
        // appointments can't resolve their job/customer for display + nav.
        const js = await db.jobs.toArray()
        setJobs(js.reduce((m, j) => { m[j.id] = j; return m }, {}))
        const cs = await db.customers.toArray()
        setCustomers(cs.reduce((m, c) => { m[c.id] = c; return m }, {}))
      }
    }
    refresh().catch(console.error)
  }, [])

  const stats = [
    { label: "Today's Jobs",     value: appointments?.length ?? 0 },
    { label: 'This Week',        value: weekAppointments?.length ?? 0 },
    { label: 'Unpaid Invoices',  value: unpaidInvoices ?? 0 },
  ]

  const quickActions = [
    { label: 'All Jobs',  icon: Briefcase, to: '/jobs'     },
    { label: 'Invoices',  icon: FileText,  to: '/invoices' },
    { label: 'Calendar',  icon: Calendar,  to: '/calendar' },
  ]

  return (
    <div className="min-h-screen">
      {/* Header */}
      <PageHeader title="DTF Field Ops">
        <span className="date-chip">{format(today, 'EEE, MMM d')}</span>
      </PageHeader>

      <div className="px-4 pt-3 pb-4 space-y-3">
        {/* Stats (exactly three tiles) */}
        {appointments === undefined || weekAppointments === undefined || unpaidInvoices === undefined ? (
          <SkeletonGroup className="grid grid-cols-3 gap-[10px]">
            {[0, 1, 2].map(i => <SkeletonStatTile key={i} />)}
          </SkeletonGroup>
        ) : (
          <div className="grid grid-cols-3 gap-[10px]">
            {stats.map(s => (
              <div key={s.label} className="glass-row home-stat">
                <div className="home-stat-num">{s.value}</div>
                <div className="home-stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Quick actions */}
        <div className="grid grid-cols-3 gap-[10px]">
          {quickActions.map(({ label, icon: Icon, to }) => (
            <button
              key={to}
              type="button"
              onClick={() => navigate(to)}
              className="glass-row home-quick"
            >
              <span className="home-quick-icon"><Icon size={22} aria-hidden="true" /></span>
              <span className="home-quick-label">{label}</span>
            </button>
          ))}
        </div>

        {/* Today's schedule */}
        <div className="space-y-3">
          <h2 className="section-label">
            TODAY'S SCHEDULE
          </h2>
          {appointments === undefined ? (
            <SkeletonGroup className="space-y-3">
              {[0, 1].map(i => <SkeletonRow key={i} />)}
            </SkeletonGroup>
          ) : !appointments || appointments.length === 0 ? (
            <EmptyState
              icon={Calendar}
              title="No appointments today"
              subtitle="Ready for the next call?"
            />
          ) : (
            <div className="space-y-3">
              {appointments.map(appt => {
                const job = jobs[appt.job_id]
                const customer = job ? customers[job.customer_id] : null
                return (
                  <Card
                    key={appt.id || appt._localId}
                    className="cursor-pointer rounded-[var(--radius-row)]"
                    onClick={() => job && navigate(`/jobs/${job.id}`)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-[var(--accent-text)] mb-0.5">
                          {job?.job_number ?? '—'}
                        </div>
                        <div className="font-bold text-[var(--text)] text-sm">
                          {customer?.full_name ?? 'Unknown Customer'}
                        </div>
                        <div className="text-[var(--text-secondary)] text-xs mt-0.5">
                          {format(new Date(appt.appointment_datetime), 'h:mm a')}
                        </div>
                        {appt.location_address && (
                          <div className="text-[var(--text-secondary)] text-xs">{appt.location_address}</div>
                        )}
                      </div>
                      {job?.status && <Badge status={job.status} />}
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
