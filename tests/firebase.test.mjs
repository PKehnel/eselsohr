import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

test('Firebase app and Auth share one core registry and initialize without Console changes', async t => {
  const require = createRequire(import.meta.url);
  const appCore = createRequire(require.resolve('firebase/app')).resolve('@firebase/app');
  const authEntry = createRequire(require.resolve('firebase/auth')).resolve('@firebase/auth');
  const authCore = createRequire(authEntry).resolve('@firebase/app');
  assert.equal(authCore, appCore, 'incremental upgrades must deduplicate the core SDK');
  const app = initializeApp({ apiKey: 'fake-key', projectId: 'demo-eselsohr' }, 'registry-test');
  t.after(() => deleteApp(app));
  const auth = getAuth(app);
  await auth.authStateReady();
  assert.equal(auth.app, app);
  assert.equal(auth.currentUser, null);
});
