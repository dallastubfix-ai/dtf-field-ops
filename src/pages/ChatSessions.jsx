import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageSquare } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import EmptyState from '../components/ui/EmptyState'

const intentColors = {
  booking:    'bg-green-100 text-green-700',
  query:      'bg-blue-100 text-blue-700',
  cached:     'bg-gray-100 text-gray-600',
  greeting:   'bg-gray-100 text-gray-600',
  farewell:   'bg-gray-100 text-gray-600',
  unclear:    'bg-amber-100 text-amber-700',
  escalation: 'bg-red-100 text-red-600',
  fallback:   'bg-amber-100 text-amber-700',
}

function IntentBadge({ intent }) {
  const colors = intentColors[intent] ?? 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${colors}`}>
      {intent ?? 'unknown'}
    </span>
  )
}

export default function ChatSessions() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchSessions() {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) {
        console.error(error)
        setLoading(false)
        return
      }

      const sessionMap = {}
      for (const row of data) {
        if (!sessionMap[row.session_id]) sessionMap[row.session_id] = []
        sessionMap[row.session_id].push(row)
      }

      const sessionList = Object.entries(sessionMap).map(([sid, msgs]) => {
        const sorted = [...msgs].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        return {
          session_id: sid,
          first: sorted[0],
          last: sorted[sorted.length - 1],
          count: sorted.length,
        }
      })

      sessionList.sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at))
      setSessions(sessionList)
      setLoading(false)
    }

    fetchSessions()
  }, [])

  return (
    <div className="min-h-screen bg-[#F3F4F6]">
      <header className="bg-navy px-4 py-4">
        <h1 className="text-white font-bold text-lg">Chat Sessions</h1>
      </header>

      <div className="px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <LoadingSpinner size="lg" />
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No chat sessions yet"
            subtitle="Website conversations will appear here."
          />
        ) : (
          <div className="space-y-3">
            {sessions.map(session => {
              const preview = session.first.user_message ?? ''
              return (
                <div
                  key={session.session_id}
                  onClick={() => navigate(`/chat-sessions/${session.session_id}`)}
                  className="bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-4 cursor-pointer hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-1.5">
                    <span className="text-sm font-semibold text-[#1F2937]">
                      {session.first.created_at
                        ? format(new Date(session.first.created_at), 'MMM d · h:mm a')
                        : '—'}
                    </span>
                    <span className="text-xs font-medium bg-[#F3F4F6] text-[#6B7280] px-2 py-0.5 rounded-full">
                      {session.count} {session.count === 1 ? 'message' : 'messages'}
                    </span>
                  </div>
                  <div className="mb-2">
                    <IntentBadge intent={session.last.intent} />
                  </div>
                  <p className="text-sm text-[#6B7280]">
                    {preview.length > 60 ? preview.slice(0, 60) + '…' : preview}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
