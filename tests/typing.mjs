import { test } from './fixtures.mjs';
import assert from 'node:assert/strict';
import { expect } from 'playwright/test';
import { path } from './emulator.mjs';
import { signIn, saved, open, network, pauseClock } from './browser.mjs';

test('typing sizes only the edited row, journals before debounce and preserves new/remote rows', async ({ browser, fixture, errors }) => {
  const id = `typing-${fixture.run}`;
  fixture.createdNoteIds.push(id);
  const base = (await fixture.adminDb.doc(path(fixture.checklistId)).get()).data();
  const item = (await fixture.adminDb.doc(fixture.itemPath).get()).data();
  const batch = fixture.adminDb.batch();
  batch.set(fixture.adminDb.doc(path(id)), { ...base, title: 'Typing regression' });
  for (let i = 0; i < 60; i++) batch.set(fixture.adminDb.doc(`${path(id)}/items/${String(i).padStart(3, '0')}`), { ...item, text: `Item ${i}`, checked: false });
  await batch.commit();
  const context = await browser.newContext({ viewport: { width: 411, height: 840 } });
  try {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await signIn(page, fixture.users[0], fixture.password); await saved(page);
    await open(page, id); await saved(page);
    const rows = page.getByLabel('Checklist item', { exact: true });
    await expect(rows).toHaveCount(60);
    await network(page, false);
    const first = rows.first(); await first.focus(); await first.press('End');
    await pauseClock(page);
    await page.clock.runFor(50); // Deliver initial layout observation before measuring input.
    await page.evaluate(async () => {
      const { EditorView } = await import('/src/views/editor.ts');
      const { NotesRepository } = await import('/src/notes.ts');
      window.typingWork = { reads: [], updates: 0, writes: 0 };
      const height = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
      Object.defineProperty(Element.prototype, 'scrollHeight', { ...height, get() {
        if (this.matches('.item-input')) window.typingWork.reads.push(this);
        return height.get.call(this);
      } });
      const update = EditorView.prototype.update;
      EditorView.prototype.update = function (...args) { window.typingWork.updates++; return update.apply(this, args); };
      const write = NotesRepository.prototype.saveItem;
      NotesRepository.prototype.saveItem = function (...args) { window.typingWork.writes++; return write.apply(this, args); };
    });
    await page.keyboard.type(' latest');
    const work = await page.evaluate(() => ({ reads: window.typingWork.reads.length,
      editedOnly: window.typingWork.reads.every(input => input === document.activeElement),
      updates: window.typingWork.updates, writes: window.typingWork.writes,
      draft: JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.includes('/drafts/')))),
    }));
    assert.equal(work.reads, 7, 'one height read per typed character, independent of list size');
    assert.equal(work.editedOnly, true, 'no sibling or new-item textarea measured while typing');
    assert.equal(work.updates, 0, 'save scheduling does not refresh the editor');
    assert.equal(work.writes, 0);
    assert.equal(work.draft.patches[`item/${id}/000`].text, 'Item 0 latest', 'newest text is durable before debounce');
    await page.clock.runFor(649);
    assert.equal(await page.evaluate(() => window.typingWork.writes), 0);
    await page.clock.runFor(1);
    await expect.poll(() => page.evaluate(() => window.typingWork.writes)).toBe(1);
    await expect(page.locator('.save-bar .status')).not.toHaveText('Saved');
    await page.clock.resume();
    const added = page.getByLabel('New checklist item', { exact: true });
    for (const text of ['First pending row', 'Second pending row']) { await added.fill(text); await added.press('Enter'); }
    await expect(rows).toHaveCount(62);
    await expect(rows.nth(60)).toHaveValue('First pending row');
    await expect(rows.nth(61)).toHaveValue('Second pending row');
    await page.getByRole('checkbox').first().check();
    await expect(page.locator('.check-row').first()).toHaveClass(/checked/);
    await page.getByRole('button', { name: 'Pin', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Unpin', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await network(page, true); await saved(page);
    await expect.poll(async () => (await fixture.adminDb.doc(`${path(id)}/items/000`).get()).data().text).toBe('Item 0 latest');

    const long = 'Long shared checklist text that must wrap completely without hiding its final words. '.repeat(5);
    await fixture.adminDb.doc(`${path(id)}/items/000`).update({ text: long });
    await expect(first).toHaveValue(long);
    await page.setViewportSize({ width: 320, height: 840 });
    await page.addStyleTag({ content: ':root { font-size:32px; }' });
    const fits = () => first.evaluate(input => input.scrollHeight <= input.clientHeight + 2);
    await expect.poll(fits).toBe(true);
    const expanded = await first.evaluate(input => input.clientHeight);
    await first.fill('Short');
    await expect.poll(async () => first.evaluate(input => input.clientHeight)).toBeLessThan(expanded);
    await expect.poll(fits).toBe(true);
    await first.blur(); await saved(page);
    await fixture.adminDb.doc(`${path(id)}/items/000`).update({ text: long });
    await expect(first).toHaveValue(long); await expect.poll(fits).toBe(true);
    await page.reload(); await saved(page);
    await expect(rows).toHaveCount(62); await expect(first).toHaveValue(long);
  } finally { await context.close(); }
});
