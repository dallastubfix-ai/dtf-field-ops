import { useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import Button from '../ui/Button'

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
    <div className="glass-banner glass-blur sticky top-0 z-50">
      <RefreshCw size={16} className="shrink-0 text-[var(--text-secondary)]" />
      <span className="flex-1">A new version is available</span>
      <Button className="shrink-0 min-h-[44px]" onClick={handleRefresh}>
        Refresh
      </Button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss update notification"
        className="icon-btn"
      >
        <X size={18} />
      </button>
    </div>
  )
}
