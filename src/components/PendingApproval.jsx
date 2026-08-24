import { useState } from 'react'
import { Check, Clock, XCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'

/**
 * Where a new account waits.
 *
 * Rather than a dead screen, this is where somebody says who they are. The
 * name box starts EMPTY on purpose: Google's display name is whatever that
 * account happens to be called -- a personal one, an initial, a nickname --
 * and pre-filling it means most people accept it without reading, which is
 * how a user list ends up full of names nobody recognises.
 *
 * The role asked for here is their JOB -- "Sales Executive", "Service
 * Advisor" -- and has nothing to do with the access level, which only an
 * admin sets. It is a free text box rather than a list because a
 * dealership's job titles are its own, and any list written here would be
 * wrong at the second dealership that used this.
 */
export default function PendingApproval() {
  const { userDoc, signOut, submitProfile } = useAuth()
  const removed = userDoc?.status === 'removed'

  const [name, setName] = useState(userDoc?.name || '')
  const [jobRole, setJobRole] = useState(userDoc?.jobRole || '')
  const [busy, setBusy] = useState(false)
  const sent = Boolean(userDoc?.requestedAt)

  async function send(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await submitProfile({ name, jobRole })
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
                placeholder="Your full name"
                className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>

            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-slate-400">Your role</span>
              <input
                value={jobRole}
                onChange={(e) => setJobRole(e.target.value)}
                placeholder="e.g. Sales Executive"
                className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              />
              <span className="mt-1 block text-[10px] text-slate-400">
                What you do, so your admin knows which pages you need. Which pages you actually get is their
                decision.
              </span>
            </label>

            <button
              type="submit"
              disabled={busy || !name.trim()}
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
