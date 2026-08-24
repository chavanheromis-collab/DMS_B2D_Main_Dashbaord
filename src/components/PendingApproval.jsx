import { useState } from 'react'
import { Check, Clock, XCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'

/**
 * Where a new account waits.
 *
 * Rather than a dead screen, this is where somebody says who they are: the
 * name their colleagues would recognise -- Google hands us whatever their
 * account is called, which is often not it -- and what they need to be able
 * to do.
 *
 * The role is a REQUEST. A user writing their own role would be granting
 * themselves admin, so it is stored under its own key, the security rules
 * refuse the real one, and an admin sees "asked for admin" beside their row
 * with one click to grant it. There are only ever two roles, so this is two
 * buttons rather than a box to type into.
 */
export default function PendingApproval() {
  const { user, userDoc, signOut, submitProfile } = useAuth()
  const removed = userDoc?.status === 'removed'

  const [name, setName] = useState(userDoc?.name || user?.displayName || '')
  const [role, setRole] = useState(userDoc?.requestedRole || 'user')
  const [busy, setBusy] = useState(false)
  const sent = Boolean(userDoc?.requestedAt)

  async function send(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await submitProfile({ name, requestedRole: role })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="card w-full max-w-sm space-y-3 text-center">
        <div
          className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${
            removed ? 'bg-red-100' : 'bg-amber-100'
          }`}
        >
          {removed ? <XCircle className="text-red-500" size={24} /> : <Clock className="text-amber-500" size={24} />}
        </div>

        <h1 className="text-lg font-semibold text-ink">
          {removed ? 'Access removed' : 'Waiting for admin approval'}
        </h1>

        <p className="text-sm text-slate-500">
          {removed
            ? 'An admin has revoked your access to this dashboard. Contact your admin if you believe this is a mistake.'
            : 'Your account has been created but an admin still needs to activate it. This page updates on its own once you’re approved.'}
        </p>

        {!removed && (
          <form onSubmit={send} className="space-y-2 border-t border-slate-100 pt-3 text-left">
            <p className="text-[11px] font-medium text-slate-500">
              Tell your admin who you are{' '}
              <span className="font-normal text-slate-400">— it helps them find you in the list</span>
            </p>

            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-slate-400">Your name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={user?.displayName || 'Name'}
                className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>

            <div>
              <span className="text-[10px] uppercase tracking-wide text-slate-400">What you need</span>
              <div className="mt-0.5 grid grid-cols-2 gap-1.5">
                {[
                  { value: 'user', label: 'User', hint: 'See the pages I’m given' },
                  { value: 'admin', label: 'Admin', hint: 'Build and edit pages' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRole(option.value)}
                    className={`rounded-lg border px-2 py-1.5 text-left transition-colors ${
                      role === option.value
                        ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span className="block text-xs font-medium">{option.label}</span>
                    <span className="block text-[10px] text-slate-400">{option.hint}</span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-slate-400">
                Asking is not getting: an admin decides, and can change it later.
              </p>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {sent && !busy && <Check size={12} />}
              {busy ? 'Sending…' : sent ? 'Update what I sent' : 'Send to my admin'}
            </button>
          </form>
        )}

        <button onClick={signOut} className="text-sm text-slate-400 underline">
          Sign out
        </button>
      </div>
    </div>
  )
}
