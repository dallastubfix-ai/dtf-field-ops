import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { format, addYears, parseISO } from 'date-fns'
import { supabase } from '../lib/supabase'
import db from '../lib/db'
import Button from '../components/ui/Button'

const NBSP = ' '

// yyyy-mm-dd → mm/dd/yyyy (matches the standalone HTML builder)
function fmtDate(s) {
  if (!s) return NBSP
  const parts = String(s).slice(0, 10).split('-')
  if (parts.length !== 3) return s
  const [y, m, d] = parts
  return `${m}/${d}/${y}`
}

const W_COVERED = [
  'Failure, peeling, or cracking of the repaired area within 2 years of service date',
  'Color or finish degradation of the repair within normal use',
  'All labor costs for any warranty service call',
  'All materials and supplies required to re-complete the repair',
  'Technician travel to and from your home at no additional charge',
]

const W_NOT_COVERED = [
  'Damage from abrasive or harsh cleaners (bleach, Drano, ammonia, scrubbing pads)',
  'Physical damage from impact — dropping heavy objects, tools, or toys onto the surface',
  'Damage from standing water left on the repair for extended periods',
  'Suction cup marks, adhesive residue, or damage from bath mats with rubber backing',
  'Wear or deterioration of the surrounding tub surface outside the repaired area',
  'Rust occurrence, bleed-through, or re-emergence beneath the repair — rust originates in the tub substrate and is outside the scope of surface repair',
  'Pre-existing conditions noted at time of service; plumbing, caulking, or water damage behind the tub',
]

const W_TERMS = [
  'Valid for two (2) years from the original service date. Covers the specific repair area(s) completed on that date. Non-transferable to subsequent owners.',
  'To submit a claim, call (469) 592-0018. Dallas Tub Fix will schedule a return visit at no cost — labor, materials, and travel included.',
  'The repaired surface may show natural variation in texture and sheen compared to the surrounding area. This is inherent to spot repair and does not constitute a warranty defect.',
  'Dallas Tub Fix reserves the right to determine whether a reported issue falls within warranty coverage. Claims outside covered conditions will be quoted as standard repair work.',
  'The repaired surface must be kept dry for a minimum of 24–48 hours following service. Failure to observe this curing period may void warranty coverage for that repair.',
  'This warranty does not extend to plumbing, electrical, or structural work. Dallas Tub Fix is not a licensed plumber and will not be held responsible for related systems.',
]

const W_CARE = [
  'Use only non-abrasive, gentle cleaners (dish soap, Fantastik, Simple Green)',
  'Do not leave standing water on the repaired surface for extended periods',
  'Avoid suction cups, rubber bath mats, or adhesive products directly on the repair',
  'Keep surface dry for at least 24–48 hours after service before using',
  'Do not use hair dryers, heat guns, or abrasive scrubbing tools on repair area',
  'Do not drop heavy or sharp objects onto the repaired surface',
]

