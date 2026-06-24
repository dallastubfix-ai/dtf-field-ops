import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Phone, Camera, Video, FileText, Shield,
  ChevronDown, ChevronUp, Plus, Calendar
} from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import db from '../lib/db'
import { updateRecord } from '../lib/sync'
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
  const [editNotes, setEditNotes] = useState(false)
  const [notesVal, setNotesVal] = useState('')
  const [apptModal, setApptModal] = useState(false)
  const [newAppt, setNewAppt] = useState({ appointment_datetime: '', location_address: '' })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    // Try Dexie first
    let j = await db.jobs.where('id').equals(id).first()
    if (!j && isOnline) {
      const { data } = await supabase.from('jobs').select('*').eq('id', id).single()
      if (data) { await db.jobs.put({ ...data, _synced: true }); j = data }
    }
    setJob(j)
    setNotesVal(j?.notes ?? '')

    if (j?.customer_id) {
      let c = await db.customers.where('id').equals(j.customer_id).first()
      if (!c && isOnline) {
        const { data } = await supabase.from('customers').select('*').eq('id', j.customer_id).single()
        if (data) { await db.customers.put({ ...data, _synced: true }); c = data }
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
      if (apptRes.data) { for (const a of apptRes.data) await db.appointments.put({ ...a, _synced: true }); setAppointments(apptRes.data) }
      if (imgRes.data)  { for (const i of imgRes.data) await db.images.put({ ...i, _synced: true }); setImages(imgRes.data) }
      if (vidRes.data)  { for (const v of vidRes.data) await db.videos.put({ ...v, _synced: true }); setVideos(vidRes.data) }
      if (invRes.data)  { await db.invoices.put({ ...invRes.data, _synced: true }); setInvoice(invRes.data) }
    }

    setLoading(false)
  }

  useEffect(() => { if (id) load() }, [id])

  const saveStatus = async (status) => {
    if (!job) return
    const updated = { ...job, status }
    setJob(updated)
    await updateRecord('jobs', updated, isOnline)
  }

  const saveNotes = async () => {
    if (!job) return
    const updated = { ...job, notes: notesVal }
    setJob(updated)
    await updateRecord('jobs', updated, isOnline)
    setEditNotes(false)
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
    }
    setAppointments(a => [...a, payload])
    setApptModal(false)
    setNewAppt({ appointment_datetime: '', location_address: '' })
    setSaving(false)
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

  const nextStatus = {
    contact: 'appointment', quote: 'appointment',
    appointment: 'active', active: 'completed',
  }[job.status]

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

      <div className="px-4 py-4 space-y-3">

        {/* Customer */}
        <Section title="Customer">
          <div className="space-y-1">
            <div className="font-bold text-[#1F2937]">{customer?.full_name ?? '—'}</div>
            {customer?.phone && (
              <a href={`tel:${customer.phone}`} className="flex items-center gap-2 text-navy text-sm">
                <Phone size={14} /> {customer.phone}
              </a>
            )}
            {customer?.email && <div className="text-sm text-[#6B7280]">{customer.email}</div>}
            {customer?.address && <div className="text-sm text-[#6B7280]">{customer.address}</div>}
          </div>
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
            {[
              ['Fixture',        job.fixture_type],
              ['Surface',        job.surface_type],
              ['Color',          job.surface_color],
              ['Lead Source',    job.lead_source],
              ['Referred By',    job.referred_by],
            ].map(([label, value]) => value ? (
              <div key={label} className="flex gap-2">
                <span className="text-xs text-[#6B7280] w-28">{label}</span>
                <span className="text-sm text-[#1F2937]">{value}</span>
              </div>
            ) : null)}
          </div>
        </Section>

        {/* Appointments */}
        <Section title="Appointments">
          <div className="space-y-2">
            {appointments.length === 0 && (
              <p className="text-sm text-[#6B7280]">No appointments yet.</p>
            )}
            {appointments.map(a => (
              <div key={a.id || a._localId} className="border border-[#E5E7EB] rounded-lg p-3">
                <div className="font-semibold text-sm text-[#1F2937]">
                  {format(new Date(a.appointment_datetime), 'EEE, MMM d · h:mm a')}
                </div>
                {a.location_address && (
                  <div className="text-xs text-[#6B7280] mt-0.5">{a.location_address}</div>
                )}
              </div>
            ))}
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
          {images.length > 0 && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              {images.map(img => (
                <div key={img.id || img._localId} className="relative rounded-lg overflow-hidden aspect-square bg-[#F3F4F6]">
                  <span className={`absolute top-1 left-1 text-xs font-bold px-1.5 py-0.5 rounded ${img.image_type === 'before' ? 'bg-green-500 text-white' : 'bg-gold text-white'}`}>
                    {img.image_type?.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
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
                disabled={!invoice?.warranty_included}
                onClick={() => warranty && navigate(`/warranties/${warranty.id}`)}
              >
                <Shield size={16} />
                {warranty ? 'View Warranty' : 'Build Warranty'}
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
