import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@dealerscan/shared'
import Header from './components/Header'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import FolderUpload from './pages/FolderUpload'
import DealView from './pages/DealView'
import ReviewPage from './pages/ReviewPage'
import BillingPage from './pages/BillingPage'
import Settings from './pages/Settings'
import Messages from './pages/Messages'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>
  )
  if (!user) return <Navigate to="/login" />
  return <>{children}</>
}

export default function App() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {user && <Header />}
      <div className={user ? 'titlebar-padding' : ''}>
        <Routes>
          <Route path="/" element={user ? <Navigate to="/dashboard" /> : <Navigate to="/login" />} />
          <Route path="/login" element={user ? <Navigate to="/dashboard" /> : <Login />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/upload" element={<ProtectedRoute><FolderUpload /></ProtectedRoute>} />
          <Route path="/deal/:id" element={<ProtectedRoute><DealView /></ProtectedRoute>} />
          <Route path="/review/:dealId/:pageId" element={<ProtectedRoute><ReviewPage /></ProtectedRoute>} />
          <Route path="/billing" element={<ProtectedRoute><BillingPage /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="/messages" element={<ProtectedRoute><Messages /></ProtectedRoute>} />
        </Routes>
      </div>
    </div>
  )
}
