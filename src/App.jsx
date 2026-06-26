import { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { onMessage } from 'firebase/messaging'
import { Bell, X } from 'lucide-react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { messaging } from './lib/firebase'
import AppShell from './components/layout/AppShell'
import LoadingSpinner from './components/ui/LoadingSpinner'
import ErrorBoundary from './components/ErrorBoundary'

import Login           from './pages/auth/Login'
import Home            from './pages/Home'
import Calendar        from './pages/Calendar'
import Jobs            from './pages/Jobs'
import JobDetail       from './pages/JobDetail'
import NewIntake       from './pages/NewIntake'
import ImageCapture    from './pages/ImageCapture'
import VideoCapture    from './pages/VideoCapture'
import Invoices        from './pages/Invoices'
import InvoiceBuilder  from './pages/InvoiceBuilder'
import WarrantyBuilder from './pages/WarrantyBuilder'
import More               from './pages/More'
import Settings           from './pages/Settings'
import ChatSessions       from './pages/ChatSessions'
import ChatSessionDetail  from './pages/ChatSessionDetail'

function AuthGuard({ children }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner size="lg" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return children
}

function AppRoutes() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route path="/" element={
        <AuthGuard>
          <AppShell><Home /></AppShell>
        </AuthGuard>
      } />
      <Route path="/calendar" element={
        <AuthGuard>
          <AppShell><Calendar /></AppShell>
        </AuthGuard>
      } />
      <Route path="/jobs" element={
        <AuthGuard>
          <AppShell><Jobs /></AppShell>
        </AuthGuard>
      } />
      <Route path="/jobs/:id" element={
        <AuthGuard>
          <AppShell><JobDetail /></AppShell>
        </AuthGuard>
      } />
      <Route path="/jobs/:id/images" element={
        <AuthGuard>
          <AppShell><ImageCapture /></AppShell>
        </AuthGuard>
      } />
      <Route path="/jobs/:id/video" element={
        <AuthGuard>
          <AppShell><VideoCapture /></AppShell>
        </AuthGuard>
      } />
      <Route path="/intake" element={
        <AuthGuard>
          <NewIntake />
        </AuthGuard>
      } />
      <Route path="/invoices" element={
        <AuthGuard>
          <AppShell><Invoices /></AppShell>
        </AuthGuard>
      } />
      <Route path="/invoices/:id" element={
        <AuthGuard>
          <AppShell><InvoiceBuilder /></AppShell>
        </AuthGuard>
      } />
      <Route path="/invoices/new/:jobId" element={
        <AuthGuard>
          <AppShell><InvoiceBuilder /></AppShell>
        </AuthGuard>
      } />
      <Route path="/warranties/:id" element={
        <AuthGuard>
          <AppShell><WarrantyBuilder /></AppShell>
        </AuthGuard>
      } />
      <Route path="/more" element={
        <AuthGuard>
          <AppShell><More /></AppShell>
        </AuthGuard>
      } />
      <Route path="/settings" element={
        <AuthGuard>
          <AppShell><Settings /></AppShell>
        </AuthGuard>
      } />
      <Route path="/chat-sessions" element={
        <AuthGuard>
          <AppShell><ChatSessions /></AppShell>
        </AuthGuard>
      } />
      <Route path="/chat-sessions/:id" element={
        <AuthGuard>
          <AppShell><ChatSessionDetail /></AppShell>
        </AuthGuard>
      } />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  const [foregroundNotif, setForegroundNotif] = useState(null)

  useEffect(() => {
    const unsubscribe = onMessage(messaging, (payload) => {
      const title = payload.notification?.title ?? 'DTF Field Ops'
      const body = payload.notification?.body ?? ''
      setForegroundNotif({ title, body })
      setTimeout(() => setForegroundNotif(null), 5000)
    })
    return unsubscribe
  }, [])

  return (
    <AuthProvider>
      <ErrorBoundary>
        {foregroundNotif && (
          <div className="fixed top-0 left-0 right-0 z-50 bg-[#1E40AF] text-white py-3 px-4 flex items-start gap-3">
            <Bell size={18} className="mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm">{foregroundNotif.title}</div>
              <div className="text-xs text-blue-100">{foregroundNotif.body}</div>
            </div>
            <button
              onClick={() => setForegroundNotif(null)}
              className="text-[#F59E0B] flex-shrink-0"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <AppRoutes />
      </ErrorBoundary>
    </AuthProvider>
  )
}
