import assert from 'node:assert/strict';
import { expect } from 'playwright/test';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { test as base } from './fixtures.mjs';
import { path, privatePath } from './emulator.mjs';
import { saved, open, network, screenshot, focusUndo, serverTimeout } from './browser.mjs';

const test = base.extend({
  guideline: async ({ fixture }, use) => {
    const { adminDb, run, createdNoteIds } = fixture;
    const [alex] = fixture.users;
    const id = `guidelines-${run}`, privateId = `guidelines-private-${run}`;
    const long = 'Buy bread, oat milk, fresh vegetables and the ingredients for Saturday dinner; the final words must remain readable.';
    const metadata = () => ({ createdBy: alex.uid, createdAt: FieldValue.serverTimestamp(), updatedBy: alex.uid, updatedAt: FieldValue.serverTimestamp() });
    const note = title => ({ kind: 'checklist', title, body: '', pinned: false, state: 'active', ...metadata() });
    const rows = [['parent', long, 0], ['child', 'Child with newer shared text', 1], ['nested', 'Nested instruction: choose the allergy-safe option', 2], ['sibling', 'Independent sibling', 0]];
    const batch = adminDb.batch();
    createdNoteIds.push(id);
    batch.set(adminDb.doc(path(id)), { ...note('Review note primary'), audience: 'everyone', createdAt: Timestamp.fromMillis(1) });
    batch.set(adminDb.doc(privatePath(alex.uid, privateId)), note('Private review list'));
    for (const [index, [rowId, text, indented]] of rows.entries()) batch.set(adminDb.doc(`${path(id)}/items/${rowId}`), { text, checked: index === 0, indented, ...metadata(), createdAt: Timestamp.fromMillis(index + 1) });
    batch.set(adminDb.doc(`${privatePath(alex.uid, privateId)}/items/only`), { text: 'Private original item', checked: true, ...metadata() });
    await batch.commit();
    await use({ id, privateId, long, rows });
  },
});

test('Back retains search, scroll, focused note and Bin context, including browser history and People', async ({ guideline, fixture, p: page }) => {
  const { id } = guideline;
  const { adminDb } = fixture;
  const card = () => page.locator(`[data-note-id="${id}"] .note-row`);
  const template = (await adminDb.doc(path(id)).get()).data();
  const batch = adminDb.batch();
  for (let i = 0; i < 16; i++) {
    const extra = `guidelines-${fixture.run}-${i}`; fixture.createdNoteIds.push(extra);
    batch.set(adminDb.doc(path(extra)), { ...template, title: `Review note ${i}`, kind: 'text', body: 'Disposable content to exercise scroll restoration.', createdAt: FieldValue.serverTimestamp() });
  }
  await batch.commit();
  await page.getByLabel('Search notes').fill('Review note');
  await expect(page.locator('.note-row')).toHaveCount(17);
  await card().scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => scrollY);
  assert.ok(scroll > 0);
  await card().press('Enter');
  await expect(page.locator('.editor')).toBeFocused();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Search notes')).toHaveValue('Review note');
  await expect(card()).toBeFocused();
  await expect.poll(() => page.evaluate(expected => Math.abs(scrollY - expected), scroll)).toBeLessThanOrEqual(1);
  await page.goBack(); await expect(page.getByLabel('Note title')).toBeVisible();
  await page.goBack(); await expect(page.getByLabel('Search notes')).toHaveValue('Review note');
  await page.getByRole('button', { name: /People, \d+ members/ }).click();
  await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Search notes')).toHaveValue('Review note');
  await page.getByRole('button', { name: 'Actions: Review note primary', exact: true }).click();
  await page.getByRole('button', { name: 'Move to bin', exact: true }).click(); await saved(page);
  await page.getByRole('button', { name: 'Bin', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bin', exact: true })).toBeVisible();
  await page.getByLabel('Search notes').fill('primary'); await card().click();
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bin', exact: true })).toBeVisible();
  await expect(page.getByLabel('Search notes')).toHaveValue('primary');
  await expect(card()).toBeFocused();
  await card().click(); await page.getByRole('button', { name: 'Restore', exact: true }).click(); await saved(page);
  await expect.poll(async () => (await adminDb.doc(path(id)).get()).data().state).toBe('active');
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bin', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Search notes')).toHaveValue('Review note');
});

