import { useNavigate } from 'react-router-dom'
import { Phone } from 'lucide-react'

export default function FAB() {
  const navigate = useNavigate()

  return (
    <div className="fixed bottom-20 right-4 z-50 group">
      <button
        onClick={() => navigate('/intake')}
        className="w-14 h-14 rounded-full bg-gold text-white shadow-lg flex items-center justify-center hover:bg-amber-500 active:scale-95 transition-all"
        aria-label="Log New Call"
      >
        <Phone size={22} />
      </button>
      <span className="absolute right-16 top-1/2 -translate-y-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden lg:block">
        Log New Call
      </span>
    </div>
  )
}
