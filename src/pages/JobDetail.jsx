import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Phone, Camera, Video, FileText, Shield,
  ChevronDown, ChevronUp, Plus, Calendar, Trash2, X, MessageSquare
} from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import db from '../lib/db'
import { updateRecord, upsertLocal } from '../lib/sync'
import { formatEnum } from '../lib/formatEnum'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import Select from '../components/ui/Select'
import Textarea from '../components/ui/Textarea'
import { createCalendarEvent, updateCalendarEvent } from '../lib/googleCalendar'
import { getValidProviderToken } from '../lib/googleToken'
import AddressAutocomplete from '../components/ui/AddressAutocomplete'

function describeCalendarError(result) {
  if (!result?.error) return 'Unknown error'
  if (result.error === 'token_expired') return 'sign in again to reconnect'
  if (result.error === 'request_failed') {
    return `Google error ${result.status}: ${(result.detail || '').slice(0, 100)}`
  }
  if (result.error === 'network_error') {
    return `Network error: ${(result.detail || '').slice(0, 100)}`
  }
  return 'Unknown error'
}

const STATUS_OPTIONS = [
  { value: 'contact',     label: 'Contact'     },
  { value: 'quote',       label: 'Quote'       },
  { value: 'appointment', label: 'Appointment' },
  { value: 'active',      label: 'Active'      },
  { value: 'completed',   label: 'Completed'   },
  { value: 'cancelled',   label: 'Cancelled'   },
]

const FIXTURE_OPTIONS = [
  { value: '',           label: '— Select Fixture —' },
  { value: 'bathtub',    label: 'Bathtub' },
  { value: 'sink',       label: 'Sink' },
  { value: 'countertop', label: 'Countertop' },
  { value: 'toilet',     label: 'Toilet' },
]

const SURFACE_OPTIONS = [
  { value: '',                    label: '— Select Surface —' },
  { value: 'porcelain_cast_iron', label: 'Porcelain / Cast Iron' },
  { value: 'fiberglass',          label: 'Fiberglass' },
  { value: 'acrylic',             label: 'Acrylic' },
  { value: 'cultured_marble',     label: 'Cultured Marble' },
]

const LEAD_OPTIONS = [
  { value: '',                label: '— Lead Source —' },
  { value: 'Google Search',   label: 'Google Search' },
  { value: 'Google Maps',     label: 'Google Maps' },
  { value: 'Referral',        label: 'Referral' },
  { value: 'Repeat Customer', label: 'Repeat Customer' },
  { value: 'Other',           label: 'Other' },
]

const REVIEW_LINK = 'https://g.page/r/CZ3g5Gm0_pYiEBM/review'

const toLocalInput = (dt) => {
  if (!dt) return ''
  try { return format(new Date(dt), "yyyy-MM-dd'T'HH:mm") } catch { return '' }
}

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Card className="p-0 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">{title}</span>
        {open ? <ChevronUp size={16} className="text-[#9CA3AF]" /> : <ChevronDown size={16} className="text-[#9CA3AF]" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </Card>
  )
}

