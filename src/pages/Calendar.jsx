import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  startOfWeek, endOfWeek, isSameDay, isSameMonth, isToday,
  addMonths, subMonths
} from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import db from '../lib/db'
import { supabase } from '../lib/supabase'
import { upsertServerRow } from '../lib/sync'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import PageHeader from '../components/layout/PageHeader'

export default function Calendar() {
  const navigate = useNavigate()
  const [current, setCurrent] = useState(new Date())
  const [selected, setSelected] = useState(new Date())
  const [jobs, setJobs] = useState({})
  const [customers, setCustomers] = useState({})

  const monthStart = startOfMonth(current)
  const monthEnd   = endOfMonth(current)
  const calStart   = startOfWeek(monthStart)
  const calEnd     = endOfWeek(monthEnd)
  const days       = eachDayOfInterval({ start: calStart, end: calEnd })

  const appointments = useLiveQuery(async () => {
    const all = await db.appointments.toArray()
    return all.filter(a => {
      if (!a.appointment_datetime) return false
      const d = new Date(a.appointment_datetime)
      return d >= calStart && d <= calEnd
    })
  }, [current])

  useEffect(() => {
    db.jobs.toArray().then(js => {
      const map = {}; js.forEach(j => { map[j.id] = j }); setJobs(map)
    })
    db.customers.toArray().then(cs => {
      const map = {}; cs.forEach(c => { map[c.id] = c }); setCustomers(map)
    })

    supabase.from('appointments')
      .select('*, jobs(*, customers(*))')
      .gte('appointment_datetime', format(calStart, "yyyy-MM-dd'T'HH:mm:ss"))
      .lte('appointment_datetime', format(calEnd,   "yyyy-MM-dd'T'HH:mm:ss"))
      .then(async ({ data }) => {
        if (!data) return
        for (const a of data) {
          const { jobs: jobData, ...appt } = a
          await upsertServerRow('appointments', { ...appt, _synced: true })
          if (jobData) {
            const { customers: cust, ...job } = jobData
            await upsertServerRow('jobs', { ...job, _synced: true })
            if (cust) await upsertServerRow('customers', { ...cust, _synced: true })
          }
        }
        // Refresh lookup maps so tapping a freshly-synced appointment can
        // resolve its job and navigate to JobDetail.
        const js = await db.jobs.toArray()
        setJobs(js.reduce((m, j) => { m[j.id] = j; return m }, {}))
        const cs = await db.customers.toArray()
        setCustomers(cs.reduce((m, c) => { m[c.id] = c; return m }, {}))
      }).catch(console.error)
  }, [current])

  const apptsByDay = (day) =>
    (appointments ?? []).filter(a =>
      isSameDay(new Date(a.appointment_datetime), day)
    )

  const selectedAppts = apptsByDay(selected)

  return (
    <div className="min-h-screen">
      <PageHeader
        title={format(current, 'MMMM yyyy')}
        centered
        leading={
          <button type="button" onClick={() => setCurrent(m => subMonths(m, 1))} className="icon-btn" aria-label="Previous month">
            <ChevronLeft size={22} />
          </button>
        }
      >
        <button type="button" onClick={() => setCurrent(m => addMonths(m, 1))} className="icon-btn" aria-label="Next month">
          <ChevronRight size={22} />
        </button>
      </PageHeader>

      <div className="px-4 pt-3 pb-4 space-y-3">
        <div className="cal-card">
          {/* Day-of-week headers */}
          <div className="cal-weekdays">
            {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
              <div key={d} className="cal-weekday">{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="cal-grid">
            {days.map(day => {
              const dayAppts = apptsByDay(day)
              const isCurrentMonth = isSameMonth(day, current)
              const todayDay = isToday(day)
              const isSelected = isSameDay(day, selected)

              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => setSelected(day)}
                  aria-pressed={isSelected}
                  aria-label={format(day, 'EEEE, MMMM d')}
                  className="cal-cell"
                >
                  <span className={`cal-num${
                    isSelected ? ' cal-num--selected'
                    : todayDay ? ' cal-num--today' : ''
                  }${!isCurrentMonth ? ' cal-num--outside' : ''}`}>
                    {format(day, 'd')}
                  </span>
                  <span className="cal-dot-slot">
                    {dayAppts.length > 0 && <span className="cal-dot" />}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Day detail panel */}
        <div className="space-y-3">
          <h2 className="section-label uppercase">
            {format(selected, 'EEEE, MMMM d')}
          </h2>
          {selectedAppts.length === 0 ? (
            <p className="cal-empty">No appointments this day.</p>
          ) : (
            <div className="space-y-3">
              {selectedAppts.map(appt => {
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
                        <div className="font-bold text-sm text-[var(--text)]">
                          {format(new Date(appt.appointment_datetime), 'h:mm a')}
                        </div>
                        <div className="text-[var(--text)] font-medium mt-0.5">
                          {customer?.full_name ?? 'Unknown'}
                        </div>
                        {job?.job_number && (
                          <div className="text-xs text-[var(--accent-text)] mt-0.5">{job.job_number}</div>
                        )}
                        {appt.location_address && (
                          <div className="text-xs text-[var(--text-secondary)]">{appt.location_address}</div>
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
