import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Share2, X } from 'lucide-react'
import Button from '../ui/Button'
import Card from '../ui/Card'
import {
  DEFAULT_LABEL_POSITION, LONG_SIDE, decodePhoto, exportCollage, loadLabelFont, renderCollage, supportsBrightness,
} from '../../lib/collageRender'

const PREVIEW_SCALE = 800 / LONG_SIDE // preview is about 800px on its long side
const DEFAULT_CUSTOM_COLOR = '#1E40AF'
const PRERENDER_DELAY_MS = 600
const BRIGHTNESS_SUPPORTED = supportsBrightness()
const ROWS = ['top', 'middle', 'bottom']
const COLS = ['left', 'center', 'right']

const isBlobUrl = (u) => typeof u === 'string' && u.startsWith('blob:')
const orderFirst = (photos, type) => [
  ...photos.filter((p) => p.type === type),
  ...photos.filter((p) => p.type !== type),
]

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

// Decodes one photo into an ImageBitmap held in a ref (so a redraw never sees a
// closed bitmap). The previous bitmap stays on screen until the new one is ready.
function useDecodedPhoto(url) {
  const bitmapRef = useRef(null)
  const [state, setState] = useState({ status: 'idle', version: 0 })

  useEffect(() => {
    if (!url) return
    let cancelled = false
    setState((s) => ({ ...s, status: 'loading' }))
    decodePhoto(url)
      .then((bitmap) => {
        if (cancelled) { bitmap.close(); return }
        const old = bitmapRef.current
        bitmapRef.current = bitmap
        old?.close()
        setState((s) => ({ status: 'ready', version: s.version + 1 }))
      })
      .catch(() => {
        if (cancelled) return
        const old = bitmapRef.current
        bitmapRef.current = null
        old?.close()
        setState((s) => ({ status: 'error', version: s.version + 1 }))
      })
    return () => { cancelled = true }
  }, [url])

  useEffect(() => () => {
    bitmapRef.current?.close()
    bitmapRef.current = null
  }, [])

  return { bitmapRef, status: state.status, version: state.version }
}

function Panel({ title, children }) {
  return (
    <Card className="space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-dtf-sub">{title}</h2>
      {children}
    </Card>
  )
}

function PhotoPicker({ photos, selectedKey, onSelect }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {photos.map((p) =>
        p.usable ? (
          <button
            key={p.key}
            onClick={() => onSelect(p.key)}
            aria-label={`Use this ${p.type} photo`}
            className={`relative w-[72px] h-[72px] shrink-0 rounded-lg overflow-hidden border-2 ${
              p.key === selectedKey ? 'border-navy' : 'border-transparent'
            }`}
          >
            <img src={p.url} alt="" decoding="async" loading="lazy" className="w-full h-full object-cover" />
            <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] font-semibold text-center uppercase">
              {p.type}
            </span>
          </button>
        ) : (
          <div
            key={p.key}
            className="w-[72px] h-[72px] shrink-0 rounded-lg bg-dtf-border flex items-center justify-center text-[10px] text-dtf-sub text-center px-1"
          >
            Not loaded
          </div>
        )
      )}
    </div>
  )
}

function LabelGrid({ value, onChange, name }) {
  return (
    <div>
      <div className="text-sm text-dtf-text mb-2">Label position</div>
      <div className="grid grid-cols-3 gap-1.5 w-[168px]">
        {Array.from({ length: 9 }, (_, i) => (
          <button
            key={i}
            onClick={() => onChange(i)}
            aria-label={`${name} label ${ROWS[Math.floor(i / 3)]} ${COLS[i % 3]}`}
            aria-pressed={value === i}
            className={`h-12 rounded-lg border flex items-center justify-center ${
              value === i ? 'bg-navy border-navy' : 'bg-white border-dtf-border'
            }`}
          >
            {value === i && <span className="w-2.5 h-2.5 rounded-full bg-white" />}
          </button>
        ))}
      </div>
    </div>
  )
}

function Brightness({ value, onChange }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm text-dtf-text">
        <span>Brightness</span>
        <span className="font-semibold">{value}%</span>
      </div>
      <input
        type="range"
        min={50}
        max={150}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={!BRIGHTNESS_SUPPORTED}
        className="w-full h-10 accent-navy"
        aria-label="Brightness"
      />
    </div>
  )
}

