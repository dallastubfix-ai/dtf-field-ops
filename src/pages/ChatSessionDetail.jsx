import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import LoadingSpinner from '../components/ui/LoadingSpinner'

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

function formatConfidence(confidence) {
  if (confidence == null) return null
  const pct = confidence > 1 ? Math.round(confidence) : Math.round(confidence * 100)
  return `${pct}%`
}

export default function ChatSessionDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef(null)

  const shortId = id ? `...${id.slice(-8)}` : ''

  useEffect(() => {
    async function fetchMessages() {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('session_id', id)
        .order('created_at', { ascending: true })

      if (error) console.error(error)
      setMessages(data ?? [])
      setLoading(false)
    }
    fetchMessages()
  }, [id])

  useEffect(() => {
    if (!loading) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [loading, messages])

  const sessionDate = messages.length > 0
    ? format(new Date(messages[0].created_at), 'MMMM d, yyyy')
    : ''

  return (
    <div className="min-h-screen bg-[#F3F4F6] flex flex-col">
      <header className="bg-navy px-4 py-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/chat-sessions')} className="text-white">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-white font-bold text-base leading-tight">
              Session {shortId}
            </h1>
            {sessionDate && (
              <p className="text-blue-200 text-xs mt-0.5">{sessionDate}</p>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 px-4 py-4 space-y-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <LoadingSpinner size="lg" />
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className="space-y-3">
              {/* User bubble — right-aligned */}
              {msg.user_message && (
                <div className="flex flex-col items-end">
                  <span className="text-xs text-[#9CA3AF] mb-1 mr-1">Customer</span>
                  <div className="bg-[#F3F4F6] rounded-xl px-4 py-3 max-w-[85%]">
                    <p className="text-sm text-[#1F2937]">{msg.user_message}</p>
                    <p className="text-xs text-[#9CA3AF] mt-1">
                      {msg.created_at ? format(new Date(msg.created_at), 'h:mm a') : ''}
                    </p>
                  </div>
                </div>
              )}

              {/* Assistant bubble — left-aligned */}
              {msg.assistant_response && (
                <div className="flex flex-col items-start">
                  <span className="text-xs text-[#9CA3AF] mb-1 ml-1">Cipher</span>
                  <div className="bg-navy text-white rounded-xl px-4 py-3 max-w-[85%]">
                    <p className="text-sm">{msg.assistant_response}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {msg.intent && <IntentBadge intent={msg.intent} />}
                      {msg.confidence != null && (
                        <span className="text-xs text-blue-200">
                          {formatConfidence(msg.confidence)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-blue-200 mt-1">
                      {msg.created_at ? format(new Date(msg.created_at), 'h:mm a') : ''}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
