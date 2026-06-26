import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer, Save, Shield } from 'lucide-react'
import { format, addYears } from 'date-fns'
import { supabase } from '../lib/supabase'
import db from '../lib/db'
import { upsertLocal } from '../lib/sync'
import { formatEnum } from '../lib/formatEnum'
import Button from '../components/ui/Button'

const DEFAULT_ITEMS = [
  { description: '', notes: '', rate: '', amount: '' },
  { description: '', notes: '', rate: '', amount: '' },
  { description: '', notes: '', rate: '', amount: '' },
  { description: '', notes: '', rate: '', amount: '' },
]

const PAYMENT_METHODS = ['Cash', 'Check', 'Credit/Debit', 'Venmo', 'Zelle', 'Other']
const PAYMENT_STATUSES = [
  ['unpaid',  'Unpaid'],
  ['partial', 'Partial'],
  ['paid',    'Paid'],
]

const today = format(new Date(), 'yyyy-MM-dd')

const NBSP = ' '
const MINUS = '−'

// yyyy-mm-dd → mm/dd/yyyy (matches the standalone HTML builder)
function fmtDateMMDDYYYY(s) {
  if (!s) return NBSP
  const parts = String(s).slice(0, 10).split('-')
  if (parts.length !== 3) return s
  const [y, m, d] = parts
  return `${m}/${d}/${y}`
}

// Totals formatting with thousands separators; negatives use a real minus sign
function money(n) {
  const abs = '$' + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return n < 0 ? MINUS + abs : abs
}

// Line-item rate/amount cell — blank when empty/zero
function cellMoney(v) {
  const n = parseFloat(v)
  if (isNaN(n) || n === 0) return ''
  const s = '$' + Math.abs(n).toFixed(2)
  return n < 0 ? MINUS + s : s
}

