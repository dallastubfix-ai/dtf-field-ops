import { Link, useLocation } from 'react-router-dom'
import { Home, Calendar, Briefcase, FileText, Menu } from 'lucide-react'

const tabs = [
  { to: '/',         icon: Home,      label: 'Home'     },
  { to: '/calendar', icon: Calendar,  label: 'Calendar' },
  { to: '/jobs',     icon: Briefcase, label: 'Jobs'     },
  { to: '/invoices', icon: FileText,  label: 'Invoices' },
  { to: '/more',     icon: Menu,      label: 'More'     },
]

export default function BottomNav() {
  const location = useLocation()

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 h-16 bg-white border-t border-[#E5E7EB] flex lg:hidden items-stretch"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map(({ to, icon: Icon, label }) => {
        const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
        return (
          <Link
            key={to}
            to={to}
            className={`flex flex-col items-center justify-center flex-1 py-2 text-xs font-medium transition-colors ${
              isActive ? 'text-navy' : 'text-gray-400'
            }`}
          >
            <Icon size={20} strokeWidth={isActive ? 2 : 1.5} />
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
