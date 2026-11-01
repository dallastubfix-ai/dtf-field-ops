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
      aria-label="Main"
      className="glass-tabbar z-40 flex lg:hidden"
    >
      {tabs.map(({ to, icon: Icon, label }) => {
        const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
        return (
          <Link
            key={to}
            to={to}
            aria-current={isActive ? 'page' : undefined}
            className="glass-tab flex flex-col items-center justify-center"
          >
            <Icon size={22} strokeWidth={isActive ? 2 : 1.5} />
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
