import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle, Shield, X } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import db from '../lib/db'
import { upsertLocal } from '../lib/sync'
import { normalize as normalizeWarrantyYears, warrantyExpiry } from '../lib/warranty'
import { formatEnum } from '../lib/formatEnum'
import { getJobSurfaceText, buildInvoiceLines } from '../lib/fixtures'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/layout/PageHeader'
import AddressAutocomplete from '../components/ui/AddressAutocomplete'
import { useAuth } from '../context/AuthContext'
import SignatureCapture from '../components/SignatureCapture'

const DEFAULT_ITEMS = [
  { description: '', notes: '', rate: '', amount: '' },
  { description: '', notes: '', rate: '', amount: '' },
  { description: '', notes: '', rate: '', amount: '' },
  { description: '', notes: '', rate: '', amount: '' },
]

const MIN_LINES = DEFAULT_ITEMS.length // 4: invoices at or under this print exactly as before
const MAX_LINES = 12
const DISCOUNT_PERCENTS = [5, 10, 15, 20]
const PENDING_ACTION_LABELS = { save: 'Save anyway', print: 'Print anyway', quote: 'Print quote anyway' }

// Letter page minus 0.45in margins on every side, in CSS px (96 per inch).
const PRINT_WIDTH_PX = 7.6 * 96
const PRINT_HEIGHT_PX = 10.1 * 96
const CONTINUED_TOLERANCE_PX = 12

// Decides whether the "continued on page 2" note and the page-2 header print (both come from one
// "has-page2" class on the print root). Lays the real print view out off-screen at the printed
// page width and checks whether the bottom block fits under the totals.
function updateContinuedNote(root) {
  if (!root) return
  const page = root.querySelector('.invoice-page')
  const bottom = root.querySelector('.inv-bottom')
  const note = root.querySelector('.inv-continued')
  if (!page || !bottom || !note) return

  root.classList.remove('has-page2')
  if (root.querySelectorAll('.svc-tbl tbody tr').length <= MIN_LINES) return

  root.style.cssText = `display:block;position:absolute;left:-10000px;top:0;visibility:hidden;width:${PRINT_WIDTH_PX}px`
  page.style.cssText = `width:${PRINT_WIDTH_PX}px;padding:0`
  try {
    // Measured without the page-2 header: it only exists once the block is already on page 2.
    const pageTop = page.getBoundingClientRect().top
    const needed = bottom.getBoundingClientRect().bottom - pageTop
    if (needed <= PRINT_HEIGHT_PX + CONTINUED_TOLERANCE_PX) return

    root.classList.add('has-page2')
    const noteEnd = note.getBoundingClientRect().bottom - pageTop + (parseFloat(getComputedStyle(note).marginBottom) || 0)
    if (noteEnd > PRINT_HEIGHT_PX) root.classList.remove('has-page2')
  } finally {
    root.removeAttribute('style')
    page.removeAttribute('style')
  }
}

const PAYMENT_METHODS = ['Cash', 'Check', 'Credit/Debit', 'Venmo', 'Zelle', 'Other']

