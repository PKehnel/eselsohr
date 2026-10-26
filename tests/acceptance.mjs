// Independent browser scenarios. Every case owns its accounts, notes and contexts.
import assert from 'node:assert/strict';
import { expect } from 'playwright/test';
import { test } from './fixtures.mjs';
import { path, privatePath } from './emulator.mjs';
import { origin, signIn, saved, open, network, pointerBox, screenshot, serverTimeout, pauseClock } from './browser.mjs';

async function swipeNote(page, title) {
  await page.getByLabel('Search notes').fill(title);
  const row = page.locator('.note-row').filter({ has: page.locator('.note-title', { hasText: title }) });
  await expect(row).toBeVisible();
  const bounds = await pointerBox(row);
  await page.mouse.move(bounds.x + 25, bounds.y + 30); await page.mouse.down();
  await page.mouse.move(bounds.x + 235, bounds.y + 30, { steps: 12 }); await page.mouse.up();
}

async function field(db, id, key, value) {
  await expect.poll(async () => (await db.doc(path(id)).get()).data()?.[key], { timeout: serverTimeout }).toEqual(value);
}

test('browser sign-in, persisted reopening and blocked visitor', async ({ fixture, browser, errors }) => {
  const { password } = fixture;
  const alex = fixture.users[0];
  const sam = fixture.users[1];
  const jo = fixture.users[2];
  const visitor = fixture.users[3];
  const contexts = await Promise.all([0, 1, 2, 3].map(() => browser.newContext({ viewport: { width: 390, height: 844 } })));
  const [p, q, r, v] = await Promise.all(contexts.map(context => context.newPage()));
  for (const page of [p, q, r, v]) page.on('pageerror', error => errors.push(error.message));
  try {
    await Promise.all([signIn(p, alex, password), signIn(q, sam, password), signIn(r, jo, password), signIn(v, visitor, password)]);
    await Promise.all([p, q, r].map(page => saved(page)));
    for (const page of [p, q, r]) await expect(page.getByLabel('Search notes')).toBeVisible();
    await expect(v.getByText('This account does not have access', { exact: false })).toBeVisible();
    await expect(v.locator('.note-row')).toHaveCount(0);
    await p.reload(); await saved(p);
    await expect(p.getByRole('group', { name: 'Show notes', exact: true }).getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('persisted startup opens cached authorized notes while the server is delayed', async ({ fixture, p }) => {
  const held = []; let holding = true;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const pattern = 'http://127.0.0.1:8080/**';
  await p.route(pattern, async route => { if (holding) { held.push(route); await gate; } await route.continue(); });
  await p.addInitScript(() => {
    window.startupFrames = [];
    new MutationObserver(() => {
      const root = document.querySelector('#app > main');
      const frame = { screen: root?.classList.contains('notebook') ? 'notebook' : root?.classList.contains('startup') ? 'startup' : root ? 'other' : null, rows: document.querySelectorAll('.note-row').length };
      if (frame.screen !== window.startupFrames.at(-1)?.screen) window.startupFrames.push(frame);
    }).observe(document, { childList: true, subtree: true });
  });
  try {
    // Simulate upgrading a populated cache from the release without generations.
    await p.evaluate(() => localStorage.removeItem('eselsohr/demo-eselsohr/clear-cache/generation'));
    await p.reload({ waitUntil: 'domcontentloaded' });
    await expect(p.locator('.notebook')).toBeVisible();
    await expect(p.getByLabel('Email', { exact: true })).toHaveCount(0);
    await expect(p.locator('.note-row')).not.toHaveCount(0);
    await expect.poll(() => held.length).toBeGreaterThan(0);
    holding = false; release();
    await saved(p);
    const frames = await p.evaluate(() => window.startupFrames);
    assert.deepEqual(frames.filter(frame => frame.screen).map(frame => frame.screen), ['startup', 'notebook']);
    assert.ok(frames.at(-1).rows > 0);
  } finally { holding = false; release(); await p.unroute(pattern); }
});

test('false missing membership preserves drafts when confirmation fails and recovers from a direct server read', async ({ fixture, browser, errors }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  let checks = 0;
  page.on('request', request => { if (request.url().includes('/documents:batchGet')) checks++; });
  try {
    await page.goto(origin);
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await page.evaluate(async () => {
      const { NotesRepository } = await import('/src/notes.ts');
      const original = NotesRepository.prototype.ownMembership, save = NotesRepository.prototype.save;
      NotesRepository.prototype.ownMembership = function(receive, fail) {
        window.reportMissingMembership = () => receive(null, false);
        return original.call(this, receive, fail);
      };
      NotesRepository.prototype.save = function(...args) {
        return new Promise((resolve, reject) => { window.finishMembershipDraft = () => save.apply(this, args).then(resolve, reject); });
      };
    });
    await page.getByLabel('Email', { exact: true }).fill(fixture.users[0].email);
    await page.getByLabel('Password', { exact: true }).fill(fixture.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await saved(page);
    await open(page, fixture.textId);
    await page.getByLabel('Note text').fill('Keep draft through a false missing membership');
    await expect.poll(() => page.evaluate(() => typeof window.finishMembershipDraft)).toBe('function');
    const pattern = url => url.origin === 'http://127.0.0.1:8080' && url.pathname.endsWith('/documents:batchGet');
    await page.route(pattern, route => route.abort('failed'));
    await page.evaluate(() => window.reportMissingMembership());
    await expect(page.locator('.save-bar .status')).toHaveText('Could not load notes. Retry when connected.');
    await expect(page.getByLabel('Note text')).toHaveValue('Keep draft through a false missing membership');
    assert.ok(await page.evaluate(() => Object.keys(localStorage).some(key => key.includes('/drafts/'))));
    assert.equal(await page.evaluate(() => localStorage.getItem('eselsohr/demo-eselsohr/clear-cache')), null);
    await page.unroute(pattern);
    await page.evaluate(() => window.reportMissingMembership());
    await expect.poll(() => checks).toBe(2);
    await expect(page.getByText('This account does not have access', { exact: false })).toHaveCount(0);
    await page.evaluate(() => window.finishMembershipDraft());
    await page.getByRole('button', { name: 'Retry', exact: true }).click(); await saved(page);
    assert.equal((await fixture.adminDb.doc(path(fixture.textId)).get()).data().body, 'Keep draft through a false missing membership');
  } finally { await context.close(); }
});

test('shared and private notes with identical IDs stay separate across owners and draft queues', async ({ fixture, p, q }) => {
  const { adminDb, textId } = fixture;
  const alex = fixture.users[0];
  await Promise.all([open(p, `private:${textId}`), open(q, `private:${textId}`)]);
  await expect(p.getByLabel('Note title')).toHaveValue('Alex only');
  await expect(q.getByLabel('Note title')).toHaveValue('Sam only');
  await expect(p.locator('.editor')).toHaveAttribute('data-scope', 'private');
  await p.getByLabel('Note text').fill('Alex personal draft');
  await open(p, textId); await saved(p);
  await expect(p.getByLabel('Note text')).toHaveValue('Third member');
  assert.equal((await adminDb.doc(privatePath(alex.uid, textId)).get()).data().body, 'Alex personal draft');
  await expect(q.getByLabel('Note text')).toHaveValue('');
  await p.getByRole('button', { name: 'Back', exact: true }).click();
  await q.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(q.locator('.note-row').filter({ hasText: 'Alex only' })).toHaveCount(0);
});

test('private Text/List creation, color labels, filters, search, pin and bin/Undo work without exposing content', async ({ fixture, q, browser, errors }) => {
  const { password, adminDb, createdNoteIds } = fixture;
  const alex = fixture.users[0];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  try {
    await signIn(page, alex, password); await saved(page);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await expect(page.getByLabel('Note text')).toBeFocused();
    const id = new URL(page.url()).hash.slice('#/notes/'.length);
    createdNoteIds.push(id);
    await expect(page.locator('.editor')).toHaveAttribute('data-scope', 'private');
    await page.getByLabel('Note title').fill('Privacy text');
    await page.getByLabel('Note text').fill('Privacy needle in a private body'); await saved(page);
    await expect(page.locator('.editor-scope')).toHaveText('Private');
    await page.getByRole('button', { name: 'Pin', exact: true }).click(); await saved(page);
    assert.equal((await adminDb.doc(path(id)).get()).data().pinned, true);
    assert.equal((await adminDb.doc(privatePath(alex.uid, id)).get()).exists, false);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    const filters = page.getByRole('group', { name: 'Show notes', exact: true });
    const select = name => filters.getByRole('button', { name, exact: true }).click();
    await select('Private');
    await expect(page.locator('.note-swipe[data-scope=shared]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('button', { name: 'List', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(page.getByLabel('New checklist item')).toBeFocused();
    const listId = new URL(page.url()).hash.slice('#/notes/'.length); createdNoteIds.push(listId);
    await page.getByLabel('Note title').fill('Privacy list');
    await page.getByLabel('New checklist item').fill('Privacy needle in a list'); await page.getByLabel('New checklist item').press('Enter');
    await page.getByRole('checkbox', { name: 'Done: Privacy needle in a list', exact: true }).check(); await saved(page);
    const listRows = await adminDb.doc(path(listId)).collection('items').get();
    assert.equal(listRows.size, 1); assert.equal(listRows.docs[0].data().checked, true);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(filters.getByRole('button', { name: 'Private', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Search notes').fill('Privacy needle'); await expect(page.locator('.note-row')).toHaveCount(2);
    await select('Shared'); await expect(page.locator('.note-row')).toHaveCount(0);
    await select('All'); await expect(page.locator('.note-row')).toHaveCount(2);
    await page.getByLabel('Search notes').fill('');
    const privateBox = page.locator('.note-swipe[data-scope=private] .note-row').first();
    const sharedBox = page.locator('.note-swipe[data-scope=shared] .note-row').first();
    assert.notEqual(await privateBox.evaluate(row => getComputedStyle(row).backgroundColor), await sharedBox.evaluate(row => getComputedStyle(row).backgroundColor));
    for (const width of [320, 390, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await screenshot(page, 'private-notes-mobile.png', { fullPage: true });
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await screenshot(page, 'compact-menu-mobile.png', { fullPage: true });
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Actions: Privacy text', exact: true }).click();
    await page.getByRole('button', { name: 'Move to bin', exact: true }).click(); await saved(page);
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await saved(page);
    assert.equal((await adminDb.doc(path(id)).get()).data().state, 'active');
    await page.getByRole('button', { name: 'Actions: Privacy text', exact: true }).click();
    await page.getByRole('button', { name: 'Move to bin', exact: true }).click(); await saved(page);
    await select('Private'); await page.getByRole('button', { name: 'Bin', exact: true }).click();
    await expect(filters.getByRole('button', { name: 'Private', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.note-swipe[data-scope=private]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Actions: Privacy text', exact: true }).click();
    await page.getByRole('button', { name: 'Restore', exact: true }).click(); await saved(page, true);
    assert.equal((await adminDb.doc(path(id)).get()).data().body, 'Privacy needle in a private body');
    await q.getByLabel('Search notes').fill('Privacy'); await expect(q.locator('.note-row')).toHaveCount(0);
    await q.getByLabel('Search notes').fill('');
    await q.evaluate(id => { location.hash = `/notes/${id}`; }, id);
    await expect(q.getByText('This note is unavailable.', { exact: true })).toBeVisible();
    await expect(q.getByLabel('Note text')).toHaveCount(0);
    await q.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await select('Shared'); await expect(page.locator('.note-swipe[data-scope=private]')).toHaveCount(0);
    await select('Private');
    await page.setViewportSize({ width: 320, height: 844 });
    await page.addStyleTag({ content: ':root { font-size:32px }' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    for (const name of ['List', 'Text']) {
      const choice = page.getByRole('button', { name, exact: true });
      await expect(choice).toBeVisible();
      assert.equal(await choice.evaluate(control => {
        const bounds = control.getBoundingClientRect();
        return control.scrollWidth <= control.clientWidth && bounds.height >= 44 && bounds.width >= 44 && bounds.right <= innerWidth;
      }), true, `${name} stays readable and tappable at large text`);
    }
    await screenshot(page, 'private-menu-large.png', { fullPage: true });
    await page.keyboard.press('Escape');
  } finally { await context.close(); }
});

test('new private lists and journaled rows survive offline reopening and sign-out clears them before account switching', async ({ fixture, browser, errors }) => {
  const { password, adminDb, createdNoteIds } = fixture;
  const alex = fixture.users[0];
  const sam = fixture.users[1];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  try {
    await signIn(page, alex, password); await saved(page);
    await page.getByRole('group', { name: 'Show notes', exact: true }).getByRole('button', { name: 'Private', exact: true }).click();
    await network(page, false);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'List', exact: true }).click();
    const id = new URL(page.url()).hash.slice('#/notes/'.length); createdNoteIds.push(id);
    await page.getByLabel('Note title').fill('Offline private list');
    await page.getByLabel('New checklist item').fill('Private submitted row'); await page.getByLabel('New checklist item').press('Enter');
    await page.getByLabel('New checklist item').fill('Private journaled row');
    const pattern = 'http://127.0.0.1:8080/**';
    await page.route(pattern, route => route.abort()); await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Note title')).toHaveValue('Offline private list');
    await expect(page.getByLabel('Checklist item', { exact: true })).toHaveCount(2);
    assert.equal((await adminDb.doc(path(id)).get()).exists, false);
    await page.unroute(pattern); await network(page, false); await network(page, true); await saved(page);
    const rows = await adminDb.doc(path(id)).collection('items').get();
    assert.deepEqual(rows.docs.map(row => row.data().text).sort(), ['Private journaled row', 'Private submitted row']);
    await page.getByLabel('Checklist item', { exact: true }).last().fill('Private draft after acknowledgement');
    await page.route(pattern, route => route.abort()); await network(page, false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel('Checklist item', { exact: true }).last()).toHaveValue('Private draft after acknowledgement');
    await page.unroute(pattern); await network(page, false); await network(page, true); await saved(page);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'People, 3 members', exact: true }).click();
    await page.evaluate(() => {
      const remove = IDBFactory.prototype.deleteDatabase;
      IDBFactory.prototype.deleteDatabase = function(name) {
        if (name.includes('firestore')) { window.cacheDeletionPaused = true; return {}; }
        return remove.call(this, name);
      };
    });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect.poll(() => page.evaluate(() => !!window.cacheDeletionPaused)).toBe(true);
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.includes('/drafts/'))), false);
    await signIn(page, sam, password); await saved(page);
    await page.getByLabel('Search notes').fill('Private draft after acknowledgement');
    await expect(page.locator('.note-row')).toHaveCount(0);
    const cached = await page.evaluate(async target => {
      const source = await (await fetch('/src/firebase.ts')).text();
      const sdk = await import(source.match(/from\s+"([^"]*firebase_firestore\.js[^"]*)"/)[1]);
      return sdk.getDocFromCache(sdk.doc(sdk.getFirestore(), target)).then(snapshot => snapshot.exists(), () => false);
    }, path(id));
    assert.equal(cached, false);
  } finally { await context.close(); }
});

test('acknowledged browser edits propagate without reload; last accepted field wins', async ({ fixture, p, q }) => {
  const { run, adminDb, textId } = fixture;
  await Promise.all([open(p, textId), open(q, textId)]);
  await p.getByLabel('Note title').fill(`Browser ${run}`); await p.getByLabel('Note title').blur(); await saved(p);
  await expect(q.getByLabel('Note title')).toHaveValue(`Browser ${run}`);
  await q.getByLabel('Note text').fill('Different field by Sam'); await q.getByLabel('Note text').blur(); await saved(q);
  await expect(p.getByLabel('Note text')).toHaveValue('Different field by Sam');
  await q.getByLabel('Note title').fill('Weekend plan'); await q.getByLabel('Note title').blur(); await saved(q);
  await screenshot(p, 'editor-reader.png', { fullPage: true });
  await expect(p.getByLabel('Note title')).toHaveValue('Weekend plan');
  await Promise.all([p.getByLabel('Note title').fill('Alex competing'), q.getByLabel('Note title').fill('Sam competing')]);
  await Promise.all([p.getByLabel('Note title').blur(), q.getByLabel('Note title').blur()]);
  await Promise.all([saved(p), saved(q)]);
  const winner = (await adminDb.doc(path(textId)).get()).data().title;
  assert.ok(['Alex competing', 'Sam competing'].includes(winner));
  await expect(p.getByLabel('Note title')).toHaveValue(winner); await expect(q.getByLabel('Note title')).toHaveValue(winner);
  await q.getByLabel('Note title').fill('Weekend plan'); await q.getByLabel('Note title').blur(); await saved(q);
});

test('navigation flushes a draft to its original note and preserves unrelated notes', async ({ fixture, p }) => {
  const { adminDb, textId, otherId } = fixture;
  await open(p, textId);
  await saved(p);
  await p.getByLabel('Note text').fill('Draft belongs to first note');
  await p.getByRole('button', { name: 'Back', exact: true }).click();
  await open(p, otherId); await saved(p);
  await field(adminDb, textId, 'body', 'Draft belongs to first note');
  await field(adminDb, otherId, 'body', '');
});

test('failed rule write retains draft across navigation and retries after correction', async ({ fixture, p }) => {
  const { adminDb, textId } = fixture;
  await open(p, textId);
  await p.getByLabel('Note text').evaluate(input => { input.value = 'x'.repeat(40001); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(p.locator('.save-bar .status')).toHaveText('Could not save. Your draft is still here.');
  await p.getByRole('button', { name: 'Notebook menu', exact: true }).click();
  await expect(p.locator('.sync-entry')).toHaveAttribute('data-state', 'problem');
  await expect(p.getByRole('button', { name: 'Retry sync', exact: true })).toBeVisible();
  await expect(p.locator('.save-companion .action-art:not([hidden]) img')).toHaveAttribute('src', '/themes/donkey-ui/offline.webp');
  await p.context().setOffline(true);
  await expect(p.locator('.sync-entry')).toHaveText('Could not save. Your draft is still here.');
  await expect(p.locator('.sync-entry')).toHaveAttribute('data-state', 'problem');
  await p.context().setOffline(false);
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: 'Back', exact: true }).click(); await open(p, textId);
  assert.equal((await p.getByLabel('Note text').inputValue()).length, 40001);
  await p.getByLabel('Note text').fill('Recovered draft');
  await p.getByRole('button', { name: 'Notebook menu', exact: true }).click();
  await p.getByRole('button', { name: 'Retry sync', exact: true }).click(); await saved(p);
  await field(adminDb, textId, 'body', 'Recovered draft');
});

test('disconnected edits stay pending, survive navigation, block sign-out and reconnect', async ({ fixture, p }) => {
  const { adminDb, textId } = fixture;
  await adminDb.doc(path(textId)).update({ body: 'Recovered draft' });
  await open(p, textId); await saved(p);
  await expect(p.getByLabel('Note text')).toHaveValue('Recovered draft');
  await network(p, false);
  await p.getByLabel('Note text').fill('Waiting draft'); await p.getByLabel('Note text').blur();
  await expect(p.locator('.save-bar .status')).toContainText('Saving');
  await expect(p.locator('.save-companion')).toHaveAttribute('data-state', 'pending');
  await expect(p.locator('.save-companion')).toHaveAttribute('data-connection', 'offline');
  await expect(p.locator('.save-companion .action-art:not([hidden]) img')).toHaveAttribute('src', '/themes/donkey-ui/offline.webp');
  await field(adminDb, textId, 'body', 'Recovered draft');
  await p.getByRole('button', { name: 'Back', exact: true }).click(); await open(p, textId);
  await expect(p.getByLabel('Note text')).toHaveValue('Waiting draft');
  await p.getByRole('button', { name: 'Back', exact: true }).click();
  await p.getByRole('button', { name: /People, 3 members/ }).click(); await p.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(p.locator('.save-bar .status')).toHaveText('Let changes in all Eselsohr windows finish saving before signing out.', { timeout: 7000 });
  await network(p, true);
  await field(adminDb, textId, 'body', 'Waiting draft');
  await saved(p);
  await p.getByRole('button', { name: 'Back', exact: true }).click(); await open(p, textId);
  await expect(p.getByLabel('Note text')).toHaveValue('Waiting draft');
});

test('offline reopening retains submitted writes and the newest unsubmitted draft', async ({ fixture, p }) => {
  const { adminDb, textId } = fixture;
  await adminDb.doc(path(textId)).update({ body: 'Waiting draft' });
  await open(p, textId); await saved(p);
  await expect(p.getByLabel('Note text')).toHaveValue('Waiting draft');
  await network(p, false);
  await p.getByLabel('Note text').fill('Submitted offline draft');
  await p.getByLabel('Note text').blur();
  await p.getByLabel('Note text').fill('Newest offline draft');
  const pattern = 'http://127.0.0.1:8080/**';
  await p.route(pattern, route => route.abort());
  await p.reload({ waitUntil: 'domcontentloaded' });
  await expect(p.getByLabel('Note text')).toHaveValue('Newest offline draft');
  await expect(p.locator('.save-companion')).toHaveAttribute('data-state', 'pending');
  await field(adminDb, textId, 'body', 'Waiting draft');
  await p.unroute(pattern);
  await network(p, false); await network(p, true);
  await saved(p); await field(adminDb, textId, 'body', 'Newest offline draft');
});

test('new offline list and rows survive reopening and sync once connected', async ({ fixture, p }) => {
  const { adminDb, createdNoteIds } = fixture;
  await network(p, false);
  await p.getByRole('button', { name: 'Add', exact: true }).click();
  await p.getByRole('button', { name: 'List', exact: true }).click();
  await expect(p.getByLabel('New checklist item')).toBeVisible();
  const id = new URL(p.url()).hash.slice('#/notes/'.length); createdNoteIds.push(id);
  await p.getByLabel('Note title').fill('Offline list');
  await p.getByLabel('New checklist item').fill('First offline row');
  await p.getByLabel('New checklist item').press('Enter');
  await p.getByLabel('New checklist item').fill('Second offline row');
  const pattern = 'http://127.0.0.1:8080/**';
  await p.route(pattern, route => route.abort());
  await p.reload({ waitUntil: 'domcontentloaded' });
  await expect(p.getByLabel('Note title')).toHaveValue('Offline list');
  await expect(p.getByLabel('Checklist item', { exact: true })).toHaveCount(2);
  assert.deepEqual(await p.getByLabel('Checklist item', { exact: true }).evaluateAll(inputs => inputs.map(input => input.value).sort()), ['First offline row', 'Second offline row']);
  assert.equal((await adminDb.doc(path(id)).get()).exists, false);
  await p.unroute(pattern);
  await network(p, false); await network(p, true);
  await saved(p);
  await field(adminDb, id, 'title', 'Offline list');
  await expect.poll(async () => (await adminDb.doc(path(id)).collection('items').get()).docs.map(doc => doc.data().text).sort()).toEqual(['First offline row', 'Second offline row']);
});

test('checkbox writes retain row text; remote typing is not overwritten', async ({ fixture, p, q }) => {
  const { adminDb, checklistId, itemPath } = fixture;
  await Promise.all([open(p, checklistId), open(q, checklistId)]);
  await q.getByLabel('Checklist item', { exact: true }).fill('Bread and milk');
  await p.getByRole('checkbox').check();
  await q.getByLabel('Checklist item', { exact: true }).blur(); await saved(q);
  await expect(p.getByLabel('Checklist item', { exact: true })).toHaveValue('Bread and milk');
  assert.equal((await adminDb.doc(itemPath).get()).data().checked, true);
  await expect(p.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
  await p.getByLabel('New checklist item').evaluate(input => { input.value = 'x'.repeat(1001); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(p.locator('.save-bar .status')).toHaveText('Could not save. Your draft is still here.');
  await expect(p.locator('.save-companion')).toHaveAttribute('data-state', 'problem');
  await expect(p.locator('.save-bar')).not.toHaveClass(/sr-only/);
  assert.equal((await p.getByLabel('New checklist item').inputValue()).length, 1001);
  await p.getByLabel('New checklist item').fill('Apples');
  await p.getByRole('button', { name: 'Retry', exact: true }).click(); await saved(p);
  await expect(q.getByLabel('Checklist item', { exact: true })).toHaveCount(2);
  await expect(p.getByLabel('Checklist item', { exact: true })).toHaveCount(2); // Blur exposes the saved row.
  await p.getByRole('button', { name: 'Actions: Apples', exact: true }).click();
  await p.getByRole('button', { name: 'Remove Apples', exact: true }).click();
  await expect(q.getByLabel('Checklist item', { exact: true })).toHaveCount(1);
});

test('plus menu creates Text/List, focuses writing and Return continues the checklist', async ({ fixture, p }) => {
  const { adminDb, createdNoteIds } = fixture;
  await expect(p.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
  await expect(p.locator('.save-bar')).toHaveClass(/sr-only/);
  await p.getByRole('button', { name: 'Add', exact: true }).click();
  await p.getByRole('button', { name: 'Text', exact: true }).click();
  await expect(p.getByLabel('Note text')).toBeFocused();
  createdNoteIds.push(new URL(p.url()).hash.slice('#/notes/'.length));
  await p.getByLabel('Note title').fill('Direct creation'); await p.getByLabel('Note title').press('Enter');
  await expect(p.getByLabel('Note text')).toBeFocused();
  await p.getByLabel('Note text').fill('Write immediately'); await saved(p);
  await p.getByRole('button', { name: 'Back', exact: true }).click();
  await p.getByRole('button', { name: 'Add', exact: true }).click();
  await p.getByRole('button', { name: 'List', exact: true }).click();
  await expect(p.getByLabel('New checklist item')).toBeFocused();
  const id = new URL(p.url()).hash.slice('#/notes/'.length); createdNoteIds.push(id);
  await p.getByLabel('Note title').fill('Continuous list'); await p.getByLabel('Note title').press('Enter');
  await expect(p.getByLabel('New checklist item')).toBeFocused();
  await p.getByLabel('New checklist item').fill('First item'); await saved(p);
  await expect.poll(async () => (await adminDb.doc(path(id)).collection('items').get()).docs.map(doc => doc.data().text)).toEqual(['First item']);
  await p.getByLabel('New checklist item').press('Enter');
  await expect(p.getByLabel('New checklist item')).toBeFocused();
  await p.getByLabel('New checklist item').fill('Second item'); await p.getByLabel('New checklist item').press('Enter');
  await p.getByLabel('New checklist item').fill('Third item');
  await p.getByRole('button', { name: 'Back', exact: true }).click(); await open(p, id); await saved(p);
  await expect(p.getByLabel('Checklist item', { exact: true })).toHaveCount(3);
  await p.getByLabel('Checklist item', { exact: true }).first().press('Enter');
  await expect(p.getByLabel('Checklist item', { exact: true }).nth(1)).toBeFocused();
  await p.getByLabel('Checklist item', { exact: true }).last().press('Enter');
  await expect(p.getByLabel('New checklist item')).toBeFocused();
  await screenshot(p, 'checklist-direct.png', { fullPage: true });
});

test('new checklist drafts survive offline navigation and edits during creation without duplicates', async ({ fixture, p }) => {
  const { adminDb } = fixture;
  const id = await fixture.addChecklist('Continuous list', ['First item', 'Second item', 'Third item'].map(text => ({ text })));
  await open(p, id); await saved(p);
  await network(p, false);
  await p.getByLabel('New checklist item').fill('Offline item'); await p.getByLabel('New checklist item').press('Enter');
  // Observe the local Firestore snapshot before checking that the row stayed last.
  await expect(p.getByRole('checkbox', { name: 'Done: Offline item', exact: true })).toBeVisible();
  await expect(p.getByLabel('Checklist item', { exact: true }).last()).toHaveValue('Offline item');
  const draftRow = p.locator('.check-row').filter({ has: p.getByRole('checkbox', { name: 'Done: Offline item', exact: true }) });
  await draftRow.getByLabel('Checklist item', { exact: true }).fill('Revised offline item');
  await p.getByRole('checkbox', { name: 'Done: Revised offline item', exact: true }).check();
  await p.getByLabel('New checklist item').fill('Next offline item');
  await p.getByRole('button', { name: 'Back', exact: true }).click(); await open(p, id);
  await expect(p.getByLabel('Checklist item', { exact: true })).toHaveCount(5);
  await expect(p.getByRole('checkbox', { name: 'Done: Revised offline item', exact: true })).toBeChecked();
  assert.deepEqual(await p.getByLabel('Checklist item', { exact: true }).evaluateAll(inputs => inputs.map(input => input.value)), ['First item', 'Second item', 'Third item', 'Revised offline item', 'Next offline item']);
  const before = await adminDb.doc(path(id)).collection('items').get(); assert.equal(before.size, 3);
  await network(p, true); await saved(p);
  await expect.poll(async () => (await adminDb.doc(path(id)).collection('items').get()).size).toBe(5);
  const items = (await adminDb.doc(path(id)).collection('items').get()).docs.map(doc => doc.data());
  assert.equal(items.filter(item => item.text === 'Revised offline item' && item.checked).length, 1, JSON.stringify(items.map(({ text, checked }) => ({ text, checked }))));
  assert.equal(items.filter(item => item.text === 'Next offline item').length, 1);
  assert.equal(items.filter(item => item.text === 'Third item' && !item.checked).length, 1);
  await p.reload(); await saved(p);
  await expect(p.getByLabel('Checklist item', { exact: true })).toHaveCount(5);
});

test('search includes bin titles, bodies and checklist rows; old Trash remains recoverable', async ({ fixture, p }) => {
  const { adminDb, textId, itemPath } = fixture;
  await adminDb.doc(path(textId)).update({ title: 'Weekend plan', body: 'Newest offline draft' });
  await adminDb.doc(itemPath).update({ text: 'Bread and milk' });
  const listId = await fixture.addChecklist('Continuous list', [{ text: 'Third item' }]);
  await open(p, textId); await p.getByRole('button', { name: 'Pin', exact: true }).click();
  await field(adminDb, textId, 'pinned', true);
  await p.getByRole('button', { name: 'Back', exact: true }).click();
  await swipeNote(p, 'Weekend plan'); await field(adminDb, textId, 'state', 'archived');
  await p.getByLabel('Search notes').fill('Newest offline draft');
  await expect(p.locator('.note-row')).toHaveCount(1);
  await expect(p.locator('.note-row .bin-label')).toHaveText('Bin');
  await p.getByLabel('Search notes').fill('Weekend plan');
  await p.locator('.note-row').click();
  await expect(p.locator('.save-companion .action-art:not([hidden]) img')).toHaveAttribute('src', '/themes/donkey-ui/bin.webp');
  await p.getByRole('button', { name: 'Back', exact: true }).click();
  await swipeNote(p, 'Weekend plan'); await field(adminDb, textId, 'state', 'active');
  await adminDb.doc(path(listId)).update({ state: 'archived' });
  await p.getByLabel('Search notes').fill('Third item');
  await expect(p.locator('.note-row')).toHaveCount(1);
  await expect(p.locator('.note-row .bin-label')).toHaveText('Bin');
  await adminDb.doc(path(listId)).update({ state: 'active' });
  await adminDb.doc(path(textId)).update({ state: 'trash' });
  await p.getByRole('button', { name: 'Bin', exact: true }).click();
  await expect(p.getByRole('heading', { name: 'Bin', exact: true })).toBeVisible();
  await expect(p.locator('.save-companion .action-art:not([hidden]) img')).toHaveAttribute('src', '/themes/donkey-ui/bin.webp');
  await p.locator('.note-row').filter({ hasText: 'Weekend plan' }).click();
  await p.getByRole('button', { name: 'Back', exact: true }).click();
  await p.getByLabel('Search notes').fill('Weekend plan');
  await swipeNote(p, 'Weekend plan'); await field(adminDb, textId, 'state', 'active');
  await expect(p.getByRole('heading', { name: 'Bin', exact: true })).toBeVisible();
  await p.getByRole('button', { name: 'Back', exact: true }).click();
  await p.getByLabel('Search notes').fill('Bread and milk'); await expect(p.locator('.note-row')).toHaveCount(1);
  const boxes = await Promise.all(['.save-companion', '.search', '.people-link'].map(selector => p.locator(selector).boundingBox()));
  assert.ok(boxes[0].x + boxes[0].width <= boxes[1].x && boxes[1].x + boxes[1].width <= boxes[2].x);
});

test('only rightward swipes reveal bin/restore; delayed Undo preserves content and survives a press across expiry', async ({ fixture, clockedPage: p }) => {
  const { adminDb, textId } = fixture;
  await adminDb.doc(path(textId)).update({ title: 'Weekend plan', body: 'Newest offline draft' });
  await p.getByLabel('Search notes').fill('Weekend plan');
  const row = p.locator('.note-row').filter({ hasText: 'Weekend plan' });
  const drag = async (dx, release = true) => {
    const bounds = await pointerBox(row);
    const x = dx < 0 ? bounds.x + bounds.width - 25 : bounds.x + 25, y = bounds.y + 35;
    await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx, y, { steps: 12 });
    if (release) await p.mouse.up();
  };
  await expect(p.locator('.swipe-bin')).toBeHidden();
  await drag(-210);
  await field(adminDb, textId, 'state', 'active'); await expect(p.locator('.swipe-bin')).toBeHidden();
  await drag(65);
  await expect(p.getByRole('button', { name: 'Move to bin: Weekend plan', exact: true })).toBeVisible();
  await field(adminDb, textId, 'state', 'active'); await expect(p.getByLabel('Note title')).toHaveCount(0);
  await pauseClock(p);
  await drag(210, false); await expect(p.locator('.note-swipe.swipe-ready')).toHaveCount(1); await p.mouse.up();
  await p.clock.runFor(1000);
  await expect(p.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  await p.clock.resume();
  await p.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(p); await field(adminDb, textId, 'state', 'active');
  await expect(p.locator('.bin-label')).toHaveCount(0);
  await pauseClock(p); await drag(210);
  await p.mouse.move(5, 5); await p.clock.runFor(1500);
  const undo = p.getByRole('button', { name: 'Undo', exact: true });
  const undoBounds = await pointerBox(undo);
  await p.mouse.move(undoBounds.x + undoBounds.width / 2, undoBounds.y + undoBounds.height / 2); await p.mouse.down();
  await p.clock.runFor(2000); await expect(undo).toBeVisible();
  await p.mouse.up(); await p.clock.resume(); await saved(p); await field(adminDb, textId, 'state', 'active');
  await pauseClock(p); await drag(210);
  await p.mouse.move(5, 5); await p.clock.runFor(3000);
  await expect(p.getByRole('button', { name: 'Undo', exact: true })).toBeHidden();
  await p.clock.resume(); await saved(p); await field(adminDb, textId, 'state', 'archived');
  await p.getByRole('button', { name: 'Bin', exact: true }).click();
  await expect(p.locator('.swipe-bin')).toBeHidden();
  await drag(-210); await field(adminDb, textId, 'state', 'archived'); await expect(p.locator('.swipe-bin')).toBeHidden();
  await drag(65); await expect(p.locator('.swipe-bin .restore-icon')).toBeVisible();
  await drag(210); await saved(p, true); await field(adminDb, textId, 'state', 'active');
  await expect(row).toHaveCount(0);
  assert.equal((await adminDb.doc(path(textId)).get()).data().body, 'Newest offline draft');
  await p.getByRole('button', { name: 'Back', exact: true }).click();
});

test('touch cancellation, leftward and vertical gestures preserve notes; right swipe bins lists', async ({ fixture, p }) => {
  const { adminDb } = fixture;
  const id = await fixture.addChecklist('Continuous list', [{ text: 'First item' }]);
  await p.getByLabel('Search notes').fill('Continuous list');
  const row = p.locator('.note-row').filter({ hasText: 'Continuous list' });
  const bounds = await pointerBox(row);
  const touch = await p.context().newCDPSession(p);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const point = (x, y) => ({ x, y, id: 1 });
  const start = async (x, y) => touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(x, y)] });
  const drag = async (x, y, dx, dy) => {
    for (let step = 1; step <= 12; step++) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(x + dx * step / 12, y + dy * step / 12)] });
    }
  };
  const end = async type => touch.send('Input.dispatchTouchEvent', { type, touchPoints: [] });
  try {
    const x = bounds.x + 35, y = bounds.y + 30;
    await start(x, y); await drag(x, y, 210, 0);
    await expect(p.locator('.swipe-ready')).toHaveCount(1);
    await end('touchCancel'); await field(adminDb, id, 'state', 'active');
    await expect(p.locator('.swipe-ready')).toHaveCount(0);
    await expect(p.locator('.swipe-bin')).toBeHidden();
    await start(x, y); await drag(x, y, 0, 65); await end('touchEnd');
    await field(adminDb, id, 'state', 'active'); await expect(p.getByLabel('Note title')).toHaveCount(0);
    const right = bounds.x + bounds.width - 35;
    await start(right, y); await drag(right, y, -210, 0); await end('touchEnd');
    await field(adminDb, id, 'state', 'active'); await expect(p.locator('.swipe-bin')).toBeHidden();
    await start(x, y); await drag(x, y, 210, 0); await end('touchEnd');
    await saved(p); await field(adminDb, id, 'state', 'archived');
  } finally {
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await touch.detach();
  }
  await p.getByRole('button', { name: 'Bin', exact: true }).click();
  await p.getByLabel('Search notes').fill('Continuous list');
  await p.locator('.note-row').filter({ hasText: 'Continuous list' }).click();
  await p.getByRole('button', { name: 'Back', exact: true }).click();
  await p.getByLabel('Search notes').fill('Continuous list');
  await swipeNote(p, 'Continuous list'); await saved(p);
  await open(p, id);
});

test('subitems persist, propagate, unindent and keep children when a parent is removed', async ({ fixture, p, q }) => {
  const { adminDb } = fixture;
  const id = await fixture.addChecklist('Continuous list', ['First item', 'Second item', 'Third item', 'Revised offline item', 'Next offline item'].map(text => ({ text })));
  await Promise.all([open(p, id), open(q, id)]);
  const second = p.locator('.check-row').nth(1);
  const bounds = await pointerBox(second);
  const touch = await p.context().newCDPSession(p);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  try {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + 85, y: bounds.y + 25, id: 1 }] });
    for (let step = 1; step <= 8; step++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bounds.x + 85 + step * 10, y: bounds.y + 25, id: 1 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await touch.detach();
  }
  await saved(p);
  await expect(q.locator('.check-row').nth(1)).toHaveClass(/indented/);
  await p.reload(); await saved(p); await expect(p.locator('.check-row').nth(1)).toHaveClass(/indented/);
  await p.getByLabel('Checklist item', { exact: true }).nth(1).press('Alt+ArrowLeft'); await saved(p);
  await expect(q.locator('.check-row').nth(1)).not.toHaveClass(/indented/);
  await p.getByRole('button', { name: 'Actions: Second item', exact: true }).click();
  await p.getByRole('button', { name: 'Subitem', exact: true }).click(); await saved(p);
  await p.getByRole('button', { name: 'Actions: First item', exact: true }).click();
  await p.getByRole('button', { name: 'Remove First item', exact: true }).click(); await saved(p);
  await expect(q.getByLabel('Checklist item', { exact: true }).first()).toHaveValue('Second item');
  await expect(q.locator('.check-row').first()).not.toHaveClass(/indented/);
  const items = (await adminDb.doc(path(id)).collection('items').get()).docs.map(doc => doc.data());
  assert.equal(items.find(item => item.text === 'Second item').indented, 0);
});

test('two sublevels persist and share; moving/deleting parents preserves descendants', async ({ fixture, p, q }) => {
  const { adminDb } = fixture;
  const id = await fixture.addChecklist('Continuous list', ['Second item', 'Third item', 'Revised offline item', 'Next offline item'].map(text => ({ text, checked: text === 'Revised offline item' })));
  await Promise.all([open(p, id), open(q, id)]); await Promise.all([saved(p), saved(q)]);
  const choose = async (text, level) => {
    await p.getByRole('button', { name: `Actions: ${text}`, exact: true }).click();
    await p.getByRole('button', { name: level, exact: true }).click(); await saved(p);
  };
  await choose('Third item', 'Subitem');
  await choose('Revised offline item', 'Nested subitem');
  await expect(q.locator('.check-row').nth(2)).toHaveAttribute('data-level', '2');
  await p.getByLabel('Checklist item', { exact: true }).nth(3).press('Alt+ArrowRight'); await saved(p);
  await network(p, false);
  await p.getByLabel('Checklist item', { exact: true }).nth(3).press('Alt+ArrowRight');
  await expect(p.locator('.check-row').nth(3)).toHaveAttribute('data-level', '2');
  await expect(q.locator('.check-row').nth(3)).toHaveAttribute('data-level', '1');
  await expect(p.locator('.save-bar .status')).toContainText('Saving');
  await network(p, true); await saved(p);
  await expect(q.locator('.check-row').nth(3)).toHaveAttribute('data-level', '2');
  await p.reload(); await saved(p);
  await expect(p.locator('.check-row').nth(2)).toHaveAttribute('data-level', '2');
  await p.getByLabel('Checklist item', { exact: true }).nth(2).press('Alt+ArrowRight'); await saved(p);
  await expect(p.locator('.check-row').nth(2)).toHaveAttribute('data-level', '2');
  await screenshot(p, 'nested-list.png', { fullPage: true });
  await choose('Third item', 'Item');
  await expect(q.locator('.check-row').nth(1)).toHaveAttribute('data-level', '0');
  await expect(q.locator('.check-row').nth(2)).toHaveAttribute('data-level', '1');
  await expect(q.locator('.check-row').nth(3)).toHaveAttribute('data-level', '1');
  const moved = (await adminDb.doc(path(id)).collection('items').get()).docs.map(doc => doc.data()).filter(item => item.text !== 'Second item');
  assert.equal(new Set(moved.map(item => item.updatedAt.toMillis())).size, 1);
  await choose('Third item', 'Subitem');
  await p.getByRole('button', { name: 'Actions: Third item', exact: true }).click();
  await p.getByRole('button', { name: 'Remove Third item', exact: true }).click(); await saved(p);
  await expect(q.locator('.check-row')).toHaveCount(3);
  await expect(q.locator('.check-row').nth(1)).toHaveAttribute('data-level', '1');
  await expect(q.locator('.check-row').nth(2)).toHaveAttribute('data-level', '1');
  await p.getByRole('button', { name: 'Actions: Second item', exact: true }).click();
  await p.getByRole('button', { name: 'Remove Second item', exact: true }).click(); await saved(p);
  await expect(q.locator('.check-row')).toHaveCount(2);
  for (const row of await q.locator('.check-row').all()) await expect(row).toHaveAttribute('data-level', '0');
  const remaining = (await adminDb.doc(path(id)).collection('items').get()).docs;
  assert.deepEqual(remaining.map(doc => doc.data().text).sort(), ['Next offline item', 'Revised offline item']);
  const legacy = remaining.find(doc => doc.data().text === 'Next offline item');
  await legacy.ref.update({ indented: true });
  await expect(q.locator('.check-row').nth(1)).toHaveAttribute('data-level', '1');
  assert.equal((await legacy.ref.get()).data().indented, true);
  await p.getByLabel('Checklist item', { exact: true }).nth(1).press('Alt+ArrowLeft'); await saved(p);
  assert.equal((await legacy.ref.get()).data().indented, 0);
});

test('deactivation blocks existing tokens and clears visible notebook data', async ({ fixture, r }) => {
  const { adminDb, textId } = fixture;
  const jo = fixture.users[2];
  await open(r, `private:${textId}`); await saved(r);
  await adminDb.doc(`members/${jo.uid}`).update({ active: false });
  await expect(r.getByText(/This account does not have access|Access to the notebook was lost/)).toBeVisible();
  await expect(r.locator('.note-row')).toHaveCount(0);
  await expect(r.getByLabel('Note title')).toHaveCount(0);
});

test('sign-out clears group data and leaves password form', async ({ fixture, q }) => {
  await q.getByRole('button', { name: 'People, 3 members', exact: true }).click(); await q.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(q.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(q.locator('.note-row')).toHaveCount(0); await expect(q.locator('.member')).toHaveCount(0);
  await screenshot(q, 'sign-in-donkey.png', { fullPage: true });
});

