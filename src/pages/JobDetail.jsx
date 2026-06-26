import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Phone, Camera, Video, FileText, Shield,
  ChevronDown, ChevronUp, Plus, Calendar
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

  const saveStatus = async (status) => {
    if (!job) return
    const updated = { ...job, status, updated_at: new Date().toISOString() }
    setJob(updated)
    await updateRecord('jobs', updated, isOnline)
    flashToast(`Status → ${formatEnum(status)}`)
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
      appointment_datetime: apptVal.appointment_datetime,
      location_address: apptVal.location_address || null,
      notes: apptVal.notes || null,
      updated_at: new Date().toISOString(),
    }
    setAppointments(list => list.map(x => (x.id || x._localId) === key ? updated : x))
    await updateRecord('appointments', updated, isOnline)
    setEditApptId(null)
    setSaving(false)
    flashToast('Appointment saved')
  }

  const addAppointment = async () => {
    if (!newAppt.appointment_datetime) return
    setSaving(true)
    const payload = {
      id: crypto.randomUUID(),
      job_id: id,
      appointment_datetime: newAppt.appointment_datetime,
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

  return (
    <div className="min-h-screen bg-[#F3F4F6] pb-28">
      {/* Header */}
      <header className="bg-navy px-4 py-4 flex items-center gap-3 sticky top-0 z-30">
        <button onClick={() => navigate(-1)} className="text-white">
          <ArrowLeft size={20} />
        </button>
        <span className="text-white font-bold text-base flex-1">{job.job_number}</span>
        <Badge status={job.status} />
      </header>

      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
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
              <Input label="Address" value={custVal.address}
                onChange={e => setCustVal(v => ({ ...v, address: e.target.value }))} />
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
                className="flex-1 py-1.5"
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
                      <Input label="Address" value={apptVal.location_address}
                        onChange={e => setApptVal(v => ({ ...v, location_address: e.target.value }))} />
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
                      <img src={url} alt={img.image_type ?? 'job photo'} loading="lazy" className="w-full h-full object-cover" />
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
                {invoice ? 'View Invoice' : 'Build Invoice'}
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                disabled={!warranty}
                onClick={() => warranty && navigate(`/warranties/${warranty.id}`)}
              >
                <Shield size={16} />
                {warranty ? 'View Warranty' : 'No Warranty'}
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
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#E5E7EB] px-4 py-3 flex gap-2 z-30 no-print"
           style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
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
          <Button variant="gold" className="flex-1" onClick={() => navigate(`/invoices/new/${id}`)}>
            Build Invoice
          </Button>
        )}
        {job.status === 'completed' && (
          <Button variant="ghost" className="flex-1" disabled={!invoice}
            onClick={() => invoice && navigate(`/invoices/${invoice.id}`)}>
            View Invoice
          </Button>
        )}
      </div>

      {/* Add Appointment Modal */}
      <Modal open={apptModal} onClose={() => setApptModal(false)} title="Add Appointment">
        <div className="space-y-3">
          <Input
            label="Date & Time"
            type="datetime-local"
            value={newAppt.appointment_datetime}
            onChange={e => setNewAppt(a => ({ ...a, appointment_datetime: e.target.value }))}
          />
          <Input
            label="Address"
            value={newAppt.location_address}
            onChange={e => setNewAppt(a => ({ ...a, location_address: e.target.value }))}
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