function Message({ children, onClose }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-4">
      <p className="text-sm text-dtf-text">{children}</p>
      <Button className="min-h-[44px]" onClick={onClose}>Close</Button>
    </div>
  )
}

export default function CollageMaker({ images, signedUrls, onClose }) {
  const canvasRef = useRef(null)
  const rafRef = useRef(0)
  const pushedRef = useRef(false)
  const genRef = useRef(0) // bumps on every change; stale exports are discarded
  const prerenderRef = useRef(0)
  const exportFileRef = useRef(null) // the one cached export, never more than one
  const exportChainRef = useRef(Promise.resolve()) // keeps exports one at a time

  const [fontStatus, setFontStatus] = useState('loading')
  const [renderError, setRenderError] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareNote, setShareNote] = useState(null) // { kind: 'info' | 'ok' | 'error', text }

  const [layout, setLayout] = useState('stacked')
  const [beforeKey, setBeforeKey] = useState(null)
  const [afterKey, setAfterKey] = useState(null)
  const [beforeBright, setBeforeBright] = useState(100)
  const [afterBright, setAfterBright] = useState(100)
  const [beforePos, setBeforePos] = useState(DEFAULT_LABEL_POSITION)
  const [afterPos, setAfterPos] = useState(DEFAULT_LABEL_POSITION)
  const [colorMode, setColorMode] = useState('black')
  const [customColor, setCustomColor] = useState(DEFAULT_CUSTOM_COLOR)
  const labelColor = colorMode === 'black' ? '#000000' : colorMode === 'white' ? '#FFFFFF' : customColor

  // Android back button: one history entry while open; popstate closes.
  useEffect(() => {
    if (!pushedRef.current) {
      window.history.pushState({ ...(window.history.state ?? {}), dtfCollage: true }, '')
      pushedRef.current = true
    }
    const onPop = () => onClose()
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const close = () => {
    if (window.history.state?.dtfCollage) window.history.back()
    else onClose()
  }

  useEffect(() => {
    let cancelled = false
    loadLabelFont()
      .then(() => { if (!cancelled) setFontStatus('ready') })
      .catch(() => { if (!cancelled) setFontStatus('error') })
    return () => { cancelled = true }
  }, [])

  // Only before/after photos; unloaded ones stay in the list as placeholders.
  const photos = useMemo(
    () => (images ?? [])
      .filter((i) => i.image_type === 'before' || i.image_type === 'after')
      .map((i) => {
        const key = i.id || i._localId
        const url = signedUrls?.[key]
        return { key, type: i.image_type, url, usable: isBlobUrl(url) }
      }),
    [images, signedUrls]
  )
  const usable = photos.filter((p) => p.usable)
  const enough = usable.length >= 2
  const beforeList = useMemo(() => orderFirst(photos, 'before'), [photos])
  const afterList = useMemo(() => orderFirst(photos, 'after'), [photos])

  const beforePhoto = usable.find((p) => p.key === beforeKey) ?? beforeList.find((p) => p.usable)
  const afterPhoto =
    usable.find((p) => p.key === afterKey) ??
    afterList.find((p) => p.usable && p.key !== beforePhoto?.key) ??
    afterList.find((p) => p.usable)

  const before = useDecodedPhoto(beforePhoto?.url)
  const after = useDecodedPhoto(afterPhoto?.url)

  // Redraw on any change; rAF coalesces rapid slider movement into one draw per frame.
  useEffect(() => {
    if (fontStatus !== 'ready' || !enough || !canvasRef.current) return
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      try {
        renderCollage(
          canvasRef.current,
          {
            layout,
            before: { bitmap: before.bitmapRef.current, brightness: beforeBright / 100, labelPosition: beforePos },
            after: { bitmap: after.bitmapRef.current, brightness: afterBright / 100, labelPosition: afterPos },
            labelColor,
          },
          PREVIEW_SCALE
        )
        setRenderError(false)
      } catch {
        setRenderError(true)
      }
    })
    return () => cancelAnimationFrame(rafRef.current)
  }, [fontStatus, enough, layout, before.version, after.version, beforeBright, afterBright, beforePos, afterPos, labelColor])

  const busy = before.status === 'loading' || after.status === 'loading'

  const photosReady = before.status === 'ready' && after.status === 'ready'
  let shareReason = ''
  if (fontStatus === 'error') shareReason = "The label font didn't load."
  else if (!enough) shareReason = 'Needs a before and an after photo.'
  else if (fontStatus !== 'ready') shareReason = 'Getting the label font ready…'
  else if (before.status === 'error' || after.status === 'error') shareReason = "A photo couldn't be opened. Pick a different one."
  else if (!photosReady) shareReason = 'Photos are still loading…'
  else if (renderError) shareReason = "The preview couldn't be drawn. Try different photos."
  const canExport = !shareReason

  const buildExportState = () => ({
    layout,
    before: { bitmap: before.bitmapRef.current, brightness: beforeBright / 100, labelPosition: beforePos },
    after: { bitmap: after.bitmapRef.current, brightness: afterBright / 100, labelPosition: afterPos },
    labelColor,
  })

  // One full-size render at a time. Returns null if settings changed meanwhile.
  const runExport = (gen) => {
    const run = exportChainRef.current.then(async () => {
      if (gen !== genRef.current) return null
      const state = buildExportState()
      if (!state.before.bitmap || !state.after.bitmap) return null
      const file = await exportCollage(state)
      if (gen !== genRef.current) return null
      exportFileRef.current = file
      return file
    })
    exportChainRef.current = run.catch(() => {})
    return run
  }

  // Any change drops the cached file; then, 600ms after the last change, render the next one.
  useEffect(() => {
    genRef.current += 1
    exportFileRef.current = null
    setShareNote(null)
    clearTimeout(prerenderRef.current)
    if (!canExport) return
    const gen = genRef.current
    prerenderRef.current = setTimeout(() => { runExport(gen).catch(() => {}) }, PRERENDER_DELAY_MS)
    return () => clearTimeout(prerenderRef.current)
  }, [canExport, layout, before.version, after.version, beforeBright, afterBright, beforePos, afterPos, labelColor])

  // On close: cancel pending work and drop the cached file.
  useEffect(() => () => {
    genRef.current += 1
    clearTimeout(prerenderRef.current)
    exportFileRef.current = null
  }, [])

  const handleShare = async () => {
    if (sharing || !canExport) return
    setSharing(true)
    setShareNote(null)
    clearTimeout(prerenderRef.current)
    try {
      // Use the ready file at once; if it isn't ready yet, render it now.
      const file = exportFileRef.current ?? (await runExport(genRef.current))
      if (!file) return // settings changed while rendering; the next tap will use the new file

      const canShareFiles =
        typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] })

      if (!canShareFiles) {
        downloadFile(file)
        setShareNote({ kind: 'ok', text: "Saved to your phone's downloads." })
        return
      }
      try {
        await navigator.share({ files: [file] }) // files only: no text or title
      } catch (err) {
        if (err?.name === 'AbortError') return // John closed the share menu
        if (err?.name === 'NotAllowedError') {
          setShareNote({ kind: 'info', text: 'Collage is ready. Tap Share again.' }) // file stays cached
          return
        }
        setShareNote({ kind: 'error', text: "Couldn't open the share menu. Please try again." })
      }
    } catch {
      setShareNote({ kind: 'error', text: "Couldn't create the collage image. Please try again." })
    } finally {
      setSharing(false)
    }
  }

  let body
  if (fontStatus === 'error') {
    body = <Message onClose={close}>Label font didn't load. Close and reopen the collage maker.</Message>
  } else if (!enough) {
    body = (
      <Message onClose={close}>
        A collage needs at least two photos (a before and an after) that have finished loading.
        Add photos or wait a moment, then try again.
      </Message>
    )
  } else if (fontStatus === 'loading') {
    body = (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 animate-spin rounded-full border-2 border-dtf-border border-t-navy" />
      </div>
    )
  } else {
    body = (
      <>
        <div className="relative h-[46dvh] shrink-0 bg-dtf-border flex items-center justify-center p-2">
          <canvas ref={canvasRef} className="bg-white shadow rounded-sm" style={{ maxWidth: '100%', maxHeight: '100%' }} />
          {busy && (
            <span className="absolute top-2 left-2 text-xs bg-black/60 text-white px-2 py-1 rounded">Preparing photos…</span>
          )}
          {renderError && (
            <span className="absolute bottom-2 inset-x-2 text-xs text-center bg-red-600 text-white px-2 py-1 rounded">
              The preview couldn't be drawn. Try picking different photos.
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-4 pb-4">
          <Panel title="Layout">
            <div className="flex gap-2">
              {[['stacked', 'Stacked'], ['side', 'Side by side']].map(([value, label]) => (
                <Button
                  key={value}
                  variant={layout === value ? 'primary' : 'secondary'}
                  className="flex-1 min-h-[44px]"
                  aria-pressed={layout === value}
                  onClick={() => setLayout(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </Panel>

          <Panel title="Before photo">
            <PhotoPicker photos={beforeList} selectedKey={beforePhoto?.key} onSelect={setBeforeKey} />
            {before.status === 'error' && (
              <p className="text-xs text-red-600">That photo couldn't be opened. Pick a different one.</p>
            )}
            <Brightness value={beforeBright} onChange={setBeforeBright} />
            <LabelGrid value={beforePos} onChange={setBeforePos} name="Before" />
          </Panel>

          <Panel title="After photo">
            <PhotoPicker photos={afterList} selectedKey={afterPhoto?.key} onSelect={setAfterKey} />
            {after.status === 'error' && (
              <p className="text-xs text-red-600">That photo couldn't be opened. Pick a different one.</p>
            )}
            <Brightness value={afterBright} onChange={setAfterBright} />
            <LabelGrid value={afterPos} onChange={setAfterPos} name="After" />
          </Panel>

          <Panel title="Label color">
            <div className="flex gap-2">
              <button
                onClick={() => setColorMode('black')}
                aria-pressed={colorMode === 'black'}
                className={`flex-1 min-h-[44px] rounded-lg border flex items-center justify-center gap-2 text-sm font-semibold ${
                  colorMode === 'black' ? 'border-navy ring-2 ring-navy' : 'border-dtf-border'
                }`}
              >
                <span className="w-5 h-5 rounded-full bg-black" /> Black
              </button>
              <button
                onClick={() => setColorMode('white')}
                aria-pressed={colorMode === 'white'}
                className={`flex-1 min-h-[44px] rounded-lg border flex items-center justify-center gap-2 text-sm font-semibold ${
                  colorMode === 'white' ? 'border-navy ring-2 ring-navy' : 'border-dtf-border'
                }`}
              >
                <span className="w-5 h-5 rounded-full bg-white border border-dtf-sub" /> White
              </button>
              <label
                className={`relative flex-1 min-h-[44px] rounded-lg border flex items-center justify-center gap-2 text-sm font-semibold ${
                  colorMode === 'custom' ? 'border-navy ring-2 ring-navy' : 'border-dtf-border'
                }`}
              >
                <span className="w-5 h-5 rounded-full border border-dtf-sub" style={{ backgroundColor: customColor }} /> Custom
                <input
                  type="color"
                  value={customColor}
                  onClick={() => setColorMode('custom')}
                  onChange={(e) => { setCustomColor(e.target.value); setColorMode('custom') }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  aria-label="Custom label color"
                />
              </label>
            </div>
          </Panel>

          {!BRIGHTNESS_SUPPORTED && (
            <p className="text-xs text-dtf-sub">Brightness isn't available in this browser.</p>
          )}
        </div>
      </>
    )
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Make collage"
      className="fixed inset-0 z-[70] bg-dtf-bg flex flex-col overscroll-contain"
    >
      <header className="bg-navy px-4 py-4 flex items-center gap-3 shrink-0">
        <h1 className="text-white font-bold text-base flex-1">Make Collage</h1>
        <button
          onClick={close}
          aria-label="Close"
          className="w-11 h-11 -mr-2 flex items-center justify-center text-white"
        >
          <X size={22} />
        </button>
      </header>
      {body}
      <div className="shrink-0 bg-white border-t border-dtf-border px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        {(shareReason || shareNote) && (
          <p
            role="status"
            className={`text-xs text-center mb-2 ${
              shareReason || shareNote.kind === 'info' ? 'text-dtf-sub'
                : shareNote.kind === 'error' ? 'text-red-600' : 'text-green-600'
            }`}
          >
            {shareReason || shareNote.text}
          </p>
        )}
        <Button className="w-full min-h-[48px]" disabled={!canExport || sharing} onClick={handleShare}>
          <Share2 size={18} /> {sharing ? 'Preparing…' : 'Share'}
        </Button>
      </div>
    </div>,
    document.body
  )
}
