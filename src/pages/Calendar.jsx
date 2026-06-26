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
import { upsertLocal } from '../lib/sync'
import Badge from '../components/ui/Badge'

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
          await upsertLocal('appointments', { ...appt, _synced: true })
          if (jobData) {
            const { customers: cust, ...job } = jobData
            await upsertLocal('jobs', { ...job, _synced: true })
            if (cust) await upsertLocal('customers', { ...cust, _synced: true })
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
    <div className="min-h-screen bg-[#F3F4F6]">
      {/* Header */}
      <header className="bg-navy px-4 py-4 flex items-center justify-between">
        <button onClick={() => setCurrent(m => subMonths(m, 1))} className="text-white">
          <ChevronLeft size={22} />
        </button>
        <h1 className="text-white font-bold text-lg">
          {format(current, 'MMMM yyyy')}
        </h1>
        <button onClick={() => setCurrent(m => addMonths(m, 1))} className="text-white">
          <ChevronRight size={22} />
        </button>
      </header>

      <div className="bg-white">
        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 border-b border-[#E5E7EB]">
          {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
            <div key={d} className="py-2 text-center text-xs font-semibold text-[#9CA3AF]">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7">
          {days.map(day => {
            const dayAppts = apptsByDay(day)
            const isCurrentMonth = isSameMonth(day, current)
            const todayDay = isToday(day)
            const isSelected = isSameDay(day, selected)

            return (
              <button
                key={day.toISOString()}
                onClick={() => setSelected(day)}
                className={`relative flex flex-col items-center py-2 min-h-[48px] border-b border-r border-[#F3F4F6] ${!isCurrentMonth ? 'opacity-30' : ''}`}
              >
                <span className={`w-7 h-7 flex items-center justify-center rounded-full text-sm font-medium ${
                  todayDay ? 'bg-navy text-white' :
                  isSelected ? 'text-navy font-bold' : 'text-[#1F2937]'
                }`}>
                  {format(day, 'd')}
                </span>
                {isSelected && !todayDay && (
                  <span className="absolute bottom-1 w-4 h-0.5 bg-gold rounded-full" />
                )}
                {dayAppts.length > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-navy mt-0.5" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Day detail panel */}
      <div className="px-4 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6B7280] mb-3">
          {format(selected, 'EEEE, MMMM d')}
        </h2>
        {selectedAppts.length === 0 ? (
          <p className="text-sm text-[#9CA3AF] text-center py-8">No appointments this day.</p>
        ) : (
          <div className="space-y-3">
            {selectedAppts.map(appt => {
              const job = jobs[appt.job_id]
              const customer = job ? customers[job.customer_id] : null
              return (
                <div
                  key={appt.id || appt._localId}
                  onClick={() => job && navigate(`/jobs/${job.id}`)}
                  className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-4 cursor-pointer hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-bold text-sm text-[#1F2937]">
                        {format(new Date(appt.appointment_datetime), 'h:mm a')}
                      </div>
                      <div className="text-[#1F2937] font-medium mt-0.5">
                        {customer?.full_name ?? 'Unknown'}
                      </div>
                      {job?.job_number && (
                        <div className="text-xs text-navy mt-0.5">{job.job_number}</div>
                      )}
                      {appt.location_address && (
                        <div className="text-xs text-[#6B7280]">{appt.location_address}</div>
                      )}
                    </div>
                    {job?.status && <Badge status={job.status} />}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
