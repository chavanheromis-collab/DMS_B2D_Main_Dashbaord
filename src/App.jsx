import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import { useEntrance, useWorkspace } from './hooks/useWorkspace'
import Login from './components/Login.jsx'
import PendingApproval from './components/PendingApproval.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Admin from './pages/Admin.jsx'
import SplashScreen, { useSplash } from './components/SplashScreen.jsx'

/**
 * Keeps v2 bookmarks working. `/dashboard/PREMIA` was a real URL people had
 * pinned; after migration PREMIA is a page with a generated id, so resolve
 * the old name against the current pages and forward to it. An unmatched
 * name falls through to `/`, which lands on the user's first page.
 */
function LegacyPageRedirect() {
  const { page: name } = useParams()
  const { pages, loading } = useWorkspace()

  if (loading) return <div className="flex h-screen items-center justify-center text-slate-400">Loading…</div>

  const match = pages.find((p) => p.name === name || p.id === name)
  return <Navigate to={match ? `/d/${match.id}` : '/'} replace />
}

export default function App() {
  const { authLoading } = useAuth()
  const splash = useSplash()
  const entrance = useEntrance()

  // The entrance lives HERE rather than on the dashboard so that it covers
  // the whole boot -- signing in, resolving the session, the first data
  // fetch. Rendering it any deeper meant a refresh showed a bare "Loading…"
  // for a beat and only then the animation, which reads as a stutter rather
  // than an entrance. App never unmounts on a route change, so this also
  // guarantees the splash plays exactly once per page load.
  return (
    <>
      {splash.show && <SplashScreen onDone={splash.dismiss} entrance={entrance} />}
      {authLoading ? (
        <div className="flex h-screen items-center justify-center text-slate-400">Loading…</div>
      ) : (
        <AppRoutes />
      )}
    </>
  )
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/pending" element={<PendingApproval />} />

      {/* Any number of admin-created dashboard pages, addressed by id. */}
      <Route
        path="/d/:pageId"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />

      {/* No page chosen -- Dashboard forwards to the first one this user
          may see, so there is no hardcoded "default page" any more. */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />

      <Route
        path="/dashboard/:page"
        element={
          <ProtectedRoute>
            <LegacyPageRedirect />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin"
        element={
          <ProtectedRoute adminOnly>
            <Admin />
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