// Print CSS lifted from dtf-invoice-builder.html, scoped under .inv-print so it
// only affects the print document and never the on-screen form or other pages.
const INVOICE_PRINT_CSS = `
.inv-print .invoice-page {
  --navy:#1E40AF; --gold:#F59E0B; --gray-bg:#f3f4f6; --gray-bd:#d1d5db;
  --gray-txt:#6b7280; --green:#16a34a; --green-lt:#dcfce7; --red:#dc2626; --red-lt:#fee2e2; --black:#111827;
  font-family:'Inter',Arial,sans-serif; font-size:8.5pt; color:var(--black); background:white;
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
  width:816px; padding:43px 43px 38px; box-sizing:border-box;
}
.inv-print .iv { display:block; border-bottom:1px solid #9ca3af; min-height:14px; line-height:14px; margin-top:2px; padding-bottom:1px; font-size:8.5pt; font-weight:500; color:#111827; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.inv-print .iv-navy { border-bottom-color:var(--navy); border-bottom-width:1.5px; color:var(--navy); font-weight:700; text-align:right; min-width:100px; display:inline-block; }
.inv-print .label { font-size:6.5pt; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--gray-txt); display:block; margin-top:5px; }
.inv-print .two-col { display:grid; grid-template-columns:1fr 1fr; gap:7px; }
.inv-print .inv-header { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:9px; }
.inv-print .logo-block { flex:1; }
.inv-print .wordmark { display:flex; align-items:baseline; gap:4px; line-height:1; }
.inv-print .wd { font-size:19pt; font-weight:900; letter-spacing:-0.02em; line-height:1; }
.inv-print .wd-navy { color:var(--navy); }
.inv-print .wd-gold { color:var(--gold); }
.inv-print .tagline { font-size:7.5pt; font-weight:600; color:var(--navy); letter-spacing:0.06em; text-transform:uppercase; margin-top:3px; }
.inv-print .ctc { font-size:7pt; color:var(--gray-txt); margin-top:3px; font-weight:500; }
.inv-print .inv-id-block { text-align:right; flex-shrink:0; min-width:170px; }
.inv-print .inv-big-label { font-size:26pt; font-weight:900; color:var(--navy); letter-spacing:-0.03em; line-height:1; }
.inv-print .inv-field-row { display:flex; align-items:center; justify-content:flex-end; gap:6px; margin-top:4px; }
.inv-print .inv-field-label { font-size:7pt; font-weight:700; color:var(--gray-txt); text-transform:uppercase; letter-spacing:0.05em; white-space:nowrap; }
.inv-print .rule-navy { border:none; border-top:3px solid var(--navy); margin:0 0 7px 0; }
.inv-print .rule-light { border:none; border-top:1px solid var(--gray-bd); margin:6px 0; }
.inv-print .info-row { display:grid; grid-template-columns:1.05fr 0.95fr; gap:7px; margin-bottom:7px; }
.inv-print .info-box { background:var(--gray-bg); border:1px solid var(--gray-bd); border-radius:4px; padding:6px 8px 7px; }
.inv-print .box-title { font-size:7pt; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; color:var(--navy); border-bottom:1.5px solid var(--navy); padding-bottom:3px; margin-bottom:4px; }
.inv-print .svc-tbl { width:100%; border-collapse:collapse; margin-bottom:6px; }
.inv-print .svc-tbl thead tr { background:var(--navy); color:#fff; }
.inv-print .svc-tbl thead th { padding:5px 6px; font-size:7pt; font-weight:700; text-transform:uppercase; letter-spacing:0.06em; text-align:left; }
.inv-print .svc-tbl thead th.r { text-align:right; }
.inv-print .svc-tbl tbody tr { border-bottom:1px solid var(--gray-bd); }
.inv-print .svc-tbl tbody tr:nth-child(even) { background:var(--gray-bg); }
.inv-print .svc-tbl tbody td { padding:2px 6px; height:22px; font-size:8pt; vertical-align:middle; }
.inv-print .td-desc { width:44%; }
.inv-print .td-notes { width:26%; }
.inv-print .td-rate { width:15%; text-align:right; color:var(--gray-txt); }
.inv-print .td-amt { width:15%; text-align:right; font-weight:600; }
.inv-print .totals-wrap { display:flex; justify-content:flex-end; margin-bottom:7px; }
.inv-print .totals-tbl { width:220px; border-collapse:collapse; }
.inv-print .totals-tbl tr td { padding:2px 6px; font-size:8pt; }
.inv-print .totals-tbl tr td:first-child { font-weight:600; color:var(--gray-txt); text-align:right; padding-right:10px; }
.inv-print .totals-tbl tr td:last-child { text-align:right; min-width:70px; border-bottom:1px solid var(--gray-bd); }
.inv-print .totals-tbl tr.total-due td { background:var(--navy); color:#fff; font-weight:800; font-size:9.5pt; padding:4px 6px; border-bottom:none; }
.inv-print .totals-tbl tr.total-due td:first-child { color:#fff; border-radius:3px 0 0 3px; }
.inv-print .totals-tbl tr.total-due td:last-child { border-radius:0 3px 3px 0; }
.inv-print .pn-row { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-bottom:7px; }
.inv-print .pn-box { border:1px solid var(--gray-bd); border-radius:4px; padding:6px 8px 7px; }
.inv-print .pn-box .box-title { font-size:7pt; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; color:var(--navy); border-bottom:1.5px solid var(--navy); padding-bottom:3px; margin-bottom:4px; }
.inv-print .cb-inv { display:flex; align-items:center; gap:4px; margin-top:4px; font-size:8pt; font-weight:500; }
.inv-print .cb-inv input { width:9px; height:9px; accent-color:var(--navy); flex-shrink:0; pointer-events:none; }
.inv-print .cb-grid-inv { display:grid; grid-template-columns:1fr 1fr 1fr; gap:2px 6px; margin-top:3px; }
.inv-print .warranty-wrap { border:1.5px solid var(--gray-bd); border-radius:4px; overflow:hidden; display:grid; grid-template-columns:1fr 1fr; margin-bottom:7px; }
.inv-print .wcol { padding:6px 8px 7px; }
.inv-print .wcol.wgreen { background:var(--green-lt); border-left:3px solid var(--green); border-right:2px solid var(--green); }
.inv-print .wcol.wred { background:var(--red-lt); border-right:3px solid var(--red); }
.inv-print .wtitle { font-size:7pt; font-weight:800; text-transform:uppercase; letter-spacing:0.07em; margin-bottom:4px; }
.inv-print .wtitle.g { color:var(--green); }
.inv-print .wtitle.r { color:var(--red); }
.inv-print .wcb-row { display:flex; align-items:flex-start; gap:5px; }
.inv-print .wcb-row input { width:11px; height:11px; flex-shrink:0; margin-top:1px; pointer-events:none; }
.inv-print .wcb-lbl { font-size:8pt; font-weight:700; }
.inv-print .wcb-lbl.g { color:var(--green); }
.inv-print .wcb-lbl.r { color:var(--red); }
.inv-print .wsub { font-size:6.5pt; color:var(--gray-txt); margin-top:2px; line-height:1.4; margin-left:16px; }
.inv-print .wreason-lbl { font-size:7pt; font-weight:700; color:var(--red); margin-top:5px; }
.inv-print .sig-row { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:7px; }
.inv-print .sig-title { font-size:6.5pt; font-weight:700; text-transform:uppercase; letter-spacing:0.07em; color:var(--navy); margin-bottom:2px; }
.inv-print .sig-line { border-bottom:1.5px solid var(--black); height:26px; margin-bottom:3px; }
.inv-print .sig-sub { font-size:6pt; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--gray-txt); margin-bottom:1px; margin-top:3px; }
.inv-print .sig-name-val { border-bottom:1px solid #9ca3af; min-height:14px; line-height:14px; font-size:8.5pt; font-weight:500; color:#111827; white-space:nowrap; overflow:hidden; }
.inv-print .inv-footer { border-top:2.5px solid var(--gold); padding-top:6px; text-align:center; }
.inv-print .footer-main { display:flex; align-items:center; justify-content:center; gap:10px; margin-bottom:4px; }
.inv-print .seal { width:22px; height:22px; border-radius:50%; background:var(--navy); display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; }
.inv-print .seal svg { width:12px; height:12px; fill:var(--gold); }
.inv-print .fthanks { font-size:9pt; font-weight:800; color:var(--navy); letter-spacing:-0.01em; }
.inv-print .fcontact { font-size:7pt; font-weight:600; color:var(--gray-txt); margin-bottom:2px; }
.inv-print .fverses { font-size:6.5pt; font-weight:500; color:var(--navy); letter-spacing:0.04em; opacity:0.8; }
@media print {
  @page { size: letter portrait; margin: 0.45in; }
  .inv-print .invoice-page { width:auto; padding:0; }
}
`

