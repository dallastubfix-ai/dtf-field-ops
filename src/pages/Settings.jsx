import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, LogOut, Info, Trash2 } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import { useAuth } from '../context/AuthContext'
import { ensurePushRegistration, getPushStatus, subscribePushStatus } from '../lib/push'
import db from '../lib/db'
import Button from '../components/ui/Button'

export default function Settings() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [push, setPush] = useState(getPushStatus())
  const [testStatus, setTestStatus] = useState(null)

  useEffect(() => {
    const unsubscribe = subscribePushStatus(setPush)
    ensurePushRegistration()
    return unsubscribe
  }, [])

  const checkedLabel = push.checkedAt
    ? (Date.now() - push.checkedAt.getTime() < 60000
        ? 'checked just now'
        : `checked ${format(push.checkedAt, 'h:mm a')}`)
    : ''

  const sendTestNotification = async () => {
    try {
      setTestStatus({ ok: true, text: 'Sending...' })
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-notification`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            type: 'test',
            title: 'DTF Field Ops',
            body: 'Push notifications are working!'
          })
        }
      )
      if (!res.ok) {
        setTestStatus({ ok: false, text: 'The test could not be sent. Please try again in a minute.' })
        return
      }
      const data = await res.json()
      if (data.sent > 0) {
        setTestStatus({ ok: true, text: 'Test notification sent!' })
      } else {
        setTestStatus({ ok: false, text: "The test did not reach any phone. Rechecking this phone's registration..." })
        ensurePushRegistration()
      }
    } catch {
      setTestStatus({ ok: false, text: 'The test could not be sent. Check your connection and try again.' })
    }
  }

  const pendingCount = useLiveQuery(() => db.sync_queue.count(), []) ?? 0

  const clearSyncQueue = async () => {
    await db.sync_queue.clear()
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <header className="bg-navy px-4 py-4">
        <h1 className="text-white font-bold text-lg">Settings</h1>
      </header>

      <div className="px-4 py-5 space-y-4 max-w-lg mx-auto">

        {/* Notifications */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-4">
          <div className="flex items-center gap-3 mb-3">
            <Bell size={18} className="text-navy" />
            <h2 className="font-semibold text-[#1F2937]">Notifications</h2>
          </div>
          <p className={`text-sm ${
            push.state === 'registered' ? 'text-green-600'
              : push.state === 'checking' ? 'text-[#6B7280]'
              : 'text-red-500'
          }`}>
            {push.message}
            {push.state === 'registered' && checkedLabel && ` - ${checkedLabel}`}
          </p>
          {(push.engine === 'current' || push.engine === 'old') && (
            <p className={`text-xs mt-1 ${push.engine === 'current' ? 'text-[#6B7280]' : 'text-red-500'}`}>
              {push.engine === 'current'
                ? 'Notification engine: v2'
                : 'Notification engine: old version - close and reopen the app'}
            </p>
          )}
          {push.state === 'needs_permission' && (
            <Button className="w-full mt-3" onClick={() => ensurePushRegistration({ prompt: true })}>
              Turn on notifications
            </Button>
          )}
          {push.state === 'registered' && (
            <Button className="w-full mt-3" onClick={sendTestNotification}>
              Send Test Notification
            </Button>
          )}
          {testStatus && (
            <p className={`text-xs mt-2 ${testStatus.ok ? 'text-green-600' : 'text-red-500'}`}>
              {testStatus.text}
            </p>
          )}
        </div>

        {/* Maintenance */}
        {pendingCount > 0 && (
          <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-4">
            <div className="flex items-center gap-3 mb-3">
              <Trash2 size={18} className="text-red-400" />
              <h2 className="font-semibold text-[#1F2937]">Maintenance</h2>
            </div>
            <p className="text-sm text-[#6B7280] mb-3">{pendingCount} item(s) pending sync</p>
            <Button variant="destructive" className="w-full" onClick={clearSyncQueue}>
              Clear Sync Queue
            </Button>
          </div>
        )}

        {/* Account */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-full bg-navy flex items-center justify-center text-white font-bold text-sm">
              {user?.email?.[0]?.toUpperCase() ?? 'J'}
            </div>
            <div>
              <div className="font-semibold text-[#1F2937] text-sm">{user?.user_metadata?.full_name ?? 'John Figueroa'}</div>
              <div className="text-xs text-[#6B7280]">{user?.email}</div>
            </div>
          </div>
          <Button variant="destructive" className="w-full" onClick={handleSignOut}>
            <LogOut size={16} /> Sign Out
          </Button>
        </div>

        {/* App info */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-4">
          <div className="flex items-center gap-3 mb-1">
            <Info size={18} className="text-[#9CA3AF]" />
            <h2 className="font-semibold text-[#1F2937]">App Info</h2>
          </div>
          <div className="text-sm text-[#6B7280] space-y-0.5 pl-7">
            <div>Version 1.0.0</div>
            <div>DTF Field Ops · Dallas Tub Fix</div>
          </div>
        </div>

      </div>
    </div>
  )
}