test('remote bin/access removal keeps focus on a neighbouring card or Search without stealing search/dialog focus', async ({ guideline, fixture, p: page }) => {
  const { id } = guideline;
  const { adminDb, run, createdNoteIds } = fixture;
  const removedId = `focus-removed-${run}`, keptId = `focus-kept-${run}`;
  createdNoteIds.push(removedId, keptId);
  const [, sam] = fixture.users;
  const base = { kind: 'text', title: 'Focus removal', body: '', pinned: false, state: 'active',
    createdBy: sam.uid, updatedBy: sam.uid, updatedAt: FieldValue.serverTimestamp(), audience: 'everyone' };
  const now = Date.now();
  await adminDb.doc(path(removedId)).set({ ...base, createdAt: Timestamp.fromMillis(now + 1) });
  await adminDb.doc(path(keptId)).set({ ...base, title: 'Focus neighbour', createdAt: Timestamp.fromMillis(now) });
  // Search intentionally includes Bin, so use the ordinary active list for
  // the bin-removal case, then exercise a last search match separately.
  await page.getByLabel('Search notes').fill('');
  const removed = page.locator(`[data-note-id="${removedId}"] .note-row`);
  const kept = page.locator(`[data-note-id="${keptId}"] .note-row`);
  await expect(removed).toBeVisible(); await expect(kept).toBeVisible();
  await removed.focus();
  await adminDb.doc(path(removedId)).update({ state: 'archived' });
  await expect(removed).toHaveCount(0); await expect(kept).toBeFocused();
  await adminDb.doc(path(removedId)).update({ state: 'active' });
  await expect(removed).toBeVisible(); await expect(kept).toBeFocused();
  await page.locator(`[data-note-id="${removedId}"] .note-options`).focus();
  await adminDb.doc(path(removedId)).update({ audience: 'private', sharedWith: [sam.uid] });
  await expect(removed).toHaveCount(0); await expect(kept).toBeFocused();
  await page.getByLabel('Search notes').fill('Focus neighbour'); await kept.focus();
  await adminDb.doc(path(keptId)).update({ title: 'A renamed note' });
  await expect(page.locator('.note-row')).toHaveCount(0);
  await expect(page.getByLabel('Search notes')).toBeFocused();
  await expect(page.getByLabel('Search notes')).toHaveValue('Focus neighbour');
  await adminDb.doc(path(keptId)).update({ title: 'Focus neighbour' });
  await expect(kept).toBeVisible(); await expect(page.getByLabel('Search notes')).toBeFocused();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const choice = page.getByRole('button', { name: 'List', exact: true });
  await expect(choice).toBeFocused();
  await adminDb.doc(path(keptId)).update({ audience: 'private', sharedWith: [sam.uid] });
  await expect(page.locator('.note-row')).toHaveCount(0); await expect(choice).toBeFocused();
  await page.keyboard.press('Escape');
});

