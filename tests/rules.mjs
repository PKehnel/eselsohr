// Client SDK requests exercise the actual emulator rules, without Vite or Chrome.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, collection, collectionGroup, getDocFromServer, getDocsFromServer, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp, setLogLevel, query, where, or, deleteField } from 'firebase/firestore';
import { emulatorFixtures, project, path, privatePath } from './emulator.mjs';
import { migrateSharing } from '../tools/migrate-sharing.mjs';

setLogLevel('silent'); // Expected denials are asserted below.
const fixture = emulatorFixtures();
const { run, password, adminDb, textId, otherId, checklistId, itemPath } = fixture;
const clients = [];
let passed = 0;
async function check(name, action) { await action(); passed++; console.log(`PASS ${name}`); }
const metadata = uid => ({ createdBy: uid, createdAt: serverTimestamp(), updatedBy: uid, updatedAt: serverTimestamp() });
const note = (uid, scope = 'shared') => ({ kind: 'text', title: 'Test note', body: '', pinned: false, state: 'active', ...(scope === 'shared' ? { audience: 'everyone' } : {}), ...metadata(uid) });
const visibleNotes = (db, uid) => query(collectionGroup(db, 'notes'), or(where('audience', '==', 'everyone'), where('sharedWith', 'array-contains', uid)));
async function denied(action) { await assert.rejects(action, error => error.code === 'permission-denied'); }
async function client(user) {
  const app = initializeApp({ projectId: project, apiKey: 'demo-key', authDomain: 'demo-eselsohr.firebaseapp.com' }, randomUUID());
  clients.push(app);
  const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8080);
  if (user) await signInWithEmailAndPassword(auth, user.email, password);
  return db;
}

