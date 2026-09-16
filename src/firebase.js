import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { RETRY_MS } from './lib/chatImages'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)

// The one thing this app stores as a file: pictures sent in a chat. See
// storage.rules, and src/lib/chatImages.js for why the picture is uploaded
// and the message keeps only a link to it.
export const storage = getStorage(app)

// The SDK retries a failing upload for two minutes by default, silently.
// For a chat picture that is the wrong trade: a bucket that is not going to
// take the file is not going to take it in two minutes either, and what the
// wait looks like from the outside is a small photo uploading for ever. Say
// so in twenty seconds instead. See lib/chatImages.js.
storage.maxUploadRetryTime = RETRY_MS
storage.maxOperationRetryTime = RETRY_MS

// Google sign-in is used purely to identify who's signed in (name, email,
// photo). Sheet data itself is fetched server-side by a Vercel serverless
// function using a Google service account, so we no longer need to request
// the Sheets OAuth scope here, and no individual Google account needs to be
// shared on the sheet -- only the service account does (see README).
export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })
