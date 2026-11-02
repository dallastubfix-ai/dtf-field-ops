import { useRef, useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Camera, Check, Image, X, Upload } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import db from '../lib/db'
import { getValidProviderToken } from '../lib/googleToken'
import heic2any from 'heic2any'
import PageHeader from '../components/layout/PageHeader'
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

  const job = useLiveQuery(() => db.jobs.get({ id }), [id])
  const userHasToggled = useRef(false)

  const [imageType, setImageType] = useState('before')
  const [captured, setCaptured] = useState([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState({})
  const [coords, setCoords] = useState(null)
  const [toast, setToast] = useState(null) // { text, kind }

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      pos => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {}
    )
  }, [id])

  useEffect(() => {
    if (job && !userHasToggled.current) {
      setImageType(
        job.status === 'active' || job.status === 'completed' ? 'after' : 'before'
      )
    }
  }, [job])

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

    const providerToken = await getValidProviderToken()
    if (!providerToken) {
      setToast({ text: 'Google Drive not connected — please try again', kind: 'error' })
      setUploading(false)
      return
    }

    // Ensure this job has a Drive subfolder; create one if it doesn't exist yet.
    let folderId = job?.drive_folder_id
    if (!folderId) {
      try {
        const topFolderId = import.meta.env.VITE_GOOGLE_DRIVE_PHOTOS_FOLDER_ID
        const folderMeta = {
          name: job?.job_number ?? id,
          mimeType: 'application/vnd.google-apps.folder',
          ...(topFolderId ? { parents: [topFolderId] } : {}),
        }
        const folderRes = await fetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${providerToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(folderMeta),
        })
        if (!folderRes.ok) {
          const errBody = await folderRes.text()
          throw new Error(`Folder creation failed: ${folderRes.status} - ${errBody.slice(0, 150)}`)
        }
        const { id: newFolderId } = await folderRes.json()
        folderId = newFolderId
        await supabase.from('jobs').update({ drive_folder_id: folderId }).eq('id', id)
        await db.jobs.where('id').equals(id).modify({ drive_folder_id: folderId })
      } catch (err) {
        console.error('Drive folder creation error:', err)
        setToast({ text: 'Could not create Drive folder — please try again', kind: 'error' })
        setUploading(false)
        return
      }
    }

    const ts = format(new Date(), "yyyy-MM-dd'T'HH-mm-ss")
    let failed = 0
    const pending = captured.filter(i => progress[i.id] !== 'done')
    for (const item of pending) {
      setProgress(p => ({ ...p, [item.id]: 'uploading' }))
      try {
        const file = await toUploadableJpeg(item.file)
        const filename = `${job?.job_number ?? id}-${item.type.toUpperCase()}-${ts}-${item.id.slice(0, 8)}.jpg`

        const driveMeta = {
          name: filename,
          mimeType: file.type || 'image/jpeg',
          parents: [folderId],
        }
        const form = new FormData()
        form.append('metadata', new Blob([JSON.stringify(driveMeta)], { type: 'application/json' }))
        form.append('file', file)

        const uploadRes = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${providerToken}` },
            body: form,
          }
        )
        if (!uploadRes.ok) {
          const errBody = await uploadRes.text()
          console.error('Drive upload error:', errBody)
          setProgress(p => ({ ...p, [item.id]: 'error' }))
          failed++
          continue
        }
        const { id: driveFileId } = await uploadRes.json()

        const record = {
          id: crypto.randomUUID(),
          job_id: id,
          storage_path: null,
          google_drive_file_id: driveFileId,
          filename,
          image_type: item.type,
          latitude: coords?.lat ?? null,
          longitude: coords?.lng ?? null,
          captured_at: new Date().toISOString(),
        }
        const { error: insertError } = await supabase.from('images').insert(record)
        if (insertError) {
          console.error('images insert error:', insertError)
          setProgress(p => ({ ...p, [item.id]: 'error' }))
          failed++
          continue
        }
        await db.images.add({ ...record, _synced: true })
        setProgress(p => ({ ...p, [item.id]: 'done' }))
      } catch (err) {
        console.error('Unexpected upload error:', err)
        setProgress(p => ({ ...p, [item.id]: 'error' }))
        failed++
        continue
      }
    }
    setUploading(false)
    const ok = pending.length - failed
    if (failed > 0) {
      setToast({ text: `${ok} uploaded · ${failed} failed — please try again`, kind: 'error' })
      return
    }
    setToast({ text: `${ok} photo${ok > 1 ? 's' : ''} uploaded!`, kind: 'success' })
    setTimeout(() => navigate(`/jobs/${id}`, { replace: true }), 900)
  }

  return (
    <div className="min-h-screen">
      <PageHeader
        title={`Add Photos ${job?.job_number ? `— ${job.job_number}` : ''}`}
        sticky
        onBack={() => navigate(-1)}
      />

      {toast && (
        <div className={`ui-toast ui-toast--${toast.kind}`}>
          {toast.text}
        </div>
      )}

      <div className="px-4 py-5 space-y-5 max-w-lg mx-auto">
        {/* Before / After toggle */}
        <div className="theme-segmented" role="group" aria-label="Photo type">
          <button
            type="button"
            className="theme-segment"
            aria-pressed={imageType === 'before'}
            onClick={() => { userHasToggled.current = true; setImageType('before') }}
          >
            BEFORE
          </button>
          <button
            type="button"
            className="theme-segment"
            aria-pressed={imageType === 'after'}
            onClick={() => { userHasToggled.current = true; setImageType('after') }}
          >
            AFTER
          </button>
        </div>

        {/* Capture buttons */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="glass-row home-quick flex-1"
          >
            <span className="home-quick-icon"><Camera size={22} /></span>
            <span className="home-quick-label">Take Photo</span>
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="glass-row home-quick flex-1"
          >
            <span className="home-quick-icon"><Image size={22} /></span>
            <span className="home-quick-label">Choose File</span>
          </button>
        </div>

        <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={e => addFiles(e.target.files)} />
        <input ref={fileRef}   type="file" accept="image/*"                        multiple hidden onChange={e => addFiles(e.target.files)} />

        {/* Captured thumbnails */}
        {captured.length > 0 && (
          <div>
            <h2 className="ui-field-label mb-2">
              This Session ({captured.length})
            </h2>
            <div className="grid grid-cols-3 gap-2">
              {captured.map(item => (
                <div key={item.id} className="photo-tile">
                  <img src={item.preview} alt="" className="w-full h-full object-cover" />
                  <span className="photo-pill">
                    {item.type.toUpperCase()}
                  </span>
                  {progress[item.id] === 'done' && (
                    <div className="photo-done">
                      <span className="photo-done-dot"><Check size={18} strokeWidth={3} /></span>
                    </div>
                  )}
                  {!uploading && (
                    <button
                      type="button"
                      onClick={() => remove(item.id)}
                      aria-label="Remove photo"
                      className="photo-remove"
                    >
                      <span className="photo-remove-dot"><X size={14} /></span>
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
