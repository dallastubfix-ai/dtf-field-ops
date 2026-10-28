import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import SignaturePad from '../components/SignaturePad'
import { normalize as normalizeWarrantyYears } from '../lib/warranty'

// Same Supabase URL variable src/lib/supabase.js uses. No login is involved.
const SIGN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/customer-sign`
const REQUEST_TIMEOUT_MS = 15000
const MAX_NAME_LENGTH = 100
const NETWORK_MSG = "Couldn't connect. Check your signal and tap Try again."
const SERVER_MSG = 'Something went wrong on our end. Tap Try again, or call (469) 592-0018.'

// One call to the customer-sign function. Resolves to { status, data }; status
// is 0 when the request never completed (offline, timeout, fetch failure).
async function callCustomerSign(payload) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(SIGN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    let data = null
    try { data = await res.json() } catch { /* body was not JSON */ }
    return { status: res.status, data }
  } catch {
    return { status: 0, data: null }
  } finally {
    clearTimeout(timer)
  }
}

export default function CustomerSign() {
  const { token } = useParams()
  const [status, setStatus] = useState('loading')
  // status values: loading | ready | submitting | done | invalid | expired | used | network | server
  const [invoice, setInvoice] = useState(null)
  const [custName, setCustName] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [submitFailed, setSubmitFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const padRef = useRef(null)

  // Retry a failed page load (the signing form is not on screen yet).
  const retryLoad = () => {
    setStatus('loading')
    setAttempt(a => a + 1)
  }

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { status: code, data } = await callCustomerSign({ action: 'load', token })
      if (cancelled) return
      if (code === 200 && data?.invoice) {
        setInvoice(data.invoice)
        setCustName(data.customer_name || '')
        setStatus('ready')
      } else if (code === 404) setStatus('invalid')
      else if (code === 410) setStatus('expired')
      else if (code === 409) setStatus('used')
      else if (code === 0) setStatus('network')
      else setStatus('server')
    }
    load()
    return () => { cancelled = true }
  }, [token, attempt])

  const handleSubmit = async () => {
    if (status === 'submitting') return
    if (!padRef.current || padRef.current.isEmpty()) {
      setErrorMsg('Please sign before submitting.')
      return
    }
    const name = custName.trim()
    const nameLength = Array.from(name).length
    if (nameLength < 1 || nameLength > MAX_NAME_LENGTH) {
      setErrorMsg(`Please enter your name (1-${MAX_NAME_LENGTH} characters).`)
      return
    }
    const signature = padRef.current.getDataURL()
    setStatus('submitting')
    setErrorMsg('')
    setSubmitFailed(false)

    const { status: code } = await callCustomerSign({ action: 'submit', token, name, signature })
    // 409 means an earlier try already went through: same success screen.
    if (code === 200 || code === 409) { setStatus('done'); return }
    if (code === 404) { setStatus('invalid'); return }
    if (code === 410) { setStatus('expired'); return }
    // Network or server trouble: stay on the form so the drawn signature
    // stays on the pad, and offer Try again.
    setSubmitFailed(true)
    setErrorMsg(code === 0 ? NETWORK_MSG : SERVER_MSG)
    setStatus('ready')
  }

  if (status === 'loading') return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="w-8 h-8 animate-spin rounded-full border-2 border-[#E5E7EB] border-t-[#1E40AF]" />
    </div>
  )

  if (status === 'used') return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
      <div className="text-4xl mb-4">✓</div>
      <h1 className="text-xl font-bold text-[#111827] mb-2">Already Signed</h1>
      <p className="text-sm text-[#6B7280]">This invoice has already been signed.</p>
    </div>
  )

  if (status === 'expired') return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
      <div className="text-4xl mb-4">⏰</div>
      <h1 className="text-xl font-bold text-[#111827] mb-2">Link Expired</h1>
      <p className="text-sm text-[#6B7280]">This link has expired. Please ask your technician for a new one.</p>
    </div>
  )

  if (status === 'invalid') return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
      <div className="text-4xl mb-4">⚠️</div>
      <h1 className="text-xl font-bold text-[#111827] mb-2">Invalid Link</h1>
      <p className="text-sm text-[#6B7280]">This signing link isn't valid. Please call Dallas Tub Fix at (469) 592-0018.</p>
    </div>
  )

  if (status === 'network' || status === 'server') return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
      <div className="text-4xl mb-4">⚠️</div>
      <h1 className="text-xl font-bold text-[#111827] mb-2">
        {status === 'network' ? 'Connection Problem' : 'Something Went Wrong'}
      </h1>
      <p className="text-sm text-[#6B7280]">{status === 'network' ? NETWORK_MSG : SERVER_MSG}</p>
      <button
        onClick={retryLoad}
        className="mt-6 px-6 py-2.5 text-sm font-bold text-white bg-[#1E40AF] rounded-lg"
      >
        Try again
      </button>
    </div>
  )

  if (status === 'done') return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
      <div className="text-5xl mb-4">✅</div>
      <h1 className="text-xl font-bold text-[#111827] mb-2">Signature Received</h1>
      <p className="text-sm text-[#6B7280]">Thank you, {custName || 'Customer'}. Your signature has been saved.</p>
      <p className="text-xs text-[#9CA3AF] mt-4">Dallas Tub Fix · dallastubfix.com</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#F3F4F6] flex flex-col">
      <header className="bg-[#1E40AF] px-4 py-4">
        <div className="text-white font-bold text-lg">Dallas Tub Fix</div>
        <div className="text-blue-200 text-xs">Customer Signature Request</div>
      </header>

      <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
        <h2 className="text-base font-bold text-[#111827] mb-1">Please sign below</h2>
        <p className="text-sm text-[#6B7280] mb-3">
          By signing, you confirm the work has been completed and accepted.
        </p>

        {invoice && (() => {
          const inv = invoice
          const lineItems = (inv.line_items || []).filter(i => i.description && i.amount)
          const hasDiscount = parseFloat(inv.discount) > 0
          const warrantyYears = normalizeWarrantyYears(inv.warranty_years)
          return (
            <div className="bg-[#F3F4F6] rounded-xl p-4 mb-4 space-y-3">
              <div className="text-xs font-bold uppercase tracking-wide text-[#1E40AF] mb-1">Invoice Summary</div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">Invoice #</div>
                  <div className="font-medium text-[#111827]">{inv.invoice_number || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">Service Date</div>
                  <div className="font-medium text-[#111827]">{inv.service_date || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">Surface Type</div>
                  <div className="font-medium text-[#111827]">{inv.surface_type || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">Surface Color</div>
                  <div className="font-medium text-[#111827]">{inv.surface_color || '—'}</div>
                </div>
              </div>

              {lineItems.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280] mb-1">Services</div>
                  {lineItems.map((item, i) => (
                    <div key={i} className="flex justify-between text-sm py-1 border-b border-[#E5E7EB] last:border-0">
                      <span className="text-[#111827]">{item.description}</span>
                      <span className="font-semibold text-[#111827]">${parseFloat(item.amount).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-1 pt-1">
                {hasDiscount && (
                  <div className="flex justify-between text-sm">
                    <span className="text-[#6B7280]">Discount</span>
                    <span className="text-[#111827]">−${parseFloat(inv.discount).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold">
                  <span className="text-[#111827]">Total Due</span>
                  <span className="text-[#1E40AF]">${parseFloat(inv.total || 0).toFixed(2)}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <div className={`w-2 h-2 rounded-full ${inv.warranty_included ? 'bg-green-500' : 'bg-gray-300'}`} />
                <span className="text-xs font-semibold text-[#6B7280]">
                  {inv.warranty_included ? `${warrantyYears}-Year Warranty Included` : `Warranty Not Applicable (${warrantyYears}-Year)`}
                </span>
              </div>
            </div>
          )
        })()}

        <div className="mb-4">
          <label className="text-xs font-semibold uppercase tracking-wide text-[#6B7280] block mb-1">
            Your Name
          </label>
          <input
            type="text"
            value={custName}
            onChange={e => setCustName(e.target.value)}
            placeholder="Full name"
            className="border border-[#E5E7EB] rounded-lg px-3 py-2.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
          />
        </div>

        <SignaturePad
          ref={padRef}
          width={600}
          height={220}
          className="mb-2"
        />

        {errorMsg && <p className="text-red-600 text-xs mb-2">{errorMsg}</p>}

        <div className="flex gap-3 mt-3">
          <button
            onClick={() => { padRef.current?.clear(); setErrorMsg(''); setSubmitFailed(false) }}
            className="flex-1 py-2.5 text-sm font-semibold text-[#6B7280] border border-[#E5E7EB] rounded-lg"
          >
            Clear
          </button>
          <button
            onClick={handleSubmit}
            disabled={status === 'submitting'}
            className="flex-2 flex-grow py-2.5 text-sm font-bold text-white bg-[#1E40AF] rounded-lg disabled:opacity-60"
          >
            {status === 'submitting' ? 'Saving…' : submitFailed ? 'Try again' : 'Submit Signature'}
          </button>
        </div>
      </div>
    </div>
  )
}
