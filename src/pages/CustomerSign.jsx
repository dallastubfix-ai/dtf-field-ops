import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import SignaturePad from '../components/SignaturePad'

export default function CustomerSign() {
  const { token } = useParams()
  const [status, setStatus] = useState('loading')
  // status values: loading | ready | submitting | done | error | expired | used
  const [request, setRequest] = useState(null)
  const [custName, setCustName] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const padRef = useRef(null)

  useEffect(() => {
    const validate = async () => {
      try {
        const { data, error } = await supabase
          .from('signature_requests')
          .select('*')
          .eq('token', token)
          .single()

        if (error || !data) { setStatus('error'); return }
        if (data.used_at) { setStatus('used'); return }
        if (new Date(data.expires_at) < new Date()) { setStatus('expired'); return }

        setRequest(data)
        setCustName(data.customer_name || '')
        setStatus('ready')
      } catch {
        setStatus('error')
      }
    }
    validate()
  }, [token])

  const handleSubmit = async () => {
    if (!padRef.current || padRef.current.isEmpty()) {
      setErrorMsg('Please sign before submitting.')
      return
    }
    setStatus('submitting')
    setErrorMsg('')
    try {
      const dataURL = padRef.current.getDataURL()
      const blob = await (await fetch(dataURL)).blob()
      const path = `signatures/${request.invoice_id}/customer.png`

      const { error: uploadError } = await supabase.storage
        .from('job-images')
        .upload(path, blob, { contentType: 'image/png', upsert: true })
      if (uploadError) throw uploadError

      const { error: updateError } = await supabase
        .from('signature_requests')
        .update({
          used_at: new Date().toISOString(),
          customer_name: custName,
          customer_signature_path: path,
        })
        .eq('token', token)
      if (updateError) throw updateError

      setStatus('done')
    } catch (err) {
      console.error('CustomerSign submit error:', err)
      const msg = err?.message || err?.error_description || JSON.stringify(err) || 'Unknown error'
      setErrorMsg(`Error: ${msg}`)
      setStatus('ready')
    }
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
      <p className="text-sm text-[#6B7280]">This signature link has already been used.</p>
    </div>
  )

  if (status === 'expired') return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
      <div className="text-4xl mb-4">⏰</div>
      <h1 className="text-xl font-bold text-[#111827] mb-2">Link Expired</h1>
      <p className="text-sm text-[#6B7280]">This signing link has expired. Please ask your technician for a new one.</p>
    </div>
  )

  if (status === 'error') return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
      <div className="text-4xl mb-4">⚠️</div>
      <h1 className="text-xl font-bold text-[#111827] mb-2">Invalid Link</h1>
      <p className="text-sm text-[#6B7280]">This signing link is not valid. Please contact Dallas Tub Fix.</p>
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
        <p className="text-sm text-[#6B7280] mb-4">
          By signing, you confirm the work has been completed and accepted.
        </p>

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
            onClick={() => { padRef.current?.clear(); setErrorMsg('') }}
            className="flex-1 py-2.5 text-sm font-semibold text-[#6B7280] border border-[#E5E7EB] rounded-lg"
          >
            Clear
          </button>
          <button
            onClick={handleSubmit}
            disabled={status === 'submitting'}
            className="flex-2 flex-grow py-2.5 text-sm font-bold text-white bg-[#1E40AF] rounded-lg disabled:opacity-60"
          >
            {status === 'submitting' ? 'Saving…' : 'Submit Signature'}
          </button>
        </div>
      </div>
    </div>
  )
}
