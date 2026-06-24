import { NavLink } from 'react-router-dom'
import { Home, Calendar, Briefcase, FileText, Menu } from 'lucide-react'

const tabs = [
  { to: '/',         icon: Home,      label: 'Home'     },
  { to: '/calendar', icon: Calendar,  label: 'Calendar' },
  { to: '/jobs',     icon: Briefcase, label: 'Jobs'     },
  { to: '/invoices', icon: FileText,  label: 'Invoices' },
  { to: '/more',     icon: Menu,      label: 'More'     },
]

export default function BottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 h-16 bg-white border-t border-[#E5E7EB] flex items-stretch safe-bottom"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex flex-col items-center justify-center flex-1 gap-0.5 py-2 text-xs font-medium transition-colors ${
              isActive ? 'text-navy' : 'text-[#9CA3AF]'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <span className="w-1 h-1 rounded-full bg-navy mb-0.5" />
              )}
              <Icon size={20} strokeWidth={isActive ? 2 : 1.5} />
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
