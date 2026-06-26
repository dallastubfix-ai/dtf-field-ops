import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer, Save, Shield } from 'lucide-react'
import { format, addYears } from 'date-fns'
import { supabase } from '../lib/supabase'
import db from '../lib/db'
import { formatEnum } from '../lib/formatEnum'
import Input from '../components/ui/Input'
import Textarea from '../components/ui/Textarea'
import Button from '../components/ui/Button'

const DEFAULT_ITEMS = [
  { description: '', notes: '', rate: '', amount: '' },
  { description: '', notes: '', rate: '', amount: '' },
  { description: '', notes: '', rate: '', amount: '' },
  { description: '', notes: '', rate: '', amount: '' },
]

const PAYMENT_METHODS = ['Cash', 'Check', 'Credit/Debit', 'Venmo', 'Zelle', 'Other']

const today = format(new Date(), 'yyyy-MM-dd')

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
    customer_address: '', customer_city: '', customer_state: 'TX', customer_zip: '',
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

  useEffect(() => {
    const load = async () => {
      if (isNew) {
        // Load job + customer data for pre-population
        const job = await db.jobs.where('id').equals(jobId).first()
          ?? (await supabase.from('jobs').select('*, customers(*), appointments(*)').eq('id', jobId).single()).data
        if (!job) return

        const customer = job.customers
          ?? (await db.customers.where('id').equals(job.customer_id).first())

        const appt = Array.isArray(job.appointments)
          ? job.appointments.sort((a,b) => new Date(b.appointment_datetime) - new Date(a.appointment_datetime))[0]
          : null

        setInv(v => ({
          ...v,
          invoice_number: job.job_number ?? '',
          service_date: appt?.appointment_datetime ? format(new Date(appt.appointment_datetime), 'yyyy-MM-dd') : '',
          customer_name:    customer?.full_name  ?? '',
          customer_phone:   customer?.phone      ?? '',
          customer_email:   customer?.email      ?? '',
          customer_address: customer?.address    ?? '',
          customer_city:    customer?.city       ?? '',
          customer_zip:     customer?.zip        ?? '',
          surface_type:     job.surface_type     ?? '',
          surface_color:    job.surface_color    ?? '',
          job_id: jobId,
        }))
      } else if (id) {
        const existing = await db.invoices.where('id').equals(id).first()
          ?? (await supabase.from('invoices').select('*').eq('id', id).single()).data
        if (existing) {
          setInv({ ...inv, ...existing, line_items: existing.line_items ?? DEFAULT_ITEMS })
          setSaved(true)
          const warr = await db.warranties.where('invoice_id').equals(id).first()
          setExistingWarranty(warr)
        }
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
    const methods = inv.payment_methods.includes(method)
      ? inv.payment_methods.filter(m => m !== method)
      : [...inv.payment_methods, method]
    set('payment_methods', methods)
  }

  const save = async () => {
    setSaving(true)
    const payload = {
      ...inv,
      total_amount: total,
      subtotal,
      tax_amount: tax,
      updated_at: new Date().toISOString(),
    }
    if (!saved) {
      payload.id = crypto.randomUUID()
      payload.created_at = new Date().toISOString()
      await db.invoices.add({ ...payload, _synced: false })
      const { data } = await supabase.from('invoices').insert(payload).select().single()
      if (data) { await db.invoices.put({ ...data, _synced: true }); payload.id = data.id }

      // Auto-create warranty record if included
      if (inv.warranty_included && inv.service_date) {
        const wPayload = {
          id: crypto.randomUUID(),
          invoice_id: payload.id,
          job_id: inv.job_id,
          service_date: inv.service_date,
          expiry_date: format(addYears(new Date(inv.service_date), 2), 'yyyy-MM-dd'),
          technician: inv.technician,
          created_at: new Date().toISOString(),
        }
        await db.warranties.add({ ...wPayload, _synced: false })
        await supabase.from('warranties').insert(wPayload)
        setExistingWarranty(wPayload)
      }
      setSaved(true)
      setInv(v => ({ ...v, id: payload.id }))
    } else {
      await db.invoices.where('id').equals(inv.id).modify(payload)
      await supabase.from('invoices').update(payload).eq('id', inv.id)
    }
    setSaving(false)
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
          <Button variant="gold" className="py-1.5 px-3" onClick={print}>
            <Printer size={14} /> Print
          </Button>
        </div>
      </header>

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
            <Field label="City"       value={inv.customer_city}    onChange={v => set('customer_city', v)} />
            <Field label="Zip"        value={inv.customer_zip}     onChange={v => set('customer_zip', v)} />
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
                className={`px-3 py-1.5 rounded-full text-sm border transition-all ${inv.payment_methods.includes(m) ? 'bg-navy text-white border-navy' : 'border-[#E5E7EB] text-[#6B7280]'}`}>
                {m}
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

      {/* ── PRINT VIEW ── */}
      <div className="print-page hidden print:block bg-white font-sans text-sm text-[#1F2937]"
           style={{ fontFamily: 'Inter, sans-serif' }}>
        <div className="flex justify-between items-start mb-6">
          <div>
            <div className="text-2xl font-black text-navy">Dallas <span className="text-gold">Tub Fix</span></div>
            <div className="text-xs text-[#6B7280] mt-1">DTF Field Ops · Field Operations</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-navy">INVOICE</div>
            <div className="text-sm font-semibold">#{inv.invoice_number}</div>
            <div className="text-xs text-[#6B7280]">Date: {inv.invoice_date}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 mb-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[#6B7280] mb-1">Bill To</div>
            <div className="font-bold">{inv.customer_name}</div>
            <div>{inv.customer_phone}</div>
            <div>{inv.customer_email}</div>
            <div>{inv.customer_address}</div>
            <div>{[inv.customer_city, inv.customer_state, inv.customer_zip].filter(Boolean).join(', ')}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-[#6B7280] mb-1">Service Info</div>
            <div>Date: <strong>{inv.service_date}</strong></div>
            <div>Tech: <strong>{inv.technician}</strong></div>
            <div>Surface: <strong>{formatEnum(inv.surface_type)}</strong></div>
            {inv.surface_color && <div>Color: <strong>{inv.surface_color}</strong></div>}
          </div>
        </div>

        <table className="w-full mb-4" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr className="bg-navy text-white text-xs">
              <th className="text-left px-3 py-2">Description</th>
              <th className="text-left px-3 py-2">Notes</th>
              <th className="text-right px-3 py-2">Rate</th>
              <th className="text-right px-3 py-2">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.line_items.filter(i => i.description || i.amount).map((item, idx) => (
              <tr key={idx} className={idx % 2 === 0 ? 'bg-[#F3F4F6]' : 'bg-white'}>
                <td className="px-3 py-2">{item.description}</td>
                <td className="px-3 py-2 text-[#6B7280]">{item.notes}</td>
                <td className="px-3 py-2 text-right">{item.rate ? `$${item.rate}` : ''}</td>
                <td className="px-3 py-2 text-right">{item.amount ? `$${parseFloat(item.amount).toFixed(2)}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mb-6">
          <div className="w-56 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-[#6B7280]">Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
            {discount > 0 && <div className="flex justify-between"><span className="text-[#6B7280]">Discount</span><span>-${discount.toFixed(2)}</span></div>}
            {taxRate > 0 && <div className="flex justify-between"><span className="text-[#6B7280]">Tax ({taxRate}%)</span><span>${tax.toFixed(2)}</span></div>}
            <div className="flex justify-between font-bold text-navy text-base border-t border-[#E5E7EB] pt-1">
              <span>TOTAL</span><span>${total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {inv.payment_methods.length > 0 && (
          <div className="mb-4 text-sm"><strong>Payment accepted: </strong>{inv.payment_methods.join(', ')}</div>
        )}

        {(inv.notes1 || inv.notes2 || inv.notes3) && (
          <div className="mb-4 text-xs text-[#6B7280] border-t border-[#E5E7EB] pt-3 space-y-0.5">
            {[inv.notes1, inv.notes2, inv.notes3].filter(Boolean).map((n, i) => <div key={i}>{n}</div>)}
          </div>
        )}

        <div className="border-t border-[#E5E7EB] pt-3 text-sm">
          <strong>Warranty: </strong>
          {inv.warranty_included
            ? '✓ 2-Year Workmanship Warranty Included'
            : `Not included${inv.warranty_no_reason ? ` — ${inv.warranty_no_reason}` : ''}`}
        </div>

        <div className="grid grid-cols-2 gap-8 mt-10">
          <div className="border-t-2 border-[#1F2937] pt-2 text-xs text-center text-[#6B7280]">Technician Signature</div>
          <div className="border-t-2 border-[#1F2937] pt-2 text-xs text-center text-[#6B7280]">Customer Signature</div>
        </div>
      </div>
    </div>
  )
}
