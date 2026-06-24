import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { format, addYears, parseISO } from 'date-fns'
import { supabase } from '../lib/supabase'
import db from '../lib/db'
import Button from '../components/ui/Button'

const WARRANTY_CLAUSES = [
  'This warranty covers defects in workmanship for 2 years from service date.',
  'Coverage includes labor, supplies, and return travel at no cost to customer.',
  'Warranty is void if surface is damaged by misuse, neglect, or unauthorized repair attempts after service.',
  'Warranty does not cover normal wear, discoloration from chemicals, or damage caused by others.',
  'Repaired surface must stay dry 24-48 hours. Failure may void coverage.',
  'Warranty does not extend to plumbing, electrical, or structural work. Dallas Tub Fix is not a licensed plumber.',
]

const CARE_TIPS = [
  "Use only non-abrasive cleaners (no Comet, Barkeeper's Friend, or scrub pads).",
  'Avoid standing water — dry the surface after use.',
  'Do not use suction cup mats or drain covers for at least 30 days.',
  'Keep sharp objects away from repaired area.',
  'Report any issues promptly before they worsen.',
  'For warranty service, call us first — do not hire another contractor.',
]

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

      {/* ── PRINT VIEW ── */}
      <div className="print-page hidden print:block bg-white font-sans text-[13px] text-[#1F2937]"
           style={{ fontFamily: 'Inter, sans-serif' }}>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-3xl font-black text-navy mb-1">Dallas <span className="text-gold">Tub Fix</span></div>
          <div className="inline-block bg-navy text-white px-6 py-2 rounded-full text-lg font-black tracking-widest mt-2">
            2 YEAR WARRANTY
          </div>
        </div>

        {/* Customer info */}
        <div className="grid grid-cols-2 gap-6 mb-6 border border-[#E5E7EB] rounded-xl p-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[#6B7280] mb-1">Customer</div>
            <div className="font-bold text-base">{w.customer_name}</div>
            {w.service_address && <div className="text-[#6B7280]">{w.service_address}</div>}
          </div>
          <div className="space-y-1">
            <div><span className="text-[#6B7280]">Invoice #: </span><strong>{w.invoice_number}</strong></div>
            <div><span className="text-[#6B7280]">Service Date: </span><strong>{w.service_date ? format(parseISO(w.service_date), 'MMMM d, yyyy') : '—'}</strong></div>
            <div><span className="text-[#6B7280]">Warranty Expiry: </span><strong className="text-gold">{w.expiry_date ? format(parseISO(w.expiry_date), 'MMMM d, yyyy') : '—'}</strong></div>
            <div><span className="text-[#6B7280]">Technician: </span><strong>{w.technician}</strong></div>
          </div>
        </div>

        {/* Warranty terms */}
        <div className="mb-5">
          <div className="text-xs font-black uppercase tracking-widest text-navy mb-3">WARRANTY TERMS & CONDITIONS</div>
          <ol className="space-y-2">
            {WARRANTY_CLAUSES.map((clause, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-bold text-navy shrink-0">{i + 1}.</span>
                <span>{clause}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* Care & Maintenance */}
        <div className="mb-5">
          <div className="text-xs font-black uppercase tracking-widest text-navy mb-3">CARE & MAINTENANCE</div>
          <ul className="space-y-1.5">
            {CARE_TIPS.map((tip, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-green-600 shrink-0">✓</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* How to submit a claim */}
        <div className="mb-6 bg-[#F3F4F6] rounded-xl p-4">
          <div className="text-xs font-black uppercase tracking-widest text-navy mb-2">HOW TO SUBMIT A WARRANTY CLAIM</div>
          <p>Call or text us at the number below. Describe the issue and provide your invoice number.
          We will schedule a return visit at no charge if the issue falls within warranty coverage.
          Do not hire another contractor — unauthorized repairs void this warranty.</p>
        </div>

        {/* Signatures */}
        <div className="grid grid-cols-2 gap-10 mt-8">
          <div className="border-t-2 border-[#1F2937] pt-2 text-center">
            <div className="text-xs text-[#6B7280]">Technician Signature</div>
            <div className="text-xs text-[#6B7280] mt-1">{w.technician}</div>
          </div>
          <div className="border-t-2 border-[#1F2937] pt-2 text-center">
            <div className="text-xs text-[#6B7280]">Customer Signature</div>
            <div className="text-xs text-[#6B7280] mt-1">{w.customer_name}</div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-[#E5E7EB] text-center text-[10px] text-[#9CA3AF] space-y-1">
          <div>Dallas Tub Fix · dallastubfix.com</div>
          <div className="italic">John 3:16 · Matthew 6:9–13 · Matthew 11:30 · Mark 10:45 · Luke 19:10</div>
        </div>
      </div>
    </div>
  )
}
