import interSemiBoldUrl from '@fontsource/inter/files/inter-latin-600-normal.woff2?url'

// Full-size output in pixels. Everything is drawn in these units and scaled
// with a canvas transform, so the preview and the later export match exactly.
export const SHORT_SIDE = 1440
export const LONG_SIDE = 2560
const BORDER = 14

export const LABEL_FAMILY = 'DTF Collage Label'
export const DEFAULT_LABEL_POSITION = 8 // 3x3 grid, row-major: 8 = bottom-right

const MAX_DECODE_LONG_SIDE = 1500

const LABEL_SIZE = SHORT_SIDE * 0.042
const LABEL_TRACKING = 0.2 // em
const LABEL_INSET_X = 0.075 // of cell width
const LABEL_INSET_Y = 0.085 // of cell height

const MARK_TEXT = 'Dallas Tub Fix'
const MARK_SIZE = SHORT_SIDE * 0.024
const MARK_PAD_X = 0.7 // em
const MARK_PAD_Y = 0.45 // em
const MARK_INSET = 0.045 // of cell width / height

// ---------- font ----------

let fontPromise = null

// Registers the bundled Inter 600 under its own family name so it can't clash
// with the Inter the app loads from Google. Rejects if the font isn't usable.
export function loadLabelFont() {
  if (!fontPromise) {
    fontPromise = (async () => {
      const face = new FontFace(LABEL_FAMILY, `url("${interSemiBoldUrl}")`, {
        weight: '600',
        style: 'normal',
      })
      await face.load()
      document.fonts.add(face)
      // check() alone is true when no face matches, so also require 'loaded'.
      if (face.status !== 'loaded' || !document.fonts.check(`600 20px "${LABEL_FAMILY}"`)) {
        throw new Error('label font not ready')
      }
    })().catch((err) => {
      fontPromise = null // allow a retry the next time the maker opens
      throw err
    })
  }
  return fontPromise
}

export function supportsBrightness() {
  return typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype
}

// ---------- decoding ----------

function probeSize(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const size = { w: img.naturalWidth, h: img.naturalHeight }
      img.src = ''
      resolve(size)
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

// Decodes a blob: URL into an ImageBitmap no larger than needed (about 1500px
// on the long side). The caller owns the bitmap and must close() it.
export async function decodePhoto(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('photo not readable')
  const blob = await res.blob()
  const size = await probeSize(url)

  const options = { resizeQuality: 'high' }
  if (!size || !size.w || !size.h) {
    options.resizeWidth = MAX_DECODE_LONG_SIDE
  } else {
    const longSide = Math.max(size.w, size.h)
    if (longSide > MAX_DECODE_LONG_SIDE) {
      options.resizeWidth = Math.round((size.w * MAX_DECODE_LONG_SIDE) / longSide)
    }
  }
  return createImageBitmap(blob, options)
}

// ---------- layout ----------

function getLayout(layout) {
  if (layout === 'side') {
    const w = (LONG_SIDE - 3 * BORDER) / 2
    const h = SHORT_SIDE - 2 * BORDER
    return {
      width: LONG_SIDE,
      height: SHORT_SIDE,
      before: { x: BORDER, y: BORDER, w, h },
      after: { x: 2 * BORDER + w, y: BORDER, w, h },
    }
  }
  const w = SHORT_SIDE - 2 * BORDER
  const h = (LONG_SIDE - 3 * BORDER) / 2
  return {
    width: SHORT_SIDE,
    height: LONG_SIDE,
    before: { x: BORDER, y: BORDER, w, h },
    after: { x: BORDER, y: 2 * BORDER + h, w, h },
  }
}

// ---------- drawing ----------

function drawPhoto(ctx, bitmap, cell, brightness) {
  if (!bitmap) {
    ctx.fillStyle = '#E5E7EB'
    ctx.fillRect(cell.x, cell.y, cell.w, cell.h)
    return
  }
  // Cover: scale to fill the cell, crop the overflow evenly (centered).
  const fit = Math.max(cell.w / bitmap.width, cell.h / bitmap.height)
  const sw = cell.w / fit
  const sh = cell.h / fit
  ctx.save()
  ctx.imageSmoothingQuality = 'high'
  if (brightness !== 1) ctx.filter = `brightness(${brightness})`
  ctx.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, cell.x, cell.y, cell.w, cell.h)
  ctx.restore() // also resets the filter before any text is drawn
}