const SIGNED_WHILE_OPEN_MSG = 'This invoice was signed while it was open, so nothing was saved. Go back and reopen the invoice to see and print the signed copy.'

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
.inv-print .td-desc { width:53%; }
.inv-print .td-notes { width:32%; }
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
.inv-print .inv-continued, .inv-print .inv-page2-head { display:none; }
.inv-print.has-page2 .inv-continued { display:block; text-align:center; margin:14px 0 0; break-inside:avoid; page-break-inside:avoid; }
.inv-print .cont-main { font-size:20pt; font-weight:900; color:var(--navy); letter-spacing:-0.01em; line-height:1.1; }
.inv-print .cont-sub { font-size:9pt; font-weight:600; color:var(--gray-txt); margin-top:3px; }
.inv-print.has-page2 .inv-page2-head { display:block; border-bottom:1px solid var(--gray-bd); padding-bottom:4px; margin-bottom:8px; }
.inv-print .p2-main { font-size:10pt; font-weight:800; color:var(--navy); line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.inv-print .p2-sub { font-size:7.5pt; font-weight:500; color:var(--gray-txt); line-height:1.3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
@media print {
  @page { size: letter portrait; margin: 0.45in; }
  .inv-print .invoice-page { width:auto; padding:0; }
  .inv-print .svc-tbl thead { display:table-header-group; }
  .inv-print .svc-tbl tbody tr { break-inside:avoid; page-break-inside:avoid; }
  .inv-print .totals-wrap { break-before:avoid; page-break-before:avoid; break-inside:avoid; page-break-inside:avoid; }
  .inv-print .inv-bottom { break-inside:avoid; page-break-inside:avoid; }
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

function Field({ label, value, onChange, type = 'text', className = '', disabled = false }) {
  return (
    <div className={className}>
      <div className="ui-field-label mb-1">{label}</div>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="ui-field ui-field-h px-3 w-full"
      />
    </div>
  )
}

export default function InvoiceBuilder() {
  const { id, jobId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
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
    warranty_years: 2,
    technician_signature_url: null,
    customer_signature_url: null,
    job_id: jobId ?? null,
  })
  const [saving, setSaving] = useState(false)
  const [printAsQuote, setPrintAsQuote] = useState(false)
  const [saved, setSaved] = useState(false)
  const [newInvoiceWarning, setNewInvoiceWarning] = useState(null) // { problems, overflow, overflowAmount }, set only for a new invoice
  const [existingWarranty, setExistingWarranty] = useState(null)
  const [toast, setToast] = useState(null) // { text, kind }
  const [showSigCapture, setShowSigCapture] = useState(false)
  const [confirmRemoveLine, setConfirmRemoveLine] = useState(false)
  const [warningAcknowledged, setWarningAcknowledged] = useState(false)
  const [pendingAction, setPendingAction] = useState(null) // 'save' | 'print' | 'quote' while the confirm is open
  const [sigLinkState, setSigLinkState] = useState(null)
  // sigLinkState: null | { status: 'generating' } | { status: 'ready', url: string } | { status: 'error' }
  // Warranty length as of the last load / successful save. Only a change from
  // this value is allowed to move an existing warranty's expiry date.
  const savedWarrantyYears = useRef(2)
  // Set once the server is found to hold a signature this page does not have.
  // From then on every save() on this page is refused, so unsaved edits are
  // never written onto a signed invoice. Reopening the invoice clears it.
  const signedWhileOpen = useRef(false)
  const printRef = useRef(null)

  // Also covers print paths that skip the Print button (Ctrl+P, browser menu).
  useEffect(() => {
    const before = () => updateContinuedNote(printRef.current)
    const after = () => printRef.current?.classList.remove('has-page2')
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])

  useEffect(() => {
    signedWhileOpen.current = false
    const load = async () => {
      if (isNew) {
        const { job, customer, appt } = await loadJobContext(jobId)
        if (!job) return
        const cards = Array.isArray(job.fixtures) ? job.fixtures : []
        let cardLines = null
        if (cards.length) {
          const built = buildInvoiceLines(cards, MAX_LINES)
          cardLines = [...built.lines]
          while (cardLines.length < MIN_LINES) cardLines.push({ description: '', notes: '', rate: '', amount: '' })
          setNewInvoiceWarning({ problems: built.problems, overflow: built.overflow, overflowAmount: built.overflowAmount })
        }
        setInv(v => ({
          ...v,
          ...(cardLines ? { line_items: cardLines } : {}),
          invoice_number: job.job_number ?? '',
          service_date: appt?.appointment_datetime ? format(new Date(appt.appointment_datetime), 'yyyy-MM-dd') : '',
          surface_type:  getJobSurfaceText(job),
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
          discount: String(existing.discount ?? '0'),
          tax_rate: String(existing.tax_rate ?? '0'),
          notes1: nlines[0] ?? '', notes2: nlines[1] ?? '', notes3: nlines[2] ?? '',
          warranty_included: existing.warranty_included ?? true,
          warranty_years: normalizeWarrantyYears(existing.warranty_years),
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
          technician_signature_url: existing.technician_signature_url ?? null,
          customer_signature_url: existing.customer_signature_url ?? null,
        }))
        setSaved(true)
        savedWarrantyYears.current = normalizeWarrantyYears(existing.warranty_years)

        // Check for completed remote customer signature
        const { data: sigReq } = await supabase
          .from('signature_requests')
          .select('customer_signature_path, customer_name, used_at')
          .eq('invoice_id', id)
          .not('used_at', 'is', null)
          .order('used_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (sigReq?.customer_signature_path && !existing.customer_signature_url) {
          const { data: urlData } = await supabase.storage
            .from('job-images')
            .createSignedUrl(sigReq.customer_signature_path, 31536000)
          if (urlData?.signedUrl) {
            const { error: invError } = await supabase.from('invoices').update({
              customer_signature_url: urlData.signedUrl,
              updated_at: new Date().toISOString(),
            }).eq('id', id)
            if (!invError) {
              await db.invoices.where('id').equals(id).modify({
                customer_signature_url: urlData.signedUrl,
              })
              setInv(v => ({ ...v, customer_signature_url: urlData.signedUrl }))
            }
          }
        }

        let warr = await db.warranties.where('invoice_id').equals(id).first()
        if (!warr) warr = (await supabase.from('warranties').select('*').eq('invoice_id', id).maybeSingle()).data
        setExistingWarranty(warr ?? null)
      }
    }
    load()
  }, [id, jobId])

  useEffect(() => {
    if (searchParams.get('sign') === '1' && inv.id && !showSigCapture) {
      setShowSigCapture(true)
    }
  }, [searchParams, inv.id])

  const set = (key, value) => setInv(v => ({ ...v, [key]: value }))

  const setItem = (i, key, value) => {
    const items = [...inv.line_items]
    items[i] = { ...items[i], [key]: value }
    if (key === 'rate') items[i].amount = value
    setInv(v => ({ ...v, line_items: items }))
  }

  const addLine = () => setInv(v => (
    v.line_items.length >= MAX_LINES
      ? v
      : { ...v, line_items: [...v.line_items, { description: '', notes: '', rate: '', amount: '' }] }
  ))

  const removeLastLine = () => setInv(v => (
    v.line_items.length <= MIN_LINES
      ? v
      : { ...v, line_items: v.line_items.slice(0, -1) }
  ))

  // A blank last line goes straight away; one with anything in it asks first.
  const lastLine = inv.line_items[inv.line_items.length - 1] || {}
  const lastLineHasContent = ['description', 'notes', 'rate', 'amount']
    .some(k => String(lastLine[k] ?? '').trim() !== '')

  const handleRemoveLastLine = () => {
    if (lastLineHasContent) setConfirmRemoveLine(true)
    else removeLastLine()
  }

  const confirmRemoveLastLine = () => {
    setConfirmRemoveLine(false)
    removeLastLine()
  }

  const subtotal = inv.line_items.reduce((s, item) => s + (parseFloat(item.amount) || 0), 0)
  const discount  = parseFloat(inv.discount)  || 0
  const taxRate   = parseFloat(inv.tax_rate)  || 0
  const taxable   = subtotal - discount
  const tax       = taxable * (taxRate / 100)
  const total     = taxable + tax

  // Calculator behavior: fills the dollar box once from the current subtotal. Nothing stays linked.
  const applyDiscountPercent = (pct) => {
    const subtotalCents = Math.round(subtotal * 100)
    if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) return
    set('discount', (Math.round(subtotalCents * pct / 100) / 100).toFixed(2))
  }

  const isLocked = !!(inv.technician_signature_url && inv.customer_signature_url)
  const warrantyYears = normalizeWarrantyYears(inv.warranty_years)

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
    // The builder has no payment status control, so a save never sends one
    // for an existing invoice; the Invoices list owns that field. New
    // invoices start as unpaid on both the phone and the server.
    ...(inv.id ? {} : { payment_status: 'unpaid' }),
    invoice_notes: [inv.notes1, inv.notes2, inv.notes3].filter(Boolean).join('\n') || null,
    warranty_included: !!inv.warranty_included,
    warranty_excluded_reason: inv.warranty_included ? null : (inv.warranty_no_reason || null),
    warranty_years: normalizeWarrantyYears(inv.warranty_years),
    // A save may add a signature but never send a blank one. A missing key
    // leaves the server's and this device's value untouched. Clearing is
    // done only by handleUnlock, with its own write.
    ...(inv.technician_signature_url ? { technician_signature_url: inv.technician_signature_url } : {}),
    ...(inv.customer_signature_url ? { customer_signature_url: inv.customer_signature_url } : {}),
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
      expiry_date: warrantyExpiry(inv.service_date, warrantyYears),
      technician: inv.technician || null,
      created_at: new Date().toISOString(),
    }
    await db.warranties.add({ ...wPayload, _synced: false })
    const { error } = await supabase.from('warranties').insert(wPayload)
    if (!error) await db.warranties.where('id').equals(wPayload.id).modify({ _synced: true })
    setExistingWarranty(wPayload)
  }

  // Signature columns straight from Supabase, so a customer signature that
  // arrived after this page loaded is not missed. Returns null when there is
  // no usable answer (offline, request failed, no reply within 5 seconds,
  // invoice not uploaded yet).
  const fetchServerSignatures = async (invoiceId) => {
    if (!navigator.onLine) return null
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const { data, error } = await supabase
        .from('invoices')
        .select('technician_signature_url, customer_signature_url, technician_signed_at, customer_signed_at')
        .eq('id', invoiceId)
        .abortSignal(controller.signal)
        .maybeSingle()
      return error ? null : (data ?? null)
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  // Move an existing warranty's expiry date to match a changed warranty length.
  // Writes ONLY expiry_date. Never throws: returns a toast ({ text, kind }) to show when
  // the server copy could not be confirmed, or null when there is nothing to report.
  const updateWarrantyExpiry = async (invoiceUploaded) => {
    try {
      // Counted from the warranty's own service date so the warranty document
      // stays consistent with itself; the invoice's date is only a fallback.
      const expiry_date = warrantyExpiry(existingWarranty.service_date || inv.service_date, warrantyYears)
      if (!expiry_date) return null
      const warrantyId = existingWarranty.id

      // Local first so this device's warranty always matches its invoice.
      await db.warranties.where('id').equals(warrantyId).modify({ expiry_date, _synced: false })
      setExistingWarranty(w => ({ ...w, expiry_date }))

      const queueUpload = () => db.sync_queue.add({
        table_name: 'warranties',
        operation: 'update',
        payload: { id: warrantyId, expiry_date },
        created_at: new Date().toISOString(),
      })

      if (!invoiceUploaded) {
        await queueUpload()
        savedWarrantyYears.current = warrantyYears
        return null
      }

      const { data, error } = await supabase
        .from('warranties')
        .update({ expiry_date })
        .eq('id', warrantyId)
        .select('id')

      if (error) {
        await queueUpload()
        savedWarrantyYears.current = warrantyYears
        return { text: 'Invoice saved. The new warranty expiry date is saved on this device and will upload when the connection is back.', kind: 'neutral' }
      }
      // No error but nothing changed: the server refused or has no such warranty.
      if (!data || data.length === 0) {
        return { text: 'Invoice saved, but the warranty expiry date was not updated on the server. It is correct on this device. Tap Save again to retry.', kind: 'error' }
      }
      await db.warranties.where('id').equals(warrantyId).modify({ _synced: true })
      savedWarrantyYears.current = warrantyYears
      return null
    } catch {
      return { text: 'Invoice saved, but the warranty expiry date could not be updated. Tap Save again to retry.', kind: 'error' }
    }
  }

  const save = async (shouldNavigateBack = true) => {
    setSaving(true)
    let toastMs = 2800
    const invoiceId = inv.id ?? crypto.randomUUID()
    const payload = buildDbPayload({
      id: invoiceId,
      created_at: inv.created_at ?? new Date().toISOString(),
    })
    // Only a changed length on an invoice that already has a warranty moves its expiry.
    const lengthChanged = !!existingWarranty && warrantyYears !== savedWarrantyYears.current
    try {
      // Already found signed on the server during an earlier save on this page.
      if (signedWhileOpen.current) {
        toastMs = 6000
        setToast({ text: SIGNED_WHILE_OPEN_MSG, kind: 'error' })
        return false
      }

      // Checked BEFORE anything is written. Existing invoices only: a signing
      // link cannot exist before the invoice has an id.
      const server = inv.id ? await fetchServerSignatures(inv.id) : null
      if (server && (
        (server.customer_signature_url && !inv.customer_signature_url) ||
        (server.technician_signature_url && !inv.technician_signature_url)
      )) {
        signedWhileOpen.current = true
        try {
          // This device's copy only, so reopening shows the signed version.
          await db.invoices.where('id').equals(inv.id).modify({
            technician_signature_url: server.technician_signature_url ?? null,
            customer_signature_url: server.customer_signature_url ?? null,
            technician_signed_at: server.technician_signed_at ?? null,
            customer_signed_at: server.customer_signed_at ?? null,
          })
        } catch {
          // Could not update this device's copy. Nothing was saved either way,
          // and the job page refreshes it from the server when reopened.
        }
        toastMs = 6000
        setToast({ text: SIGNED_WHILE_OPEN_MSG, kind: 'error' })
        return false
      }

      if (lengthChanged) {
        const signed = server
          ? !!(server.technician_signature_url && server.customer_signature_url)
          : isLocked
        if (signed) {
          setInv(v => ({ ...v, ...(server ?? {}), warranty_years: savedWarrantyYears.current }))
          toastMs = 6000
          setToast({ text: 'This invoice is already signed, so the warranty length was not changed and nothing was saved.', kind: 'error' })
          return false
        }
      }

      // Local first so nothing is lost, even offline.
      await upsertLocal('invoices', { ...payload, _synced: !!navigator.onLine })
      const wasNew = !inv.id
      if (wasNew) setInv(v => ({ ...v, id: invoiceId }))
      setSaved(true)

      if (inv.warranty_included && inv.service_date && !existingWarranty) {
        await createWarranty(invoiceId)
        savedWarrantyYears.current = warrantyYears
      }

      // upsert handles both create and update against Supabase by primary key.
      const { error } = await supabase.from('invoices').upsert(payload)
      if (error) {
        await db.invoices.where('id').equals(invoiceId).modify({ _synced: false })
        // Invoice is on this device only: keep its warranty in step locally and queue the upload.
        if (lengthChanged) await updateWarrantyExpiry(false)
        throw error
      }
      const warrantyNote = lengthChanged ? await updateWarrantyExpiry(true) : null
      if (warrantyNote) {
        // Stay on the page so the message can be read.
        toastMs = 6000
        setToast(warrantyNote)
        return
      }
      setToast({ text: wasNew ? 'Invoice saved ✓' : 'Invoice updated ✓', kind: 'success' })
      if (shouldNavigateBack) navigate(`/jobs/${inv.job_id}`)
    } catch (err) {
      console.error('Invoice save failed:', err)
      setToast({ text: `Saved locally · ${err.message || 'offline — reopen online to upload'}`, kind: 'error' })
    } finally {
      setSaving(false)
      setTimeout(() => setToast(null), toastMs)
    }
  }

  const print = async () => {
    setPrintAsQuote(false)
    if ((await save(false)) === false) return
    document.title = `${inv.invoice_number || 'invoice'}-invoice`
    updateContinuedNote(printRef.current)
    window.print()
  }
  const printAsQuoteHandler = async () => {
    setPrintAsQuote(true)
    if ((await save(false)) === false) return
    document.title = `${inv.invoice_number || 'quote'}-quote`
    updateContinuedNote(printRef.current)
    window.print()
  }

  // Shown as the red "Not on this invoice:" box and asked about before the first save.
  const missingFromInvoice = !!newInvoiceWarning && !saved
    && (newInvoiceWarning.problems.length > 0 || newInvoiceWarning.overflow > 0)

  const runAction = (name) => {
    if (name === 'save') save()
    else if (name === 'print') print()
    else if (name === 'quote') printAsQuoteHandler()
  }

  // Save, Print and Print as Quote all come through here. The first one on an
  // incomplete new invoice asks first; after "anyway" none of them ask again.
  const requestAction = (name) => {
    if (missingFromInvoice && !warningAcknowledged) setPendingAction(name)
    else runAction(name)
  }

  const confirmPendingAction = () => {
    const name = pendingAction
    setWarningAcknowledged(true)
    setPendingAction(null)
    runAction(name)
  }

  const handleSignaturesComplete = async (techUrl, custUrl) => {
    const signedAt = new Date().toISOString()
    setInv(v => ({ ...v, technician_signature_url: techUrl, customer_signature_url: custUrl, technician_signed_at: signedAt, customer_signed_at: signedAt }))
    setShowSigCapture(false)
    try {
      await supabase.from('invoices').update({
        technician_signature_url: techUrl,
        customer_signature_url: custUrl,
        technician_signed_at: signedAt,
        customer_signed_at: signedAt,
        updated_at: new Date().toISOString(),
      }).eq('id', inv.id)
      await db.invoices.where('id').equals(inv.id).modify({
        technician_signature_url: techUrl,
        customer_signature_url: custUrl,
        technician_signed_at: signedAt,
        customer_signed_at: signedAt,
      })
      setToast({ text: 'Signatures saved ✓', kind: 'success' })
      setTimeout(() => setToast(null), 2800)
      navigate(`/jobs/${inv.job_id}`)
    } catch (err) {
      console.error('Signature save error:', err)
      setToast({ text: 'Signatures uploaded but not saved to record — try again', kind: 'error' })
      setTimeout(() => setToast(null), 3500)
    }
  }

  const generateSigningLink = async () => {
    if (!inv.id) return
    setSigLinkState({ status: 'generating' })
    try {
      const token = crypto.randomUUID().replace(/-/g, '')
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      const { error } = await supabase.from('signature_requests').insert({
        invoice_id: inv.id,
        token,
        expires_at: expiresAt,
        customer_name: inv.customer_name || null,
      })
      if (error) throw error
      const url = `${window.location.origin}/sign/${token}`
      setSigLinkState({ status: 'ready', url })
    } catch (err) {
      console.error('Failed to generate signing link:', err)
      setSigLinkState({ status: 'error' })
    }
  }

  const handleTechnicianSigned = async (techUrl) => {
    try {
      const { error } = await supabase.from('invoices').update({
        technician_signature_url: techUrl,
        updated_at: new Date().toISOString(),
      }).eq('id', inv.id)
      if (error) throw error
      await db.invoices.where('id').equals(inv.id).modify({ technician_signature_url: techUrl })
      setInv(v => ({ ...v, technician_signature_url: techUrl }))
      setToast({ text: 'Technician signature saved', kind: 'success' })
      setTimeout(() => setToast(null), 3500)
    } catch (err) {
      console.error('Technician signature save error:', err)
      setToast({ text: 'Signature uploaded but not saved to record — try again', kind: 'error' })
      setTimeout(() => setToast(null), 3500)
    }
  }

  const handleUnlock = async () => {
    if (!window.confirm(
      'Unlock this invoice? This will clear both signatures and require re-signing. This cannot be undone.'
    )) return
    const prev = { technician_signature_url: inv.technician_signature_url, customer_signature_url: inv.customer_signature_url }
    setInv(v => ({ ...v, technician_signature_url: null, customer_signature_url: null }))
    try {
      const { data, error } = await supabase.from('invoices').update({
        technician_signature_url: null,
        customer_signature_url: null,
        updated_at: new Date().toISOString(),
      }).eq('id', inv.id).select('id')
      if (error) throw error
      // No error but no row changed: the server refused or has no such invoice.
      if (!data || data.length === 0) throw new Error('Unlock was not applied')
      await db.invoices.where('id').equals(inv.id).modify({
        technician_signature_url: null,
        customer_signature_url: null,
      })
      setToast({ text: 'Invoice unlocked — signatures cleared', kind: 'success' })
      setTimeout(() => setToast(null), 2800)
    } catch (err) {
      console.error('Unlock failed:', err)
      setInv(v => ({ ...v, ...prev }))
      setToast({ text: 'Could not unlock the invoice. Check your connection and try again.', kind: 'error' })
      setTimeout(() => setToast(null), 3500)
    }
  }

  const page2Title = `Dallas Tub Fix - Invoice${inv.invoice_number ? ` ${inv.invoice_number}` : ''} (continued)`
  const page2Sub = [inv.customer_name, inv.service_date ? fmtDateMMDDYYYY(inv.service_date) : '', 'Page 2 of 2']
    .filter(Boolean)
    .join(' · ')

  const combinedAddress = [inv.customer_address, inv.customer_city]
    .filter(Boolean)
    .join(', ')

  const handleAddressAutocomplete = (formatted) => {
    const clean = formatted.replace(/, (USA|United States)$/, '').trim()
    const commaIdx = clean.indexOf(',')
    if (commaIdx === -1) {
      set('customer_address', clean)
      set('customer_city', '')
    } else {
      set('customer_address', clean.slice(0, commaIdx).trim())
      set('customer_city', clean.slice(commaIdx + 1).trim())
    }
  }

  return (
    <div className="min-h-screen">
      {/* Top nav and actions — hidden on print */}
      <PageHeader
        title="Invoice Builder"
        sticky
        onBack={() => navigate(-1)}
        className="no-print"
        below={
          <div className="builder-actions">
            {!isLocked && (
              <Button variant="secondary" onClick={() => requestAction('save')} disabled={saving}>
                {saving ? '…' : 'Save'}
              </Button>
            )}
            <Button variant="primary" onClick={() => requestAction('print')} disabled={saving}>
              Print
            </Button>
            <Button variant="secondary" onClick={() => requestAction('quote')} disabled={saving}>
              Print as Quote
            </Button>
          </div>
        }
      />

      {toast && (
        <div className={`no-print ui-toast ui-toast--bottom ui-toast--${toast.kind}`}>
          {toast.text}
        </div>
      )}

      {/* Edit form — no-print */}
      <div className="no-print px-4 py-5 space-y-5 max-w-2xl mx-auto">
        {missingFromInvoice && (
          <div role="alert" className="glass-card flex gap-2 text-[var(--message-red)]">
            <AlertCircle size={16} aria-hidden="true" className="shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-bold">Not on this invoice:</p>
              <ul className="mt-1 space-y-0.5">
                {newInvoiceWarning.problems.map((p, i) => (
                  <li key={i} className="text-sm font-bold">{`${p.title} - ${p.message}`}</li>
                ))}
                {newInvoiceWarning.overflow > 0 && (
                  <li className="text-sm font-bold">
                    {`${newInvoiceWarning.overflow} more ${newInvoiceWarning.overflow === 1 ? 'line' : 'lines'} didn't fit (${MAX_LINES} line maximum) - ${money(newInvoiceWarning.overflowAmount)} not included.`}
                  </li>
                )}
              </ul>
            </div>
          </div>
        )}
        {isLocked && (
          <div className="inset-box note-warn items-center gap-3 px-4 py-3">
            <AlertCircle size={16} aria-hidden="true" />
            <p className="flex-1">This invoice has been signed by both parties and is locked.</p>
            <Button variant="secondary" className="shrink-0 min-h-[44px] px-3 text-sm" onClick={handleUnlock}>
              Unlock
            </Button>
          </div>
        )}
        <div className="glass-card grid grid-cols-2 gap-3">
          <Field label="Invoice #"    value={inv.invoice_number} onChange={v => set('invoice_number', v)} disabled={isLocked} />
          <Field label="Invoice Date" value={inv.invoice_date}   onChange={v => set('invoice_date', v)} type="date" disabled={isLocked} />
        </div>

        <div className="glass-card space-y-3">
          <h3 className="ui-field-label">Customer</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full Name"  value={inv.customer_name}    onChange={v => set('customer_name', v)}    className="col-span-2" disabled={isLocked} />
            <Field label="Phone"      value={inv.customer_phone}   onChange={v => set('customer_phone', v)} disabled={isLocked} />
            <Field label="Email"      value={inv.customer_email}   onChange={v => set('customer_email', v)} disabled={isLocked} />
            <AddressAutocomplete
              label="Address"
              value={combinedAddress}
              onChange={v => set('customer_address', v)}
              onAutocomplete={handleAddressAutocomplete}
              className="col-span-2"
              disabled={isLocked}
            />
          </div>
        </div>

        <div className="glass-card space-y-3">
          <h3 className="ui-field-label">Service Details</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Service Date"  value={inv.service_date}  onChange={v => set('service_date', v)}  type="date" disabled={isLocked} />
            <Field label="Technician"    value={inv.technician}    onChange={v => set('technician', v)} disabled={isLocked} />
            <Field label="Surface Type"  value={inv.surface_type}  onChange={v => set('surface_type', v)} disabled={isLocked} />
            <Field label="Surface Color" value={inv.surface_color} onChange={v => set('surface_color', v)} disabled={isLocked} />
          </div>
        </div>

        <div className="glass-card space-y-2">
          <h3 className="ui-field-label mb-2">Line Items</h3>
          <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)_96px] gap-1 text-[10px] font-semibold uppercase text-[var(--text-secondary)] mb-1">
            <span>Description</span>
            <span>Notes/Type</span>
            <span className="text-right">Amount</span>
          </div>
          {inv.line_items.map((item, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)_96px] gap-1">
              <input value={item.description} onChange={e => setItem(i, 'description', e.target.value)} disabled={isLocked}
                className="ui-field min-w-0 min-h-[44px] rounded-[var(--radius-sm)] px-2 text-xs" />
              <input value={item.notes} onChange={e => setItem(i, 'notes', e.target.value)} disabled={isLocked}
                className="ui-field min-w-0 min-h-[44px] rounded-[var(--radius-sm)] px-2 text-xs" />
              <input value={item.amount} onChange={e => setItem(i, 'amount', e.target.value)} disabled={isLocked}
                inputMode="decimal"
                className="ui-field min-w-0 min-h-[44px] rounded-[var(--radius-sm)] px-2 text-xs text-right" />
            </div>
          ))}
          {!isLocked && (
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="secondary" className="flex-1 min-h-[44px]"
                onClick={addLine} disabled={inv.line_items.length >= MAX_LINES}>
                {inv.line_items.length >= MAX_LINES ? `Add line (max ${MAX_LINES})` : 'Add line'}
              </Button>
              {inv.line_items.length > MIN_LINES && (
                <Button type="button" variant="secondary" className="flex-1 min-h-[44px]" onClick={handleRemoveLastLine}>
                  Remove last line
                </Button>
              )}
            </div>
          )}
          <div className="inset-box mt-2 px-3 py-2 space-y-1 text-sm text-[var(--text)]">
            <div className="flex justify-between"><span>Subtotal</span><span className="font-medium">${subtotal.toFixed(2)}</span></div>
            <div className="flex items-center gap-2">
              <span className="flex-1">Discount ($)</span>
              <input value={inv.discount} onChange={e => set('discount', e.target.value)} disabled={isLocked} className="ui-field w-20 min-h-[44px] rounded-[var(--radius-sm)] px-2 text-xs text-right" />
            </div>
            {!isLocked && (
              <div className="flex flex-wrap justify-end gap-2">
                {DISCOUNT_PERCENTS.map(pct => (
                  <button key={pct} type="button" onClick={() => applyDiscountPercent(pct)} disabled={!(subtotal > 0)}
                    className="fx-option min-h-[44px] px-3">
                    {pct}%
                  </button>
                ))}
                <button type="button" onClick={() => set('discount', '0')}
                  className="fx-option min-h-[44px] px-3">
                  Clear
                </button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="flex-1">Tax (%)</span>
              <input value={inv.tax_rate} onChange={e => set('tax_rate', e.target.value)} disabled={isLocked} className="ui-field w-20 min-h-[44px] rounded-[var(--radius-sm)] px-2 text-xs text-right" />
            </div>
            <div className="flex justify-between font-bold text-[var(--accent-text)] text-base pt-2">
              <span>Total</span><span>${total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="glass-card space-y-3">
          <h3 className="ui-field-label">Payment Methods</h3>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map(m => (
              <button key={m} type="button" onClick={() => togglePayment(m)}
                aria-pressed={(inv.payment_methods ?? []).includes(m)}
                className={`fx-option min-h-[44px] px-3${isLocked ? ' pointer-events-none opacity-60' : ''}`}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="glass-card space-y-2">
          <h3 className="ui-field-label mb-2">Notes</h3>
          {[1,2,3].map(n => (
            <input key={n} value={inv[`notes${n}`]} onChange={e => set(`notes${n}`, e.target.value)}
              placeholder={`Note line ${n}`} disabled={isLocked}
              className="ui-field ui-field-h w-full px-3" />
          ))}
        </div>

        <div className="glass-card space-y-3">
          <h3 className="ui-field-label">Warranty</h3>
          <div className="flex gap-2">
            <button type="button" onClick={() => set('warranty_included', true)}
              aria-pressed={!!inv.warranty_included}
              className={`fx-option flex-1${isLocked ? ' pointer-events-none opacity-60' : ''}`}>
              YES — {warrantyYears}-Year Included
            </button>
            <button type="button" onClick={() => set('warranty_included', false)}
              aria-pressed={!inv.warranty_included}
              className={`fx-option flex-1${isLocked ? ' pointer-events-none opacity-60' : ''}`}>
              NO
            </button>
          </div>
          <div className="flex gap-2">
            {[2, 6].map(n => (
              <button key={n} type="button" onClick={() => set('warranty_years', n)} disabled={isLocked}
                aria-pressed={warrantyYears === n}
                className={`fx-option flex-1${isLocked ? ' pointer-events-none opacity-60' : ''}`}>
                {n} Years
              </button>
            ))}
          </div>
          {inv.warranty_included && !inv.service_date && !isLocked && (
            <p className="note-warn">
              <AlertCircle size={16} aria-hidden="true" />
              <span>Add a service date to create the warranty.</span>
            </p>
          )}
          {!inv.warranty_included && (
            <input value={inv.warranty_no_reason} onChange={e => set('warranty_no_reason', e.target.value)}
              placeholder="Reason warranty not included…" disabled={isLocked}
              className="ui-field ui-field-h w-full px-3" />
          )}
        </div>

        {saved && inv.warranty_included && existingWarranty && (
          <Button variant="secondary" className="w-full" onClick={() => navigate(`/warranties/${existingWarranty.id}`)}>
            <Shield size={16} /> Build Warranty →
          </Button>
        )}
      </div>

      {/* ── PRINT VIEW — matches dtf-invoice-builder.html ── */}
      <div ref={printRef} className="inv-print hidden print:block">
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
              <div className="inv-big-label">{printAsQuote ? 'QUOTE' : 'INVOICE'}</div>
              {printAsQuote && (
                <div style={{ fontSize: '8pt', fontWeight: 700, color: 'var(--red, #dc2626)', marginTop: '2px' }}>
                  This is a quote only — not an invoice
                </div>
              )}
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
                <th className="td-amt r">Amount</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: Math.max(MIN_LINES, inv.line_items.length) }, (_, i) => {
                const item = inv.line_items[i] || {}
                return (
                  <tr key={i}>
                    <td className="td-desc">{item.description || ''}</td>
                    <td className="td-notes">{item.notes || ''}</td>
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

          {/* Only shown (via has-page2 on the print root) when the bottom block moves to page 2 */}
          <div className="inv-continued">
            <div className="cont-main">CONTINUED ON PAGE 2 &rarr;</div>
            <div className="cont-sub">Payment, warranty &amp; signature</div>
          </div>

          {/* Everything below the totals stays together: page 1 if it fits, otherwise page 2 as one block */}
          <div className="inv-bottom">

          <div className="inv-page2-head">
            <div className="p2-main">{page2Title}</div>
            <div className="p2-sub">{page2Sub}</div>
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
                <span className="wcb-lbl g">{warrantyYears}-Year Warranty Included</span>
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

          {!printAsQuote && (
            <>
              {/* SIGNATURES */}
              <hr className="rule-light" />
              <div className="sig-row">
                <div>
                  <div className="sig-title">Technician Signature</div>
                  {inv.technician_signature_url
                    ? <img src={inv.technician_signature_url} alt="Technician signature" style={{ height: '26px', objectFit: 'contain', objectPosition: 'left' }} />
                    : <div className="sig-line"></div>
                  }
                  <div className="sig-sub">Print Name &amp; Date</div>
                  <div className="sig-name-val">
                    {inv.technician || NBSP}
                    {inv.technician_signed_at ? ` · ${format(new Date(inv.technician_signed_at), 'MMM d, yyyy')}` : ''}
                  </div>
                </div>
                <div>
                  <div className="sig-title">Customer Signature — Work Completed &amp; Accepted</div>
                  {inv.customer_signature_url
                    ? <img src={inv.customer_signature_url} alt="Customer signature" style={{ height: '26px', objectFit: 'contain', objectPosition: 'left' }} />
                    : <div className="sig-line"></div>
                  }
                  <div className="sig-sub">Print Name &amp; Date</div>
                  <div className="sig-name-val">
                    {inv.customer_name || NBSP}
                    {inv.customer_signed_at ? ` · ${format(new Date(inv.customer_signed_at), 'MMM d, yyyy')}` : ''}
                  </div>
                </div>
              </div>
            </>
          )}

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

          </div>{/* /inv-bottom */}

        </div>
      </div>

      {/* Portal keeps the Modal's un-typed close button out of any surrounding form. */}
      {createPortal(
        <Modal open={confirmRemoveLine} onClose={() => setConfirmRemoveLine(false)} title="Remove line?">
          <p className="text-sm text-[var(--text)] mb-4">
            The last line has details filled in. Remove it?
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1 min-h-[44px]" onClick={() => setConfirmRemoveLine(false)}>
              Keep it
            </Button>
            <Button type="button" variant="destructive" className="flex-1 min-h-[44px]" onClick={confirmRemoveLastLine}>
              Remove
            </Button>
          </div>
        </Modal>,
        document.body
      )}

      {createPortal(
        <Modal open={pendingAction !== null} onClose={() => setPendingAction(null)} title="Not everything is on this invoice">
          <ul className="space-y-1 mb-4">
            {newInvoiceWarning?.problems.map((p, i) => (
              <li key={i} className="text-sm font-bold text-[var(--message-red)]">{`${p.title} - ${p.message}`}</li>
            ))}
            {newInvoiceWarning?.overflow > 0 && (
              <li className="text-sm font-bold text-[var(--message-red)]">
                {`${newInvoiceWarning.overflow} more ${newInvoiceWarning.overflow === 1 ? 'line' : 'lines'} didn't fit (${MAX_LINES} line maximum) - ${money(newInvoiceWarning.overflowAmount)} not included.`}
              </li>
            )}
          </ul>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1 min-h-[44px]" onClick={() => setPendingAction(null)}>
              Go back
            </Button>
            <Button type="button" variant="primary" className="flex-1 min-h-[44px]" onClick={confirmPendingAction}>
              {PENDING_ACTION_LABELS[pendingAction]}
            </Button>
          </div>
        </Modal>,
        document.body
      )}

      {sigLinkState && (
        <div className="no-print fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="ui-modal-scrim absolute inset-0" />
          <div className="ui-modal-panel relative rounded-[var(--radius-modal)] w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="ui-modal-title">Customer Signing Link</h2>
              <button type="button" onClick={() => setSigLinkState(null)} aria-label="Close" className="ui-modal-close">
                <X size={20} />
              </button>
            </div>
            {sigLinkState.status === 'generating' && (
              <p className="text-sm text-[var(--text-secondary)]">Generating link…</p>
            )}
            {sigLinkState.status === 'error' && (
              <p className="text-sm text-[var(--message-red)]">Failed to generate link. Please try again.</p>
            )}
            {sigLinkState.status === 'ready' && (
              <>
                <p className="text-xs text-[var(--text-secondary)] mb-3">Copy this link and send it to your customer. It expires in 24 hours and can only be used once.</p>
                <div className="inset-box px-3 py-2.5 text-xs font-mono text-[var(--text)] break-all mb-4 select-all">
                  {sigLinkState.url}
                </div>
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={() => {
                    navigator.clipboard.writeText(sigLinkState.url)
                    setToast({ text: 'Link copied ✓', kind: 'success' })
                    setTimeout(() => setToast(null), 2000)
                    setSigLinkState(null)
                  }}
                >
                  Copy Link
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {showSigCapture && inv.id && (
        <SignatureCapture
          invoiceId={inv.id}
          initialStep={inv.technician_signature_url ? 'customer' : 'technician'}
          technicianName={user?.user_metadata?.full_name || user?.user_metadata?.name || inv.technician}
          customerName={inv.customer_name}
          onComplete={handleSignaturesComplete}
          onClose={() => {
            setShowSigCapture(false)
            if (sigLinkState?.status === 'ready') {
              navigate(`/jobs/${inv.job_id}`)
            }
          }}
          onSendToCustomer={generateSigningLink}
          onTechnicianSigned={handleTechnicianSigned}
          existingTechnicianUrl={inv.technician_signature_url || null}
          sigLinkState={sigLinkState}
        />
      )}
    </div>
  )
}