// Print CSS lifted from dtf-warranty-builder.html, scoped under .warr-print.
const WARRANTY_PRINT_CSS = `
.warr-print .warranty-page {
  --navy:#1E40AF; --gold:#F59E0B; --gray-bg:#f3f4f6; --gray-bd:#d1d5db; --gray-txt:#6b7280;
  --green:#16a34a; --green-lt:#f0fdf4; --red:#dc2626; --red-lt:#fff5f5; --black:#111827;
  font-family:'Inter',Arial,sans-serif; font-size:7.5pt; color:var(--black); background:white;
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
  width:816px; padding:36px 40px 33px; box-sizing:border-box;
}
.warr-print .w-header { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:7px; }
.warr-print .w-logo-block { flex:1; }
.warr-print .wordmark { display:flex; align-items:baseline; gap:4px; line-height:1; }
.warr-print .wd { font-size:16pt; font-weight:900; letter-spacing:-0.02em; line-height:1; }
.warr-print .wd-navy { color:var(--navy); }
.warr-print .wd-gold { color:var(--gold); }
.warr-print .hd-sub { font-size:7pt; font-weight:500; color:var(--gray-txt); margin-top:2px; }
.warr-print .w-badge { text-align:right; flex-shrink:0; }
.warr-print .badge-num { font-size:36pt; font-weight:900; color:var(--navy); line-height:1; letter-spacing:-0.04em; }
.warr-print .badge-year { font-size:10pt; font-weight:800; color:var(--navy); text-transform:uppercase; letter-spacing:0.1em; line-height:1; }
.warr-print .badge-sub { font-size:7pt; font-weight:600; color:var(--gray-txt); text-transform:uppercase; letter-spacing:0.06em; margin-top:1px; }
.warr-print .rule-double { border:none; border-top:3px solid var(--navy); margin-bottom:1px; }
.warr-print .rule-thin { border:none; border-top:1px solid var(--navy); margin-bottom:7px; }
.warr-print .rule-light { border:none; border-top:1px solid var(--gray-bd); margin:0 0 5px 0; }
.warr-print .g-banner { background:var(--navy); border-radius:5px; padding:7px 12px; display:flex; align-items:center; justify-content:space-between; margin-bottom:7px; }
.warr-print .banner-title { font-size:10pt; font-weight:800; color:#fff; }
.warr-print .banner-sub { font-size:6.5pt; font-weight:400; color:rgba(255,255,255,0.7); margin-top:1px; }
.warr-print .banner-pill { background:var(--gold); color:#111827; font-size:7pt; font-weight:800; padding:4px 10px; border-radius:20px; white-space:nowrap; letter-spacing:0.03em; }
.warr-print .w-info-block { border:1.5px solid var(--gray-bd); border-radius:5px; padding:7px 10px 8px; margin-bottom:7px; }
.warr-print .w-info-top { display:grid; grid-template-columns:1fr 1fr 1fr; gap:0 14px; margin-bottom:6px; }
.warr-print .w-info-bottom { display:grid; grid-template-columns:1fr 1fr 1fr; gap:0 14px; }
.warr-print .w-field label { display:block; font-size:6pt; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; color:var(--navy); margin-bottom:2px; }
.warr-print .w-val { font-size:8.5pt; font-weight:600; color:var(--black); border-bottom:1.5px solid var(--navy); padding-bottom:2px; display:block; white-space:nowrap; overflow:hidden; min-height:16px; }
.warr-print .cov-row { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-bottom:7px; }
.warr-print .cov-box { border-radius:5px; padding:7px 9px 8px; }
.warr-print .cov-box.green { background:var(--green-lt); border:1.5px solid #86efac; }
.warr-print .cov-box.red { background:var(--red-lt); border:1.5px solid #fca5a5; }
.warr-print .cov-title { display:flex; align-items:center; gap:5px; font-size:7.5pt; font-weight:800; text-transform:uppercase; letter-spacing:0.07em; margin-bottom:5px; }
.warr-print .cov-title.g { color:var(--green); }
.warr-print .cov-title.r { color:var(--red); }
.warr-print .cov-icon { width:13px; height:13px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:7pt; font-weight:900; flex-shrink:0; }
.warr-print .cov-icon.g { background:var(--green); color:white; }
.warr-print .cov-icon.r { background:var(--red); color:white; }
.warr-print .cov-list { list-style:none; }
.warr-print .cov-list li { font-size:7pt; font-weight:400; color:#374151; line-height:1.45; padding:2px 0 2px 12px; position:relative; }
.warr-print .cov-list li::before { content:'—'; position:absolute; left:0; color:var(--gray-txt); font-size:6.5pt; }
.warr-print .terms-sec { margin-bottom:7px; }
.warr-print .sec-label { font-size:6.5pt; font-weight:800; text-transform:uppercase; letter-spacing:0.1em; color:var(--navy); border-bottom:1.5px solid var(--navy); padding-bottom:3px; margin-bottom:5px; }
.warr-print .terms-list { list-style:none; }
.warr-print .terms-list li { display:flex; gap:6px; font-size:6.8pt; line-height:1.4; color:#374151; margin-bottom:3px; }
.warr-print .t-num { font-size:6.5pt; font-weight:800; color:var(--navy); flex-shrink:0; min-width:10px; margin-top:0.5px; }
.warr-print .bottom-row { display:grid; grid-template-columns:1fr 1fr; gap:7px; margin-bottom:6px; }
.warr-print .bottom-box { border:1px solid var(--gray-bd); border-radius:4px; padding:6px 8px 7px; }
.warr-print .care-list { list-style:none; }
.warr-print .care-list li { display:flex; align-items:flex-start; gap:4px; font-size:6.8pt; line-height:1.4; color:#374151; margin-bottom:2px; }
.warr-print .care-chk { color:var(--green); font-weight:900; font-size:7pt; flex-shrink:0; margin-top:0.5px; }
.warr-print .claim-body { font-size:7pt; line-height:1.5; color:#374151; }
.warr-print .claim-num { font-size:12pt; font-weight:900; color:var(--navy); display:block; margin:4px 0 2px; }
.warr-print .claim-note { font-size:6.5pt; color:var(--gray-txt); margin-top:3px; line-height:1.4; }
.warr-print .sig-ack { font-size:6.5pt; color:var(--gray-txt); margin-bottom:6px; line-height:1.4; }
.warr-print .sig-ack strong { color:var(--navy); }
.warr-print .sig-row { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:5px; }
.warr-print .sig-title { font-size:6pt; font-weight:700; text-transform:uppercase; letter-spacing:0.07em; color:var(--navy); margin-bottom:2px; }
.warr-print .sig-line { border-bottom:1.5px solid var(--black); height:24px; margin-bottom:2px; }
.warr-print .sig-sub { font-size:5.5pt; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--gray-txt); margin-bottom:1px; margin-top:2px; }
.warr-print .sig-name { border-bottom:1px solid #9ca3af; min-height:13px; line-height:13px; font-size:7.5pt; font-weight:500; color:var(--black); }
.warr-print .w-footer { border-top:2px solid var(--gold); padding-top:5px; text-align:center; }
.warr-print .footer-main { display:flex; align-items:center; justify-content:center; gap:8px; margin-bottom:2px; }
.warr-print .seal { width:18px; height:18px; border-radius:50%; background:var(--navy); display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; }
.warr-print .seal svg { width:10px; height:10px; fill:var(--gold); }
.warr-print .fthanks { font-size:8pt; font-weight:800; color:var(--navy); }
.warr-print .fcontact { font-size:6pt; font-weight:600; color:var(--gray-txt); }
@media print {
  @page { size: letter portrait; margin: 0.38in 0.42in 0.35in 0.42in; }
  .warr-print .warranty-page { width:auto; padding:0; }
}
`

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

