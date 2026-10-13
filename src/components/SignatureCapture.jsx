import { useLayoutEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import SignaturePad from './SignaturePad'

export default function SignatureCapture({ invoiceId, technicianName, customerName, onComplete, onClose, onSendToCustomer, onTechnicianSigned, sigLinkState, initialStep = 'technician', existingTechnicianUrl = null }) {
  const [step, setStep] = useState(initialStep)
  const [techDataURL, setTechDataURL] = useState(null)
  const [custName, setCustName] = useState(customerName || '')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const [savingTech, setSavingTech] = useState(false)
  const techPadRef = useRef(null)
  const custPadRef = useRef(null)
  const padBoxRef = useRef(null)
  const [padSize, setPadSize] = useState(null)

  // Measure the pad box once per step, before the pad mounts. The canvas is
  // never resized after that: resizing wipes the ink and resets the pen.
  useLayoutEffect(() => {
    const box = padBoxRef.current
    if (!box) return
    setPadSize({ step, width: box.offsetWidth, height: box.offsetHeight })
  }, [step])

  const linkReady = step === 'customer' && sigLinkState?.status === 'ready'

  const handleTechNext = () => {
    if (!techPadRef.current || techPadRef.current.isEmpty()) {
      setError('Please sign before continuing.')
      return
    }
    setTechDataURL(techPadRef.current.getDataURL())
    setError(null)
    setStep('customer')
  }

  const handleConfirm = async () => {
    if (!custPadRef.current || custPadRef.current.isEmpty()) {
      setError('Please sign before continuing.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const custDataURL = custPadRef.current.getDataURL()
      const custBlob = await (await fetch(custDataURL)).blob()
      const custPath = `signatures/${invoiceId}/customer.png`

      const { error: custUploadError } = await supabase.storage
        .from('job-images')
        .upload(custPath, custBlob, { contentType: 'image/png', upsert: true })
      if (custUploadError) throw custUploadError

      const { data: custSignedData, error: custSignError } = await supabase.storage
        .from('job-images')
        .createSignedUrl(custPath, 31536000)
      if (custSignError) throw custSignError

      let techUrl = existingTechnicianUrl
      if (!techUrl && techDataURL) {
        const techBlob = await (await fetch(techDataURL)).blob()
        const techPath = `signatures/${invoiceId}/technician.png`
        const { error: techUploadError } = await supabase.storage
          .from('job-images')
          .upload(techPath, techBlob, { contentType: 'image/png', upsert: true })
        if (techUploadError) throw techUploadError
        const { data: techSignedData, error: techSignError } = await supabase.storage
          .from('job-images')
          .createSignedUrl(techPath, 31536000)
        if (techSignError) throw techSignError
        techUrl = techSignedData.signedUrl
      }

      onComplete(techUrl, custSignedData.signedUrl)
    } catch (err) {
      console.error('Signature upload error:', err)
      setError('Upload failed. Please try again.')
      setUploading(false)
    }
  }

  const handleSendToCustomerClick = async () => {
    if (existingTechnicianUrl) {
      onSendToCustomer()
      return
    }
    if (!techDataURL) return
    setSavingTech(true)
    setError(null)
    try {
      const techBlob = await (await fetch(techDataURL)).blob()
      const techPath = `signatures/${invoiceId}/technician.png`
      const { error: upErr } = await supabase.storage
        .from('job-images')
        .upload(techPath, techBlob, { contentType: 'image/png', upsert: true })
      if (upErr) throw upErr
      const { data: signedData, error: signErr } = await supabase.storage
        .from('job-images')
        .createSignedUrl(techPath, 31536000)
      if (signErr) throw signErr
      if (onTechnicianSigned) onTechnicianSigned(signedData.signedUrl)
    } catch (err) {
      console.error('Technician signature save error:', err)
      setError('Failed to save technician signature. Please try again.')
      setSavingTech(false)
      return
    }
    setSavingTech(false)
    onSendToCustomer()
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center overflow-hidden"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div className="bg-white rounded-xl p-3"
        style={{
          width: 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 16px)',
          height: 'calc(100vw - 16px)',
          flexShrink: 0,
          transform: 'rotate(90deg)',
          transformOrigin: 'center center',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="flex items-center gap-3 h-11 shrink-0 mb-2">
          <h2 className="text-sm font-bold text-[#111827] whitespace-nowrap">
            Step {step === 'technician' ? '1' : '2'} of 2 - {step === 'technician' ? 'Technician Signature' : 'Customer Signature'}
          </h2>
          <div className="flex-1 min-w-0 text-sm font-semibold text-[#111827]">
            {step === 'technician' ? (
              <span className="block truncate">{technicianName || 'Technician'}</span>
            ) : (
              <input
                type="text"
                value={custName}
                onChange={e => setCustName(e.target.value)}
                placeholder="Customer name"
                className="border border-[#E5E7EB] rounded px-2 h-10 text-sm w-full focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
              />
            )}
          </div>
          <button onClick={onClose} className="w-11 h-11 shrink-0 flex items-center justify-center text-[#6B7280] text-2xl leading-none">×</button>
        </div>

        <div ref={padBoxRef} className="relative flex-1 min-h-0">
          {!linkReady && padSize?.step === step && (
            <SignaturePad
              key={step}
              ref={step === 'technician' ? techPadRef : custPadRef}
              width={padSize.width}
              height={padSize.height}
              rotated={true}
              className="absolute inset-0 h-full"
            />
          )}

          {linkReady && (
            <div className="absolute inset-0 overflow-auto p-4 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 flex flex-col justify-center gap-3">
              <span className="font-semibold text-sm">Link ready — send to customer:</span>
              <span className="font-mono break-all">{sigLinkState.url}</span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(sigLinkState.url)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
                className="self-start px-4 min-h-[44px] bg-[#1E40AF] text-white text-sm font-semibold rounded-lg"
              >
                {copied ? 'Copied ✓' : 'Copy Link'}
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0 mt-2">
          <p className="flex-1 min-w-0 text-red-600 text-xs">{error}</p>
          <button
            onClick={() => {
              const pad = step === 'technician' ? techPadRef : custPadRef
              pad.current?.clear()
              setError(null)
            }}
            className="px-4 min-h-[44px] text-sm font-semibold text-[#6B7280] border border-[#E5E7EB] rounded-lg whitespace-nowrap"
          >
            Clear
          </button>
          {step === 'customer' && onSendToCustomer && (
            <button
              onClick={handleSendToCustomerClick}
              disabled={savingTech || sigLinkState?.status === 'generating'}
              className="px-4 min-h-[44px] text-sm font-semibold text-[#1E40AF] border border-[#1E40AF] rounded-lg whitespace-nowrap disabled:opacity-60"
            >
              {savingTech ? 'Saving…' : sigLinkState?.status === 'generating' ? '…' : 'Send to Customer'}
            </button>
          )}
          {step === 'technician' ? (
            <button
              onClick={handleTechNext}
              className="px-5 min-h-[44px] text-sm font-bold text-white bg-[#1E40AF] rounded-lg whitespace-nowrap"
            >
              Next — Customer
            </button>
          ) : (
            <button
              onClick={handleConfirm}
              disabled={uploading}
              className="px-5 min-h-[44px] text-sm font-bold text-white bg-[#1E40AF] rounded-lg whitespace-nowrap disabled:opacity-60"
            >
              {uploading ? 'Saving…' : 'Confirm & Save'}
            </button>
          )}
        </div>

      </div>
    </div>
  )
}
