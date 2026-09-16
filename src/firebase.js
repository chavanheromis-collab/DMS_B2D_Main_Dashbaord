import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

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

// No Storage here on purpose. The one thing this app stores as a file --
// pictures sent in a chat -- goes to Google Drive instead, through
// api/chatImage.js, so there is one place to look for files and one set of
// credentials to keep. See src/lib/chatImages.js.

// Google sign-in is used purely to identify who's signed in (name, email,
// photo). Sheet data itself is fetched server-side by a Vercel serverless
// function using a Google service account, so we no longer need to request
// the Sheets OAuth scope here, and no individual Google account needs to be
// shared on the sheet -- only the service account does (see README).
export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })
