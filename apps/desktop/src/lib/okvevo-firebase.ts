/**
 * Renderer Firebase client for OkVevo portal billing snapshots.
 * Public config must match OkVevo-Web NEXT_PUBLIC_FIREBASE_* (okvevo-testing).
 */
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_OKVEVO_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_OKVEVO_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_OKVEVO_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_OKVEVO_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_OKVEVO_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_OKVEVO_FIREBASE_APP_ID || ''
}

export function okvevoFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId)
}

let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null

export function getOkvevoFirebase(): { app: FirebaseApp; auth: Auth; db: Firestore } | null {
  if (!okvevoFirebaseConfigured()) return null
  if (!app) {
    const existing = getApps().find(a => a.name === 'okvevo-desktop')
    app = existing ?? initializeApp(firebaseConfig, 'okvevo-desktop')
    auth = getAuth(app)
    db = getFirestore(app)
  }
  return { app: app!, auth: auth!, db: db! }
}
