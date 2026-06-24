import { WifiOff } from 'lucide-react'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'

export default function OfflineBanner() {
  const isOnline = useOnlineStatus()
  if (isOnline) return null

  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-amber-50 border-b border-amber-200 px-4 h-9 text-amber-800 text-xs font-medium">
      <WifiOff size={14} />
      Working offline — changes will sync when connected
    </div>
  )
}
