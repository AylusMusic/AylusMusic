/**
 * AylusMusic - Firebase Client Module
 * Modular SDK v10 via CDN ESM with Persistent Local Cache
 */

export const firebaseConfig = {
  apiKey: "AIzaSyDl8RoTc39s2r8cyLL9JMRL8hpxn377d0M",
  authDomain: "data-pembagian-ktm.firebaseapp.com",
  projectId: "data-pembagian-ktm",
  storageBucket: "data-pembagian-ktm.firebasestorage.app",
  messagingSenderId: "276414422745",
  appId: "1:276414422745:web:f3820bee202f9c33bfe8c8"
};

let app = null;
let auth = null;
let db = null;
let isInitialized = false;
let initError = null;

export async function initFirebase() {
  if (isInitialized) return { app, auth, db, error: initError };

  try {
    // Dynamic import from CDN ESM
    const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    const { getAuth, GoogleAuthProvider } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
    const { 
      initializeFirestore, 
      persistentLocalCache, 
      persistentMultipleTabManager 
    } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

    app = initializeApp(firebaseConfig);
    auth = getAuth(app);

    // Initialize Firestore with multi-tab persistent cache
    try {
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager()
        })
      });
    } catch (cacheErr) {
      console.warn('[Firebase] Firestore persistent cache fallback:', cacheErr.message);
      const { getFirestore } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      db = getFirestore(app);
    }

    isInitialized = true;
    console.log('[Firebase] Initialized successfully with offline persistence');
    return { app, auth, db, GoogleAuthProvider, error: null };
  } catch (err) {
    initError = err;
    console.warn('[Firebase] Initialization offline/skipped:', err.message);
    return { app: null, auth: null, db: null, GoogleAuthProvider: null, error: err };
  }
}

export { app, auth, db };
