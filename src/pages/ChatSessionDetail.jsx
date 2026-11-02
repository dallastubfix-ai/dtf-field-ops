import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import PageHeader from '../components/layout/PageHeader'
import { SkeletonGroup, SkeletonBubbles } from '../components/ui/Skeleton'

// Only these two get their own look; everything else is the neutral badge.
const intentColors = {
  booking:    'ui-badge-active',
  escalation: 'ui-badge-cancelled',
}

function IntentBadge({ intent }) {
  const colors = intentColors[intent] ?? 'ui-badge-neutral'
  return (
    <span className={`ui-badge inline-flex items-center capitalize ${colors}`}>
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
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      bottomRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' })
    }
  }, [loading, messages])

  const sessionDate = messages.length > 0
    ? format(new Date(messages[0].created_at), 'MMMM d, yyyy')
    : ''

  return (
    <div className="min-h-screen flex flex-col">
      <PageHeader
        title={`Session ${shortId}`}
        subtitle={sessionDate}
        onBack={() => navigate('/chat-sessions')}
      />

      <div className="flex-1 px-4 py-4 space-y-4">
        {loading ? (
          <SkeletonGroup>
            <SkeletonBubbles count={4} />
          </SkeletonGroup>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className="space-y-3">
              {/* User bubble — right-aligned */}
              {msg.user_message && (
                <div className="flex flex-col items-end">
                  <span className="chat-who mb-1 mr-1">Customer</span>
                  <div className="chat-bubble chat-bubble--customer">
                    <p className="text-sm">{msg.user_message}</p>
                    <p className="chat-meta mt-1">
                      {msg.created_at ? format(new Date(msg.created_at), 'h:mm a') : ''}
                    </p>
                  </div>
                </div>
              )}

              {/* Assistant bubble — left-aligned */}
              {msg.assistant_response && (
                <div className="flex flex-col items-start">
                  <span className="chat-who mb-1 ml-1">Cipher</span>
                  <div className="chat-bubble chat-bubble--assistant">
                    <p className="text-sm">{msg.assistant_response}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {msg.intent && <IntentBadge intent={msg.intent} />}
                      {msg.confidence != null && (
                        <span className="chat-meta">
                          {formatConfidence(msg.confidence)}
                        </span>
                      )}
                    </div>
                    <p className="chat-meta mt-1">
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
