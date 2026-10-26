import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { DraftSaves } from '../src/saves.ts';

function queue(t, storageKey) {
  const saves = new DraftSaves(() => {}, storageKey);
  t.after(() => saves.dispose());
  return saves;
}

function storage(t) {
  const entries = new Map();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new Proxy({
      getItem: key => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, value),
      removeItem: key => entries.delete(key),
    }, {
      ownKeys: () => [...entries.keys()],
      getOwnPropertyDescriptor: (_, key) => entries.has(key) ? { configurable: true, enumerable: true, value: entries.get(key) } : undefined,
    }),
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
  return entries;
}

function journals(entries) { return [...entries.values()].map(value => JSON.parse(value).patches); }

test('a pending acknowledgement serializes newer edits without blocking another note', async t => {
  const saves = queue(t);
  const writes = [];
  let acknowledge;
  const writer = patch => { writes.push(patch); return new Promise(resolve => { acknowledge = resolve; }); };
  saves.schedule('one', { body: 'old' }, writer, true);
  saves.schedule('one', { body: 'new', title: 'Latest' }, writer);
  saves.schedule('two', { title: 'Other note' }, async patch => { writes.push(patch); }, true);
  assert.equal(saves.pending, true);
  assert.deepEqual(saves.draft('one'), { body: 'new', title: 'Latest' });
  assert.deepEqual(writes, [{ body: 'old' }, { title: 'Other note' }]);
  acknowledge(); await setImmediate();
  assert.deepEqual(writes.at(-1), { body: 'new', title: 'Latest' });
  assert.equal(saves.pending, true);
  acknowledge(); await setImmediate();
  assert.equal(saves.pending, false);
});

test('failed writes retain every field and retry with newer corrections', async t => {
  const saves = queue(t);
  let failing = true;
  const writes = [];
  const writer = async patch => { writes.push(patch); if (failing) throw new Error('network'); };
  saves.schedule('note', { body: 'Keep this', title: 'Old title' }, writer, true);
  await setImmediate();
  assert.equal(saves.failed, true);
  saves.schedule('note', { title: 'Corrected title' }, writer);
  saves.flush(); await setImmediate();
  assert.equal(writes.length, 1, 'a failed write waits for an explicit retry');
  assert.deepEqual(saves.draft('note'), { body: 'Keep this', title: 'Corrected title' });
  failing = false;
  saves.retry(); await setImmediate();
  assert.deepEqual(writes.at(-1), { body: 'Keep this', title: 'Corrected title' });
  assert.equal(saves.pending, false);
  assert.equal(saves.failed, false);
});

test('reopening recovers both submitted fields and newer text still awaiting debounce', async t => {
  const entries = storage(t);
  const saves = queue(t, 'synthetic/drafts');
  let acknowledge;
  saves.schedule('note', { body: 'Submitted', pinned: true }, () => new Promise(resolve => { acknowledge = resolve; }), true);
  saves.schedule('note', { body: 'Newest draft' }, async () => {});
  assert.deepEqual(journals(entries), [{ note: { body: 'Newest draft', pinned: true } }]);
  await saves.dispose();
  acknowledge(); await setImmediate();
  const reopened = queue(t, 'synthetic/drafts');
  const recovered = [];
  await reopened.restore(key => async patch => { recovered.push({ key, patch }); });
  assert.deepEqual(reopened.draft('note'), { body: 'Newest draft', pinned: true });
  reopened.flush(); await setImmediate();
  assert.deepEqual(recovered, [{ key: 'note', patch: { body: 'Newest draft', pinned: true } }]);
  assert.equal(entries.size, 0, 'only acknowledged fields leave the journal');
});

test('storage failure remains visible while the in-memory draft can still save', async t => {
  storage(t);
  localStorage.setItem = () => { throw new Error('storage full'); };
  const saves = queue(t, 'synthetic/drafts');
  const writes = [];
  saves.schedule('note', { body: 'Still editable' }, async patch => { writes.push(patch); });
  assert.equal(saves.durable, false);
  assert.deepEqual(saves.draft('note'), { body: 'Still editable' });
  saves.flush(); await setImmediate();
  assert.deepEqual(writes, [{ body: 'Still editable' }]);
  assert.equal(saves.pending, false);
});

test('malformed persisted drafts surface a durability problem', async t => {
  const entries = storage(t);
  entries.set('synthetic/drafts', '{interrupted');
  const saves = queue(t, 'synthetic/drafts');
  await saves.restore(() => async () => assert.fail('corrupt data must not be submitted'));
  assert.equal(saves.durable, false);
  assert.equal(saves.pending, false);
  assert.equal(entries.get('synthetic/drafts'), '{interrupted');
});

test('invalid writer records remain intact instead of being treated as empty journals', async t => {
  const entries = storage(t), key = 'synthetic/drafts/writers/interrupted';
  entries.set(key, JSON.stringify({ updatedAt: 1, patches: null }));
  const saves = queue(t, 'synthetic/drafts');
  await saves.restore(() => async () => assert.fail('invalid data must not be submitted'));
  assert.equal(saves.durable, false);
  assert.equal(entries.get(key), JSON.stringify({ updatedAt: 1, patches: null }));
});

