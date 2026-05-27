/**
 * Firebase client SDK init.
 * API key di Firebase web bersifat PUBLIC by design — keamanan dijamin oleh
 * Firestore Security Rules, bukan dengan hide API key.
 *
 * Refer ke firestore.rules untuk security boundaries.
 */
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore
} from 'firebase/firestore';
import { getAuth, type Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: 'AIzaSyCW0_QFfQn8o-Kl0yOscjzRIQKOVPe2BvM',
  authDomain: 'lab-ap-86286.firebaseapp.com',
  projectId: 'lab-ap-86286',
  storageBucket: 'lab-ap-86286.firebasestorage.app',
  messagingSenderId: '58473122585',
  appId: '1:58473122585:web:5da5ffdedd15464c24d388'
};

let app: FirebaseApp;
let db: Firestore;
let auth: Auth;

if (typeof window !== 'undefined') {
  app = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);

  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });

  auth = getAuth(app);
}

export { app, db, auth };

export const EMAIL_DOMAIN = '@mhs.lab-ap.com';
export const emailFromNim = (nim: string) => `${nim}${EMAIL_DOMAIN}`;
export const nimFromEmail = (email: string) => email.replace(EMAIL_DOMAIN, '');
