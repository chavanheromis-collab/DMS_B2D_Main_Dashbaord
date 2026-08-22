import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { signInWithPopup, signOut as fbSignOut, onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db, googleProvider } from '../firebase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null) // firebase auth user
  const [userDoc, setUserDoc] = useState(undefined) // undefined = loading, null = none yet
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      setUser(fbUser)
      setAuthLoading(false)
    })
    return unsub
  }, [])

  // Live-subscribe to this user's profile doc so an admin toggling
  // status to "removed" locks the dashboard immediately, without reload.
  useEffect(() => {
    if (!user) {
      setUserDoc(undefined)
      return
    }
    const ref = doc(db, 'users', user.uid)
    const unsub = onSnapshot(ref, (snap) => {
      setUserDoc(snap.exists() ? snap.data() : null)
    })
    return unsub
  }, [user])

  const signIn = useCallback(async () => {
    const result = await signInWithPopup(auth, googleProvider)

    // Create/update the user's profile doc on sign-in. Basic identity fields
    // are always refreshed, but status/role are only ever set to defaults
    // the FIRST time we see this user -- never overwritten on later logins,
    // so an admin's decision (active/removed/role) always sticks.
    const ref = doc(db, 'users', result.user.uid)
    const existing = await getDoc(ref)

    await setDoc(
      ref,
      {
        email: result.user.email,
        name: result.user.displayName,
        photoURL: result.user.photoURL,
        lastLogin: serverTimestamp(),
        ...(existing.exists() ? {} : { status: 'pending', role: 'user', createdAt: serverTimestamp() }),
      },
      { merge: true }
    )
  }, [])

  const signOut = useCallback(async () => {
    await fbSignOut(auth)
  }, [])

  // Every call to our /api/sheets serverless function needs a fresh Firebase
  // ID token in the Authorization header so the server can verify who's
  // asking (see api/_lib/firebaseAdmin.js). The SDK auto-refreshes this
  // token, so always pull a live one right before each request rather than
  // caching it -- that's what makes reconnect-after-reload issues go away.
  const getIdToken = useCallback(async () => {
    if (!auth.currentUser) throw new Error('Not signed in')
    return auth.currentUser.getIdToken()
  }, [])

  const value = {
    user,
    userDoc,
    authLoading,
    signIn,
    signOut,
    getIdToken,
    isAdmin: userDoc?.role === 'admin',
    isActive: userDoc?.role === 'admin' || userDoc?.status === 'active',
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
