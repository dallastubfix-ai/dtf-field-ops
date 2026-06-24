import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wrench } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

export default function Login() {
  const { user, loading, signInWithGoogle } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true })
  }, [user, loading, navigate])

  return (
    <div className="min-h-screen bg-[#F3F4F6] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Wordmark */}
        <div className="text-center mb-8">
          <span className="text-2xl font-bold text-navy">Dallas </span>
          <span className="text-2xl font-bold text-gold">Tub Fix</span>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-[#E5E7EB] p-8 flex flex-col items-center gap-5">
          <div className="w-16 h-16 rounded-full bg-navy flex items-center justify-center">
            <Wrench size={28} className="text-white" />
          </div>

          <div className="text-center">
            <h1 className="text-xl font-bold text-[#1F2937]">Welcome Back</h1>
            <p className="text-sm text-[#6B7280] mt-1">Sign in to access your field operations</p>
          </div>

          <button
            onClick={signInWithGoogle}
            className="w-full flex items-center justify-center gap-3 bg-gold text-white rounded-lg px-4 py-3 font-semibold text-sm hover:bg-amber-500 active:scale-95 transition-all"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
              <path fill="#FFF" d="M44.5 20H24v8.5h11.8C34.7 33.9 29.8 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/>
            </svg>
            Sign in with Google
          </button>
        </div>

        <p className="text-center text-xs text-[#9CA3AF] mt-6">
          Dallas Tub Fix · Field Operations
        </p>
      </div>
    </div>
  )
}
