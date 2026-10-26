import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { DeviceCache, clearFirestoreCoordination, clearOrphanedFirestoreCoordination } from '../src/device-cache.ts';

function environment(t) {
  const entries = new Map(), window = new EventTarget();
  for (const [key, value] of Object.entries({ window, localStorage: {
    getItem: key => entries.get(key) ?? null,
    setItem(key, value) {
      entries.set(key, value);
      queueMicrotask(() => window.dispatchEvent(Object.assign(new Event('storage'), { key, newValue: value })));
    },
    removeItem: key => entries.delete(key),
  } })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value: key === 'localStorage' ? new Proxy(value, {
      ownKeys: () => [...entries.keys()],
      getOwnPropertyDescriptor: (_, key) => entries.has(key) ? { configurable: true, enumerable: true, value: entries.get(key) } : undefined,
    }) : value });
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  return entries;
}

test('cache cleanup closes every reader and removes only this database coordination before reopening', async t => {
  const entries = environment(t), key = 'synthetic/clear-cache';
  const namespace = 'firestore/[DEFAULT]/demo-eselsohr/';
  const owned = ['targets', 'clients', 'mutations'].map(kind => `firestore_${kind}_${namespace}_2`)
    .concat(['online_state', 'sequence_number', 'bundle_loaded_v2'].map(kind => `firestore_${kind}_${namespace}`));
  const preserved = ['synthetic/drafts/writers/one', 'firebase:authUser:fake:[DEFAULT]',
    'firestore_targets_firestore/[DEFAULT]/demo-other/_2',
    'firestore_targets_firestore/[DEFAULT]/demo-eselsohr.other/_2',
    'firestore_targets_firestore/other-app/demo-eselsohr/_2'];
  for (const entry of [...owned, ...preserved]) entries.set(entry, 'preserve');
  const stopped = [], readers = [];
  let deletions = 0, preparations = 0, release, began;
  const started = new Promise(resolve => { began = resolve; });
  const erase = async () => {
    assert.deepEqual(stopped.sort(), [0, 1]);
    deletions++; began();
    await new Promise(resolve => { release = resolve; });
    clearFirestoreCoordination('[DEFAULT]', 'demo-eselsohr');
  };
  for (let index = 0; index < 2; index++) {
    const cache = new DeviceCache(key, async () => { stopped.push(index); }, erase, async () => { preparations++; });
    await cache.open(); readers.push(cache);
  }
  const clearing = readers[0].clear(); await started;
  assert.equal(preparations, 1, 'first-start preparation happens once before readers');
  assert.ok(entries.get(key), 'interruption recovery is durable before erasing');
  let reopened = false;
  const next = new DeviceCache(key, async () => {}, async () => { deletions++; });
  const opening = next.open().then(() => { reopened = true; });
  await setImmediate(); assert.equal(reopened, false);
  release(); await clearing; await opening; await readers[1].clear();
  assert.equal(deletions, 1, 'queued old cleanup cannot delete the reopened generation');
  assert.equal(entries.has(key), false);
  for (const entry of owned) assert.equal(entries.has(entry), false, entry);
  for (const entry of preserved) assert.equal(entries.get(entry), 'preserve', entry);
  await next.clear();
});

test('interrupted cleanup retries before granting readers and stale generation markers cannot erase new data', async t => {
  const entries = environment(t), key = 'synthetic/recovery';
  const original = new DeviceCache(key, async () => {}, async () => { throw new Error('interrupted'); });
  await original.open();
  await assert.rejects(original.clear(), /interrupted/);
  assert.equal(entries.get(key), 'initial');
  let deletions = 0;
  const recovered = new DeviceCache(key, async () => {}, async () => { deletions++; });
  await recovered.open();
  assert.equal(deletions, 1);
  assert.equal(entries.has(key), false);
  await recovered.clear();
  const generation = entries.get(`${key}/generation`);
  entries.set(key, 'initial');
  const next = new DeviceCache(key, async () => {}, async () => { deletions++; });
  await next.open();
  assert.equal(entries.get(`${key}/generation`), generation);
  assert.equal(deletions, 2, 'a stale marker does not erase the new cache');
  await next.clear();
});

test('startup recovers the previous release cleanup marker', async t => {
  const entries = environment(t), key = 'synthetic/legacy';
  entries.set(key, '1');
  let deletions = 0;
  const cache = new DeviceCache(key, async () => {}, async () => { deletions++; });
  await cache.open();
  assert.equal(deletions, 1);
  assert.equal(entries.has(key), false);
  await cache.clear();
});

test('first-start recovery removes orphaned markers only when the exact database is absent', async t => {
  const entries = environment(t), key = 'firestore_targets_firestore/[DEFAULT]/demo-eselsohr/_2';
  const other = 'firestore_targets_firestore/[DEFAULT]/demo-other/_2';
  entries.set(key, 'current'); entries.set(other, 'preserve');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  let databases = [{ name: 'firestore/[DEFAULT]/demo-eselsohr/main' }];
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { databases: async () => databases } });
  t.after(() => original ? Object.defineProperty(globalThis, 'indexedDB', original) : delete globalThis.indexedDB);
  await clearOrphanedFirestoreCoordination('[DEFAULT]', 'demo-eselsohr');
  assert.equal(entries.get(key), 'current', 'a populated legacy cache retains its coordination');
  databases = [{ name: 'firestore/[DEFAULT]/demo-other/main' }];
  await clearOrphanedFirestoreCoordination('[DEFAULT]', 'demo-eselsohr');
  assert.equal(entries.has(key), false);
  assert.equal(entries.get(other), 'preserve');
});
