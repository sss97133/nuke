import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth, useCredits } from '@dealerscan/shared'
import { FileText, FolderOpen, CreditCard, LogOut, Settings, MessageSquare } from 'lucide-react'

export default function Header() {
  const { user, signOut } = useAuth()
  const { credits } = useCredits(user?.id)
  const navigate = useNavigate()
  const location = useLocation()

  const navItems = [
    { to: '/dashboard', label: 'Deals', icon: FileText },
    { to: '/upload', label: 'Scan Folder', icon: FolderOpen },
    { to: '/messages', label: 'Messages', icon: MessageSquare },
    { to: '/billing', label: 'Billing', icon: CreditCard },
    { to: '/settings', label: 'Settings', icon: Settings },
  ]

  return (
    <header className="bg-white border-b border-gray-200 fixed top-0 left-0 right-0 z-50">
      <div className="flex items-center justify-between h-12 px-4" style={{ paddingLeft: 80 }}>
        <nav className="flex items-center gap-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                location.pathname === to || (to !== '/dashboard' && location.pathname.startsWith(to))
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          {credits && (
            <button
              onClick={() => navigate('/billing')}
              className="text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-medium hover:bg-blue-100"
            >
              {credits.total_available} credits
            </button>
          )}
          <button
            onClick={signOut}
            className="text-gray-400 hover:text-gray-600 p-1"
            title="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  )
}
