import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, Search } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import db from '../lib/db'
import { writeRecord } from '../lib/sync'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import Input from '../components/ui/Input'
import Select from '../components/ui/Select'
import Textarea from '../components/ui/Textarea'
import Modal from '../components/ui/Modal'
import Button from '../components/ui/Button'

function formatPhone(value) {
  const digits = value.replace(/\D/g, '').slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `(${digits.slice(0,3)}) ${digits.slice(3)}`
  return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`
}

function generateId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
}

const now = () => format(new Date(), "yyyy-MM-dd'T'HH:mm")

const FIXTURE_OPTIONS  = [
  { value: '', label: '— Select Fixture —' },
  'Bathtub', 'Sink', 'Countertop', 'Toilet'
]
const SURFACE_OPTIONS  = [
  { value: '', label: '— Select Surface —' },
  'Porcelain/Cast Iron', 'Fiberglass', 'Acrylic', 'Cultured Marble'
]
const LEAD_OPTIONS = [
  { value: '', label: '— How did they hear about us? —' },
  'Google Search', 'Google Maps', 'Referral', 'Repeat Customer', 'Other'
]

export default function NewIntake() {
  const navigate = useNavigate()
  const isOnline = useOnlineStatus()
  const nameRef = useRef(null)

  const [form, setForm] = useState({
    full_name: '', phone: '', call_datetime: now(),
    fixture_type: '', surface_type: '', surface_color: '',
    schedule_appointment: false,
    appointment_datetime: '', location_address: '',
    notes: '', lead_source: '', referred_by: '',
  })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [linkedCustomer, setLinkedCustomer] = useState(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }))

  const handlePhone = (v) => set('phone', formatPhone(v))

  const searchCustomers = async (q) => {
    setSearchQuery(q)
    if (q.length < 2) { setSearchResults([]); return }
    const results = await db.customers
      .filter(c =>
        c.full_name?.toLowerCase().includes(q.toLowerCase()) ||
        c.phone?.includes(q)
      )
      .limit(8)
      .toArray()
    setSearchResults(results)
  }

  const submitLabel = () => {
    if (form.appointment_datetime) return 'Save & Schedule'
    if (form.fixture_type || form.surface_type) return 'Save as Quote'
    return 'Save Contact'
  }

  const submitStatus = () => {
    if (form.appointment_datetime) return 'appointment'
    if (form.fixture_type || form.surface_type) return 'quote'
    return 'contact'
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.full_name.trim()) return
    setSaving(true)

    let customerId = linkedCustomer?.id
    let savedJob, jobNumber

    try {
      if (!linkedCustomer) {
        const customerPayload = {
          id: generateId(),
          full_name: form.full_name.trim(),
          phone: form.phone,
          created_at: new Date().toISOString(),
        }
        const saved = await writeRecord('customers', customerPayload, isOnline)
        customerId = saved.id
      }

      jobNumber = `DTF-${Date.now().toString().slice(-5)}`
      if (isOnline) {
        const { data } = await supabase.rpc('generate_job_number')
        if (data) jobNumber = data
      }

      const jobPayload = {
        id: generateId(),
        job_number: jobNumber,
        customer_id: customerId,
        status: submitStatus(),
        fixture_type: form.fixture_type || null,
        surface_type: form.surface_type || null,
        surface_color: form.surface_color || null,
        notes: form.notes || null,
        lead_source: form.lead_source || null,
        referred_by: form.lead_source === 'Referral' ? form.referred_by : null,
        call_datetime: form.call_datetime,
        created_at: new Date().toISOString(),
      }
      savedJob = await writeRecord('jobs', jobPayload, isOnline)

      setToast(`Saved! Job ${jobNumber}`)
      navigate(`/jobs/${savedJob.id}`, { replace: true })
    } catch (primaryError) {
      console.error(primaryError)
      setToast('Error saving. Try again.')
      setSaving(false)
      return
    }

    // Secondary operations — run after navigate; each fully isolated
    if (form.schedule_appointment && form.appointment_datetime) {
      try {
        const apptPayload = {
          id: generateId(),
          job_id: savedJob.id,
          appointment_datetime: form.appointment_datetime,
          location_address: form.location_address || null,
          created_at: new Date().toISOString(),
        }
        await writeRecord('appointments', apptPayload, isOnline)
      } catch (e) { console.error('Appointment write failed:', e) }

      if (isOnline) {
        try {
          const { data: { session } } = await supabase.auth.getSession()
          if (session?.provider_token) {
            const event = {
              summary: `DTF — ${form.full_name} (${form.fixture_type || 'Job'})`,
              description: `Job: ${jobNumber}\nPhone: ${form.phone}\nNotes: ${form.notes}`,
              start: { dateTime: new Date(form.appointment_datetime).toISOString() },
              end:   { dateTime: new Date(new Date(form.appointment_datetime).getTime() + 2 * 3600000).toISOString() },
              location: form.location_address || undefined,
            }
            await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${session.provider_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(event),
            })
          }
        } catch (e) { console.error('Calendar sync failed:', e) }
      }
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="bg-navy px-4 py-4 flex items-center justify-between sticky top-0 z-30">
        <h1 className="text-white font-bold text-lg">New Call</h1>
        <button onClick={() => navigate(-1)} className="text-white">
          <X size={22} />
        </button>
      </header>

      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex-1 px-4 py-5 space-y-6 max-w-lg mx-auto w-full">

        {/* Section 1 — Customer */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6B7280] mb-3">Customer</h2>
          <div className="space-y-3">
            <Input
              label="Full Name"
              id="full_name"
              ref={nameRef}
              value={form.full_name}
              onChange={e => set('full_name', e.target.value)}
              placeholder="Jane Smith"
              required
              autoComplete="off"
            />
            <Input
              label="Phone"
              id="phone"
              type="tel"
              value={form.phone}
              onChange={e => handlePhone(e.target.value)}
              placeholder="(214) 555-0100"
            />
            {linkedCustomer ? (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
                <span>Linked: {linkedCustomer.full_name}</span>
                <button type="button" onClick={() => setLinkedCustomer(null)} className="ml-auto text-red-500">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="text-xs text-navy underline"
              >
                Existing customer?
              </button>
            )}
          </div>
        </section>

        {/* Section 2 — Job Details */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6B7280] mb-3">Job Details</h2>
          <div className="space-y-3">
            <Input
              label="Call Date & Time"
              id="call_datetime"
              type="datetime-local"
              value={form.call_datetime}
              onChange={e => set('call_datetime', e.target.value)}
            />
            <Select
              label="Fixture Type"
              id="fixture_type"
              value={form.fixture_type}
              onChange={e => set('fixture_type', e.target.value)}
              options={FIXTURE_OPTIONS}
            />
            <Select
              label="Surface Type"
              id="surface_type"
              value={form.surface_type}
              onChange={e => set('surface_type', e.target.value)}
              options={SURFACE_OPTIONS}
            />
            <Input
              label="Surface Color (optional)"
              id="surface_color"
              value={form.surface_color}
              onChange={e => set('surface_color', e.target.value)}
              placeholder="e.g. Almond, Biscuit, White"
            />
          </div>
        </section>

        {/* Section 3 — Appointment */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6B7280] mb-3">Appointment</h2>
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              onClick={() => set('schedule_appointment', !form.schedule_appointment)}
              className={`w-10 h-6 rounded-full transition-colors flex items-center px-1 ${form.schedule_appointment ? 'bg-navy' : 'bg-gray-300'}`}
            >
              <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${form.schedule_appointment ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
            <span className="text-sm font-medium text-[#1F2937]">Schedule Appointment</span>
          </label>
          {form.schedule_appointment && (
            <div className="mt-3 space-y-3">
              <Input
                label="Appointment Date & Time"
                id="appointment_datetime"
                type="datetime-local"
                value={form.appointment_datetime}
                onChange={e => set('appointment_datetime', e.target.value)}
              />
              <Input
                label="Location / Address"
                id="location_address"
                value={form.location_address}
                onChange={e => set('location_address', e.target.value)}
                placeholder="123 Main St, Dallas TX 75201"
              />
            </div>
          )}
        </section>

        {/* Section 4 — Notes */}
        <section>
          <Textarea
            label="Notes"
            id="notes"
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            rows={3}
            placeholder="Describe the issue, color match details, customer requests…"
          />
        </section>

        {/* Section 5 — Lead Source */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6B7280] mb-3">Lead Source</h2>
          <div className="space-y-3">
            <Select
              label="How did they hear about us?"
              id="lead_source"
              value={form.lead_source}
              onChange={e => set('lead_source', e.target.value)}
              options={LEAD_OPTIONS}
            />
            {form.lead_source === 'Referral' && (
              <Input
                label="Referred By"
                id="referred_by"
                value={form.referred_by}
                onChange={e => set('referred_by', e.target.value)}
                placeholder="Name of person who referred them"
              />
            )}
          </div>
        </section>

        {/* Submit */}
        <div className="pb-8">
          <Button
            type="submit"
            variant="gold"
            className="w-full py-3 text-base"
            disabled={saving || !form.full_name.trim()}
          >
            {saving ? 'Saving…' : submitLabel()}
          </Button>
        </div>
      </form>

      {/* Customer search modal */}
      <Modal open={searchOpen} onClose={() => setSearchOpen(false)} title="Find Existing Customer">
        <div className="space-y-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              autoFocus
              value={searchQuery}
              onChange={e => searchCustomers(e.target.value)}
              placeholder="Name or phone…"
              className="w-full border border-[#E5E7EB] rounded-lg pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy"
            />
          </div>
          <div className="space-y-2">
            {searchResults.map(c => (
              <button
                key={c.id || c._localId}
                type="button"
                onClick={() => {
                  setLinkedCustomer(c)
                  set('full_name', c.full_name)
                  set('phone', c.phone || '')
                  setSearchOpen(false)
                }}
                className="w-full text-left px-3 py-2 rounded-lg border border-[#E5E7EB] hover:bg-blue-50"
              >
                <div className="font-medium text-sm text-[#1F2937]">{c.full_name}</div>
                <div className="text-xs text-[#6B7280]">{c.phone}</div>
              </button>
            ))}
            {searchQuery.length >= 2 && searchResults.length === 0 && (
              <p className="text-sm text-[#6B7280] text-center py-4">No customers found</p>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
