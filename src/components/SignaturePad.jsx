import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react'

const SignaturePad = forwardRef(function SignaturePad({ width, height, className = '', rotated = false }, ref) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)

  useImperativeHandle(ref, () => ({
    getDataURL: () => {
      const canvas = canvasRef.current
      if (!canvas) return null
      return canvas.toDataURL('image/png')
    },
    isEmpty: () => {
      const canvas = canvasRef.current
      if (!canvas) return true
      const ctx = canvas.getContext('2d')
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      return !data.some(channel => channel !== 0)
    },
    clear: () => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    }
  }))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.strokeStyle = '#111827'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [])

  const getPos = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    if (rotated) {
      const relX = clientX - rect.left
      const relY = clientY - rect.top
      return {
        x: relY * (canvas.width / rect.height),
        y: (rect.width - relX) * (canvas.height / rect.width),
      }
    }
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    }
  }

  const startDraw = (e) => {
    e.preventDefault()
    drawing.current = true
    const ctx = canvasRef.current.getContext('2d')
    const { x, y } = getPos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const draw = (e) => {
    e.preventDefault()
    if (!drawing.current) return
    const ctx = canvasRef.current.getContext('2d')
    const { x, y } = getPos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  const endDraw = (e) => {
    e.preventDefault()
    drawing.current = false
  }

  return (
    <canvas
      ref={canvasRef}
      width={width || 600}
      height={height || 200}
      className={`touch-none bg-white rounded border border-[#E5E7EB] w-full ${className}`}
      onMouseDown={startDraw}
      onMouseMove={draw}
      onMouseUp={endDraw}
      onMouseLeave={endDraw}
      onTouchStart={startDraw}
      onTouchMove={draw}
      onTouchEnd={endDraw}
    />
  )
})

export default SignaturePad
