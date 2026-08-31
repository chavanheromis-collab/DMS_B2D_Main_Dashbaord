import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import { useEntrance, useWorkspace } from './hooks/useWorkspace'
import Login from './components/Login.jsx'
import PendingApproval from './components/PendingApproval.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Dashboard from './pages/Dashboard.jsx'
import SplashScreen, { useSplash } from './components/SplashScreen.jsx'
import { PageErrorBoundary } from './components/ErrorBoundary.jsx'
import Booting from './components/Booting.jsx'

/**
 * The admin panel, fetched only when somebody opens it.
 *
 * It is the largest thing in the app -- every widget editor, every control
 * editor, the data-source panel, the user table -- and it was landing in the
 * bundle that EVERY visitor downloads before seeing a single number, most of
 * whom are readers who cannot open it at all.
 *
 * A route boundary is the natural seam: nothing on a dashboard imports it,
 * and an admin clicking Admin can afford the fetch that a reader waiting for
 * their first page cannot.
 */
const Admin = lazy(() => import('./pages/Admin.jsx'))

/**
 * Keeps v2 bookmarks working. `/dashboard/PREMIA` was a real URL people had
 * pinned; after migration PREMIA is a page with a generated id, so resolve
 * the old name against the current pages and forward to it. An unmatched
 * name falls through to `/`, which lands on the user's first page.
 */
function LegacyPageRedirect() {
  const { page: name } = useParams()
  const { pages, loading } = useWorkspace()

  if (loading) return <Booting label="Finding that page" />

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
        <Booting label="Signing you in" />
      ) : (
        /* The scaffolding a widget boundary cannot reach -- the layout, the
           control bar, the header. A failure there is the one that produced
           the white screen, and this at least leaves something on it. */
        <PageErrorBoundary>
          <AppRoutes />
        </PageErrorBoundary>
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
            <Suspense fallback={<Booting label="Opening the admin panel" />}>
              <Admin />
            </Suspense>
          </ProtectedRoute>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