test('row Undo restores original order, checked state and descendants, synchronizes and survives offline acknowledgement', async ({ guideline, fixture, p: page, q: remote }) => {
  const { id, privateId, long, rows } = guideline;
  const { adminDb } = fixture;
  await Promise.all([open(page, id), open(remote, id)]); await Promise.all([saved(page), saved(remote)]);
  await page.getByRole('button', { name: `Actions: ${long}`, exact: true }).click();
  await page.getByRole('button', { name: `Remove ${long}`, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible({ timeout: serverTimeout });
  await expect(page.getByLabel('Checklist item', { exact: true }).first()).toBeFocused();
  await focusUndo(page); await saved(page);
  assert.equal((await adminDb.doc(`${path(id)}/items/parent`).get()).exists, false);
  await expect(remote.locator('.check-row')).toHaveCount(3);
  await expect(remote.locator('.check-row').nth(0)).toHaveAttribute('data-level', '0');
  await expect(remote.locator('.check-row').nth(1)).toHaveAttribute('data-level', '1');
  await adminDb.doc(`${path(id)}/items/child`).update({ text: 'A newer remote edit survives Undo' });
  await network(page, false);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.save-bar')).toHaveClass('save-bar sr-only');
  await expect(page.locator('.save-bar')).toContainText('Saving');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await network(page, true); await saved(page);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeHidden();
  for (const p of [page, remote]) {
    await expect(p.locator('.check-row')).toHaveCount(4);
    await expect.poll(() => p.getByLabel('Checklist item', { exact: true }).evaluateAll(nodes => nodes.map(node => node.value))).toEqual([long, 'A newer remote edit survives Undo', rows[2][1], rows[3][1]]);
    for (const [i, level] of [0, 1, 2, 0].entries()) await expect(p.locator('.check-row').nth(i)).toHaveAttribute('data-level', String(level));
    await expect(p.getByRole('checkbox').first()).toBeChecked();
  }
  await expect(page.getByLabel('Checklist item', { exact: true }).first()).toBeFocused();
  await page.reload(); await saved(page);
  await expect(page.getByLabel('Checklist item', { exact: true }).first()).toHaveValue(long);
  assert.equal((await adminDb.doc(`${path(id)}/items/parent`).get()).data().sortAt.toMillis(), 1);
  await page.getByRole('button', { name: `Actions: ${long}`, exact: true }).click();
  await page.getByRole('button', { name: `Remove ${long}`, exact: true }).click(); await focusUndo(page); await saved(page);
  await adminDb.doc(`${path(id)}/items/nested`).update({ indented: 0 });
  await expect(page.locator('.check-row').nth(1)).toHaveAttribute('data-level', '0');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await saved(page);
  assert.equal((await adminDb.doc(`${path(id)}/items/nested`).get()).data().indented, 0);
  await expect(page.getByLabel('Checklist item', { exact: true }).first()).toHaveValue(long);
  await adminDb.doc(`${path(id)}/items/nested`).update({ indented: 2 });
  await open(page, `private:${privateId}`); await saved(page);
  await page.getByRole('button', { name: 'Actions: Private original item', exact: true }).click();
  await page.getByRole('button', { name: 'Remove Private original item', exact: true }).click(); await focusUndo(page); await saved(page);
  await expect(page.locator('.check-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await saved(page);
  await expect(page.getByLabel('Checklist item', { exact: true })).toHaveValue('Private original item');
  await expect(page.getByRole('checkbox')).toBeChecked();
  await expect(remote.locator(`[data-note-id="private:${privateId}"]`)).toHaveCount(0);
});

test('item touch swipes clear the bin preview on release, keep indentation and promote deleted children with Undo', async ({ guideline, fixture, p: page, q: remote }) => {
  const { id, privateId, long } = guideline;
  const { adminDb } = fixture;
  const [alex] = fixture.users;
  await Promise.all([open(page, id), open(remote, id)]); await Promise.all([saved(page), saved(remote)]);
  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const end = type => touch.send('Input.dispatchTouchEvent', { type, touchPoints: [] });
  const drag = async (index, dx, dy = 0, finish = 'touchEnd') => {
    const row = page.locator('.check-row').nth(index);
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    const x = dx < 0 ? box.x + box.width - 60 : box.x + 70, y = box.y + 24;
    const point = (x, y) => ({ x, y, id: 1 });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(x, y)] });
    for (let step = 1; step <= 12; step++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(x + dx * step / 12, y + dy * step / 12)] });
    if (finish) await end(finish);
  };
  const levels = p => p.locator('.check-row').evaluateAll(nodes => nodes.map(node => Number(node.dataset.level)));
  const undo = async count => {
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await saved(page);
    await expect(page.locator('.check-row')).toHaveCount(count);
  };
  try {
    // A small right swipe indents; a left swipe unindents without removing.
    await drag(3, 80); await saved(page);
    await expect(remote.locator('.check-row').nth(3)).toHaveAttribute('data-level', '1');
    await drag(3, -80); await saved(page);
    await expect(remote.locator('.check-row').nth(3)).toHaveAttribute('data-level', '0');
    // Passing the indent zone must not indent an otherwise indentable row.
    await drag(3, 210, 0, null);
    await expect(page.locator('.check-row.swipe-ready')).toHaveCount(1);
    assert.equal((await adminDb.doc(`${path(id)}/items/sibling`).get()).data().indented, 0);
    await end('touchCancel');
    // Even after revealing the bin, a shorter release just indents and resets.
    await drag(3, 110, 0, null);
    await expect(page.locator('.check-row').nth(3).locator('.swipe-bin')).toBeVisible();
    await end('touchEnd'); await saved(page);
    await expect(remote.locator('.check-row').nth(3)).toHaveAttribute('data-level', '1');
    await expect(page.locator('.check-row .swipe-bin:visible')).toHaveCount(0);
    await expect(page.locator('.check-row').nth(3).locator('.check-content')).toHaveCSS('transform', 'none');
    await drag(3, -80); await saved(page);
    await expect(remote.locator('.check-row').nth(3)).toHaveAttribute('data-level', '0');
    for (const [dx, dy, finish] of [[30, 0, 'touchEnd'], [0, -65, 'touchEnd'], [210, 0, 'touchCancel'], [80, 0, 'touchCancel']]) {
      await drag(0, dx, dy, finish);
      await expect(page.locator('.check-row .swipe-bin:visible')).toHaveCount(0);
      await expect(page.locator('.indent-ready, .swipe-ready')).toHaveCount(0);
      assert.equal((await adminDb.doc(`${path(id)}/items/parent`).get()).exists, true);
      assert.deepEqual(await levels(page), [0, 1, 2, 0]);
    }
    // The middle stage reveals the same donkey bin without changing levels.
    await drag(0, 110, 0, null);
    const bin = page.locator('.check-row').first().getByRole('button', { name: `Remove ${long}`, exact: true });
    await expect(bin).toBeVisible();
    await expect(bin.locator('img')).toHaveAttribute('src', '/themes/donkey-ui/bin.webp');
    assert.deepEqual(await levels(page), [0, 1, 2, 0]);
    await end('touchEnd'); await saved(page);
    await expect(bin).toBeHidden();
    await expect(page.locator('.check-row').first().locator('.check-content')).toHaveCSS('transform', 'none');
    assert.deepEqual(await levels(page), [0, 1, 2, 0]);
    // Crossing the final threshold does nothing until the gesture is released.
    await drag(0, 210, 0, null);
    await expect(page.locator('.check-row.swipe-ready')).toHaveCount(1);
    assert.equal((await adminDb.doc(`${path(id)}/items/parent`).get()).exists, true);
    await end('touchEnd'); await focusUndo(page); await saved(page);
    await expect(remote.locator('.check-row')).toHaveCount(3);
    assert.deepEqual(await levels(remote), [0, 1, 0]);
    const child = (await adminDb.doc(`${path(id)}/items/child`).get()).data();
    const nested = (await adminDb.doc(`${path(id)}/items/nested`).get()).data();
    assert.equal(child.indented, 0); assert.equal(nested.indented, 1);
    assert.equal(child.updatedAt.toMillis(), nested.updatedAt.toMillis());
    await undo(4);
    assert.deepEqual(await levels(page), [0, 1, 2, 0]);
    await expect(page.getByRole('checkbox').first()).toBeChecked();
    // Removing a subitem promotes its nested child without changing siblings.
    await drag(1, 210); await focusUndo(page); await saved(page);
    await expect(remote.locator('.check-row')).toHaveCount(3);
    assert.deepEqual(await levels(remote), [0, 1, 0]);
    assert.equal((await adminDb.doc(`${path(id)}/items/nested`).get()).data().indented, 1);
    await undo(4);
    await open(page, `private:${privateId}`); await saved(page);
    await drag(0, 210); await focusUndo(page); await saved(page);
    await expect(page.locator('.check-row')).toHaveCount(0);
    assert.equal((await adminDb.doc(`${privatePath(alex.uid, privateId)}/items/only`).get()).exists, false);
    await undo(1);
    await expect(page.getByLabel('Checklist item', { exact: true })).toHaveValue('Private original item');
    await expect(page.getByRole('checkbox')).toBeChecked();
  } finally {
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await touch.detach();
  }
});

