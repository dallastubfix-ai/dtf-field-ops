import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Send } from 'lucide-react'
import Button from '../ui/Button'
import Modal from '../ui/Modal'

const NOTE_MS = 4000
const FALLBACK_NAME = 'dallas-tub-fix-collage.jpg'

const isBlobUrl = (u) => typeof u === 'string' && u.startsWith('blob:')
const keyOf = (img) => img.id || img._localId
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Oldest saved first; rows with no usable date keep their order.
const byCaptured = (a, b) => (Date.parse(a.captured_at) || 0) - (Date.parse(b.captured_at) || 0)

// "Wide" / "Close-up" from the saved filename; the filename itself if it doesn't match.
function baseLabel(filename) {
  const m = /-before-after-(wide|close-up)(?:-\d+)?\.jpg$/i.exec(filename ?? '')
  if (m) return m[1].toLowerCase() === 'wide' ? 'Wide' : 'Close-up'
  return filename || 'Collage'
}

// Repeated labels get a number in list order: Wide, Wide 2, Wide 3.
function makeLabels(collages) {
  const seen = {}
  return collages.map((img) => {
    const base = baseLabel(img.filename)
    seen[base] = (seen[base] || 0) + 1
    return seen[base] === 1 ? base : `${base} ${seen[base]}`
  })
}

// Fallback when file sharing isn't supported: save the JPEG to the phone's downloads.
function downloadFile(file) {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000) // revoking right away can cancel the download
}

async function downloadAll(files) {
  for (let i = 0; i < files.length; i++) {
    if (i > 0) await sleep(400) // phones can drop downloads that start at the same instant
    downloadFile(files[i])
  }
}

function canShareFiles(files) {
  try {
    return typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files })
  } catch {
    return false
  }
}

// "Send Collage" for the completed-job bottom bar: re-sends saved collages through the phone's share menu.
// The Files are built from the already-loaded blob URLs as soon as they exist, so navigator.share
// runs straight inside the tap and keeps the user activation.
export default function SendCollage({ images, signedUrls }) {
  const filesRef = useRef(new Map()) // blob URL -> File
  const pendingRef = useRef(new Set())
  const busyRef = useRef(false)
  const noteTimerRef = useRef(0)
  const [, setReadyCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [unticked, setUnticked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null) // { kind: 'info' | 'ok' | 'error', text }

  const collages = useMemo(
    () => (images ?? []).filter((i) => i.image_type === 'collage').sort(byCaptured),
    [images]
  )
  const labels = useMemo(() => makeLabels(collages), [collages])

  useEffect(() => {
    collages.forEach((img) => {
      const url = signedUrls?.[keyOf(img)]
      if (!isBlobUrl(url) || filesRef.current.has(url) || pendingRef.current.has(url)) return
      pendingRef.current.add(url)
      fetch(url)
        .then((res) => res.blob())
        .then((blob) => {
          filesRef.current.set(url, new File([blob], img.filename || FALLBACK_NAME, { type: 'image/jpeg' }))
          setReadyCount((n) => n + 1)
        })
        .catch(() => {}) // stays "still loading"; the next change tries again
        .finally(() => pendingRef.current.delete(url))
    })
  }, [collages, signedUrls])

  useEffect(() => () => clearTimeout(noteTimerRef.current), [])

  const flash = (kind, text) => {
    setNote({ kind, text })
    clearTimeout(noteTimerRef.current)
    noteTimerRef.current = setTimeout(() => setNote(null), NOTE_MS)
  }

  const items = collages.map((img, i) => {
    const key = keyOf(img)
    const url = signedUrls?.[key]
    return { img, key, url, label: labels[i], file: isBlobUrl(url) ? filesRef.current.get(url) ?? null : null }
  })
  const picked = items.filter((it) => it.file && !unticked.has(it.key))

  // Not async before navigator.share: the tap's user activation must still be alive when it runs.
  const send = (chosen) => {
    if (busyRef.current) return
    const files = chosen.map((it) => it.file)
    if (!files.length || files.some((f) => !f)) {
      flash('info', 'Collage is still loading')
      return
    }
    busyRef.current = true
    setBusy(true)

    if (!canShareFiles(files)) {
      downloadAll(files)
        .then(() => { flash('ok', "Saved to your phone's downloads."); setOpen(false) })
        .finally(() => { busyRef.current = false; setBusy(false) })
      return
    }
    navigator.share({ files }) // files only: no text or title
      .then(() => setOpen(false))
      .catch((err) => {
        if (err?.name === 'AbortError') return // John closed the share menu
        if (err?.name === 'NotAllowedError') flash('info', 'Ready. Tap Send again.')
        else flash('error', "Couldn't open the share menu. Please try again.")
      })
      .finally(() => { busyRef.current = false; setBusy(false) })
  }

  const onTap = () => {
    if (items.length === 1) {
      send(items)
      return
    }
    setUnticked(new Set()) // all ticked by default
    setNote(null)
    setOpen(true)
  }

  const toggle = (key) => setUnticked((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  if (!items.length) return null

  const single = items.length === 1
  const barNote = open ? null : (note ?? (single && !items[0].file ? { kind: 'info', text: 'Collage is still loading' } : null))
  const noteClass = (n) => (n.kind === 'error' ? 'text-[var(--message-red)]' : n.kind === 'ok' ? 'text-[var(--success-tint-text)]' : 'text-[var(--text-secondary)]')

  return (
    <>
      {barNote && (
        <p role="status" className={`action-note ${noteClass(barNote)}`}>{barNote.text}</p>
      )}
      <Button
        type="button"
        variant="primary"
        className="w-full min-h-[44px]"
        disabled={busy || (single && !items[0].file)}
        onClick={onTap}
      >
        <Send size={16} /> Send Collage
      </Button>

      {createPortal(
        <Modal open={open} onClose={() => { if (!busy) setOpen(false) }} title="Send collages">
          <div className="space-y-2">
            {items.map((it) => (
              <label
                key={it.key}
                className={`inset-box flex items-center gap-3 min-h-[44px] p-2 ${it.file ? '' : 'opacity-60'}`}
              >
                <input
                  type="checkbox"
                  className="check-box"
                  checked={!!it.file && !unticked.has(it.key)}
                  disabled={!it.file || busy}
                  onChange={() => toggle(it.key)}
                />
                {isBlobUrl(it.url) ? (
                  <img src={it.url} alt="" className="w-14 h-14 rounded-md object-cover shrink-0" />
                ) : (
                  <div className="inset-box w-14 h-14 flex items-center justify-center shrink-0">
                    <div className="ui-spinner w-5 h-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-[var(--text)]">{it.label}</div>
                  {it.file ? (
                    <div className="text-xs text-[var(--text-secondary)] break-all">{it.img.filename}</div>
                  ) : (
                    <div className="text-xs text-[var(--text-secondary)]">Collage is still loading</div>
                  )}
                </div>
              </label>
            ))}
          </div>
          {note && <p role="status" className={`text-xs text-center mt-3 ${noteClass(note)}`}>{note.text}</p>}
          <div className="flex gap-2 mt-4">
            <Button type="button" variant="secondary" className="flex-1 min-h-[44px]" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" className="flex-1 min-h-[44px]" disabled={!picked.length || busy} onClick={() => send(picked)}>
              Send
            </Button>
          </div>
        </Modal>,
        document.body
      )}
    </>
  )
}
