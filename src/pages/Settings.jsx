import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, LogOut, Info, Trash2, Home } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { format } from 'date-fns'
import { useAuth } from '../context/AuthContext'
import { ensurePushRegistration, getPushStatus, subscribePushStatus } from '../lib/push'
import { supabase } from '../lib/supabase'
import db from '../lib/db'
import Button from '../components/ui/Button'
import AddressAutocomplete from '../components/ui/AddressAutocomplete'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { loadHomeAddress, saveHomeAddress } from '../lib/appSettings'

export default function Settings() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [push, setPush] = useState(getPushStatus())
  const [testStatus, setTestStatus] = useState(null)
  const isOnline = useOnlineStatus()
  const [homeAddress, setHomeAddress] = useState('')
  const [savedAddress, setSavedAddress] = useState('')
  const [homeSaving, setHomeSaving] = useState(false)
  const [homeStatus, setHomeStatus] = useState(null)
  const homeEdited = useRef(false)
  const homeStatusTimer = useRef(null)

  // Load on open, and again if connectivity changes. Never overwrites text
  // the user has started editing.
  useEffect(() => {
    let cancelled = false
    loadHomeAddress(isOnline).then(row => {
      if (cancelled || !row?.home_address) return
      setSavedAddress(row.home_address)
      if (!homeEdited.current) setHomeAddress(row.home_address)
    })
    return () => { cancelled = true }
  }, [isOnline])

  useEffect(() => () => clearTimeout(homeStatusTimer.current), [])

  const handleHomeChange = (value) => {
    homeEdited.current = true
    setHomeAddress(value)
    setHomeStatus(null)
  }

  const handleSaveHome = async () => {
    setHomeSaving(true)
    setHomeStatus(null)
    try {
      const result = await saveHomeAddress(homeAddress)
      if (result.ok) {
        const trimmed = homeAddress.trim()
        setSavedAddress(trimmed)
        setHomeAddress(trimmed)
        homeEdited.current = false
        setHomeStatus({ ok: true, text: 'Saved' })
        clearTimeout(homeStatusTimer.current)
        homeStatusTimer.current = setTimeout(() => setHomeStatus(null), 2500)
      } else {
        setHomeStatus({ ok: false, text: result.message })
      }
    } catch {
      setHomeStatus({ ok: false, text: 'Your home address could not be saved. Please try again.' })
    } finally {
      setHomeSaving(false)
    }
  }

  const homeUnchanged = homeAddress.trim() === savedAddress

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

  const sendTestNotification = async (delaySeconds = 0) => {
    try {
      setTestStatus({ ok: true, text: 'Sending...' })
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setTestStatus({ ok: false, text: 'You are signed out. Sign in again, then send the test.' })
        return
      }
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-notification`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            title: 'DTF Field Ops',
            body: 'Push notifications are working!',
            url: '/',
            tag: 'dtf-test',
            ttl_seconds: 60,
            delay_seconds: delaySeconds,
          })
        }
      )
      if (res.status === 401) {
        setTestStatus({ ok: false, text: 'Your sign-in has expired. Close and reopen the app, then try again.' })
        return
      }
      if (!res.ok) {
        setTestStatus({ ok: false, text: 'The test could not be sent. Please try again in a minute.' })
        return
      }
      const data = await res.json()
      if (data.scheduled) {
        setTestStatus({ ok: true, text: `Test scheduled for ${data.devices} device(s). It arrives in about ${data.delay_seconds} seconds - lock the phone or switch apps now.` })
      } else if (data.sent > 0) {
        setTestStatus({ ok: true, text: `Sent to ${data.sent} device(s)` })
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
            <>
              <Button className="w-full mt-3" onClick={() => sendTestNotification()}>
                Send Test Notification
              </Button>
              <Button variant="secondary" className="w-full mt-2" onClick={() => sendTestNotification(15)}>
                Send test in 15 seconds
              </Button>
            </>
          )}
          {testStatus && (
            <p className={`text-xs mt-2 ${testStatus.ok ? 'text-green-600' : 'text-red-500'}`}>
              {testStatus.text}
            </p>
          )}
        </div>

        {/* Home Base Address */}
        <div className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-4">
          <div className="flex items-center gap-3 mb-3">
            <Home size={18} className="text-navy" />
            <h2 className="font-semibold text-[#1F2937]">Home Base Address</h2>
          </div>
          <p className="text-sm text-[#6B7280] mb-3">
            Used as the start and end point for automatic mileage tracking.
          </p>
          <AddressAutocomplete
            id="home-base-address"
            value={homeAddress}
            onChange={handleHomeChange}
            placeholder="Start typing your address"
          />
          <Button
            className="w-full mt-3"
            onClick={handleSaveHome}
            disabled={homeSaving || !homeAddress.trim() || homeUnchanged || !isOnline}
          >
            {homeSaving ? 'Saving…' : 'Save Address'}
          </Button>
          {!isOnline && (
            <p className="text-xs mt-2 text-red-500">Connect to the internet to save your home address.</p>
          )}
          {isOnline && homeStatus && (
            <p className={`text-xs mt-2 ${homeStatus.ok ? 'text-green-600' : 'text-red-500'}`}>
              {homeStatus.text}
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
