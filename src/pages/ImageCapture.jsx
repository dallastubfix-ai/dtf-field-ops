import { useRef, useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, Image, X, Upload } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import db from '../lib/db'
import heic2any from 'heic2any'
import Button from '../components/ui/Button'

// iPhones / some Androids deliver image/heic which browsers can't render.
// Convert to JPEG with heic2any; on any failure fall back to the original
// file so the upload still goes through.
async function toUploadableJpeg(file) {
  if (!file.type.includes('heic') && !file.type.includes('heif')) {
    return file
  }
  try {
    const result = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.85,
    })
    // heic2any returns a Blob (or an array of Blobs for multi-image HEICs)
    const jpegBlob = Array.isArray(result) ? result[0] : result
    const jpegFile = new File(
      [jpegBlob],
      file.name.replace(/\.(heic|heif)$/i, '.jpg'),
      { type: 'image/jpeg' }
    )
    return jpegFile
  } catch (err) {
    console.error('HEIC conversion failed, uploading original:', err)
    return file
  }
}

export default function ImageCapture() {
  const { id } = useParams()
  const navigate = useNavigate()
  const cameraRef = useRef()
  const fileRef = useRef()

  const [imageType, setImageType] = useState('before')
  const [captured, setCaptured] = useState([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState({})
  const [coords, setCoords] = useState(null)
  const [job, setJob] = useState(null)
  const [toast, setToast] = useState('')

  useEffect(() => {
    db.jobs.where('id').equals(id).first().then(setJob)
    navigator.geolocation?.getCurrentPosition(
      pos => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {}
    )
  }, [id])

  const addFiles = (files) => {
    const newItems = Array.from(files).map(file => ({
      file,
      type: imageType,
      preview: URL.createObjectURL(file),
      id: crypto.randomUUID(),
    }))
    setCaptured(c => [...c, ...newItems])
  }

  const remove = (itemId) => {
    setCaptured(c => {
      const item = c.find(i => i.id === itemId)
      if (item) URL.revokeObjectURL(item.preview)
      return c.filter(i => i.id !== itemId)
    })
  }

  const upload = async () => {
    if (captured.length === 0) return
    setUploading(true)
    const ts = format(new Date(), "yyyy-MM-dd'T'HH-mm-ss")

    let failed = 0
    // On a retry, skip photos that already uploaded successfully
    const pending = captured.filter(i => progress[i.id] !== 'done')

    for (const item of pending) {
      setProgress(p => ({ ...p, [item.id]: 'uploading' }))

      // HEIC/HEIF → JPEG (best-effort) before upload
      const file = await toUploadableJpeg(item.file)
      const filename = `${job?.job_number ?? id}-${item.type.toUpperCase()}-${ts}.jpg`
      const storagePath = `${id}/${filename}`

      const { error: uploadError } = await supabase.storage
        .from('job-images')
        .upload(storagePath, file, { contentType: file.type || 'image/jpeg', upsert: false })

      if (uploadError) {
        console.error('Storage upload error:', uploadError)
        setProgress(p => ({ ...p, [item.id]: 'error' }))
        failed++
        continue
      }

      const record = {
        id: crypto.randomUUID(),
        job_id: id,
        storage_path: storagePath,
        filename,
        image_type: item.type,
        latitude: coords?.lat ?? null,
        longitude: coords?.lng ?? null,
        captured_at: new Date().toISOString(),
      }

      // The images-table row is what makes the photo show up in JobDetail.
      // If this insert fails the upload is effectively lost, so surface it.
      const { error: insertError } = await supabase.from('images').insert(record)
      if (insertError) {
        console.error('images insert error:', insertError)
        setProgress(p => ({ ...p, [item.id]: 'error' }))
        failed++
        continue
      }

      await db.images.add({ ...record, _synced: true })
      setProgress(p => ({ ...p, [item.id]: 'done' }))
    }

    setUploading(false)

    const ok = pending.length - failed
    if (failed > 0) {
      setToast(`${ok} uploaded · ${failed} failed — check connection`)
      return
    }
    setToast(`${ok} photo${ok > 1 ? 's' : ''} uploaded!`)
    setTimeout(() => navigate(`/jobs/${id}`, { replace: true }), 900)
  }

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <header className="bg-navy px-4 py-4 flex items-center gap-3 sticky top-0 z-30">
        <button onClick={() => navigate(-1)} className="text-white"><ArrowLeft size={20} /></button>
        <h1 className="text-white font-bold text-base flex-1">
          Add Photos {job?.job_number ? `— ${job.job_number}` : ''}
        </h1>
      </header>

      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      <div className="px-4 py-5 space-y-5 max-w-lg mx-auto">
        {/* Before / After toggle */}
        <div className="flex gap-2">
          <button
            onClick={() => setImageType('before')}
            className={`flex-1 py-3 rounded-xl font-semibold text-sm transition-all ${
              imageType === 'before'
                ? 'bg-green-500 text-white shadow-sm'
                : 'bg-white border border-[#E5E7EB] text-[#6B7280]'
            }`}
          >
            BEFORE
          </button>
          <button
            onClick={() => setImageType('after')}
            className={`flex-1 py-3 rounded-xl font-semibold text-sm transition-all ${
              imageType === 'after'
                ? 'bg-gold text-white shadow-sm'
                : 'bg-white border border-[#E5E7EB] text-[#6B7280]'
            }`}
          >
            AFTER
          </button>
        </div>

        {/* Capture buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => cameraRef.current?.click()}
            className="flex-1 bg-white border border-[#E5E7EB] rounded-xl py-6 flex flex-col items-center gap-2 shadow-sm hover:bg-blue-50 transition-colors"
          >
            <Camera size={28} className="text-navy" />
            <span className="text-sm font-medium text-[#1F2937]">Take Photo</span>
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex-1 bg-white border border-[#E5E7EB] rounded-xl py-6 flex flex-col items-center gap-2 shadow-sm hover:bg-blue-50 transition-colors"
          >
            <Image size={28} className="text-navy" />
            <span className="text-sm font-medium text-[#1F2937]">Choose File</span>
          </button>
        </div>

        <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={e => addFiles(e.target.files)} />
        <input ref={fileRef}   type="file" accept="image/*"                        multiple hidden onChange={e => addFiles(e.target.files)} />

        {/* Captured thumbnails */}
        {captured.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6B7280] mb-2">
              This Session ({captured.length})
            </h2>
            <div className="grid grid-cols-3 gap-2">
              {captured.map(item => (
                <div key={item.id} className="relative rounded-xl overflow-hidden aspect-square bg-[#F3F4F6]">
                  <img src={item.preview} alt="" className="w-full h-full object-cover" />
                  <span className={`absolute top-1 left-1 text-xs font-bold px-1 py-0.5 rounded ${item.type === 'before' ? 'bg-green-500 text-white' : 'bg-gold text-white'}`}>
                    {item.type.toUpperCase()}
                  </span>
                  {progress[item.id] === 'done' && (
                    <div className="absolute inset-0 bg-green-500/40 flex items-center justify-center">
                      <span className="text-white font-bold text-xs">✓</span>
                    </div>
                  )}
                  {!uploading && (
                    <button
                      onClick={() => remove(item.id)}
                      className="absolute top-1 right-1 w-5 h-5 bg-black/50 rounded-full flex items-center justify-center"
                    >
                      <X size={10} className="text-white" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {captured.length > 0 && (
          <Button
            variant="primary"
            className="w-full py-3"
            onClick={upload}
            disabled={uploading}
          >
            <Upload size={16} />
            {uploading ? 'Uploading…' : `Upload ${captured.length} Photo${captured.length > 1 ? 's' : ''}`}
          </Button>
        )}
      </div>
    </div>
  )
}
