import { useState, useEffect, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, ChevronLeft, ChevronRight, ChevronDown, Car } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import db from '../lib/db'
import PageHeader from '../components/layout/PageHeader'
import Button from '../components/ui/Button'
import EmptyState from '../components/ui/EmptyState'
import { SkeletonGroup, SkeletonStatTile, SkeletonCard } from '../components/ui/Skeleton'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { todayKey, monthKeyOf, shiftMonth, monthRange, yearRange, summarizeCalculated, fetchDayGroups, refreshMileageRows, calculateDay, friendlyReason, MAX_AUTO_ATTEMPTS, requestRecalc, getRecalcDays, subscribeRecalc, setStartsFromHome } from '../lib/mileage'

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
  const monthDate = new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)) - 1, 1)
  const monthLabel = format(monthDate, 'MMMM yyyy')
  const monthName = format(monthDate, 'MMMM')
  const { start: yearStart, end: yearEnd } = yearRange(monthKey)

  const rows = useLiveQuery(() => db.daily_mileage.toArray(), [])
  const [groups, setGroups] = useState(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState({})
  const [notes, setNotes] = useState({})
  const [open, setOpen] = useState({})

  const recalcDays = useSyncExternalStore(subscribeRecalc, getRecalcDays)
  const queuedAppointmentOps = useLiveQuery(
    () => db.sync_queue.where('table_name').equals('appointments').toArray(), [])
  const [flipped, setFlipped] = useState({}) // appointment id -> true/false

  // Flips still waiting in the sync queue (made offline) keep their position.
  useEffect(() => {
    const fromQueue = {}
    for (const op of queuedAppointmentOps ?? []) {
      if (op.operation === 'update' && typeof op.payload?.starts_from_home === 'boolean') {
        fromQueue[op.payload.id] = op.payload.starts_from_home
      }
    }
    if (Object.keys(fromQueue).length) setFlipped(f => ({ ...f, ...fromQueue }))
  }, [queuedAppointmentOps])

  const isHome = (stop) => flipped[stop.appointment_id] ?? stop.starts_from_home === true

  const handleFlip = async (day, stop) => {
    const id = stop.appointment_id
    const prev = isHome(stop)
    const next = !prev
    setFlipped(f => ({ ...f, [id]: next }))
    setNotes(n => ({ ...n, [day]: null }))
    const result = await setStartsFromHome(id, next)
    if (!result.ok) {
      setFlipped(f => (f[id] === next ? { ...f, [id]: prev } : f)) // back to where it was
      setNotes(n => ({ ...n, [day]: result.message }))
      return
    }
    requestRecalc(day)
  }

  const changeMonth = (n) => {
    setGroups(null)
    setLoadFailed(false)
    setMonthKey(k => shiftMonth(k, n))
  }

  useEffect(() => {
    if (!isOnline) return
    let cancelled = false
    setLoadFailed(false)
    fetchDayGroups(startKey, endKey)
      .then(g => { if (!cancelled) setGroups(g) })
      .catch(() => { if (!cancelled) setLoadFailed(true) })
    return () => { cancelled = true }
  }, [isOnline, startKey, endKey])

  // Whole year, so the year total is right. A failed refresh is silent: Dexie is used.
  useEffect(() => {
    if (!isOnline) return
    refreshMileageRows(yearStart, yearEnd).catch(() => {})
  }, [isOnline, yearStart, yearEnd])

  const rowByDay = new Map((rows ?? []).map(r => [r.id, r]))
  // newest first, only days in the selected month
  const dayKeys = [...new Set([
    ...Object.keys(groups ?? {}),
    ...(rows ?? []).map(r => r.id),
  ])].filter(k => k >= startKey && k <= endKey).sort().reverse()

  const monthTotal = summarizeCalculated(rows, startKey, endKey).miles
  const yearTotal = summarizeCalculated(rows, yearStart, yearEnd).miles
  const notIncluded = dayKeys.filter(d => d <= today && rowByDay.get(d)?.status !== 'calculated').length

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

  const statusText = (day, row, status) => {
    if (day > today) return { text: 'Scheduled', cls: '' }
    if (status === 'calculated') return { text: `${row.total_miles} mi`, cls: 'chip--success' }
    if (status === 'pending') return { text: 'Waiting to calculate', cls: '' }
    if (status === 'failed') return { text: 'Needs attention', cls: 'chip--error' }
    return { text: 'Not calculated', cls: '' }
  }

  const loading = rows === undefined || (isOnline && groups === null && !loadFailed)

  return (
    <div className="min-h-screen">
      <PageHeader title="Mileage" onBack={() => navigate('/more')} />

      <div className="px-4 mt-3 max-w-lg mx-auto">
        <div className="glass-row flex items-center justify-between px-1 py-1">
          <button type="button" onClick={() => changeMonth(-1)} aria-label="Previous month" className="icon-btn">
            <ChevronLeft size={22} />
          </button>
          <span className="font-semibold text-sm text-[var(--text)]">{monthLabel}</span>
          <button type="button" onClick={() => changeMonth(1)} aria-label="Next month" className="icon-btn">
            <ChevronRight size={22} />
          </button>
        </div>
      </div>

      <div className="px-4 py-4 space-y-3 max-w-lg mx-auto">
        {loading ? (
          // Placeholders; the day list below announces "Loading"
          <div className="grid grid-cols-2 gap-3">
            <SkeletonStatTile />
            <SkeletonStatTile />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="glass-row home-stat">
              <div className="home-stat-label">{monthName} total</div>
              <div className="text-lg font-bold text-[var(--accent-text)]">{monthTotal} mi</div>
            </div>
            <div className="glass-row home-stat">
              <div className="home-stat-label">{yearStart.slice(0, 4)} total</div>
              <div className="text-lg font-bold text-[var(--accent-text)]">{yearTotal} mi</div>
            </div>
          </div>
        )}
        {notIncluded > 0 && (
          <p className="note-warn">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{notIncluded} day{notIncluded === 1 ? '' : 's'} not included yet</span>
          </p>
        )}
        {!isOnline && (
          <p className="text-xs text-[var(--message-red)]">You are offline. Connect to the internet to calculate mileage.</p>
        )}
        {loadFailed && (
          <p className="text-xs text-[var(--message-red)]">Could not load your schedule. Check your connection and reopen this page.</p>
        )}

        {loading ? (
          <SkeletonGroup className="space-y-3">
            {[0, 1, 2].map(i => <SkeletonCard key={i} lines={1} />)}
          </SkeletonGroup>
        ) : dayKeys.length === 0 ? (
          <EmptyState icon={Car} title={`No mileage days in ${monthLabel}`} subtitle="Days with appointments will show up here." />
        ) : dayKeys.map(day => {
          const row = rowByDay.get(day)
          const group = groups?.[day]
          const stops = group?.stops ?? row?.stops ?? []
          const canFlip = day <= today && stops.length >= 2
          const recalcWaiting = day <= today && recalcDays.includes(day)
          const status = recalcWaiting ? 'pending' : row?.status
          const chip = statusText(day, row, status)
          const stopCount = row?.stops?.length ?? group?.stops?.length ?? 0
          const skipped = row?.skipped?.length ? row.skipped : (group?.skipped ?? [])
          const isOpen = !!open[day]
          return (
            <div key={day} className="glass-card">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(o => ({ ...o, [day]: !o[day] }))}
                className="w-full min-h-[44px] flex items-center justify-between gap-2 text-left"
              >
                <div>
                  <div className="font-semibold text-[var(--text)] text-sm">{prettyDay(day)}{day === today && ' · Today'}</div>
                  <div className="text-xs text-[var(--text-secondary)]">{stopCount} stop{stopCount === 1 ? '' : 's'}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`chip ${chip.cls}`}>{chip.text}</span>
                  <ChevronDown size={16} className={`text-[var(--text-secondary)] transition-transform motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`} />
                </div>
              </button>

              {isOpen && (
                <div className="mt-3 space-y-2">
                  {canFlip && (
                    <div className="space-y-1">
                      {stops.map((s, i) => (
                        <div key={s.appointment_id}>
                          {i > 0 && (
                            <div className="pl-4 border-l-2 border-[var(--inset-fill)]">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={isHome(s)}
                                onClick={() => handleFlip(day, s)}
                                className="switch-row"
                              >
                                <span className="text-xs text-[var(--text-secondary)]">Went home in between</span>
                                <span className="switch-track" aria-hidden="true">
                                  <span className="switch-thumb" />
                                </span>
                              </button>
                            </div>
                          )}
                          <div className="text-xs text-[var(--text)]">
                            {i + 1}. {s.job_number ?? `Stop ${i + 1}`}{s.city ? `, ${s.city}` : ''}
                          </div>
                        </div>
                      ))}
                      {recalcWaiting && !isOnline && (
                        <p className="text-xs text-[var(--text-secondary)]">Will recalculate when you're back online.</p>
                      )}
                    </div>
                  )}
                  {row?.status === 'calculated' && row.legs?.length > 0 && (
                    <ul className="space-y-1">
                      {row.legs.map((leg, i) => (
                        <li key={i} className="flex justify-between gap-3 text-xs text-[var(--text-secondary)]">
                          <span>{leg.from} → {leg.to}</span>
                          <span className="shrink-0">{leg.miles} mi</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {skipped.length > 0 && (
                    <p className="note-warn">
                      <AlertCircle size={16} aria-hidden="true" />
                      <span>Not counted (no address): {skipped.map(s => s.job_number ?? 'job').join(', ')}</span>
                    </p>
                  )}
                  {!(row?.legs?.length > 0) && skipped.length === 0 && !canFlip && (
                    <p className="text-xs text-[var(--text-secondary)]">No trip details yet.</p>
                  )}
                </div>
              )}

              {!recalcWaiting && (row?.status === 'pending' || row?.status === 'failed') && row.status_reason && (
                <p className="mt-2 text-xs text-[var(--text-secondary)]">
                  {row.status === 'pending' && (row.attempts ?? 0) >= MAX_AUTO_ATTEMPTS
                    ? "Couldn't calculate automatically. Tap Try again."
                    : friendlyReason(row.status_reason)}
                </p>
              )}
              {notes[day] && <p className="mt-2 text-xs text-[var(--message-red)]">{notes[day]}</p>}

              {day <= today && (
                <Button
                  variant={status === 'calculated' ? 'secondary' : 'primary'}
                  className="w-full mt-3"
                  onClick={() => handleCalculate(day)}
                  disabled={busy[day] || !isOnline}
                >
                  {busy[day] ? 'Calculating…'
                    : status === 'calculated' ? 'Recalculate'
                    : (status === 'pending' || status === 'failed') ? 'Try again'
                    : 'Calculate'}
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
