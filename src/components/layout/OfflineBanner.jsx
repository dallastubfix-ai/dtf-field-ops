import { WifiOff } from 'lucide-react'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'

export default function OfflineBanner() {
  const isOnline = useOnlineStatus()
  if (isOnline) return null

  return (
    <div className="glass-banner glass-banner--notice glass-blur sticky top-0 z-50">
      <WifiOff size={14} />
      Working offline — changes will sync when connected
    </div>
  )
}
