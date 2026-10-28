import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ChevronDown, Car } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import db from '../lib/db'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { todayKey, monthKeyOf, shiftMonth, monthRange, fetchDayGroups, refreshMileageRows, calculateDay, friendlyReason } from '../lib/mileage'

const prettyDay = (key) => {
  const [y, m, d] = key.split('-').map(Number)
  return format(new Date(y, m - 1, d, 12), 'EEE, MMM d')
}

export default function Mileage() {
  const navigate = useNavigate()
  const isOnline = useOnlineStatus()
  const today = todayKey()
  const [monthKey, setMonthKey] = useState(() => monthKeyOf(todayKey()))
  const { start: startKey, end: endKey } = monthRange(monthKey)
  const monthLabel = format(new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)) - 1, 1), 'MMMM yyyy')

  const rows = useLiveQuery(() => db.daily_mileage.toArray(), [])
  const [groups, setGroups] = useState(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState({})
  const [notes, setNotes] = useState({})
  const [open, setOpen] = useState({})

  const changeMonth = (n) => {
    setGroups(null)
    setLoadFailed(false)
    setMonthKey(k => shiftMonth(k, n))
  }

  useEffect(() => {
    if (!isOnline) return
    let cancelled = false
    setLoadFailed(false)
    Promise.all([fetchDayGroups(startKey, endKey), refreshMileageRows(startKey, endKey)])
      .then(([g]) => { if (!cancelled) setGroups(g) })
      .catch(() => { if (!cancelled) setLoadFailed(true) })
    return () => { cancelled = true }
  }, [isOnline, startKey, endKey])

  const rowByDay = new Map((rows ?? []).map(r => [r.id, r]))
  // newest first, only days in the selected month
  const dayKeys = [...new Set([
    ...Object.keys(groups ?? {}),
    ...(rows ?? []).map(r => r.id),
  ])].filter(k => k >= startKey && k <= endKey).sort().reverse()

  const handleCalculate = async (day) => {
    setBusy(b => ({ ...b, [day]: true }))
    setNotes(n => ({ ...n, [day]: null }))
    try {
      const result = await calculateDay(day)
      if (!result.ok) setNotes(n => ({ ...n, [day]: result.message }))
    } catch {
      setNotes(n => ({ ...n, [day]: friendlyReason('unknown') }))
    } finally {
      setBusy(b => ({ ...b, [day]: false }))
    }
  }

  const statusText = (day, row) => {
    if (day > today) return { text: 'Scheduled', cls: 'bg-blue-100 text-blue-700' }
    if (row?.status === 'calculated') return { text: `${row.total_miles} mi`, cls: 'bg-green-100 text-green-700' }
    if (row?.status === 'pending') return { text: 'Waiting to retry', cls: 'bg-amber-100 text-amber-700' }
    if (row?.status === 'failed') return { text: 'Needs attention', cls: 'bg-red-100 text-red-600' }
    return { text: 'Not calculated', cls: 'bg-gray-100 text-gray-600' }
  }

  const loading = rows === undefined || (isOnline && groups === null && !loadFailed)

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <header className="bg-navy px-4 py-4 flex items-center gap-2">
        <button onClick={() => navigate('/more')} aria-label="Back" className="text-white">
          <ChevronLeft size={22} />
        </button>
        <h1 className="text-white font-bold text-lg">Mileage</h1>
      </header>

      <div className="flex items-center justify-between bg-white border-b border-[#E5E7EB] px-2 py-1">
        <button onClick={() => changeMonth(-1)} aria-label="Previous month" className="p-3 text-navy">
          <ChevronLeft size={20} />
        </button>
        <span className="font-semibold text-sm text-[#1F2937]">{monthLabel}</span>
        <button onClick={() => changeMonth(1)} aria-label="Next month" className="p-3 text-navy">
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="px-4 py-4 space-y-3 max-w-lg mx-auto">
        {!isOnline && (
          <p className="text-xs text-red-500">You are offline. Connect to the internet to calculate mileage.</p>
        )}
        {loadFailed && (
          <p className="text-xs text-red-500">Could not load your schedule. Check your connection and reopen this page.</p>
        )}

        {loading ? (
          <div className="flex justify-center py-10"><LoadingSpinner /></div>
        ) : dayKeys.length === 0 ? (
          <EmptyState icon={Car} title={`No mileage days in ${monthLabel}`} subtitle="Days with appointments will show up here." />
        ) : dayKeys.map(day => {
          const row = rowByDay.get(day)
          const group = groups?.[day]
          const chip = statusText(day, row)
          const stopCount = row?.stops?.length ?? group?.stops?.length ?? 0
          const skipped = row?.skipped?.length ? row.skipped : (group?.skipped ?? [])
          const isOpen = !!open[day]
          return (
            <div key={day} className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-4">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(o => ({ ...o, [day]: !o[day] }))}
                className="w-full flex items-center justify-between gap-2 text-left"
              >
                <div>
                  <div className="font-semibold text-[#1F2937] text-sm">{prettyDay(day)}{day === today && ' · Today'}</div>
                  <div className="text-xs text-[#6B7280]">{stopCount} stop{stopCount === 1 ? '' : 's'}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${chip.cls}`}>{chip.text}</span>
                  <ChevronDown size={16} className={`text-[#9CA3AF] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </div>
              </button>

              {isOpen && (
                <div className="mt-3 space-y-2">
                  {row?.status === 'calculated' && row.legs?.length > 0 && (
                    <ul className="space-y-1">
                      {row.legs.map((leg, i) => (
                        <li key={i} className="flex justify-between gap-3 text-xs text-[#6B7280]">
                          <span>{leg.from} → {leg.to}</span>
                          <span className="shrink-0">{leg.miles} mi</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {skipped.length > 0 && (
                    <p className="text-xs text-amber-600">
                      Not counted (no address): {skipped.map(s => s.job_number ?? 'job').join(', ')}
                    </p>
                  )}
                  {!(row?.legs?.length > 0) && skipped.length === 0 && (
                    <p className="text-xs text-[#6B7280]">No trip details yet.</p>
                  )}
                </div>
              )}

              {(row?.status === 'pending' || row?.status === 'failed') && row.status_reason && (
                <p className="mt-2 text-xs text-[#6B7280]">{friendlyReason(row.status_reason)}</p>
              )}
              {notes[day] && <p className="mt-2 text-xs text-red-500">{notes[day]}</p>}

              {day <= today && (
                <Button
                  variant={row?.status === 'calculated' ? 'secondary' : 'primary'}
                  className="w-full mt-3"
                  onClick={() => handleCalculate(day)}
                  disabled={busy[day] || !isOnline}
                >
                  {busy[day] ? 'Calculating…' : row ? 'Recalculate' : 'Calculate'}
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