// Letter-spaced text, one character at a time. The total width leaves out the
// gap after the last letter, so right-aligned text lines up with its inset.
function drawTracked(ctx, text, x, baseline, align, trackPx) {
  const chars = [...text]
  const widths = chars.map((c) => ctx.measureText(c).width)
  const total = widths.reduce((a, b) => a + b, 0) + trackPx * (chars.length - 1)
  let cx = align === 'left' ? x : align === 'right' ? x - total : x - total / 2
  const left = cx
  chars.forEach((c, i) => {
    ctx.fillText(c, cx, baseline)
    cx += widths[i] + trackPx
  })
  return { left, width: total }
}

function drawLabel(ctx, text, cell, position) {
  ctx.font = `600 ${LABEL_SIZE}px "${LABEL_FAMILY}"`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const capHeight = ctx.measureText('H').actualBoundingBoxAscent
  const trackPx = LABEL_SIZE * LABEL_TRACKING
  const col = position % 3
  const row = Math.floor(position / 3)
  const insetX = cell.w * LABEL_INSET_X
  const insetY = cell.h * LABEL_INSET_Y

  const align = ['left', 'center', 'right'][col]
  const x = [cell.x + insetX, cell.x + cell.w / 2, cell.x + cell.w - insetX][col]
  const baseline = [
    cell.y + insetY + capHeight,
    cell.y + cell.h / 2 + capHeight / 2,
    cell.y + cell.h - insetY,
  ][row]

  const { left, width } = drawTracked(ctx, text, x, baseline, align, trackPx)
  return { x: left, y: baseline - capHeight, w: width, h: capHeight }
}

const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

function drawMark(ctx, cell, labelBox, labelColumn) {
  ctx.font = `600 ${MARK_SIZE}px "${LABEL_FAMILY}"`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const m = ctx.measureText(MARK_TEXT)
  const padX = MARK_SIZE * MARK_PAD_X
  const padY = MARK_SIZE * MARK_PAD_Y
  const w = m.width + 2 * padX
  const h = MARK_SIZE + 2 * padY
  const y = cell.y + cell.h - cell.h * MARK_INSET - h
  const leftX = cell.x + cell.w * MARK_INSET
  const rightX = cell.x + cell.w - cell.w * MARK_INSET - w

  // Bottom-left, unless the After label is in the left column.
  let x = labelColumn === 0 ? rightX : leftX
  if (overlaps({ x, y, w, h }, labelBox)) x = x === leftX ? rightX : leftX

  const r = h / 2
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2)
  ctx.lineTo(x + r, y + h)
  ctx.arc(x + r, y + r, r, Math.PI / 2, (Math.PI * 3) / 2)
  ctx.closePath()
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)'
  ctx.fill()

  ctx.fillStyle = '#1E40AF'
  const baseline = y + h / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2
  ctx.fillText(MARK_TEXT, x + padX, baseline)
}

// before / after: { bitmap, brightness (0.5-1.5), labelPosition (0-8) }
// scale: 1 = full size (1440x2560 or 2560x1440). The preview passes a smaller
// scale; the later export passes 1. Throws if the canvas can't be drawn.
export function renderCollage(canvas, { layout, before, after, labelColor }, scale = 1) {
  const spec = getLayout(layout)
  const width = Math.round(spec.width * scale)
  const height = Math.round(spec.height * scale)
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, spec.width, spec.height)

  drawPhoto(ctx, before.bitmap, spec.before, before.brightness)
  drawPhoto(ctx, after.bitmap, spec.after, after.brightness)

  ctx.fillStyle = labelColor
  drawLabel(ctx, 'BEFORE', spec.before, before.labelPosition)
  const afterBox = drawLabel(ctx, 'AFTER', spec.after, after.labelPosition)

  drawMark(ctx, spec.after, afterBox, after.labelPosition % 3)
}
