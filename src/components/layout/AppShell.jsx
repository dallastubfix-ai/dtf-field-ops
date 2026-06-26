import { NavLink } from 'react-router-dom'
import { Home, Calendar, Briefcase, FileText, Menu, Settings } from 'lucide-react'
import BottomNav from './BottomNav'
import FAB from './FAB'
import UpdateBanner from './UpdateBanner'
import OfflineBanner from './OfflineBanner'
import SyncIndicator from './SyncIndicator'

const sidebarLinks = [
  { to: '/',         icon: Home,      label: 'Home'     },
  { to: '/calendar', icon: Calendar,  label: 'Calendar' },
  { to: '/jobs',     icon: Briefcase, label: 'Jobs'     },
  { to: '/invoices', icon: FileText,  label: 'Invoices' },
  { to: '/more',     icon: Menu,      label: 'More'     },
  { to: '/settings', icon: Settings,  label: 'Settings' },
]

export default function AppShell({ children }) {
  return (
    <div className="flex min-h-screen bg-[#F3F4F6]">
      {/* Desktop sidebar — hidden on mobile */}
      <aside className="hidden lg:flex flex-col w-60 bg-navy fixed top-0 left-0 h-full z-40 shrink-0">
        <div className="px-6 py-6 border-b border-navy-dark">
          <span className="text-white font-bold text-lg tracking-tight">DTF Field Ops</span>
          <div className="mt-1">
            <SyncIndicator />
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {sidebarLinks.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-navy-dark text-white'
                    : 'text-blue-200 hover:bg-navy-dark hover:text-white'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main content — single render of children */}
      <div className="flex-1 flex flex-col min-h-screen lg:ml-60">
        <UpdateBanner />
        <OfflineBanner />
        <main className="flex-1 pb-[calc(64px+env(safe-area-inset-bottom))] lg:pb-0">
          {children}
        </main>
      </div>

      <BottomNav />
      <FAB />
    </div>
  )
}
