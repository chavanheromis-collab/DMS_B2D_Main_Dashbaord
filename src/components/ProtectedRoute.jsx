import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function ProtectedRoute({ children, adminOnly = false }) {
  const { user, userDoc, isAdmin, isActive } = useAuth()

  if (!user) return <Navigate to="/login" replace />
  if (userDoc === undefined) {
    return <div className="flex items-center justify-center h-screen text-slate-400">Checking access…</div>
  }
  if (!isActive) return <Navigate to="/pending" replace />
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />

  return children
}