export default function WarrantyBuilder() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [w, setW] = useState({
    invoice_number: '',
    service_date: '',
    expiry_date: '',
    customer_name: '',
    service_address: '',
    technician: 'John Figueroa Jr.',
  })
  const [loading, setLoading] = useState(true)

  const set = (key, value) => setW(v => ({ ...v, [key]: value }))

  useEffect(() => {
    const load = async () => {
      let warranty = await db.warranties.where('id').equals(id).first()
      if (!warranty) {
        const { data } = await supabase.from('warranties').select('*').eq('id', id).single()
        if (data) { await db.warranties.put({ ...data, _synced: true }); warranty = data }
      }
      if (!warranty) { setLoading(false); return }

      const invoice = warranty.invoice_id
        ? (await db.invoices.where('id').equals(warranty.invoice_id).first()
          ?? (await supabase.from('invoices').select('*').eq('id', warranty.invoice_id).single()).data)
        : null

      const job = warranty.job_id
        ? (await db.jobs.where('id').equals(warranty.job_id).first()
          ?? (await supabase.from('jobs').select('*').eq('id', warranty.job_id).single()).data)
        : null

      const customer = job?.customer_id
        ? (await db.customers.where('id').equals(job.customer_id).first()
          ?? (await supabase.from('customers').select('*').eq('id', job.customer_id).single()).data)
        : null

      const appt = job
        ? ((await db.appointments.where('job_id').equals(job.id).toArray()) ?? [])[0]
        : null

      const sd = warranty.service_date ?? invoice?.service_date ?? ''
      const exp = warranty.expiry_date ?? (sd ? format(addYears(parseISO(sd), 2), 'yyyy-MM-dd') : '')

      setW({
        invoice_number: invoice?.invoice_number ?? job?.job_number ?? '',
        service_date: sd,
        expiry_date: exp,
        customer_name: customer?.full_name ?? '',
        service_address: appt?.location_address ?? customer?.address ?? '',
        technician: warranty.technician ?? 'John Figueroa Jr.',
      })
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><div className="w-8 h-8 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-navy" /></div>
  }

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      {/* Header */}
      <header className="bg-navy px-4 py-4 flex items-center gap-3 no-print sticky top-0 z-30">
        <button onClick={() => navigate(-1)} className="text-white"><ArrowLeft size={20} /></button>
        <h1 className="text-white font-bold text-base flex-1">Warranty Builder</h1>
        <Button variant="gold" className="py-1.5 px-3" onClick={() => window.print()}>
          <Printer size={14} /> Print
        </Button>
      </header>

      {/* Edit fields */}
      <div className="no-print px-4 py-5 space-y-4 max-w-lg mx-auto">
        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-4 grid grid-cols-2 gap-3">
          <Field label="Invoice #"     value={w.invoice_number}  onChange={v => set('invoice_number', v)} />
          <Field label="Service Date"  value={w.service_date}    onChange={v => {
            set('service_date', v)
            if (v) set('expiry_date', format(addYears(parseISO(v), 2), 'yyyy-MM-dd'))
          }} type="date" />
          <Field label="Expiry Date"   value={w.expiry_date}     onChange={v => set('expiry_date', v)} type="date" />
          <Field label="Technician"    value={w.technician}      onChange={v => set('technician', v)} />
          <Field label="Customer Name" value={w.customer_name}   onChange={v => set('customer_name', v)} className="col-span-2" />
          <Field label="Service Address" value={w.service_address} onChange={v => set('service_address', v)} className="col-span-2" />
        </div>
        <p className="text-xs text-[#9CA3AF] text-center">Edit the fields above, then tap Print to save as PDF.</p>
      </div>

      {/* ── PRINT VIEW — matches dtf-warranty-builder.html ── */}
      <div className="warr-print hidden print:block">
        <style>{WARRANTY_PRINT_CSS}</style>
        <div className="warranty-page">

          {/* HEADER */}
          <div className="w-header">
            <div className="w-logo-block">
              <div className="wordmark">
                <span className="wd wd-navy">Dallas</span>
                <span className="wd wd-gold">Tub</span>
                <span className="wd wd-navy">Fix</span>
              </div>
              <div className="hd-sub">Professional Bathtub Repair · DFW Area</div>
              <div className="hd-sub" style={{ marginTop: '1px' }}>(469) 592-0018 · dallastubfix.com · Lavon, TX</div>
            </div>
            <div className="w-badge">
              <div className="badge-num">2</div>
              <div className="badge-year">Year Warranty</div>
              <div className="badge-sub">Workmanship &amp; Materials</div>
            </div>
          </div>

          <div className="rule-double"></div>
          <div className="rule-thin"></div>

          {/* BANNER */}
          <div className="g-banner">
            <div>
              <div className="banner-title">Warranty &amp; Service Guarantee</div>
              <div className="banner-sub">Dallas Tub Fix stands behind every repair — no exceptions.</div>
            </div>
            <div className="banner-pill">100% Covered · Labor · Supplies · Travel</div>
          </div>

          {/* CUSTOMER INFO */}
          <div className="w-info-block">
            <div className="w-info-top">
              <div className="w-field">
                <label>Customer Name</label>
                <span className="w-val">{w.customer_name || NBSP}</span>
              </div>
              <div className="w-field">
                <label>Service Address</label>
                <span className="w-val">{w.service_address || NBSP}</span>
              </div>
              <div className="w-field">
                <label>Invoice / Job #</label>
                <span className="w-val">{w.invoice_number || NBSP}</span>
              </div>
            </div>
            <div className="w-info-bottom">
              <div className="w-field">
                <label>Service Date</label>
                <span className="w-val">{w.service_date ? fmtDate(w.service_date) : NBSP}</span>
              </div>
              <div className="w-field">
                <label>Warranty Expires</label>
                <span className="w-val">{w.expiry_date ? fmtDate(w.expiry_date) : NBSP}</span>
              </div>
              <div className="w-field">
                <label>Technician</label>
                <span className="w-val">{w.technician || NBSP}</span>
              </div>
            </div>
          </div>

          {/* COVERED / NOT COVERED */}
          <div className="cov-row">
            <div className="cov-box green">
              <div className="cov-title g"><div className="cov-icon g">✓</div>What Is Covered</div>
              <ul className="cov-list">
                {W_COVERED.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
            <div className="cov-box red">
              <div className="cov-title r"><div className="cov-icon r">✕</div>What Is Not Covered</div>
              <ul className="cov-list">
                {W_NOT_COVERED.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </div>
          </div>

          {/* TERMS */}
          <div className="terms-sec">
            <div className="sec-label">Warranty Terms &amp; Conditions</div>
            <ol className="terms-list">
              {W_TERMS.map((t, i) => (
                <li key={i}><span className="t-num">{i + 1}.</span><span>{t}</span></li>
              ))}
            </ol>
          </div>

          {/* CARE + CLAIM */}
          <div className="bottom-row">
            <div className="bottom-box">
              <div className="sec-label" style={{ marginBottom: '5px' }}>Care &amp; Maintenance — Required to Maintain Warranty</div>
              <ul className="care-list">
                {W_CARE.map((t, i) => (
                  <li key={i}><span className="care-chk">✓</span><span>{t}</span></li>
                ))}
              </ul>
            </div>
            <div className="bottom-box">
              <div className="sec-label" style={{ marginBottom: '5px' }}>How to Submit a Warranty Claim</div>
              <div className="claim-body">
                Call Dallas Tub Fix and reference your invoice number. We will schedule a return visit at no cost — no hoops, no hassle.
                <span className="claim-num">(469) 592-0018</span>
                Keep this warranty document and your original invoice together for your records.
              </div>
              <div className="claim-note">
                Invoice # <strong style={{ color: 'var(--navy)' }}>{w.invoice_number || '—'}</strong>
                {' · '}Expires: <strong style={{ color: 'var(--navy)' }}>{w.expiry_date ? fmtDate(w.expiry_date) : '—'}</strong>
              </div>
            </div>
          </div>

          {/* SIGNATURES */}
          <hr className="rule-light" />
          <div className="sig-ack">
            By signing below, both parties acknowledge that the work described on Invoice #{' '}
            <strong>{w.invoice_number || '—'}</strong> has been completed, and that the customer has received, read, and understood the warranty terms above.
          </div>
          <div className="sig-row">
            <div>
              <div className="sig-title">Technician Signature</div>
              <div className="sig-line"></div>
              <div className="sig-sub">Print Name &amp; Date</div>
              <div className="sig-name">{w.technician || NBSP}</div>
            </div>
            <div>
              <div className="sig-title">Customer Signature — Warranty Accepted</div>
              <div className="sig-line"></div>
              <div className="sig-sub">Print Name &amp; Date</div>
              <div className="sig-name">{w.customer_name || NBSP}</div>
            </div>
          </div>

          {/* FOOTER */}
          <div className="w-footer">
            <div className="footer-main">
              <div className="seal"><svg viewBox="0 0 24 24"><path d="M15.5 2.1a6 6 0 0 0-7.4 7.4L2.1 15.5a2.1 2.1 0 0 0 3 3l6-5.9a6 6 0 0 0 7.4-7.4l-3.2 3.2-2.1-.7-.7-2.1 2.9-3.4z"/></svg></div>
              <span className="fthanks">Dallas Tub Fix · Thank You For Your Business</span>
              <div className="seal"><svg viewBox="0 0 24 24"><path d="M15.5 2.1a6 6 0 0 0-7.4 7.4L2.1 15.5a2.1 2.1 0 0 0 3 3l6-5.9a6 6 0 0 0 7.4-7.4l-3.2 3.2-2.1-.7-.7-2.1 2.9-3.4z"/></svg></div>
            </div>
            <div className="fcontact">(469) 592-0018 · dallastubfix.com · Serving the Greater DFW Area</div>
          </div>

        </div>
      </div>
    </div>
  )
}