test('long checklist text wraps fully at 100/200% text and phone/tablet widths; touch targets and focus stay usable', async ({ guideline, fixture, p: page }) => {
  const { id } = guideline;
  const card = () => page.locator(`[data-note-id="${id}"] .note-row`);
  await open(page, id); await saved(page);
  for (const width of [320, 390, 411, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    for (const size of [16, 32]) {
      await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, size);
      await expect.poll(() => page.locator('.check-row textarea').evaluateAll(inputs => inputs.filter(input => input.clientHeight < input.scrollHeight - 1 || input.clientWidth < input.scrollWidth - 1).map(input => ({ text: input.value, width: input.clientWidth, scrollWidth: input.scrollWidth, height: input.clientHeight, scrollHeight: input.scrollHeight }))), { message: `Full checklist text at ${width}px / ${size}px font` }).toEqual([]);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('button:not([hidden]), .check-toggle').evaluateAll(nodes => nodes.filter(n => n.getClientRects().length).every(n => { const r = n.getBoundingClientRect(); return r.width >= 48 && r.height >= 48; })), true);
      if (width === 320) await screenshot(page, `guidelines-checklist-${size}px.png`, { fullPage: true });
    }
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.keyboard.press('Tab'); await card().focus();
  const focus = await card().evaluate(node => { const s = getComputedStyle(node); return { visible: node.matches(':focus-visible'), style: s.outlineStyle, width: parseFloat(s.outlineWidth), offset: parseFloat(s.outlineOffset) }; });
  assert.equal(focus.visible, true); assert.equal(focus.style, 'solid'); assert.ok(focus.width >= 2 && focus.offset < 0);
  await screenshot(page, 'guidelines-home-focus.png', { fullPage: true });
});

