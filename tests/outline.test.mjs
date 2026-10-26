import assert from 'node:assert/strict';
import test from 'node:test';
import { orderedNotes, orderedItems } from '../src/ordering.ts';
import { outlineItems, descendants, levelChanges, deletionPromotions } from '../src/outline.ts';

const time = value => ({ toMillis: () => value });
const row = (id, level = 0) => ({ id, text: id, checked: false, indented: level, createdAt: null });
const ids = items => items.map(item => item.id);

test('notes order pinned first, then newest, then ID, without changing the input', () => {
  const notes = [
    { id: 'recent', pinned: false, createdAt: time(10) },
    { id: 'pinned-b', pinned: true, createdAt: null },
    { id: 'pinned-a', pinned: true, createdAt: time(0) },
    { id: 'old', pinned: false, createdAt: time(1) },
  ];
  const before = [...notes];
  assert.deepEqual(ids(orderedNotes(notes)), ['pinned-a', 'pinned-b', 'recent', 'old']);
  assert.deepEqual(notes, before);
});

test('restored items retain their original sort position, including timestamp zero and ID ties', () => {
  const items = [
    { ...row('later'), createdAt: time(20) },
    { ...row('restored'), createdAt: time(100), sortAt: time(1) },
    { ...row('zero-b'), createdAt: time(30), sortAt: time(0) },
    { ...row('zero-a'), createdAt: null },
  ];
  const before = [...items];
  assert.deepEqual(ids(orderedItems(items)), ['zero-a', 'zero-b', 'restored', 'later']);
  assert.deepEqual(items, before);
});

test('outline normalizes first/skipped levels and legacy booleans without rewriting stored indentation', () => {
  const items = [row('d', false), row('b', 2), row('e', 2), row('a', 2), row('c', true)];
  const normalized = outlineItems(items);
  assert.deepEqual(ids(normalized), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(normalized.map(item => item.level), [0, 1, 1, 0, 1]);
  assert.deepEqual(items.map(item => item.indented), [false, 2, 2, 2, true]);
  assert.deepEqual(normalized.map(item => item.indented), [2, 2, true, false, 2]);
});

test('subtrees end at siblings and ancestors, while leaves and absent rows have no descendants', () => {
  const items = [row('a'), row('b', 1), row('c', 2), row('d', 1), row('e')];
  assert.deepEqual(ids(descendants(items, 'a')), ['b', 'c', 'd']);
  assert.deepEqual(ids(descendants(items, 'b')), ['c']);
  assert.deepEqual(descendants(items, 'c'), []);
  assert.deepEqual(descendants(items, 'missing'), []);
});

test('moving a parent moves its subtree together and preserves sibling levels and content', () => {
  const items = [row('a'), row('b', 1), { ...row('c', 2), checked: true }, row('d')];
  const before = structuredClone(items);
  assert.deepEqual(levelChanges(items, 'b', 0), [{ id: 'b', level: 0 }, { id: 'c', level: 1 }]);
  assert.deepEqual(items, before);
  assert.deepEqual(levelChanges(items, 'b', 1), []);
});

test('invalid indentation produces no writes: first row, skipped levels, missing IDs and overflowing subtrees', () => {
  const items = [row('a'), row('b'), row('c', 1), row('d', 2)];
  for (const [id, level] of [['a', 1], ['b', 2], ['b', 1], ['missing', 0], ['b', -1], ['b', 3]]) {
    assert.equal(levelChanges(items, id, level), null, `${id} cannot move to ${level}`);
  }
});

test('a parent can indent beneath its predecessor together with descendants that still fit', () => {
  const items = [row('a'), row('b'), row('c', 1), row('d')];
  assert.deepEqual(levelChanges(items, 'b', 1), [{ id: 'b', level: 1 }, { id: 'c', level: 2 }]);
  assert.equal(items[3].indented, 0);
});

test('deleting a parent promotes only its descendants one level, preserving relative nesting', () => {
  const items = [row('a'), row('b', 1), row('c', 2), row('d', 1), row('e')];
  assert.deepEqual(deletionPromotions(items, 'a'), [{ id: 'b', level: 0 }, { id: 'c', level: 1 }, { id: 'd', level: 0 }]);
  assert.deepEqual(deletionPromotions(items, 'b'), [{ id: 'c', level: 1 }]);
  assert.deepEqual(deletionPromotions(items, 'c'), []);
  assert.deepEqual(deletionPromotions(items, 'missing'), []);
});