// Customer info is NOT stored on the invoices table — it is derived from the
// linked job → customer. Map a customer record onto the invoice form fields.
function customerFields(c) {
  if (!c) return {}
  return {
    customer_name:    c.full_name      ?? '',
    customer_phone:   c.phone          ?? '',
    customer_email:   c.email          ?? '',
    customer_address: c.address        ?? '',
    customer_city:    c.city_state_zip ?? '',
    customer_state:   '',
    customer_zip:     '',
  }
}

// Resolve a job's customer + most-recent appointment, Dexie-first with a
// Supabase fallback, so pre-population works whether or not the join was loaded.
async function loadJobContext(jobId) {
  if (!jobId) return {}
  let job = await db.jobs.where('id').equals(jobId).first()
  if (!job) job = (await supabase.from('jobs').select('*').eq('id', jobId).maybeSingle()).data
  if (!job) return {}

  let customer = job.customer_id ? await db.customers.where('id').equals(job.customer_id).first() : null
  if (!customer && job.customer_id) {
    customer = (await supabase.from('customers').select('*').eq('id', job.customer_id).maybeSingle()).data
  }

  let appts = await db.appointments.where('job_id').equals(jobId).toArray()
  if (!appts || appts.length === 0) {
    appts = (await supabase.from('appointments').select('*').eq('job_id', jobId)).data ?? []
  }
  const appt = appts
    .filter(a => a.appointment_datetime)
    .sort((a, b) => new Date(b.appointment_datetime) - new Date(a.appointment_datetime))[0] ?? null

  return { job, customer, appt }
}

function Field({ label, value, onChange, type = 'text', className = '' }) {
  return (
    <div className={className}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280] mb-0.5">{label}</div>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="border border-[#E5E7EB] rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-navy"
      />
    </div>
  )
}

