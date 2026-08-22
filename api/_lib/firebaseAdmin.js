import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

// FIREBASE_SERVICE_ACCOUNT_KEY is the full JSON key of a Firebase service
// account, stored as ONE-LINE JSON in a Vercel environment variable (never
// committed to git). Generate it in:
// Firebase console -> Project settings -> Service accounts -> Generate new
// private key.
function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  if (!raw) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_KEY environment variable')
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON')
  }
}

function getAdminApp() {
  const existing = getApps()
  if (existing.length) return existing[0]
  return initializeApp({ credential: cert(getServiceAccount()) })
}

const app = getAdminApp()
export const adminAuth = getAuth(app)
export const adminDb = getFirestore(app)

/**
 * Verifies the Firebase ID token sent from the browser as
 * `Authorization: Bearer <token>` and returns the decoded token (contains
 * `uid`, `email`, etc). Throws if missing/invalid/expired.
 */
export async function requireUser(req) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) {
    const err = new Error('Missing Authorization header')
    err.statusCode = 401
    throw err
  }
  try {
    return await adminAuth.verifyIdToken(token)
  } catch {
    const err = new Error('Invalid or expired sign-in token')
    err.statusCode = 401
    throw err
  }
}

/**
 * Re-implements the same access rules the frontend enforces via Firestore
 * security rules, but on the server -- sheet data no longer flows through
 * the browser's own Google token, so the server has to decide for itself.
 *
 * Mirrors: users/{uid}.status/.role and
 *   access/{uid}_{pageId} = {
 *     canView: boolean,
 *     editable:     { [ref]: string[] },   // per-ref editable columns
 *     downloadable: { [ref]: string[] },
 *     hiddenWidgets: string[],
 *   }
 *
 * `editable` is keyed by REF ("<sourceId>::<tabName>") because one page now
 * spans tabs from several different spreadsheets -- "may edit CASH/FINANCE"
 * only means anything once you say which tab of which sheet it's on, and two
 * connected spreadsheets very often both have a tab called MASTER.
 */
export async function getAccess(uid, page) {
  const [userSnap, accessSnap] = await Promise.all([
    adminDb.doc(`users/${uid}`).get(),
    adminDb.doc(`access/${uid}_${page}`).get(),
  ])
  const userDoc = userSnap.exists ? userSnap.data() : null
  const accessDoc = accessSnap.exists ? accessSnap.data() : null

  const isAdmin = userDoc?.role === 'admin'
  const isActive = isAdmin || userDoc?.status === 'active'
  const canView = isActive && (isAdmin || !!accessDoc?.canView)

  let editable = accessDoc?.editable || {}
  // Back-compat with the old flat single-tab shape ({ editableColumns: [] }).
  if (!accessDoc?.editable && Array.isArray(accessDoc?.editableColumns)) {
    editable = { MASTER: accessDoc.editableColumns }
  }

  const downloadable = accessDoc?.downloadable || {}

  return { isAdmin, isActive, canView, editable, downloadable }
}
