import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { measure } from '../tools/test-profile.mjs';

export const project = 'demo-eselsohr';
export const path = id => `notebooks/home/notes/${id}`;
export const privatePath = (uid, id) => `members/${uid}/notes/${id.replace(/^private:/, '')}`;

// Fixed loopback/demo target; cleanup tracks exact fixtures, never enumerates users.
export function emulatorFixtures() {
  const run = randomUUID(), password = randomUUID();
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
    throw new Error('Fixtures require the local demo Auth and Firestore emulators.');
  }
  const app = initializeApp({ projectId: project }, `fixture-${run}`);
  const adminAuth = getAuth(app), adminDb = getFirestore(app);
  const users = [];
  const createdNoteIds = [];
  const textId = `acceptance-text-${run}`, otherId = `acceptance-other-${run}`, checklistId = `acceptance-list-${run}`;
  const itemPath = `${path(checklistId)}/items/row`;

  async function createUsers() {
    for (const name of ['alex', 'sam', 'jo', 'visitor']) {
      const user = await measure('fixture.auth-create', () => adminAuth.createUser({ email: `${name}-${run}@example.test`, password }));
      users.push(user);
      if (name !== 'visitor') await measure('fixture.membership-write', () => adminDb.doc(`members/${user.uid}`).set({ displayName: name, active: true }));
    }
    return users;
  }

  // Browser scenarios start independently of the rules suite's successful writes.
  async function seedNotebook() {
    const [alex, sam, jo] = users;
    const metadata = uid => ({ createdBy: uid, createdAt: FieldValue.serverTimestamp(), updatedBy: uid, updatedAt: FieldValue.serverTimestamp() });
    const note = (uid, title, body = '', kind = 'text') => ({ kind, title, body, pinned: false, state: 'active', ...metadata(uid) });
    const batch = adminDb.batch();
    batch.set(adminDb.doc(path(textId)), { ...note(alex.uid, 'Shared title', 'Third member'), audience: 'everyone' });
    batch.set(adminDb.doc(path(otherId)), { ...note(alex.uid, 'Things to remember'), audience: 'everyone' });
    batch.set(adminDb.doc(path(checklistId)), { ...note(alex.uid, 'Weekend shopping', '', 'checklist'), audience: 'everyone' });
    batch.set(adminDb.doc(itemPath), { text: 'Bread', checked: false, ...metadata(alex.uid) });
    for (const [user, name] of [[alex, 'Alex'], [sam, 'Sam'], [jo, 'Jo']]) {
      batch.set(adminDb.doc(privatePath(user.uid, textId)), note(user.uid, `${name} only`, user === alex ? 'Still private' : ''));
    }
    await batch.commit();
  }

  async function cleanup() {
    const results = await measure('fixture.delete-data', () => Promise.allSettled([
      ...[textId, otherId, checklistId, `limits-${run}`, ...createdNoteIds].map(id => measure('fixture.cleanup-note', () => adminDb.recursiveDelete(adminDb.doc(path(id))))),
      ...users.map(async user => {
        await measure('fixture.cleanup-member', () => adminDb.recursiveDelete(adminDb.doc(`members/${user.uid}`)));
        await measure('fixture.cleanup-auth', () => adminAuth.deleteUser(user.uid));
      }),
    ]));
    try { await measure('fixture.firestore-terminate', () => adminDb.terminate()); }
    finally { await measure('fixture.admin-delete', () => deleteApp(app)); }
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Synthetic fixture cleanup failed.');
  }

  async function addChecklist(title, items) {
    const id = `list-${randomUUID()}`;
    createdNoteIds.push(id);
    const uid = users[0].uid;
    const metadata = { createdBy: uid, createdAt: FieldValue.serverTimestamp(), updatedBy: uid, updatedAt: FieldValue.serverTimestamp() };
    const batch = adminDb.batch();
    batch.set(adminDb.doc(path(id)), { kind: 'checklist', title, body: '', state: 'active', pinned: false, audience: 'everyone', ...metadata });
    items.forEach((item, index) => batch.set(adminDb.doc(`${path(id)}/items/row-${String(index).padStart(3, '0')}`), {
      checked: false, indented: 0, ...item, ...metadata, createdAt: Timestamp.fromMillis(index + 1),
    }));
    await batch.commit();
    return id;
  }

  return { run, password, adminAuth, adminDb, users, createdNoteIds, textId, otherId, checklistId, itemPath, createUsers, seedNotebook, addChecklist, cleanup };
}
