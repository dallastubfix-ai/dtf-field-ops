import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, isToday, startOfWeek, endOfWeek } from 'date-fns'
import { Briefcase, Calendar, FileText } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import db from '../lib/db'
import { supabase } from '../lib/supabase'
import { upsertLocal } from '../lib/sync'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'

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

  const unpaidInvoices = useLiveQuery(
    () => db.invoices.where('payment_status').notEqual('paid').count(),
    []
  )

  const [jobs, setJobs] = useState({})
  const [customers, setCustomers] = useState({})

  useEffect(() => {
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

    // Background refresh — clear and replace appointments so deleted records don't linger
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
          apptRows.push({ ...appt, _synced: true })
          if (jobData) {
            const { customers: cust, ...job } = jobData
            await upsertLocal('jobs', { ...job, _synced: true })
            if (cust) await upsertLocal('customers', { ...cust, _synced: true })
          }
        }
        await db.appointments.clear()
        await db.appointments.bulkPut(apptRows)

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

  // Background notification checks — runs once on mount when online
  useEffect(() => {
    if (!navigator.onLine) return

    const run = async () => {
      const todayKey = format(new Date(), 'yyyy-MM-dd')

      // Appointment reminders: appointments in the next 24 hours
      try {
        const now      = new Date().toISOString()
        const tomorrow = new Date(Date.now() + 86400000).toISOString()

        const { data: appts } = await supabase
          .from('appointments')
          .select('id, appointment_datetime, location_address, jobs(customers(full_name))')
          .gte('appointment_datetime', now)
          .lte('appointment_datetime', tomorrow)

        for (const appt of appts ?? []) {
          const key = `reminder_sent_${appt.id}_${todayKey}`
          if (localStorage.getItem(key)) continue

          const customerName = appt.jobs?.customers?.full_name ?? 'Customer'
          const time         = format(new Date(appt.appointment_datetime), 'h:mm a')
          const address      = appt.location_address ?? ''

          await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-notification`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              },
              body: JSON.stringify({
                type:  'appointment_reminder',
                title: 'DTF Appointment Today',
                body:  `${customerName} · ${time}${address ? ` · ${address}` : ''}`,
              }),
            }
          )
          localStorage.setItem(key, '1')
        }
      } catch { /* silent */ }

      // Quote follow-up: jobs in contact/quote status older than 3 days
      try {
        const cutoff = new Date(Date.now() - 3 * 86400000).toISOString()

        const { data: staleJobs } = await supabase
          .from('jobs')
          .select('id, customers(full_name)')
          .in('status', ['contact', 'quote'])
          .lt('created_at', cutoff)

        for (const job of staleJobs ?? []) {
          const key = `followup_sent_${job.id}`
          if (localStorage.getItem(key)) continue

          const customerName = job.customers?.full_name ?? 'Customer'

          await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-notification`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
              },
              body: JSON.stringify({
                type:  'quote_followup',
                title: 'Follow Up Reminder',
                body:  `${customerName} hasn't been scheduled yet`,
              }),
            }
          )
          localStorage.setItem(key, '1')
        }
      } catch { /* silent */ }
    }

    run()
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
    <div className="min-h-screen bg-[#F3F4F6]">
      {/* Header */}
      <header className="bg-navy px-4 pt-4 pb-4 flex items-center justify-between">
        <span className="text-white font-bold text-lg">DTF Field Ops</span>
        <span className="text-blue-200 text-sm">{format(today, 'EEE, MMM d')}</span>
      </header>

      <div className="px-4 py-4 space-y-5">
        {/* Stats strip */}
        <div className="flex gap-3 overflow-x-auto pb-1">
          {stats.map(s => (
            <div key={s.label} className="flex-shrink-0 bg-white rounded-xl border border-[#E5E7EB] shadow-sm px-4 py-3 min-w-[110px]">
              <div className="text-2xl font-bold text-navy">{s.value}</div>
              <div className="text-xs text-[#6B7280] mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Quick actions */}
        <div className="flex gap-3">
          {quickActions.map(({ label, icon: Icon, to }) => (
            <button
              key={to}
              onClick={() => navigate(to)}
              className="flex-1 bg-white rounded-xl border border-[#E5E7EB] shadow-sm flex flex-col items-center gap-2 py-4 hover:bg-blue-50 transition-colors"
            >
              <Icon size={20} className="text-navy" />
              <span className="text-xs font-medium text-[#1F2937]">{label}</span>
            </button>
          ))}
        </div>

        {/* Today's schedule */}
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B7280] mb-3">
            Today's Schedule
          </h2>
          {!appointments || appointments.length === 0 ? (
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
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => job && navigate(`/jobs/${job.id}`)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-navy mb-0.5">
                          {job?.job_number ?? '—'}
                        </div>
                        <div className="font-bold text-[#1F2937] text-sm">
                          {customer?.full_name ?? 'Unknown Customer'}
                        </div>
                        <div className="text-[#6B7280] text-xs mt-0.5">
                          {format(new Date(appt.appointment_datetime), 'h:mm a')}
                        </div>
                        {appt.location_address && (
                          <div className="text-[#6B7280] text-xs">{appt.location_address}</div>
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
