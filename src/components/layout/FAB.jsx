import { useNavigate, useLocation } from 'react-router-dom'
import { Plus } from 'lucide-react'

export default function FAB() {
  const navigate = useNavigate()
  const location = useLocation()

  if (location.pathname === '/intake') return null

  return (
    <div className="glass-fab-wrap z-[45] group">
      <button
        type="button"
        onClick={() => navigate('/intake')}
        className="glass-fab flex items-center justify-center"
        aria-label="Log New Call"
      >
        <Plus size={26} strokeWidth={2.4} />
      </button>
      <span className="absolute right-16 top-1/2 -translate-y-1/2 fab-tooltip text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden lg:block">
        Log New Call
      </span>
    </div>
  )
}
