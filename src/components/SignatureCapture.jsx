import { useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import SignaturePad from './SignaturePad'

export default function SignatureCapture({ invoiceId, technicianName, customerName, onComplete, onClose, onSendToCustomer, sigLinkState }) {
  const [step, setStep] = useState('technician')
  const [techDataURL, setTechDataURL] = useState(null)
  const [custName, setCustName] = useState(customerName || '')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const techPadRef = useRef(null)
  const custPadRef = useRef(null)

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
      const toBlob = async (dataURL) => (await fetch(dataURL)).blob()
      const [techBlob, custBlob] = await Promise.all([toBlob(techDataURL), toBlob(custDataURL)])

      const techPath = `signatures/${invoiceId}/technician.png`
      const custPath = `signatures/${invoiceId}/customer.png`

      const [tu, cu] = await Promise.all([
        supabase.storage.from('job-images').upload(techPath, techBlob, { contentType: 'image/png', upsert: true }),
        supabase.storage.from('job-images').upload(custPath, custBlob, { contentType: 'image/png', upsert: true }),
      ])
      if (tu.error) throw tu.error
      if (cu.error) throw cu.error

      const [ts, cs] = await Promise.all([
        supabase.storage.from('job-images').createSignedUrl(techPath, 31536000),
        supabase.storage.from('job-images').createSignedUrl(custPath, 31536000),
      ])
      if (ts.error) throw ts.error
      if (cs.error) throw cs.error

      onComplete(ts.data.signedUrl, cs.data.signedUrl)
    } catch (err) {
      console.error('Signature upload error:', err)
      setError('Upload failed. Please try again.')
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center">
      <div className="bg-white rounded-xl p-5"
        style={{
          width: '90vh',
          maxWidth: '90vh',
          height: '90vw',
          transform: 'rotate(90deg)',
          transformOrigin: 'center center',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
              Step {step === 'technician' ? '1' : '2'} of 2
            </span>
            <h2 className="text-base font-bold text-[#111827] mt-0.5">
              {step === 'technician' ? 'Technician Signature' : 'Customer Signature'}
            </h2>
          </div>
          <button onClick={onClose} className="text-[#6B7280] text-2xl leading-none px-2">×</button>
        </div>

        <div className="text-sm font-semibold text-[#111827] mb-2">
          {step === 'technician' ? (
            <span>{technicianName || 'Technician'}</span>
          ) : (
            <input
              type="text"
              value={custName}
              onChange={e => setCustName(e.target.value)}
              placeholder="Customer name"
              className="border border-[#E5E7EB] rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-2 focus:ring-[#1E40AF]"
            />
          )}
        </div>

        {!(step === 'customer' && sigLinkState?.status === 'ready') && (
          <SignaturePad
            key={step}
            ref={step === 'technician' ? techPadRef : custPadRef}
            width={720}
            height={360}
            rotated={true}
            className="mb-2 flex-1"
          />
        )}

        {error && <p className="text-red-600 text-xs mb-2">{error}</p>}

        {step === 'customer' && sigLinkState?.status === 'ready' && (
          <div className="mb-2 flex-1 p-4 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 break-all flex flex-col justify-center gap-2">
            <span className="font-semibold text-sm">Link ready — copy and send to customer:</span>
            <span className="font-mono select-all">{sigLinkState.url}</span>
          </div>
        )}

        <div className="flex gap-3 justify-end mt-3">
          <button
            onClick={() => {
              const pad = step === 'technician' ? techPadRef : custPadRef
              pad.current?.clear()
              setError(null)
            }}
            className="px-4 py-2 text-sm font-semibold text-[#6B7280] border border-[#E5E7EB] rounded-lg"
          >
            Clear
          </button>
          {step === 'customer' && onSendToCustomer && (
            <button
              onClick={onSendToCustomer}
              disabled={sigLinkState?.status === 'generating'}
              className="px-4 py-2 text-sm font-semibold text-[#1E40AF] border border-[#1E40AF] rounded-lg disabled:opacity-60"
            >
              {sigLinkState?.status === 'generating' ? '…' : 'Send to Customer'}
            </button>
          )}
          {step === 'technician' ? (
            <button
              onClick={handleTechNext}
              className="px-5 py-2 text-sm font-bold text-white bg-[#1E40AF] rounded-lg"
            >
              Next — Customer
            </button>
          ) : (
            <button
              onClick={handleConfirm}
              disabled={uploading}
              className="px-5 py-2 text-sm font-bold text-white bg-[#1E40AF] rounded-lg disabled:opacity-60"
            >
              {uploading ? 'Saving…' : 'Confirm & Save'}
            </button>
          )}
        </div>

      </div>
    </div>
  )
}
