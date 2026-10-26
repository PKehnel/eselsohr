import { initializeApp } from 'firebase/app';
import { browserLocalPersistence, connectAuthEmulator, initializeAuth } from 'firebase/auth';
import { clearIndexedDbPersistence, connectFirestoreEmulator, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, terminate } from 'firebase/firestore';
import { connectFirestoreEmulator as connectMembershipEmulator, getFirestore as getMembershipStore } from 'firebase/firestore/lite';
import { clearFirestoreCoordination, clearOrphanedFirestoreCoordination, DeviceCache } from './device-cache';

export function initializeBackend() {
  const env = import.meta.env;
  const useEmulators = env.VITE_USE_EMULATORS === 'true';
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY as string,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string,
    projectId: env.VITE_FIREBASE_PROJECT_ID as string,
    appId: env.VITE_FIREBASE_APP_ID as string,
  };
  if (useEmulators && (!env.DEV || env.MODE !== 'emulator' || !['localhost', '127.0.0.1'].includes(location.hostname) || config.projectId !== 'demo-eselsohr')) {
    throw new Error('Emulator configuration is restricted to local development.');
  }
  if (!useEmulators && config.projectId?.startsWith('demo-')) {
    throw new Error('A demo project cannot be used for a release.');
  }
  if (Object.values(config).some(value => !value)) return null;
  const app = initializeApp(config);
  const auth = initializeAuth(app, { persistence: browserLocalPersistence });
  const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  const membershipDb = getMembershipStore(app);
  if (useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    connectMembershipEmulator(membershipDb, '127.0.0.1', 8080);
  }
  const cacheKey = `eselsohr/${config.projectId}`;
  const cache = new DeviceCache(`${cacheKey}/clear-cache`, () => terminate(db), async () => {
    await clearIndexedDbPersistence(db);
    clearFirestoreCoordination(app.name, config.projectId);
  }, () => clearOrphanedFirestoreCoordination(app.name, config.projectId));
  const ready = auth.authStateReady().then(async () => {
    // Finish an interrupted sign-out before starting any database listeners.
    await cache.open();
  });
  return {
    auth, db, membershipDb, ready, useEmulators, cacheKey,
    get closed() { return cache.closed; },
    onCacheClose(receive: () => void) { cache.onClose = receive; },
    clearCache: () => cache.clear(),
  };
}

export type Backend = NonNullable<ReturnType<typeof initializeBackend>>;
