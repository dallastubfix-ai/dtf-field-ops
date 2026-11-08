import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { normalize as normalizeWarrantyYears, warrantyExpiry, isNewWarranty } from '../lib/warranty'
import { supabase } from '../lib/supabase'
import db from '../lib/db'
import Button from '../components/ui/Button'
import PageHeader from '../components/layout/PageHeader'
import { SkeletonGroup, SkeletonHeader, SkeletonCard } from '../components/ui/Skeleton'
import LegacyWarrantyPrint from '../components/warranty/LegacyWarrantyPrint'
import WarrantyPrintV2 from '../components/warranty/WarrantyPrintV2'
import { buildWarrantyItems } from '../lib/warrantyItems'

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
    warranty_years: 2,
    fixtures: [],
  })
  const [loading, setLoading] = useState(true)
  const [isLocked, setIsLocked] = useState(false)
  const [invoiceUnconfirmed, setInvoiceUnconfirmed] = useState(false)

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
      const years = normalizeWarrantyYears(invoice?.warranty_years)
      const exp = warranty.expiry_date ?? (sd ? warrantyExpiry(sd, years) : '')

      setW({
        invoice_number: invoice?.invoice_number ?? job?.job_number ?? '',
        service_date: sd,
        expiry_date: exp,
        customer_name: customer?.full_name ?? '',
        service_address: appt?.location_address ?? customer?.address ?? '',
        technician: warranty.technician ?? 'John Figueroa Jr.',
        warranty_years: years,
        fixtures: job?.fixtures ?? [],
      })
      setInvoiceUnconfirmed(!invoice)
      setIsLocked(!!(invoice?.technician_signature_url && invoice?.customer_signature_url))
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) {
    return (
      <SkeletonGroup className="no-print min-h-screen">
        <SkeletonHeader />
        <div className="px-4 py-5 max-w-lg mx-auto">
          <SkeletonCard lines={4} />
        </div>
      </SkeletonGroup>
    )
  }

  // New warranty version: service date on or after the switch date, or any 1-year warranty.
  const showNew =
    new URLSearchParams(window.location.search).get('v') === 'new' || // TEMPORARY preview, remove in Phase 4
    isNewWarranty(w.service_date, w.warranty_years)
  const result = showNew
    ? buildWarrantyItems(w.fixtures, w.warranty_years, w.service_date, w.invoice_number)
    : null

  return (
    <div className="min-h-screen">
      {/* Header and actions — hidden on print */}
      <PageHeader
        title="Warranty Builder"
        sticky
        onBack={() => navigate(-1)}
        className="no-print"
        below={
          <div className="builder-actions">
            <Button variant="primary" onClick={() => {
              document.title = `${w.invoice_number || 'warranty'}-warranty`
              window.print()
            }}>
              Print
            </Button>
          </div>
        }
      />

      {/* Edit fields */}
      <div className="no-print px-4 py-5 space-y-4 max-w-lg mx-auto">
        {isLocked && (
          <p className="inset-box note-warn px-4 py-3">
            <AlertCircle size={16} aria-hidden="true" />
            <span>This warranty's invoice has been signed by both parties and is locked.</span>
          </p>
        )}
        {invoiceUnconfirmed && (
          <p className="inset-box note-warn px-4 py-3">
            <AlertCircle size={16} aria-hidden="true" />
            <span>The warranty length could not be confirmed from the invoice, so 2 years is shown. Check the length before printing.</span>
          </p>
        )}
        <div className="glass-card grid grid-cols-2 gap-3">
          <Field label="Invoice #"     value={w.invoice_number}  onChange={v => set('invoice_number', v)} disabled={isLocked} />
          <Field label="Service Date"  value={w.service_date}    onChange={v => {
            set('service_date', v)
            if (v) set('expiry_date', warrantyExpiry(v, w.warranty_years))
          }} type="date" disabled={isLocked} />
          <Field label="Expiry Date"   value={showNew ? result.latestExpiry : w.expiry_date} onChange={v => set('expiry_date', v)} type="date" disabled={isLocked || showNew} />
          <Field label="Technician"    value={w.technician}      onChange={v => set('technician', v)} disabled={isLocked} />
          <Field label="Customer Name" value={w.customer_name}   onChange={v => set('customer_name', v)} className="col-span-2" disabled={isLocked} />
          <Field label="Service Address" value={w.service_address} onChange={v => set('service_address', v)} className="col-span-2" disabled={isLocked} />
        </div>
        <p className="text-xs text-[var(--text-secondary)] text-center">Edit the fields above, then tap Print to save as PDF.</p>
      </div>

      {/* ── PRINT VIEW — matches dtf-warranty-builder.html ── */}
      {showNew
        ? <WarrantyPrintV2 w={w} result={result} />
        : <LegacyWarrantyPrint w={w} />}
    </div>
  )
}
