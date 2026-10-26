import { test } from './fixtures.mjs';
import assert from 'node:assert/strict';
import { expect } from 'playwright/test';
import { origin, screenshot } from './browser.mjs';

test('list cards grow with content, cap long previews and pack without gaps after updates or resizing', async ({ browser, errors }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await page.evaluate(async () => {
      const { HomeView } = await import('/src/views/home.ts');
      const noop = () => {};
      window.cardActions = [];
      const home = new HomeView('active', 'all', {
        companion: document.createElement('div'), open: id => window.cardActions.push(id),
        create: noop, filter: noop, navigate: noop, changeState: noop, pin: noop, sharing: noop,
      });
      const definitions = [['a-short', 'Weekend bag', 2], ['b-long', 'Garden plans', 7], ['c-medium', 'At the market', 4], ['d-overlong', 'Things to try', 15], ['e-empty', 'New list', 0]];
      const notes = definitions.map(([id, title]) => ({ id, title, kind: 'checklist', body: '', pinned: false, state: 'active', audience: 'private', createdAt: null }));
      notes.push({ id: 'pinned', title: 'A quiet reminder', kind: 'text', body: 'A short note.\nRemember to leave some room.', pinned: true, state: 'active', audience: 'everyone', createdAt: null });
      const items = new Map(definitions.map(([id, , count]) => [id, Array.from({ length: count }, (_, index) => ({
        id: `row-${String(index).padStart(2, '0')}`, text: index === 14 ? 'Find this hidden item' : `Item ${index + 1}`,
        checked: index === 1, indented: index === 2 ? 1 : index === 3 ? 2 : 0, createdAt: null,
      }))]));
      window.updateCardCheck = (id, count) => {
        items.set(id, Array.from({ length: count }, (_, index) => ({ id: `changed-${index}`, text: `Updated item ${index + 1}`, checked: false, createdAt: null })));
        home.update(notes, [], items, false);
      };
      window.disposeCardCheck = () => home.dispose();
      document.body.replaceChildren(home.root); home.update(notes, [], items, false);
    });
    const card = id => page.locator(`.note-swipe[data-note-id="${id}"]`);
    const height = id => card(id).evaluate(node => node.getBoundingClientRect().height);
    for (const [id, count] of [['a-short', 2], ['b-long', 7], ['c-medium', 4], ['d-overlong', 7]]) {
      await expect(card(id).locator('.mini-check')).toHaveCount(count);
    }
    await expect(card('d-overlong').locator('.note-more')).toHaveText('+ 8 more');
    await expect(card('d-overlong').locator('.note-progress')).toHaveText('1/15 done');
    await expect(card('e-empty').locator('.note-snippet')).toHaveText('Checklist');
    assert.ok(await height('a-short') < await height('c-medium'));
    assert.ok(await height('c-medium') < await height('b-long'));
    assert.ok(await height('b-long') < await height('d-overlong'));
    await screenshot(page, 'variable-list-cards-mobile.png', { fullPage: true });

    const verifyLayout = () => page.evaluate(() => {
      const failures = [];
      for (const grid of document.querySelectorAll('.note-grid')) {
        const cards = [...grid.children].map(node => ({ id: node.dataset.noteId, box: node.getBoundingClientRect() }));
        for (const { id, box } of cards) {
          if (box.right > innerWidth || box.left < 0) failures.push(`${id}: outside viewport`);
          const above = cards.filter(other => Math.abs(other.box.left - box.left) < 1 && other.box.top < box.top).sort((a, b) => b.box.bottom - a.box.bottom)[0];
          const gap = box.top - (above?.box.bottom ?? grid.getBoundingClientRect().top);
          if (above ? gap < 12 || gap > 13.1 : gap > 1) failures.push(`${id}: gap ${gap}`);
          for (const other of cards) if (id !== other.id && box.left < other.box.right - 1 && box.right > other.box.left + 1 && box.top < other.box.bottom - 1 && box.bottom > other.box.top + 1) failures.push(`${id}: overlaps ${other.id}`);
        }
        const bottom = Math.max(...cards.map(card => card.box.bottom));
        if (grid.getBoundingClientRect().bottom < bottom) failures.push('Grid ends before its cards');
      }
      if (document.documentElement.scrollWidth > innerWidth) failures.push('Horizontal overflow');
      return failures;
    });
    for (const width of [320, 390, 411, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      for (const size of [16, 32]) {
        await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, size);
        await expect.poll(verifyLayout, { message: `Cards fit at ${width}px / ${size}px font` }).toEqual([]);
        assert.deepEqual(await page.locator('.note-grid').last().locator('.note-swipe').evaluateAll(cards => cards.map(card => card.dataset.noteId)), ['a-short', 'b-long', 'c-medium', 'd-overlong', 'e-empty']);
      }
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(verifyLayout).toEqual([]);
    await page.evaluate(() => scrollTo(0, 100));
    assert.equal(await page.evaluate(() => scrollY), 100);
    await page.evaluate(() => window.updateCardCheck('a-short', 7));
    await expect(card('a-short').locator('.mini-check')).toHaveCount(7);
    await expect.poll(verifyLayout).toEqual([]);
    assert.equal(await page.evaluate(() => scrollY), 100, 'Live card updates retain the scroll position');
    await page.evaluate(() => window.updateCardCheck('a-short', 1));
    await expect(card('a-short').locator('.mini-check')).toHaveCount(1);
    await expect.poll(verifyLayout).toEqual([]);
    await page.getByLabel('Search notes').fill('Find this hidden item');
    await expect(page.locator('.note-swipe')).toHaveCount(1);
    await expect(card('d-overlong')).toBeVisible();
    await card('d-overlong').locator('.note-row').focus();
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => window.cardActions), ['d-overlong']);
    await page.evaluate(() => window.disposeCardCheck());
  } finally { await context.close(); }
});