export default function JobDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isOnline = useOnlineStatus()

  const [job, setJob] = useState(null)
  const [customer, setCustomer] = useState(null)
  const [appointments, setAppointments] = useState([])
  const [images, setImages] = useState([])
  const [videos, setVideos] = useState([])
  const [invoice, setInvoice] = useState(null)
  const [warranty, setWarranty] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Edit state per section
  const [editNotes, setEditNotes] = useState(false)
  const [notesVal, setNotesVal] = useState('')
  const [editCustomer, setEditCustomer] = useState(false)
  const [custVal, setCustVal] = useState({})
  const [editJob, setEditJob] = useState(false)
  const [jobVal, setJobVal] = useState({})
  const [editApptId, setEditApptId] = useState(null)
  const [apptVal, setApptVal] = useState({ appointment_datetime: '', location_address: '', notes: '' })

  const [apptModal, setApptModal] = useState(false)
  const [newAppt, setNewAppt] = useState({ appointment_datetime: '', location_address: '' })

  // Signed URLs for private bucket images (id/_localId -> url)
  const [signedUrls, setSignedUrls] = useState({})
  const [lightboxImg, setLightboxImg] = useState(null)
  const touchStartX = useRef(null)
  const lightboxContainerRef = useRef(null)
  const [dragX, setDragX] = useState(0)
  const [isSettling, setIsSettling] = useState(false)

  const flashToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 1800) }

  const load = async () => {
    // Try Dexie first
    let j = await db.jobs.where('id').equals(id).first()
    if (!j && isOnline) {
      const { data } = await supabase.from('jobs').select('*').eq('id', id).single()
      if (data) { await upsertLocal('jobs', { ...data, _synced: true }); j = data }
    }
    setJob(j)
    setNotesVal(j?.notes ?? '')

    if (j?.customer_id) {
      let c = await db.customers.where('id').equals(j.customer_id).first()
      if (!c && isOnline) {
        const { data } = await supabase.from('customers').select('*').eq('id', j.customer_id).single()
        if (data) { await upsertLocal('customers', { ...data, _synced: true }); c = data }
      }
      setCustomer(c)
    }

    const appts = await db.appointments.where('job_id').equals(id).toArray()
    setAppointments(appts)

    const imgs = await db.images.where('job_id').equals(id).toArray()
    setImages(imgs)

    const vids = await db.videos.where('job_id').equals(id).toArray()
    setVideos(vids)

    const inv = await db.invoices.where('job_id').equals(id).first()
    setInvoice(inv)
    if (inv) {
      const warr = await db.warranties.where('invoice_id').equals(inv.id).first()
      setWarranty(warr)
    }

    if (isOnline) {
      const [apptRes, imgRes, vidRes, invRes] = await Promise.all([
        supabase.from('appointments').select('*').eq('job_id', id),
        supabase.from('images').select('*').eq('job_id', id),
        supabase.from('videos').select('*').eq('job_id', id),
        supabase.from('invoices').select('*').eq('job_id', id).maybeSingle(),
      ])
      if (apptRes.data) { for (const a of apptRes.data) await upsertLocal('appointments', { ...a, _synced: true }); setAppointments(apptRes.data) }
      if (imgRes.data)  { for (const i of imgRes.data) await upsertLocal('images', { ...i, _synced: true }); setImages(imgRes.data) }
      if (vidRes.data)  { for (const v of vidRes.data) await upsertLocal('videos', { ...v, _synced: true }); setVideos(vidRes.data) }
      if (invRes.data)  {
        await upsertLocal('invoices', { ...invRes.data, _synced: true })
        setInvoice(invRes.data)
        let warr = await db.warranties.where('invoice_id').equals(invRes.data.id).first()
        if (!warr) {
          const { data: wData } = await supabase.from('warranties').select('*').eq('invoice_id', invRes.data.id).maybeSingle()
          if (wData) { await upsertLocal('warranties', { ...wData, _synced: true }); warr = wData }
        }
        if (warr) setWarranty(warr)
      }
    }

    setLoading(false)
  }

  useEffect(() => { if (id) load() }, [id])

  // Generate signed URLs whenever the image set changes (bucket is private)
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (!images || images.length === 0) { setSignedUrls({}); return }
      const entries = await Promise.all(images.map(async (img) => {
        const key = img.id || img._localId
        if (!img.storage_path) return [key, null]
        try {
          const { data } = await supabase.storage
            .from('job-images')
            .createSignedUrl(img.storage_path, 3600)
          return [key, data?.signedUrl ?? null]
        } catch {
          return [key, null]
        }
      }))
      if (!cancelled) setSignedUrls(Object.fromEntries(entries))
    }
    run()
    return () => { cancelled = true }
  }, [images])

  const deletePhoto = async (img) => {
    if (!window.confirm('Delete this photo? This cannot be undone.')) return
    try {
      if (img.storage_path) {
        await supabase.storage.from('job-images').remove([img.storage_path])
      }
      const imgId = img.id
      if (imgId) await supabase.from('images').delete().eq('id', imgId)
      await db.images.where('id').equals(imgId).delete()
      setImages(prev => prev.filter(i => (i.id || i._localId) !== (img.id || img._localId)))
      setLightboxImg(null)
    } catch (err) {
      console.error('Delete photo error:', err)
      alert('Failed to delete photo. Please try again.')
    }
  }

  const goToPhoto = (direction) => {
    if (!lightboxImg) return
    const currentKey = lightboxImg.img.id || lightboxImg.img._localId
    const currentIndex = sortedImages.findIndex(img => (img.id || img._localId) === currentKey)
    if (currentIndex === -1) return
    const newIndex = currentIndex + (direction === 'next' ? 1 : -1)
    if (newIndex < 0 || newIndex >= sortedImages.length) return
    const newImg = sortedImages[newIndex]
    const newKey = newImg.id || newImg._localId
    const newUrl = signedUrls[newKey]
    if (!newUrl) return
    setLightboxImg({ url: newUrl, img: newImg })
  }

  const deleteVideo = async (v) => {
    if (!window.confirm('Delete this video? It will also be removed from Google Drive.')) return
    try {
      const providerToken = await getValidProviderToken()
      if (providerToken && v.google_drive_file_id) {
        await fetch(`https://www.googleapis.com/drive/v3/files/${v.google_drive_file_id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${providerToken}` },
        })
      }
      if (v.id) await supabase.from('videos').delete().eq('id', v.id)
      await db.videos.where('id').equals(v.id).delete()
      setVideos(prev => prev.filter(vid => (vid.id || vid._localId) !== (v.id || v._localId)))
    } catch (err) {
      console.error('Delete video error:', err)
      alert('Failed to delete video. Please try again.')
    }
  }

  const handleDeleteTestJob = async () => {
    if (!window.confirm('Delete this entire test job? This removes the job, its invoice, appointments, photos, and videos permanently. This cannot be undone.')) return
    setDeleting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-test-job`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ job_id: id }),
      })
      const result = await res.json()
      if (!res.ok || !result.success) {
        throw new Error(result?.error || 'Delete failed')
      }
      navigate('/jobs')
    } catch (err) {
      console.error('Delete test job error:', err)
      alert('Failed to delete job. Please try again.')
      setDeleting(false)
    }
  }

  const saveStatus = async (status) => {
    if (!job) return
    const updated = { ...job, status, updated_at: new Date().toISOString() }
    setJob(updated)
    await updateRecord('jobs', updated, isOnline)
    flashToast(`Status → ${formatEnum(status)}`)
  }

  const handleCancelJob = () => {
    if (!window.confirm('Cancel this job? It will be marked cancelled and excluded from active work, but not deleted.')) return
    saveStatus('cancelled')
  }

  const handleUncancelJob = () => {
    if (!window.confirm('Restore this job to active status?')) return
    saveStatus('active')
  }

  const saveNotes = async () => {
    if (!job) return
    const updated = { ...job, notes: notesVal, updated_at: new Date().toISOString() }
    setJob(updated)
    await updateRecord('jobs', updated, isOnline)
    setEditNotes(false)
    flashToast('Notes saved')
  }

  const startEditCustomer = () => {
    setCustVal({
      full_name:      customer?.full_name      ?? '',
      phone:          customer?.phone          ?? '',
      email:          customer?.email          ?? '',
      address:        customer?.address        ?? '',
      city_state_zip: customer?.city_state_zip ?? '',
      lead_source:    customer?.lead_source    ?? '',
      referred_by:    customer?.referred_by    ?? '',
    })
    setEditCustomer(true)
  }

  const saveCustomer = async () => {
    if (!customer) return
    setSaving(true)
    const updated = {
      ...customer,
      ...custVal,
      email:       custVal.email       || null,
      address:     custVal.address     || null,
      lead_source: custVal.lead_source || null,
      referred_by: custVal.lead_source === 'Referral' ? (custVal.referred_by || null) : null,
      updated_at: new Date().toISOString(),
    }
    setCustomer(updated)
    await updateRecord('customers', updated, isOnline)
    setEditCustomer(false)
    setSaving(false)
    flashToast('Customer saved')
  }

  const startEditJob = () => {
    setJobVal({
      fixture_type:  job?.fixture_type  ?? '',
      surface_type:  job?.surface_type  ?? '',
      surface_color: job?.surface_color ?? '',
    })
    setEditJob(true)
  }

  const saveJob = async () => {
    if (!job) return
    setSaving(true)
    const updated = {
      ...job,
      fixture_type:  jobVal.fixture_type  || null,
      surface_type:  jobVal.surface_type  || null,
      surface_color: jobVal.surface_color || null,
      updated_at: new Date().toISOString(),
    }
    setJob(updated)
    await updateRecord('jobs', updated, isOnline)
    setEditJob(false)
    setSaving(false)
    flashToast('Job details saved')
  }

  const startEditAppt = (a) => {
    setEditApptId(a.id || a._localId)
    setApptVal({
      appointment_datetime: toLocalInput(a.appointment_datetime),
      location_address: a.location_address ?? '',
      notes: a.notes ?? '',
    })
  }

  const saveAppt = async (a) => {
    if (!apptVal.appointment_datetime) return
    setSaving(true)
    const key = a.id || a._localId
    const updated = {
      ...a,
      appointment_datetime: new Date(apptVal.appointment_datetime).toISOString(),
      location_address: apptVal.location_address || null,
      notes: apptVal.notes || null,
      updated_at: new Date().toISOString(),
    }
    setAppointments(list => list.map(x => (x.id || x._localId) === key ? updated : x))
    await updateRecord('appointments', updated, isOnline)
    setEditApptId(null)
    setSaving(false)
    if (isOnline) {
      try {
        const token = await getValidProviderToken()
        if (!token) {
          flashToast('Appointment saved. Calendar sync failed — sign in again to reconnect.')
          return
        }
        const [apptDate, apptTime] = apptVal.appointment_datetime.split('T')
        const appointmentData = {
          customerName: customer?.full_name || '',
          address: apptVal.location_address || '',
          appointmentDate: apptDate,
          appointmentTime: apptTime,
          jobNumber: job?.job_number || '',
          notes: apptVal.notes || '',
        }
        let eventId
        if (updated.google_calendar_event_id) {
          eventId = await updateCalendarEvent(token, updated.google_calendar_event_id, appointmentData)
        } else {
          eventId = await createCalendarEvent(token, appointmentData)
        }
        if (eventId && typeof eventId === 'string') {
          const withEventId = { ...updated, google_calendar_event_id: eventId }
          setAppointments(list => list.map(x => (x.id || x._localId) === key ? withEventId : x))
          await updateRecord('appointments', withEventId, isOnline)
        } else if (eventId?.error) {
          flashToast(`Appointment saved. Calendar sync failed — ${describeCalendarError(eventId)}`)
          return
        }
      } catch (e) { console.error('Calendar sync failed:', e) }
    }
    flashToast('Appointment saved')
  }

  const addAppointment = async () => {
    if (!newAppt.appointment_datetime) return
    setSaving(true)
    const payload = {
      id: crypto.randomUUID(),
      job_id: id,
      appointment_datetime: new Date(newAppt.appointment_datetime).toISOString(),
      location_address: newAppt.location_address || null,
      created_at: new Date().toISOString(),
    }
    await db.appointments.add({ ...payload, _synced: false })
    if (isOnline) {
      await supabase.from('appointments').insert(payload)
      await db.appointments.where('id').equals(payload.id).modify({ _synced: true })
    }
    setAppointments(a => [...a, payload])
    setApptModal(false)
    setNewAppt({ appointment_datetime: '', location_address: '' })
    setSaving(false)
    flashToast('Appointment added')
    if (isOnline) {
      try {
        const token = await getValidProviderToken()
        if (!token) {
          flashToast('Calendar sync failed — sign in again to reconnect.')
          return
        }
        const [apptDate, apptTime] = newAppt.appointment_datetime.split('T')
        const eventId = await createCalendarEvent(token, {
          customerName: customer?.full_name || '',
          address: newAppt.location_address || '',
          appointmentDate: apptDate,
          appointmentTime: apptTime,
          jobNumber: job?.job_number || '',
          notes: '',
        })
        if (eventId && typeof eventId === 'string') {
          const withEventId = { ...payload, google_calendar_event_id: eventId }
          setAppointments(prev => prev.map(a => a.id === payload.id ? withEventId : a))
          await updateRecord('appointments', withEventId, isOnline)
        } else if (eventId?.error) {
          flashToast(`Calendar sync failed — ${describeCalendarError(eventId)}`)
        }
      } catch (e) { console.error('Calendar sync failed:', e) }
    }
  }

  function requestReview() {
    if (!customer?.phone) return
    const digits = customer.phone.replace(/\D/g, '')
    const e164 = digits.length === 10 ? `+1${digits}` : `+${digits}`
    const firstName = (customer.full_name || '').split(' ')[0] || 'there'
    const body = `Hi ${firstName} — thanks again for letting us fix your tub today. If you have a sec, your honest Google review means everything for a new local business: ${REVIEW_LINK}. No pressure either way. — John, Dallas Tub Fix`
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    const separator = isIOS ? '&' : '?'
    window.location.href = `sms:${e164}${separator}body=${encodeURIComponent(body)}`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-navy" />
      </div>
    )
  }

  if (!job) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-4">
        <p className="text-[#6B7280]">Job not found.</p>
        <button onClick={() => navigate('/jobs')} className="mt-4 text-navy underline text-sm">Back to Jobs</button>
      </div>
    )
  }

  const sortedImages = [...images].sort(
    (a, b) => (a.image_type === 'before' ? 0 : 1) - (b.image_type === 'before' ? 0 : 1)
  )

  const invoiceLocked = !!(invoice?.technician_signature_url && invoice?.customer_signature_url)
  const hasInvoice = !!invoice
  const technicianSigned = !!invoice?.technician_signature_url
  const customerSigned = !!invoice?.customer_signature_url
  const hasWarranty = !!warranty

  return (
    <div className="min-h-screen bg-[#F3F4F6] pb-40">
      {/* Header */}
      <header className="bg-navy px-4 py-4 flex items-center gap-3 sticky top-0 z-30">
        <button onClick={() => navigate(-1)} className="text-white">
          <ArrowLeft size={20} />
        </button>
        <span className="text-white font-bold text-base flex-1">{job.job_number}</span>
        <Badge status={job.status} />
        {job.is_test && (
          <button onClick={handleDeleteTestJob} className="text-white/80 hover:text-white" disabled={deleting}>
            <Trash2 size={18} />
          </button>
        )}
        {job.status !== 'cancelled' ? (
          <button onClick={handleCancelJob} className="text-white/80 hover:text-white">
            <X size={18} />
          </button>
        ) : (
          <button onClick={handleUncancelJob} className="text-xs text-white/80 hover:text-white underline">
            Restore
          </button>
        )}
      </header>

      {/* v4 test build */}
      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[60] bg-green-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      <div className="px-4 py-4 space-y-3">

        {/* Customer */}
        <Section title="Customer">
          {editCustomer ? (
            <div className="space-y-3">
              <Input label="Full Name" value={custVal.full_name}
                onChange={e => setCustVal(v => ({ ...v, full_name: e.target.value }))} />
              <Input label="Phone" type="tel" value={custVal.phone}
                onChange={e => setCustVal(v => ({ ...v, phone: e.target.value }))} />
              <Input label="Email" type="email" value={custVal.email}
                onChange={e => setCustVal(v => ({ ...v, email: e.target.value }))} />
              <AddressAutocomplete label="Address" value={custVal.address}
                onChange={v => setCustVal(cv => ({ ...cv, address: v }))} />
              <Input label="City / State / Zip" value={custVal.city_state_zip}
                onChange={e => setCustVal(v => ({ ...v, city_state_zip: e.target.value }))} />
              <Select label="Lead Source" value={custVal.lead_source} options={LEAD_OPTIONS}
                onChange={e => setCustVal(v => ({ ...v, lead_source: e.target.value }))} />
              {custVal.lead_source === 'Referral' && (
                <Input label="Referred By" value={custVal.referred_by}
                  onChange={e => setCustVal(v => ({ ...v, referred_by: e.target.value }))} />
              )}
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1" onClick={saveCustomer} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </Button>
                <Button variant="ghost" onClick={() => setEditCustomer(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div className="font-bold text-[#1F2937]">{customer?.full_name ?? '—'}</div>
                {customer && (
                  <button onClick={startEditCustomer} className="text-xs text-navy underline shrink-0">Edit</button>
                )}
              </div>
              {customer?.phone && (
                <a href={`tel:${customer.phone}`} className="flex items-center gap-2 text-navy text-sm">
                  <Phone size={14} /> {customer.phone}
                </a>
              )}
              {customer?.email && <div className="text-sm text-[#6B7280]">{customer.email}</div>}
              {customer?.address && <div className="text-sm text-[#6B7280]">{customer.address}</div>}
              {customer?.city_state_zip && <div className="text-sm text-[#6B7280]">{customer.city_state_zip}</div>}
              {customer?.lead_source && (
                <div className="text-xs text-[#9CA3AF] pt-1">
                  Lead: {customer.lead_source}{customer.referred_by ? ` · ${customer.referred_by}` : ''}
                </div>
              )}
            </div>
          )}
        </Section>

        {/* Job Info */}
        <Section title="Job Info">
          <div className="space-y-2">
            <div className="flex gap-2 items-center">
              <span className="text-xs text-[#6B7280] w-28">Status</span>
              <Select
                value={job.status}
                onChange={e => saveStatus(e.target.value)}
                options={STATUS_OPTIONS}
                className="flex-1 py-1.5 pr-8"
              />
            </div>

            {editJob ? (
              <div className="space-y-3 pt-1">
                <Select label="Fixture Type" value={jobVal.fixture_type} options={FIXTURE_OPTIONS}
                  onChange={e => setJobVal(v => ({ ...v, fixture_type: e.target.value }))} />
                <Select label="Surface Type" value={jobVal.surface_type} options={SURFACE_OPTIONS}
                  onChange={e => setJobVal(v => ({ ...v, surface_type: e.target.value }))} />
                <Input label="Surface Color" value={jobVal.surface_color}
                  onChange={e => setJobVal(v => ({ ...v, surface_color: e.target.value }))} />
                <div className="flex gap-2">
                  <Button variant="primary" className="flex-1" onClick={saveJob} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                  <Button variant="ghost" onClick={() => setEditJob(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                {[
                  ['Fixture', formatEnum(job.fixture_type)],
                  ['Surface', formatEnum(job.surface_type)],
                  ['Color',   job.surface_color],
                ].map(([label, value]) => value ? (
                  <div key={label} className="flex gap-2">
                    <span className="text-xs text-[#6B7280] w-28">{label}</span>
                    <span className="text-sm text-[#1F2937]">{value}</span>
                  </div>
                ) : null)}
                <button onClick={startEditJob} className="text-xs text-navy underline mt-1">Edit job details</button>
              </>
            )}
          </div>
        </Section>

        {/* Appointments */}
        <Section title="Appointments">
          <div className="space-y-2">
            {appointments.length === 0 && (
              <p className="text-sm text-[#6B7280]">No appointments yet.</p>
            )}
            {appointments.map(a => {
              const key = a.id || a._localId
              const editing = editApptId === key
              return (
                <div key={key} className="border border-[#E5E7EB] rounded-lg p-3">
                  {editing ? (
                    <div className="space-y-3">
                      <Input label="Date & Time" type="datetime-local" value={apptVal.appointment_datetime}
                        onChange={e => setApptVal(v => ({ ...v, appointment_datetime: e.target.value }))} />
                      <AddressAutocomplete label="Address" value={apptVal.location_address}
                        onChange={v => setApptVal(a => ({ ...a, location_address: v }))} />
                      <Textarea label="Notes" rows={2} value={apptVal.notes}
                        onChange={e => setApptVal(v => ({ ...v, notes: e.target.value }))} />
                      <div className="flex gap-2">
                        <Button variant="primary" className="flex-1" onClick={() => saveAppt(a)} disabled={saving}>
                          {saving ? 'Saving…' : 'Save'}
                        </Button>
                        <Button variant="ghost" onClick={() => setEditApptId(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-sm text-[#1F2937]">
                          {format(new Date(a.appointment_datetime), 'EEE, MMM d · h:mm a')}
                        </div>
                        {a.location_address && (
                          <div className="text-xs text-[#6B7280] mt-0.5">{a.location_address}</div>
                        )}
                        {a.notes && (
                          <div className="text-xs text-[#6B7280] mt-0.5 whitespace-pre-wrap">{a.notes}</div>
                        )}
                      </div>
                      <button onClick={() => startEditAppt(a)} className="text-xs text-navy underline shrink-0">Edit</button>
                    </div>
                  )}
                </div>
              )
            })}
            <button
              onClick={() => setApptModal(true)}
              className="flex items-center gap-2 text-navy text-sm font-medium mt-2"
            >
              <Plus size={14} /> Add Appointment
            </button>
          </div>
        </Section>

        {/* Images */}
        <Section title="Photos">
          {sortedImages.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 mb-3">
              {sortedImages.map(img => {
                const key = img.id || img._localId
                const url = signedUrls[key]
                return (
                  <div key={key} className="relative rounded-lg overflow-hidden aspect-square bg-[#F3F4F6]">
                    {url ? (
                      <img
                        src={url}
                        alt={img.image_type ?? 'job photo'}
                        loading="lazy"
                        className="w-full h-full object-cover cursor-pointer"
                        onClick={() => setLightboxImg({ url, img })}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="w-5 h-5 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-navy" />
                      </div>
                    )}
                    <span className={`absolute top-1 left-1 text-xs font-bold px-1.5 py-0.5 rounded ${img.image_type === 'before' ? 'bg-green-500 text-white' : 'bg-gold text-white'}`}>
                      {img.image_type?.toUpperCase()}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-[#6B7280] mb-3">No photos yet.</p>
          )}
          <Button variant="secondary" className="w-full" onClick={() => navigate(`/jobs/${id}/images`)}>
            <Camera size={16} /> Add Photos
          </Button>
        </Section>

        {/* Videos */}
        <Section title="Videos" defaultOpen={false}>
          {videos.length > 0 && (
            <div className="space-y-2 mb-3">
              {videos.map(v => (
                <div key={v.id || v._localId} className="flex items-center gap-2 border border-[#E5E7EB] rounded-lg p-3">
                  <Video size={14} className="text-navy" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{v.video_type?.toUpperCase()} video</div>
                    {v.google_drive_view_url && (
                      <a href={v.google_drive_view_url} target="_blank" rel="noreferrer" className="text-xs text-navy underline">
                        View in Drive
                      </a>
                    )}
                  </div>
                  <button
                    onClick={() => deleteVideo(v)}
                    className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <Button variant="secondary" className="w-full" onClick={() => navigate(`/jobs/${id}/video`)}>
            <Video size={16} /> Record Video
          </Button>
        </Section>

        {/* Documents */}
        <Section title="Documents">
          <div className="space-y-2">
            {invoice && (
              <div className="flex items-center gap-2 text-sm text-[#6B7280] mb-1">
                <span className="font-medium text-[#1F2937]">Invoice #{invoice.invoice_number ?? job.job_number}</span>
                <Badge status={invoice.payment_status === 'paid' ? 'completed' : invoice.payment_status === 'partial' ? 'quote' : 'contact'} />
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => invoice
                  ? navigate(`/invoices/${invoice.id}`)
                  : navigate(`/invoices/new/${id}`)
                }
              >
                <FileText size={16} />
                {invoice ? (invoiceLocked ? 'Signed Invoice' : 'View Invoice') : 'Build Invoice'}
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                disabled={!warranty}
                onClick={() => warranty && navigate(`/warranties/${warranty.id}`)}
              >
                <Shield size={16} />
                {warranty ? (invoiceLocked ? 'Signed Warranty' : 'View Warranty') : 'No Warranty'}
              </Button>
            </div>
          </div>
        </Section>

        {/* Notes */}
        <Section title="Notes">
          {editNotes ? (
            <div className="space-y-2">
              <Textarea
                value={notesVal}
                onChange={e => setNotesVal(e.target.value)}
                rows={4}
              />
              <div className="flex gap-2">
                <Button variant="primary" className="flex-1" onClick={saveNotes}>Save</Button>
                <Button variant="ghost" onClick={() => { setEditNotes(false); setNotesVal(job.notes ?? '') }}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-[#1F2937] whitespace-pre-wrap">{job.notes || 'No notes yet.'}</p>
              <button onClick={() => setEditNotes(true)} className="text-xs text-navy underline mt-2">Edit</button>
            </div>
          )}
        </Section>
      </div>

      {/* Sticky bottom action bar */}
      <div className="fixed left-0 right-0 bg-white border-t border-[#E5E7EB] pl-4 pr-20 py-3 flex gap-2 z-30 no-print"
           style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom))' }}>
        {(job.status === 'contact' || job.status === 'quote') && (
          <Button variant="gold" className="flex-1" onClick={() => setApptModal(true)}>
            <Calendar size={16} /> Schedule Appointment
          </Button>
        )}
        {job.status === 'appointment' && (
          <>
            <Button variant="primary" className="flex-1" onClick={() => saveStatus('active')}>
              Mark Active
            </Button>
            <Button variant="gold" className="flex-1" onClick={() => navigate(`/invoices/new/${id}`)}>
              Build Invoice
            </Button>
          </>
        )}
        {job.status === 'active' && (
          <div className="flex flex-col gap-2 flex-1">
            <div className="flex gap-2">
              {!hasInvoice && (
                <Button variant="gold" className="flex-1" onClick={() => navigate(`/invoices/new/${id}`)}>
                  Build Invoice
                </Button>
              )}
              {hasInvoice && !technicianSigned && (
                <Button variant="gold" className="flex-1" onClick={() => navigate(`/invoices/${invoice.id}?sign=1`)}>
                  Technician Sign
                </Button>
              )}
              {hasInvoice && technicianSigned && !customerSigned && (
                <Button variant="gold" className="flex-1" onClick={() => navigate(`/invoices/${invoice.id}?sign=1`)}>
                  Customer Sign
                </Button>
              )}
              {hasInvoice && technicianSigned && customerSigned && (
                <Button variant="primary" className="flex-1" onClick={() => saveStatus('completed')}>
                  Mark Completed
                </Button>
              )}
            </div>
            {(hasInvoice || hasWarranty) && (
              <div className="flex gap-2">
                {hasInvoice && (
                  <Button variant="secondary" className="flex-1" onClick={() => navigate(`/invoices/${invoice.id}`)}>
                    Print Invoice
                  </Button>
                )}
                {hasWarranty && (
                  <Button variant="secondary" className="flex-1" onClick={() => navigate(`/warranties/${warranty.id}`)}>
                    Print Warranty
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
        {job.status === 'cancelled' && (
          <div className="w-full text-center py-2 text-sm text-[#6B7280] bg-gray-100 rounded-lg">
            This job has been cancelled. Tap Restore in the header to reactivate it.
          </div>
        )}
        {job.status === 'completed' && (
          <Button variant="gold" className="w-full" disabled={!customer?.phone}
            onClick={requestReview}>
            <MessageSquare size={16} /> Request Review
          </Button>
        )}
      </div>

      {/* Lightbox with sliding-strip swipe animation */}
      {lightboxImg && (() => {
        const currentKey = lightboxImg.img.id || lightboxImg.img._localId
        const currentIdx = sortedImages.findIndex(img => (img.id || img._localId) === currentKey)
        const prevImg = currentIdx > 0 ? sortedImages[currentIdx - 1] : null
        const nextImg = currentIdx >= 0 && currentIdx < sortedImages.length - 1 ? sortedImages[currentIdx + 1] : null
        const prevUrl = prevImg ? signedUrls[prevImg.id || prevImg._localId] : null
        const nextUrl = nextImg ? signedUrls[nextImg.id || nextImg._localId] : null
        return (
        <div
          className="fixed inset-0 z-50 bg-black/95 flex flex-col"
          onClick={() => setLightboxImg(null)}
        >
          <div className="flex items-center justify-between px-4 py-3" onClick={e => e.stopPropagation()}>
            <span className={`text-xs font-bold px-2 py-1 rounded ${lightboxImg.img.image_type === 'before' ? 'bg-green-500 text-white' : 'bg-gold text-white'}`}>
              {lightboxImg.img.image_type?.toUpperCase()}
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => deletePhoto(lightboxImg.img)}
                className="p-2 rounded-lg bg-red-500/20 text-red-400"
              >
                <Trash2 size={18} />
              </button>
              <button
                onClick={() => setLightboxImg(null)}
                className="p-2 rounded-lg bg-white/10 text-white"
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <div
            ref={lightboxContainerRef}
            className="flex-1 relative overflow-hidden"
            onClick={e => e.stopPropagation()}
            onTouchStart={e => {
              touchStartX.current = e.touches[0].clientX
            }}
            onTouchMove={e => {
              if (touchStartX.current === null) return
              let delta = e.touches[0].clientX - touchStartX.current
              if (delta > 0 && !prevImg) delta *= 0.3
              if (delta < 0 && !nextImg) delta *= 0.3
              setDragX(delta)
            }}
            onTouchEnd={() => {
              flashToast(`dragX=${Math.round(dragX)}, hasStart=${touchStartX.current !== null}`)
              if (touchStartX.current === null) return
              const containerWidth = lightboxContainerRef.current?.offsetWidth || window.innerWidth
              const threshold = containerWidth * 0.3
              const direction = dragX < 0 ? 'next' : 'prev'
              const hasTarget = direction === 'next' ? !!nextImg : !!prevImg
              if (Math.abs(dragX) > threshold && hasTarget) {
                setIsSettling(true)
                setDragX(direction === 'next' ? -containerWidth : containerWidth)
                setTimeout(() => {
                  goToPhoto(direction)
                  setIsSettling(false)
                  setDragX(0)
                }, 280)
              } else {
                setIsSettling(true)
                setDragX(0)
                setTimeout(() => setIsSettling(false), 280)
              }
              touchStartX.current = null
            }}
          >
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{
                transform: `translateX(${dragX}px)`,
                transition: isSettling ? 'transform 280ms ease-out' : 'none',
              }}
            >
              {prevUrl && (
                <img
                  src={prevUrl}
                  alt="previous"
                  className="absolute w-full h-full object-contain rounded-lg px-4"
                  style={{ left: '-100%' }}
                />
              )}
              <img
                src={lightboxImg.url}
                alt={lightboxImg.img.image_type ?? 'job photo'}
                className="absolute w-full h-full object-contain rounded-lg px-4"
                style={{ left: '0' }}
              />
              {nextUrl && (
                <img
                  src={nextUrl}
                  alt="next"
                  className="absolute w-full h-full object-contain rounded-lg px-4"
                  style={{ left: '100%' }}
                />
              )}
            </div>
          </div>
        </div>
        )
      })()}

      {/* Add Appointment Modal */}
      <Modal open={apptModal} onClose={() => setApptModal(false)} title="Add Appointment">
        <div className="space-y-3">
          <Input
            label="Date & Time"
            type="datetime-local"
            value={newAppt.appointment_datetime}
            onChange={e => setNewAppt(a => ({ ...a, appointment_datetime: e.target.value }))}
          />
          <AddressAutocomplete
            label="Address"
            value={newAppt.location_address}
            onChange={v => setNewAppt(a => ({ ...a, location_address: v }))}
            placeholder="123 Main St, Dallas TX"
          />
          <Button variant="primary" className="w-full" onClick={addAppointment} disabled={saving}>
            {saving ? 'Saving…' : 'Save Appointment'}
          </Button>
        </div>
      </Modal>
    </div>
  )
}