test('revocation discards only that note and its rows, including late rejected writes, and purges unauthorized restored drafts', async t => {
  const entries = storage(t), saves = queue(t, 'synthetic/drafts');
  let reject;
  saves.schedule('item/revoked/row', { text: 'Submitted private content' }, () => new Promise((_, fail) => { reject = fail; }), true);
  saves.schedule('note/revoked', { title: 'Pending title' }, async () => assert.fail('revoked draft must not be submitted'));
  saves.schedule('note/revoked-longer', { title: 'Unrelated draft' }, async () => {});
  saves.discard('note/revoked'); saves.discard('item/revoked/');
  assert.deepEqual(journals(entries), [{ 'note/revoked-longer': { title: 'Unrelated draft' } }]);
  reject(new Error('permission-denied')); await setImmediate();
  assert.equal(saves.failed, false);
  assert.deepEqual(saves.draft('item/revoked/row'), {});
  saves.retainNotes(new Set(['revoked-longer']));
  saves.schedule('note/stale', { body: 'Old cached draft' }, async () => assert.fail('unauthorized restored draft must not be submitted'));
  saves.retainNotes(new Set(['revoked-longer']));
  assert.deepEqual(saves.draft('note/stale'), {});
  saves.flush(); await setImmediate();
  assert.equal(entries.size, 0);
});

test('independent tabs preserve unsent journals through another tab acknowledgement, failure and recovery', async t => {
  const entries = storage(t), first = queue(t, 'synthetic/drafts'), second = queue(t, 'synthetic/drafts');
  let acknowledge;
  first.schedule('note/first', { body: 'Unsubmitted first-tab text' }, async () => assert.fail('first tab closed before debounce'));
  second.schedule('note/second', { body: 'Submitted second-tab text' }, () => new Promise(resolve => { acknowledge = resolve; }), true);
  assert.equal(entries.size, 2);
  const observer = queue(t, 'synthetic/drafts');
  await observer.restore(() => async () => assert.fail('live writer must not be replayed'));
  assert.equal(observer.pending, false);
  acknowledge(); await setImmediate();
  assert.deepEqual(journals(entries), [{ 'note/first': { body: 'Unsubmitted first-tab text' } }]);
  assert.equal(first.durable, true);
  await first.dispose();
  let failing = true;
  const recovered = queue(t, 'synthetic/drafts');
  await recovered.restore(() => async () => { if (failing) throw new Error('network'); });
  recovered.flush(); await setImmediate();
  assert.equal(recovered.failed, true);
  assert.deepEqual(journals(entries), [{ 'note/first': { body: 'Unsubmitted first-tab text' } }]);
  failing = false; recovered.retry(); await setImmediate();
  assert.equal(entries.size, 0);
});

for (const order of [[0, 1], [1, 0]]) test(`same-field writers clear only their own acknowledged version (${order.join(',')})`, async t => {
  const entries = storage(t);
  const tabs = [queue(t, 'synthetic/drafts'), queue(t, 'synthetic/drafts')], acknowledge = [];
  for (const [index, tab] of tabs.entries()) tab.schedule('note/shared', { body: `Tab ${index}` }, () => new Promise(resolve => { acknowledge[index] = resolve; }), true);
  assert.equal(entries.size, 2);
  acknowledge[order[0]](); await setImmediate();
  assert.deepEqual(journals(entries), [{ 'note/shared': { body: `Tab ${order[1]}` } }]);
  assert.equal(tabs[order[1]].pending, true);
  acknowledge[order[1]](); await setImmediate();
  assert.equal(entries.size, 0);
});

test('two reopening tabs adopt an abandoned draft once and never replay the new live owner', async t => {
  const entries = storage(t), original = queue(t, 'synthetic/drafts');
  original.schedule('note/recovered', { body: 'Before debounce' }, async () => assert.fail('closed before submission'));
  await original.dispose();
  const reopened = [queue(t, 'synthetic/drafts'), queue(t, 'synthetic/drafts')], writes = [];
  await Promise.all(reopened.map(tab => tab.restore(() => async patch => { writes.push(patch); })));
  assert.equal(reopened.filter(tab => tab.pending).length, 1);
  assert.deepEqual(journals(entries), [{ 'note/recovered': { body: 'Before debounce' } }]);
  for (const tab of reopened) tab.flush();
  await setImmediate();
  assert.deepEqual(writes, [{ body: 'Before debounce' }]);
  assert.equal(entries.size, 0);
});

test('legacy journals migrate without losing fields and failed recovery copies preserve their source', async t => {
  const entries = storage(t);
  entries.set('synthetic/drafts', JSON.stringify({ 'note/legacy': { title: 'Keep title', body: 'Keep text' } }));
  const saves = queue(t, 'synthetic/drafts');
  const setItem = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('storage full'); };
  await saves.restore(() => async () => {});
  assert.equal(saves.durable, false);
  assert.equal(entries.has('synthetic/drafts'), true);
  await saves.dispose();
  localStorage.setItem = setItem;
  const reopened = queue(t, 'synthetic/drafts');
  await reopened.restore(() => async () => {});
  assert.deepEqual(reopened.draft('note/legacy'), { title: 'Keep title', body: 'Keep text' });
  assert.equal(entries.has('synthetic/drafts'), false);
  reopened.flush(); await setImmediate();
  assert.equal(entries.size, 0);
});

