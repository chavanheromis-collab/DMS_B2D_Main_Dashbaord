import { useAuth } from '../context/AuthContext.jsx'
import { Clock, XCircle } from 'lucide-react'

export default function PendingApproval() {
  const { userDoc, signOut } = useAuth()
  const removed = userDoc?.status === 'removed'

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div className="card w-full max-w-sm text-center space-y-3">
        <div className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center ${removed ? 'bg-red-100' : 'bg-amber-100'}`}>
          {removed ? <XCircle className="text-red-500" size={24} /> : <Clock className="text-amber-500" size={24} />}
        </div>
        <h1 className="text-lg font-semibold text-ink">
          {removed ? 'Access removed' : 'Waiting for admin approval'}
        </h1>
        <p className="text-sm text-slate-500">
          {removed
            ? 'An admin has revoked your access to this dashboard. Contact your admin if you believe this is a mistake.'
            : 'Your account has been created but an admin still needs to activate it before you can see any data. This page updates automatically once you\u2019re approved.'}
        </p>
        <button onClick={signOut} className="text-sm text-slate-400 underline">
          Sign out
        </button>
      </div>
    </div>
  )
}