export default function InvoiceBuilder() {
  const { id, jobId } = useParams()
  const navigate = useNavigate()
  const isNew = !!jobId

  const [inv, setInv] = useState({
    invoice_number: '', invoice_date: today, service_date: '',
    technician: 'John Figueroa Jr.',
    customer_name: '', customer_phone: '', customer_email: '',
    customer_address: '', customer_city: '', customer_state: '', customer_zip: '',
    surface_type: '', surface_color: '',
    line_items: DEFAULT_ITEMS,
    discount: '0', tax_rate: '0',
    payment_methods: [],
    notes1: '', notes2: '', notes3: '',
    warranty_included: true, warranty_no_reason: '',
    payment_status: 'unpaid',
    job_id: jobId ?? null,
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [existingWarranty, setExistingWarranty] = useState(null)
  const [toast, setToast] = useState('')

  useEffect(() => {
    const load = async () => {
      if (isNew) {
        const { job, customer, appt } = await loadJobContext(jobId)
        if (!job) return
        setInv(v => ({
          ...v,
          invoice_number: job.job_number ?? '',
          service_date: appt?.appointment_datetime ? format(new Date(appt.appointment_datetime), 'yyyy-MM-dd') : '',
          surface_type:  job.surface_type  ?? '',
          surface_color: job.surface_color ?? '',
          ...customerFields(customer),
          // Address comes from the appointment location first, customer profile second
          customer_address: appt?.location_address || customer?.address || '',
          customer_city:    customer?.city_state_zip || '',
          job_id: jobId,
        }))
      } else if (id) {
        let existing = await db.invoices.where('id').equals(id).first()
        if (!existing) {
          existing = (await supabase.from('invoices').select('*').eq('id', id).maybeSingle()).data
          if (existing) await upsertLocal('invoices', { ...existing, _synced: true })
        }
        if (!existing) return

        const nlines = (existing.invoice_notes ?? '').split('\n')
        const { customer, appt } = await loadJobContext(existing.job_id)

        setInv(v => ({
          ...v,
          ...existing,
          line_items: Array.isArray(existing.line_items) && existing.line_items.length ? existing.line_items : DEFAULT_ITEMS,
          payment_methods: existing.payment_methods ?? [],
          payment_status: existing.payment_status ?? 'unpaid',
          discount: String(existing.discount ?? '0'),
          tax_rate: String(existing.tax_rate ?? '0'),
          notes1: nlines[0] ?? '', notes2: nlines[1] ?? '', notes3: nlines[2] ?? '',
          warranty_included: existing.warranty_included ?? true,
          warranty_no_reason: existing.warranty_excluded_reason ?? '',
          ...customerFields(customer),
          // Address comes from the appointment location first, customer profile second
          customer_address: appt?.location_address || customer?.address || '',
          customer_city:    customer?.city_state_zip || '',
          service_date: existing.service_date
            ?? (appt?.appointment_datetime ? format(new Date(appt.appointment_datetime), 'yyyy-MM-dd') : ''),
          job_id: existing.job_id ?? null,
          id: existing.id,
          created_at: existing.created_at,
        }))
        setSaved(true)

        let warr = await db.warranties.where('invoice_id').equals(id).first()
        if (!warr) warr = (await supabase.from('warranties').select('*').eq('invoice_id', id).maybeSingle()).data
        setExistingWarranty(warr ?? null)
      }
    }
    load()
  }, [id, jobId])

  const set = (key, value) => setInv(v => ({ ...v, [key]: value }))

  const setItem = (i, key, value) => {
    const items = [...inv.line_items]
    items[i] = { ...items[i], [key]: value }
    if (key === 'rate') items[i].amount = value
    setInv(v => ({ ...v, line_items: items }))
  }

  const subtotal = inv.line_items.reduce((s, item) => s + (parseFloat(item.amount) || 0), 0)
  const discount  = parseFloat(inv.discount)  || 0
  const taxRate   = parseFloat(inv.tax_rate)  || 0
  const taxable   = subtotal - discount
  const tax       = taxable * (taxRate / 100)
  const total     = taxable + tax

  const togglePayment = (method) => {
    const methods = (inv.payment_methods ?? []).includes(method)
      ? inv.payment_methods.filter(m => m !== method)
      : [...(inv.payment_methods ?? []), method]
    set('payment_methods', methods)
  }

  // Build a payload containing ONLY real invoices columns.
  const buildDbPayload = (extra = {}) => ({
    job_id: inv.job_id ?? null,
    invoice_number: inv.invoice_number || null,
    invoice_date: inv.invoice_date || null,
    service_date: inv.service_date || null,
    technician: inv.technician || null,
    surface_type: inv.surface_type || null,
    surface_color: inv.surface_color || null,
    line_items: inv.line_items,
    subtotal,
    discount,
    tax_rate: taxRate,
    tax_amount: tax,
    total,
    payment_methods: inv.payment_methods ?? [],
    payment_status: inv.payment_status || 'unpaid',
    invoice_notes: [inv.notes1, inv.notes2, inv.notes3].filter(Boolean).join('\n') || null,
    warranty_included: !!inv.warranty_included,
    warranty_excluded_reason: inv.warranty_included ? null : (inv.warranty_no_reason || null),
    updated_at: new Date().toISOString(),
    ...extra,
  })

  const createWarranty = async (invoiceId) => {
    if (!inv.service_date) return
    const wPayload = {
      id: crypto.randomUUID(),
      invoice_id: invoiceId,
      job_id: inv.job_id ?? null,
      customer_name: inv.customer_name || null,
      service_address: [inv.customer_address, inv.customer_city].filter(Boolean).join(', ') || null,
      service_date: inv.service_date,
      expiry_date: format(addYears(new Date(inv.service_date), 2), 'yyyy-MM-dd'),
      technician: inv.technician || null,
      created_at: new Date().toISOString(),
    }
    await db.warranties.add({ ...wPayload, _synced: false })
    const { error } = await supabase.from('warranties').insert(wPayload)
    if (!error) await db.warranties.where('id').equals(wPayload.id).modify({ _synced: true })
    setExistingWarranty(wPayload)
  }

  const save = async () => {
    setSaving(true)
    const invoiceId = inv.id ?? crypto.randomUUID()
    const payload = buildDbPayload({
      id: invoiceId,
      created_at: inv.created_at ?? new Date().toISOString(),
    })
    try {
      // Local first so nothing is lost, even offline.
      await upsertLocal('invoices', { ...payload, _synced: !!navigator.onLine })
      const wasNew = !inv.id
      if (wasNew) setInv(v => ({ ...v, id: invoiceId }))
      setSaved(true)

      if (inv.warranty_included && inv.service_date && !existingWarranty) {
        await createWarranty(invoiceId)
      }

      // upsert handles both create and update against Supabase by primary key.
      const { error } = await supabase.from('invoices').upsert(payload)
      if (error) {
        await db.invoices.where('id').equals(invoiceId).modify({ _synced: false })
        throw error
      }
      setToast(wasNew ? 'Invoice saved ✓' : 'Invoice updated ✓')
    } catch (err) {
      console.error('Invoice save failed:', err)
      setToast(`Saved locally · ${err.message || 'offline — reopen online to upload'}`)
    } finally {
      setSaving(false)
      setTimeout(() => setToast(''), 2800)
    }
  }

  const print = async () => {
    await save()
    window.print()
  }

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      {/* Top nav — hidden on print */}
      <header className="bg-navy px-4 py-4 flex items-center gap-3 no-print sticky top-0 z-30">
        <button onClick={() => navigate(-1)} className="text-white"><ArrowLeft size={20} /></button>
        <h1 className="text-white font-bold text-base flex-1">Invoice Builder</h1>
        <div className="flex gap-2">
          <Button variant="secondary" className="text-white border-white/30 py-1.5 px-3" onClick={save} disabled={saving}>
            <Save size={14} /> {saving ? '…' : 'Save'}
          </Button>
          <Button variant="gold" className="py-1.5 px-3" onClick={print} disabled={saving}>
            <Printer size={14} /> Print
          </Button>
        </div>
      </header>

      {toast && (
        <div className="no-print fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      {/* Edit form — no-print */}
      <div className="no-print px-4 py-5 space-y-5 max-w-2xl mx-auto">
        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-4 grid grid-cols-2 gap-3">
          <Field label="Invoice #"    value={inv.invoice_number} onChange={v => set('invoice_number', v)} />
          <Field label="Invoice Date" value={inv.invoice_date}   onChange={v => set('invoice_date', v)} type="date" />
        </div>

        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-4 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Customer</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full Name"  value={inv.customer_name}    onChange={v => set('customer_name', v)}    className="col-span-2" />
            <Field label="Phone"      value={inv.customer_phone}   onChange={v => set('customer_phone', v)} />
            <Field label="Email"      value={inv.customer_email}   onChange={v => set('customer_email', v)} />
            <Field label="Address"    value={inv.customer_address} onChange={v => set('customer_address', v)} className="col-span-2" />
            <Field label="City / State / Zip" value={inv.customer_city} onChange={v => set('customer_city', v)} className="col-span-2" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-4 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Service Details</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Service Date"  value={inv.service_date}  onChange={v => set('service_date', v)}  type="date" />
            <Field label="Technician"    value={inv.technician}    onChange={v => set('technician', v)} />
            <Field label="Surface Type"  value={inv.surface_type}  onChange={v => set('surface_type', v)} />
            <Field label="Surface Color" value={inv.surface_color} onChange={v => set('surface_color', v)} />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-4 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#6B7280] mb-2">Line Items</h3>
          <div className="grid grid-cols-12 gap-1 text-[10px] font-semibold uppercase text-[#9CA3AF] mb-1">
            <span className="col-span-5">Description</span>
            <span className="col-span-4">Notes/Type</span>
            <span className="col-span-1">Rate</span>
            <span className="col-span-2 text-right">Amt</span>
          </div>
          {inv.line_items.map((item, i) => (
            <div key={i} className="grid grid-cols-12 gap-1">
              <input value={item.description} onChange={e => setItem(i, 'description', e.target.value)}
                className="col-span-5 border border-[#E5E7EB] rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-navy" />
              <input value={item.notes} onChange={e => setItem(i, 'notes', e.target.value)}
                className="col-span-4 border border-[#E5E7EB] rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-navy" />
              <input value={item.rate} onChange={e => setItem(i, 'rate', e.target.value)}
                className="col-span-1 border border-[#E5E7EB] rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-navy" />
              <input value={item.amount} onChange={e => setItem(i, 'amount', e.target.value)}
                className="col-span-2 border border-[#E5E7EB] rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-navy" />
            </div>
          ))}
          <div className="border-t border-[#E5E7EB] pt-2 mt-2 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-[#6B7280]">Subtotal</span><span className="font-medium">${subtotal.toFixed(2)}</span></div>
            <div className="flex items-center gap-2">
              <span className="text-[#6B7280] flex-1">Discount ($)</span>
              <input value={inv.discount} onChange={e => set('discount', e.target.value)} className="w-20 border border-[#E5E7EB] rounded px-2 py-1 text-xs text-right focus:outline-none" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[#6B7280] flex-1">Tax (%)</span>
              <input value={inv.tax_rate} onChange={e => set('tax_rate', e.target.value)} className="w-20 border border-[#E5E7EB] rounded px-2 py-1 text-xs text-right focus:outline-none" />
            </div>
            <div className="flex justify-between font-bold text-navy text-base pt-1 border-t border-[#E5E7EB]">
              <span>Total</span><span>${total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-4 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Payment Methods</h3>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map(m => (
              <button key={m} type="button" onClick={() => togglePayment(m)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-all ${(inv.payment_methods ?? []).includes(m) ? 'bg-navy text-white border-navy' : 'border-[#E5E7EB] text-[#6B7280]'}`}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-4 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Payment Status</h3>
          <div className="flex gap-2">
            {PAYMENT_STATUSES.map(([val, label]) => (
              <button key={val} type="button" onClick={() => set('payment_status', val)}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-all ${inv.payment_status === val ? 'bg-navy text-white border-navy' : 'border-[#E5E7EB] text-[#6B7280]'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-4 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#6B7280] mb-2">Notes</h3>
          {[1,2,3].map(n => (
            <input key={n} value={inv[`notes${n}`]} onChange={e => set(`notes${n}`, e.target.value)}
              placeholder={`Note line ${n}`}
              className="w-full border border-[#E5E7EB] rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-navy" />
          ))}
        </div>

        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-4 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Warranty</h3>
          <div className="flex gap-2">
            <button onClick={() => set('warranty_included', true)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-all ${inv.warranty_included ? 'bg-green-500 text-white border-green-500' : 'border-[#E5E7EB] text-[#6B7280]'}`}>
              YES — 2-Year Included
            </button>
            <button onClick={() => set('warranty_included', false)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-all ${!inv.warranty_included ? 'bg-red-500 text-white border-red-500' : 'border-[#E5E7EB] text-[#6B7280]'}`}>
              NO
            </button>
          </div>
          {!inv.warranty_included && (
            <input value={inv.warranty_no_reason} onChange={e => set('warranty_no_reason', e.target.value)}
              placeholder="Reason warranty not included…"
              className="w-full border border-[#E5E7EB] rounded px-2 py-1.5 text-sm focus:outline-none" />
          )}
        </div>

        {saved && inv.warranty_included && existingWarranty && (
          <Button variant="secondary" className="w-full" onClick={() => navigate(`/warranties/${existingWarranty.id}`)}>
            <Shield size={16} /> Build Warranty →
          </Button>
        )}
      </div>

      {/* ── PRINT VIEW — matches dtf-invoice-builder.html ── */}
      <div className="inv-print hidden print:block">
        <style>{INVOICE_PRINT_CSS}</style>
        <div className="invoice-page">

          {/* HEADER */}
          <div className="inv-header">
            <div className="logo-block">
              <div className="wordmark">
                <span className="wd wd-navy">Dallas</span>
                <span className="wd wd-gold">Tub</span>
                <span className="wd wd-navy">Fix</span>
              </div>
              <div className="tagline">Professional Bathtub Repair · DFW Area</div>
              <div className="ctc">(469) 592-0018 · dallastubfix.com · Lavon, TX</div>
            </div>
            <div className="inv-id-block">
              <div className="inv-big-label">INVOICE</div>
              <div className="inv-field-row">
                <span className="inv-field-label">Invoice #</span>
                <span className="iv iv-navy">{inv.invoice_number || NBSP}</span>
              </div>
              <div className="inv-field-row">
                <span className="inv-field-label">Date</span>
                <span className="iv iv-navy">{fmtDateMMDDYYYY(inv.invoice_date)}</span>
              </div>
            </div>
          </div>

          <hr className="rule-navy" />

          {/* INFO BOXES */}
          <div className="info-row">
            <div className="info-box">
              <div className="box-title">Customer Information</div>
              <span className="label">Full Name</span>
              <span className="iv">{inv.customer_name || NBSP}</span>
              <div className="two-col">
                <div>
                  <span className="label">Phone</span>
                  <span className="iv">{inv.customer_phone || NBSP}</span>
                </div>
                <div>
                  <span className="label">Email</span>
                  <span className="iv">{inv.customer_email || NBSP}</span>
                </div>
              </div>
              <span className="label">Address</span>
              <span className="iv">{inv.customer_address || NBSP}</span>
              <span className="label">City / State / ZIP</span>
              <span className="iv">{inv.customer_city || NBSP}</span>
            </div>
            <div className="info-box">
              <div className="box-title">Service Details</div>
              <div className="two-col">
                <div>
                  <span className="label">Service Date</span>
                  <span className="iv">{inv.service_date ? fmtDateMMDDYYYY(inv.service_date) : NBSP}</span>
                </div>
                <div>
                  <span className="label">Technician</span>
                  <span className="iv">{inv.technician || NBSP}</span>
                </div>
              </div>
              <span className="label">Surface Type</span>
              <span className="iv">{formatEnum(inv.surface_type) || NBSP}</span>
              <span className="label">Surface Color</span>
              <span className="iv">{inv.surface_color || NBSP}</span>
            </div>
          </div>

          {/* SERVICES TABLE */}
          <table className="svc-tbl">
            <thead>
              <tr>
                <th className="td-desc">Description of Work</th>
                <th className="td-notes">Type / Notes</th>
                <th className="td-rate r">Rate</th>
                <th className="td-amt r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3].map(i => {
                const item = inv.line_items[i] || {}
                return (
                  <tr key={i}>
                    <td className="td-desc">{item.description || ''}</td>
                    <td className="td-notes">{item.notes || ''}</td>
                    <td className="td-rate">{cellMoney(item.rate)}</td>
                    <td className="td-amt">{cellMoney(item.amount)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* TOTALS */}
          <div className="totals-wrap">
            <table className="totals-tbl">
              <tbody>
                <tr><td>Subtotal</td><td>{subtotal !== 0 ? money(subtotal) : '—'}</td></tr>
                <tr><td>Discount</td><td>{discount > 0 ? MINUS + '$' + discount.toFixed(2) : '—'}</td></tr>
                <tr><td>Tax</td><td>{tax !== 0 ? money(tax) : '—'}</td></tr>
                <tr className="total-due"><td>Total Due</td><td>{total !== 0 ? money(total) : '—'}</td></tr>
              </tbody>
            </table>
          </div>

          {/* PAYMENT + NOTES */}
          <div className="pn-row">
            <div className="pn-box">
              <div className="box-title">Payment Method</div>
              <div className="cb-grid-inv">
                {PAYMENT_METHODS.map(m => (
                  <label className="cb-inv" key={m}>
                    <input type="checkbox" readOnly checked={(inv.payment_methods ?? []).includes(m)} /> {m}
                  </label>
                ))}
              </div>
            </div>
            <div className="pn-box">
              <div className="box-title">Notes</div>
              <span className="iv" style={{ marginTop: '6px' }}>{inv.notes1 || NBSP}</span>
              <span className="iv" style={{ marginTop: '7px' }}>{inv.notes2 || NBSP}</span>
              <span className="iv" style={{ marginTop: '7px' }}>{inv.notes3 || NBSP}</span>
            </div>
          </div>

          {/* WARRANTY */}
          <div className="warranty-wrap">
            <div className="wcol wgreen">
              <div className="wtitle g">Warranty Status</div>
              <div className="wcb-row">
                <input type="checkbox" readOnly checked={!!inv.warranty_included} style={{ accentColor: '#16a34a' }} />
                <span className="wcb-lbl g">2-Year Warranty Included</span>
              </div>
              <div className="wsub">100% covered — labor, supplies &amp; travel. Warranty doc provided.</div>
            </div>
            <div className="wcol wred">
              <div className="wtitle r">Warranty Status</div>
              <div className="wcb-row">
                <input type="checkbox" readOnly checked={!inv.warranty_included} style={{ accentColor: '#dc2626' }} />
                <span className="wcb-lbl r">Warranty Not Applicable</span>
              </div>
              <div className="wsub">Reason documented below. Customer acknowledges.</div>
              <div className="wreason-lbl">Reason:</div>
              <span className="iv" style={{ marginTop: '4px', borderBottomColor: '#f87171' }}>
                {(!inv.warranty_included && inv.warranty_no_reason) ? inv.warranty_no_reason : NBSP}
              </span>
              <span className="iv" style={{ marginTop: '5px', borderBottomColor: '#f87171' }}>{NBSP}</span>
            </div>
          </div>

          {/* SIGNATURES */}
          <hr className="rule-light" />
          <div className="sig-row">
            <div>
              <div className="sig-title">Technician Signature</div>
              <div className="sig-line"></div>
              <div className="sig-sub">Print Name &amp; Date</div>
              <div className="sig-name-val">{inv.technician || NBSP}</div>
            </div>
            <div>
              <div className="sig-title">Customer Signature — Work Completed &amp; Accepted</div>
              <div className="sig-line"></div>
              <div className="sig-sub">Print Name &amp; Date</div>
              <div className="sig-name-val">{inv.customer_name || NBSP}</div>
            </div>
          </div>

          {/* FOOTER */}
          <div className="inv-footer">
            <div className="footer-main">
              <div className="seal"><svg viewBox="0 0 24 24"><path d="M15.5 2.1a6 6 0 0 0-7.4 7.4L2.1 15.5a2.1 2.1 0 0 0 3 3l6-5.9a6 6 0 0 0 7.4-7.4l-3.2 3.2-2.1-.7-.7-2.1 2.9-3.4z"/></svg></div>
              <span className="fthanks">Thank you for choosing Dallas Tub Fix!</span>
              <div className="seal"><svg viewBox="0 0 24 24"><path d="M15.5 2.1a6 6 0 0 0-7.4 7.4L2.1 15.5a2.1 2.1 0 0 0 3 3l6-5.9a6 6 0 0 0 7.4-7.4l-3.2 3.2-2.1-.7-.7-2.1 2.9-3.4z"/></svg></div>
            </div>
            <div className="fcontact">(469) 592-0018 · dallastubfix.com</div>
            <div className="fverses">John 3:16 · Matthew 6:9–13 · Matthew 11:30 · Mark 10:45 · Luke 19:10</div>
          </div>

        </div>
      </div>
    </div>
  )
}
