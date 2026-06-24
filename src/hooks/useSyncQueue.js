import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import db from '../lib/db'
import { processSyncQueue } from '../lib/sync'
import { useOnlineStatus } from './useOnlineStatus'

export function useSyncQueue() {
  const isOnline = useOnlineStatus()
  const [syncing, setSyncing] = useState(false)
  const pendingCount = useLiveQuery(() => db.sync_queue.count(), []) ?? 0

  useEffect(() => {
    if (isOnline && pendingCount > 0) {
      setSyncing(true)
      processSyncQueue().finally(() => setSyncing(false))
    }
  }, [isOnline, pendingCount])

  return { syncing, pendingCount }
}
