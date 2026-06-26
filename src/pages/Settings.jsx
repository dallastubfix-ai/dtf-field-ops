import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, LogOut, Info, Trash2 } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getToken } from 'firebase/messaging'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { messaging } from '../lib/firebase'
import db from '../lib/db'
import Button from '../components/ui/Button'

export default function Settings() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)
  const [pushStatus, setPushStatus] = useState('')

  const togglePush = async () => {
    if (pushEnabled) { setPushEnabled(false); return }
    if (!('Notification' in window)) { setPushStatus('Notifications not supported in this browser.'); return }

    setPushLoading(true)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setPushStatus('Permission denied.'); return }

      const token = await getToken(messaging, {
        vapidKey: import.meta.env.VITE_VAPID_PUBLIC_KEY,
      })

      if (!token) { setPushStatus('Failed to get FCM token.'); return }

      const { error } = await supabase.from('push_subscriptions').upsert({
        endpoint: token,
        p256dh:   'fcm',
        auth_key: 'fcm',
      }, { onConflict: 'endpoint' })

      if (error) throw error

      setPushEnabled(true)
      setPushStatus('Push notifications enabled!')
      localStorage.setItem('pushEnabled', 'true')
    } catch (err) {
      console.error('Push setup error:', err)
      setPushStatus('Error: ' + err.message)
    } finally {
      setPushLoading(false)
    }
  }

  const sendTestNotification = async () => {
    try {
      setPushStatus('Sending...')
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
      const data = await res.json()
      if (data.sent > 0) {
        setPushStatus('Test notification sent!')
      } else {
        setPushStatus(`Test failed: sent=${data.sent} failed=${data.failed}`)
      }
    } catch (err) {
      setPushStatus('Test failed: ' + err.message)
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
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-[#1F2937]">Enable Push Notifications</span>
            <div
              onClick={togglePush}
              className={`w-10 h-6 rounded-full transition-colors flex items-center px-1 ${pushEnabled ? 'bg-navy' : 'bg-gray-300'}`}
            >
              <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${pushEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
          </label>
          {pushLoading && <p className="text-xs text-[#6B7280] mt-2">Setting up…</p>}
          {pushStatus && (
            <p className={`text-xs mt-2 ${pushStatus.includes('enabled') || pushStatus.includes('sent') ? 'text-green-600' : 'text-red-500'}`}>
              {pushStatus}
            </p>
          )}
          {pushEnabled && (
            <Button className="w-full mt-3" onClick={sendTestNotification}>
              Send Test Notification
            </Button>
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
