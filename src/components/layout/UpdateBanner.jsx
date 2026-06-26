import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'

/**
 * Gentle, dismissible prompt shown when a new app build has been downloaded
 * and is waiting to activate. Tapping "Refresh" activates the waiting service
 * worker and reloads onto the new version. Nothing reloads automatically, so a
 * deploy never interrupts data entry (e.g. mid-intake).
 *
 * Wiring (src/main.jsx): registerSW's onNeedRefresh sets window.__updateAvailable
 * and calls window.__needsRefresh; the Refresh button calls window.__updateSW(true).
 */
export default function UpdateBanner() {
  const [show, setShow] = useState(
    () => !!window.__updateAvailable && !window.__updateDismissed
  )

  useEffect(() => {
    window.__needsRefresh = () => {
      if (!window.__updateDismissed) setShow(true)
    }
    // Catch an update flagged before this banner mounted — e.g. it fired while
    // the user was on the intake/login screens, which render without AppShell.
    if (window.__updateAvailable && !window.__updateDismissed) setShow(true)
    return () => { window.__needsRefresh = undefined }
  }, [])

  if (!show) return null

  const handleRefresh = () => {
    window.__updateSW?.(true) // activate the waiting SW + reload onto the new build
  }

  const handleDismiss = () => {
    window.__updateDismissed = true
    setShow(false)
  }

  return (
    <div className="sticky top-0 z-50 flex items-center gap-3 bg-navy px-4 py-2.5 text-white shadow-md">
      <RefreshCw size={16} className="shrink-0 text-gold" />
      <span className="flex-1 text-sm font-medium">A new version is available</span>
      <button
        onClick={handleRefresh}
        className="shrink-0 rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-amber-500 active:scale-95"
      >
        Refresh
      </button>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss update notification"
        className="shrink-0 text-blue-200 transition-colors hover:text-white"
      >
        <X size={18} />
      </button>
    </div>
  )
}
