import { Link, useNavigate } from 'react-router-dom'
import { useAuth, useCredits } from '@dealerscan/shared'
import { FileText, Upload, CreditCard, LogOut } from 'lucide-react'

export default function Header() {
  const { user, signOut } = useAuth()
  const { credits } = useCredits(user?.id)
  const navigate = useNavigate()

  return (
    <header className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <Link to="/dashboard" className="flex items-center gap-2 font-bold text-lg text-gray-900">
              <FileText className="w-5 h-5 text-blue-600" />
              DealerScan
            </Link>
            <nav className="hidden sm:flex items-center gap-4">
              <Link to="/dashboard" className="text-sm text-gray-600 hover:text-gray-900">Dashboard</Link>
              <Link to="/upload" className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
                <Upload className="w-3.5 h-3.5" /> Upload
              </Link>
              <Link to="/billing" className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1">
                <CreditCard className="w-3.5 h-3.5" /> Billing
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            {credits && (
              <button
                onClick={() => navigate('/billing')}
                className="text-sm bg-blue-50 text-blue-700 px-3 py-1 rounded-full font-medium hover:bg-blue-100"
              >
                {credits.total_available} credits
              </button>
            )}
            <button onClick={signOut} className="text-gray-400 hover:text-gray-600" title="Sign out">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
