import { useRef, useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Circle, Square, RefreshCw, Upload } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import db from '../lib/db'
import Button from '../components/ui/Button'

function useTimer(running) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!running) { setElapsed(0); return }
    const id = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(id)
  }, [running])
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export default function VideoCapture() {
  const { id } = useParams()
  const navigate = useNavigate()
  const videoRef = useRef()
  const recorderRef = useRef()
  const chunksRef = useRef([])
  const streamRef = useRef()

  const [videoType, setVideoType] = useState('before')
  const [recording, setRecording] = useState(false)
  const [blob, setBlob] = useState(null)
  const [blobUrl, setBlobUrl] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [toast, setToast] = useState('')
  const [noProvider, setNoProvider] = useState(false)
  const [job, setJob] = useState(null)

  const timer = useTimer(recording)

  useEffect(() => {
    db.jobs.where('id').equals(id).first().then(setJob)
    startPreview()
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()) }
  }, [id])

  const startPreview = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: true
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.muted = true
      }
    } catch (err) {
      console.error('Camera access denied:', err)
    }
  }

  const startRecording = () => {
    if (!streamRef.current) return
    chunksRef.current = []
    const rec = new MediaRecorder(streamRef.current, { mimeType: 'video/webm;codecs=vp9,opus' })
    rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    rec.onstop = () => {
      const b = new Blob(chunksRef.current, { type: 'video/webm' })
      setBlob(b)
      setBlobUrl(URL.createObjectURL(b))
    }
    rec.start(250)
    recorderRef.current = rec
    setRecording(true)
  }

  const stopRecording = () => {
    recorderRef.current?.stop()
    setRecording(false)
  }

  const reRecord = () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl)
    setBlob(null)
    setBlobUrl(null)
  }

  const uploadToDrive = async () => {
    if (!blob) return
    setUploading(true)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.provider_token) {
      setNoProvider(true)
      setUploading(false)
      return
    }

    const ts = format(new Date(), "yyyy-MM-dd'T'HH-mm-ss")
    const filename = `${job?.job_number ?? id}-${videoType.toUpperCase()}-${ts}.mp4`

    const meta = { name: filename, mimeType: 'video/mp4' }
    const form = new FormData()
    form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }))
    form.append('file', blob)

    try {
      const res = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.provider_token}` },
          body: form,
        }
      )
      if (!res.ok) throw new Error(`Drive error ${res.status}`)
      const { id: fileId, webViewLink } = await res.json()

      const record = {
        id: crypto.randomUUID(),
        job_id: id,
        video_type: videoType,
        google_drive_file_id: fileId,
        google_drive_view_url: webViewLink,
        filename,
        created_at: new Date().toISOString(),
      }
      await supabase.from('videos').insert(record)
      await db.videos.add({ ...record, _synced: true })

      setToast('Video uploaded to Google Drive!')
      setTimeout(() => navigate(`/jobs/${id}`, { replace: true }), 900)
    } catch (err) {
      console.error('Drive upload error:', err)
      setToast('Upload failed. Check console.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <header className="bg-navy px-4 py-4 flex items-center gap-3 z-30">
        <button onClick={() => navigate(-1)} className="text-white"><ArrowLeft size={20} /></button>
        <h1 className="text-white font-bold text-base flex-1">
          Record Video {job?.job_number ? `— ${job.job_number}` : ''}
        </h1>
      </header>

      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      {noProvider && (
        <div className="mx-4 mt-4 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          Google Drive not connected yet. Complete Google OAuth setup to enable video upload.
        </div>
      )}

      {/* Before / After toggle */}
      <div className="flex gap-2 px-4 py-3">
        {['before', 'after'].map(t => (
          <button
            key={t}
            onClick={() => setVideoType(t)}
            className={`flex-1 py-2 rounded-lg font-semibold text-sm transition-all ${
              videoType === t
                ? t === 'before' ? 'bg-green-500 text-white' : 'bg-gold text-white'
                : 'bg-white/10 text-white/60'
            }`}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Camera preview or playback */}
      <div className="flex-1 flex items-center justify-center">
        {blob ? (
          <video src={blobUrl} controls className="max-h-[60vh] w-full object-contain" />
        ) : (
          <video ref={videoRef} autoPlay playsInline className="max-h-[60vh] w-full object-contain" />
        )}
      </div>

      {/* Controls */}
      <div className="px-4 py-6 flex flex-col items-center gap-4">
        {recording && (
          <div className="text-red-400 font-mono text-lg font-bold">{timer}</div>
        )}

        {!blob ? (
          <button
            onClick={recording ? stopRecording : startRecording}
            className={`w-20 h-20 rounded-full flex items-center justify-center shadow-lg transition-all ${
              recording
                ? 'bg-red-500 animate-pulse'
                : 'bg-white'
            }`}
          >
            {recording
              ? <Square size={28} className="text-white" />
              : <Circle size={36} className="text-red-500 fill-red-500" />
            }
          </button>
        ) : (
          <div className="flex gap-3 w-full">
            <Button variant="secondary" className="flex-1 text-white border-white/30 hover:bg-white/10" onClick={reRecord}>
              <RefreshCw size={16} /> Re-record
            </Button>
            <Button variant="gold" className="flex-1" onClick={uploadToDrive} disabled={uploading}>
              <Upload size={16} />
              {uploading ? 'Uploading…' : 'Upload to Drive'}
            </Button>
          </div>
        )}
        <p className="text-white/40 text-xs">
          {recording ? 'Tap to stop recording' : blob ? '' : 'Tap to start recording'}
        </p>
      </div>
    </div>
  )
}
