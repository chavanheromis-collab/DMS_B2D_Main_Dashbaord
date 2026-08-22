import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { LayoutGrid } from 'lucide-react'
import { BRAND_NAME, BRAND_TAGLINE } from './SplashScreen.jsx'

export default function Login() {
  const { user, signIn } = useAuth()
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/" replace />

  async function handleSignIn() {
    setBusy(true)
    setError(null)
    try {
      await signIn()
    } catch (e) {
      setError(e.message || 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      {/* Same wordmark as the entrance animation, so signing in and landing
          on the dashboard read as one product rather than two. */}
      <div className="card w-full max-w-sm text-center space-y-4">
        <div className="rise-in mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-sky-400 to-teal-300 shadow-lg">
          <LayoutGrid className="text-white" size={26} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-ink">{BRAND_NAME}</h1>
          <p className="mt-1 text-[11px] uppercase tracking-[0.2em] text-slate-400">{BRAND_TAGLINE}</p>
        </div>
        <p className="text-sm text-slate-500">
          Sign in with your Google account. An admin grants access to each dashboard page.
        </p>
        <button
          onClick={handleSignIn}
          disabled={busy}
          className="w-full py-2.5 rounded-lg bg-ink text-white font-medium hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in with Google'}
        </button>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </div>
  )
}
