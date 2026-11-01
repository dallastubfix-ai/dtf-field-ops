import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function Modal({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center">
      <div className="ui-modal-scrim absolute inset-0" onClick={onClose} />
      <div className="ui-modal-panel relative w-full lg:max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h2 className="ui-modal-title">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="ui-modal-close">
            <X size={20} />
          </button>
        </div>
        <div className="ui-modal-body overflow-y-auto flex-1">
          {children}
        </div>
      </div>
    </div>
  )
}