try {
  const [alex, sam, jo, visitor] = await fixture.createUsers();
  const [a, b, c, outsider, anonymous] = await Promise.all(fixture.users.map(client).concat(client(null)));
  await check('three active members can create, read and edit shared notes', async () => {
    await setDoc(doc(a, path(textId)), note(alex.uid));
    await updateDoc(doc(b, path(textId)), { title: 'Shared title', updatedBy: sam.uid, updatedAt: serverTimestamp() });
    assert.equal((await getDocFromServer(doc(c, path(textId)))).data().title, 'Shared title');
    await updateDoc(doc(c, path(textId)), { body: 'Third member', updatedBy: jo.uid, updatedAt: serverTimestamp() });
    await setDoc(doc(a, path(otherId)), { ...note(alex.uid), title: 'Things to remember' });
  });
  await check('anonymous and unlisted accounts cannot read/write notes or other members', async () => {
    for (const db of [outsider, anonymous]) {
      await denied(() => getDocFromServer(doc(db, path(textId))));
      await denied(() => getDocsFromServer(collection(db, 'notebooks/home/notes')));
      await denied(() => setDoc(doc(db, path(`blocked-${run}`)), note(visitor.uid)));
      await denied(() => updateDoc(doc(db, path(textId)), { title: 'Blocked' }));
      await denied(() => deleteDoc(doc(db, path(textId))));
      await denied(() => getDocFromServer(doc(db, `members/${alex.uid}`)));
      await denied(() => getDocsFromServer(collection(db, 'members')));
    }
    assert.equal((await getDocFromServer(doc(outsider, `members/${visitor.uid}`))).exists(), false);
  });
  await check('clients cannot grant membership or write unknown/notebook-parent paths', async () => {
    for (const db of [a, outsider]) {
      await denied(() => setDoc(doc(db, `members/${visitor.uid}`), { displayName: 'Visitor', active: true }));
      await denied(() => setDoc(doc(db, 'notebooks/home'), { title: 'Home' }));
      await denied(() => setDoc(doc(db, 'unknown/path'), { value: true }));
    }
  });
  await check('note fields, types, limits, timestamps and creation metadata are enforced', async () => {
    for (const patch of [{ extra: true }, { title: 'x'.repeat(121) }, { body: 'x'.repeat(40001) }, { pinned: 'yes' }, { state: 'deleted' }, { kind: 'checklist', body: '' }, { createdBy: sam.uid }, { createdAt: Timestamp.fromMillis(0) }, { updatedBy: sam.uid }, { updatedAt: Timestamp.fromMillis(0) }]) {
      await denied(() => updateDoc(doc(a, path(textId)), { updatedBy: alex.uid, updatedAt: serverTimestamp(), ...patch }));
    }
    await denied(() => setDoc(doc(a, path(`bad-create-${run}`)), { ...note(alex.uid), createdBy: sam.uid }));
    await denied(() => setDoc(doc(a, path(`bad-create-${run}`)), { ...note(alex.uid), createdAt: Timestamp.fromMillis(0) }));
    await setDoc(doc(a, path(`limits-${run}`)), { ...note(alex.uid), title: 'x'.repeat(120), body: 'x'.repeat(40000) });
    await adminDb.doc(path(`limits-${run}`)).delete();
    await denied(() => deleteDoc(doc(a, path(textId))));
  });
  await check('checklist row validation, separate text/toggle writes and deletion', async () => {
    await setDoc(doc(a, path(checklistId)), { ...note(alex.uid), kind: 'checklist', title: 'Weekend shopping' });
    await setDoc(doc(a, itemPath), { text: 'Bread', checked: false, ...metadata(alex.uid) });
    await updateDoc(doc(b, itemPath), { checked: true, updatedBy: sam.uid, updatedAt: serverTimestamp() });
    assert.equal((await getDocFromServer(doc(c, itemPath))).data().text, 'Bread');
    for (const patch of [{ text: 'x'.repeat(1001) }, { checked: 'yes' }, { indented: 'yes' }, { indented: 3 }, { indented: -1 }, { indented: 1.5 }, { extra: 1 }, { createdBy: sam.uid }, { createdAt: Timestamp.fromMillis(0) }, { updatedBy: sam.uid }, { updatedAt: Timestamp.fromMillis(0) }]) {
      await denied(() => updateDoc(doc(a, itemPath), { updatedBy: alex.uid, updatedAt: serverTimestamp(), ...patch }));
    }
    for (const indented of [0, 1, 2, true, false]) await updateDoc(doc(a, itemPath), { indented, updatedBy: alex.uid, updatedAt: serverTimestamp() });
    await updateDoc(doc(a, itemPath), { text: 'x'.repeat(1000), updatedBy: alex.uid, updatedAt: serverTimestamp() });
    await updateDoc(doc(a, itemPath), { text: 'Bread', checked: false, updatedBy: alex.uid, updatedAt: serverTimestamp() });
    await denied(() => setDoc(doc(a, `${path(textId)}/items/nope`), { text: 'No', checked: false, ...metadata(alex.uid) }));
    await denied(() => getDocsFromServer(collection(a, `${path(textId)}/items`)));
    await denied(() => setDoc(doc(a, path(`bad-list-${run}`)), { ...note(alex.uid), kind: 'checklist', body: 'Must be empty' }));
    await setDoc(doc(a, `${path(checklistId)}/items/disposable`), { text: 'Delete me', checked: false, ...metadata(alex.uid) });
    await deleteDoc(doc(b, `${path(checklistId)}/items/disposable`));
    const restored = doc(a, `${path(checklistId)}/items/disposable`);
    await denied(() => setDoc(restored, { text: 'Invalid order', checked: false, sortAt: 123, ...metadata(alex.uid) }));
    await setDoc(restored, { text: 'Restored in place', checked: true, sortAt: Timestamp.fromMillis(1), ...metadata(alex.uid) });
    assert.equal((await getDocFromServer(doc(c, `${path(checklistId)}/items/disposable`))).data().sortAt.toMillis(), 1);
    await denied(() => updateDoc(restored, { sortAt: Timestamp.fromMillis(2), updatedBy: alex.uid, updatedAt: serverTimestamp() }));
    await deleteDoc(restored);
  });
  await check('private notes and lists belong only to their active owner, including direct paths and row operations', async () => {
    for (const [db, user] of [[a, alex], [b, sam], [c, jo]]) {
      await setDoc(doc(db, privatePath(user.uid, textId)), { ...note(user.uid, 'private'), title: `${user === alex ? 'Alex' : user === sam ? 'Sam' : 'Jo'} only` });
      assert.equal((await getDocFromServer(doc(db, privatePath(user.uid, textId)))).exists(), true);
      assert.equal((await getDocsFromServer(collection(db, `members/${user.uid}/notes`))).size, 1);
    }
    const list = privatePath(alex.uid, checklistId), row = `${list}/items/row`;
    await setDoc(doc(a, list), { ...note(alex.uid, 'private'), kind: 'checklist', title: 'Alex private list' });
    await setDoc(doc(a, row), { text: 'Private groceries', checked: false, ...metadata(alex.uid) });
    for (const db of [b, c, outsider, anonymous]) {
      await denied(() => getDocFromServer(doc(db, privatePath(alex.uid, textId))));
      await denied(() => getDocsFromServer(collection(db, `members/${alex.uid}/notes`)));
      await denied(() => getDocFromServer(doc(db, row)));
      await denied(() => getDocsFromServer(collection(db, `${list}/items`)));
      await denied(() => setDoc(doc(db, privatePath(alex.uid, `blocked-${run}`)), note(sam.uid)));
      await denied(() => updateDoc(doc(db, list), { title: 'Stolen', updatedBy: sam.uid, updatedAt: serverTimestamp() }));
      await denied(() => deleteDoc(doc(db, list)));
      await denied(() => setDoc(doc(db, `${list}/items/blocked`), { text: 'Blocked', checked: false, ...metadata(sam.uid) }));
      await denied(() => updateDoc(doc(db, row), { checked: true, updatedBy: sam.uid, updatedAt: serverTimestamp() }));
      await denied(() => deleteDoc(doc(db, row)));
    }
    await denied(() => getDocsFromServer(collection(outsider, `members/${visitor.uid}/notes`)));
    await denied(() => setDoc(doc(outsider, privatePath(visitor.uid, textId)), note(visitor.uid)));
    for (const db of [a, b, outsider, anonymous]) await denied(() => getDocsFromServer(collectionGroup(db, 'notes')));
    for (const parent of ['notebooks/other', `unknown/${alex.uid}`]) await denied(() => setDoc(doc(a, `${parent}/notes/blocked`), note(alex.uid)));
    assert.equal((await getDocsFromServer(visibleNotes(b, sam.uid))).docs.some(record => record.data().title === 'Alex only'), false);
  });
  await check('private data has the same validation, immutable ownership, bin recovery and row protections', async () => {
    const text = privatePath(alex.uid, textId), list = privatePath(alex.uid, checklistId), row = `${list}/items/row`;
    for (const patch of [{ extra: true }, { scope: 'shared' }, { title: 'x'.repeat(121) }, { body: 'x'.repeat(40001) }, { createdBy: sam.uid }, { createdAt: Timestamp.fromMillis(0) }, { updatedBy: sam.uid }, { state: 'deleted' }]) {
      await denied(() => updateDoc(doc(a, text), { updatedBy: alex.uid, updatedAt: serverTimestamp(), ...patch }));
    }
    await denied(() => setDoc(doc(a, privatePath(alex.uid, 'forged-owner')), note(sam.uid)));
    await denied(() => deleteDoc(doc(a, text)));
    await updateDoc(doc(a, text), { body: 'Still private', state: 'archived', updatedBy: alex.uid, updatedAt: serverTimestamp() });
    await updateDoc(doc(a, text), { state: 'active', updatedBy: alex.uid, updatedAt: serverTimestamp() });
    assert.equal((await getDocFromServer(doc(a, text))).data().body, 'Still private');
    await updateDoc(doc(a, row), { checked: true, indented: 2, updatedBy: alex.uid, updatedAt: serverTimestamp() });
    assert.equal((await getDocFromServer(doc(a, row))).data().text, 'Private groceries');
    for (const patch of [{ indented: 3 }, { text: 'x'.repeat(1001) }, { checked: 'yes' }, { createdBy: sam.uid }]) {
      await denied(() => updateDoc(doc(a, row), { updatedBy: alex.uid, updatedAt: serverTimestamp(), ...patch }));
    }
    await denied(() => setDoc(doc(a, `${text}/items/blocked`), { text: 'Text has no rows', checked: false, ...metadata(alex.uid) }));
    await setDoc(doc(a, `${list}/items/disposable`), { text: 'Delete me', checked: false, ...metadata(alex.uid) });
    await deleteDoc(doc(a, `${list}/items/disposable`));
  });
  const selectedId = `selected-${run}`, selectedListId = `selected-list-${run}`;
  fixture.createdNoteIds.push(selectedId, selectedListId);
  const selected = { audience: 'selected', sharedWith: [alex.uid, sam.uid] };
  const update = (uid, patch) => ({ ...patch, updatedBy: uid, updatedAt: serverTimestamp() });
  await check('selected notes/lists and every row operation require active participation, including known paths and broad queries', async () => {
    await setDoc(doc(a, path(selectedId)), { ...note(alex.uid), ...selected, body: 'Selected content' });
    await setDoc(doc(a, path(selectedListId)), { ...note(alex.uid), ...selected, kind: 'checklist' });
    const row = `${path(selectedListId)}/items/row`;
    await setDoc(doc(a, row), { text: 'Selected row', checked: false, ...metadata(alex.uid) });
    await updateDoc(doc(b, path(selectedId)), update(sam.uid, { body: 'Participant edit' }));
    await updateDoc(doc(b, row), update(sam.uid, { checked: true }));
    for (const db of [c, outsider, anonymous]) {
      for (const target of [path(selectedId), path(selectedListId), row]) {
        await denied(() => getDocFromServer(doc(db, target)));
        await denied(() => updateDoc(doc(db, target), update(jo.uid, { title: 'No access' })));
        await denied(() => deleteDoc(doc(db, target)));
      }
      await denied(() => getDocsFromServer(collection(db, `${path(selectedListId)}/items`)));
      await denied(() => setDoc(doc(db, `${path(selectedListId)}/items/nope`), { text: 'Blocked', checked: false, ...metadata(jo.uid) }));
    }
    for (const [db, user] of [[a, alex], [b, sam], [c, jo]]) {
      const ids = (await getDocsFromServer(visibleNotes(db, user.uid))).docs.map(record => record.id);
      assert.equal(ids.includes(selectedId), user !== jo);
      assert.ok(ids.includes(textId));
      await denied(() => getDocsFromServer(collection(db, 'notebooks/home/notes')));
    }
    await denied(() => getDocsFromServer(query(collection(c, 'notebooks/home/notes'), where('sharedWith', 'array-contains', sam.uid))));
    const disposable = `${path(selectedListId)}/items/disposable`;
    await setDoc(doc(b, disposable), { text: 'Participant row', checked: false, ...metadata(sam.uid) });
    await deleteDoc(doc(b, disposable));
  });
  await check('only the creator can change sharing; malformed access and ownership changes are denied', async () => {
    for (const patch of [{ audience: 'everyone', sharedWith: [] }, { sharedWith: [alex.uid, sam.uid, jo.uid] }]) {
      await denied(() => updateDoc(doc(b, path(selectedId)), update(sam.uid, patch)));
    }
    for (const patch of [{ audience: 'public' }, { audience: deleteField() }, { sharedWith: 'anyone' }, { sharedWith: [] }, { sharedWith: [sam.uid] }, { sharedWith: [alex.uid, alex.uid] }, { sharedWith: [alex.uid, ...Array.from({ length: 100 }, (_, i) => `member-${i}`)] }, { createdBy: sam.uid }]) {
      await denied(() => updateDoc(doc(a, path(selectedId)), update(alex.uid, patch)));
    }
    await denied(() => updateDoc(doc(a, path(textId)), update(alex.uid, { sharedWith: [alex.uid] })));
    await denied(() => setDoc(doc(b, path(`forged-${run}`)), { ...note(alex.uid), ...selected }));
    await denied(() => setDoc(doc(a, path(`missing-${run}`)), { ...note(alex.uid, 'private') }));
  });
  await check('new private notes and legacy private lists share in place and return to private without moving or losing content', async () => {
    const fresh = `private-default-${run}`; fixture.createdNoteIds.push(fresh);
    for (const target of [path(fresh), privatePath(alex.uid, checklistId)]) {
      if (target === path(fresh)) await setDoc(doc(a, target), { ...note(alex.uid), kind: 'checklist', audience: 'private', sharedWith: [alex.uid] });
      const ref = doc(a, target), row = `${target}/items/scope-row`;
      await setDoc(doc(a, row), { text: 'Preserved throughout sharing', checked: true, ...metadata(alex.uid) });
      const original = (await getDocFromServer(ref)).data();
      await denied(() => getDocFromServer(doc(b, target)));
      await denied(() => getDocFromServer(doc(b, row)));
      await updateDoc(ref, update(alex.uid, selected));
      assert.equal((await getDocFromServer(doc(b, row))).data().text, 'Preserved throughout sharing');
      assert.ok((await getDocsFromServer(visibleNotes(b, sam.uid))).docs.some(record => record.ref.path === target));
      await updateDoc(doc(b, row), update(sam.uid, { text: 'Participant correction' }));
      await denied(() => updateDoc(doc(b, target), update(sam.uid, { audience: 'everyone', sharedWith: [] })));
      await updateDoc(ref, update(alex.uid, { audience: 'everyone', sharedWith: [] }));
      assert.equal((await getDocFromServer(doc(c, row))).data().text, 'Participant correction');
      await updateDoc(ref, update(alex.uid, { audience: 'private', sharedWith: [alex.uid] }));
      for (const db of [b, c]) {
        await denied(() => getDocFromServer(doc(db, target)));
        await denied(() => getDocsFromServer(collection(db, `${target}/items`)));
        await denied(() => updateDoc(doc(db, row), update(sam.uid, { checked: false })));
        await denied(() => deleteDoc(doc(db, row)));
      }
      assert.equal((await getDocFromServer(ref)).data().createdBy, original.createdBy);
      assert.ok((await getDocFromServer(ref)).data().createdAt.isEqual(original.createdAt));
      assert.equal((await getDocFromServer(doc(a, row))).data().text, 'Participant correction');
      await denied(() => updateDoc(ref, update(alex.uid, { sharedWith: [alex.uid, sam.uid] })));
    }
  });
  await check('creator can add/remove people and switch everyone/selected; revocation also blocks rows and restores correctly', async () => {
    const ref = doc(a, path(selectedListId)), row = `${path(selectedListId)}/items/row`;
    await updateDoc(ref, update(alex.uid, { sharedWith: [alex.uid, jo.uid] }));
    await denied(() => getDocFromServer(doc(b, row)));
    await denied(() => updateDoc(doc(b, row), update(sam.uid, { checked: false })));
    await denied(() => deleteDoc(doc(b, row)));
    await denied(() => setDoc(doc(b, `${path(selectedListId)}/items/revoked`), { text: 'Denied', checked: false, ...metadata(sam.uid) }));
    assert.equal((await getDocFromServer(doc(c, row))).data().text, 'Selected row');
    await updateDoc(ref, update(alex.uid, { state: 'archived', pinned: true }));
    await denied(() => getDocFromServer(doc(b, path(selectedListId))));
    await updateDoc(ref, update(alex.uid, { state: 'active' }));
    await updateDoc(ref, update(alex.uid, { audience: 'everyone', sharedWith: [] }));
    assert.equal((await getDocFromServer(doc(b, row))).data().text, 'Selected row');
    await adminDb.doc(`members/${visitor.uid}`).set({ displayName: 'New member', active: true });
    assert.equal((await getDocFromServer(doc(outsider, path(selectedListId)))).exists(), true);
    await denied(() => getDocFromServer(doc(outsider, path(selectedId))));
    await adminDb.doc(`members/${visitor.uid}`).delete();
    await updateDoc(ref, update(alex.uid, { audience: 'selected', sharedWith: [alex.uid] }));
    await denied(() => getDocFromServer(doc(c, row)));
  });
  await check('legacy sharing migration is idempotent, preserves all note/row fields and leaves selected/private notes alone', async () => {
    const legacy = `legacy-${run}`; fixture.createdNoteIds.push(legacy);
    const ref = adminDb.doc(path(legacy)), row = ref.collection('items').doc('legacy-row');
    const { audience, ...content } = { ...note(alex.uid), kind: 'checklist', title: 'Existing content' };
    // Use concrete timestamps for Admin fixtures, rather than client sentinels.
    const { Timestamp: AdminTimestamp } = await import('firebase-admin/firestore');
    await ref.set({ ...content, createdAt: AdminTimestamp.fromMillis(1), updatedAt: AdminTimestamp.fromMillis(2) });
    await row.set({ text: 'Keep row', checked: true });
    const before = (await ref.get()).data(), privateBefore = (await adminDb.doc(privatePath(alex.uid, textId)).get()).data();
    assert.equal((await migrateSharing(adminDb, true)).missing, 1);
    assert.equal((await migrateSharing(adminDb)).updated, 1);
    assert.deepEqual((await ref.get()).data(), { ...before, audience: 'everyone' });
    assert.deepEqual((await row.get()).data(), { text: 'Keep row', checked: true });
    assert.equal((await migrateSharing(adminDb)).updated, 0);
    assert.deepEqual((await adminDb.doc(path(selectedId)).get()).data().sharedWith, selected.sharedWith);
    assert.deepEqual((await adminDb.doc(privatePath(alex.uid, textId)).get()).data(), privateBefore);
  });
  await check('deactivation denies shared and private access using existing tokens', async () => {
    await adminDb.doc(`members/${jo.uid}`).update({ active: false });
    for (const target of [path(textId), privatePath(jo.uid, textId)]) {
      await denied(() => getDocFromServer(doc(c, target)));
      await denied(() => updateDoc(doc(c, target), { title: 'Blocked', updatedBy: jo.uid, updatedAt: serverTimestamp() }));
    }
    await denied(() => getDocsFromServer(collection(c, 'members')));
    await denied(() => getDocsFromServer(collection(c, `members/${jo.uid}/notes`)));
  });
  console.log(`${passed} authorization groups passed. Demo emulators only.`);
} finally {
  try { await Promise.all(clients.map(deleteApp)); }
  finally { await fixture.cleanup(); }
}
