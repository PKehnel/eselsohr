import { test } from './fixtures.mjs';
import assert from 'node:assert/strict';
import { expect } from 'playwright/test';
import { path } from './emulator.mjs';
import { origin, signIn, saved, open, serverTimeout } from './browser.mjs';

test('same-account draft ownership and coordinated sign-out', async ({ browser, fixture, errors }) => {
  // Three recovery journeys share account state; individual assertion budgets stay unchanged.
  test.slow();
  const [alex, sam] = fixture.users;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const diagnostics = [];
  const newPage = async () => {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()); });
    return page;
  };
  const journals = page => page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.includes('/drafts/')).map(([, value]) => JSON.parse(value).patches));
  const holdWrite = page => page.evaluate(async () => {
    const { NotesRepository } = await import('/src/notes.ts');
    const original = NotesRepository.prototype.save;
    NotesRepository.prototype.save = function(...args) {
      return new Promise((resolve, reject) => {
        window.releaseTabWrite = () => original.apply(this, args).then(resolve, reject);
      });
    };
  });
  const holdAcknowledgement = page => page.evaluate(async () => {
    const { NotesRepository } = await import('/src/notes.ts');
    const original = NotesRepository.prototype.save;
    NotesRepository.prototype.save = async function(...args) {
      await original.apply(this, args);
      return new Promise(resolve => { window.releaseTabWrite = resolve; });
    };
  });
  const signOut = async page => {
    await page.evaluate(() => { location.hash = '/people'; });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  };
  try {
    let first = await newPage(), second = await newPage();
    await signIn(first, alex, fixture.password); await saved(first);
    await second.goto(origin); await saved(second);
    await test.step('same-account tabs preserve another writer draft, block sign-out and recover after that writer closes', async () => {
      await Promise.all([open(first, fixture.textId), open(second, fixture.otherId)]);
      await holdWrite(first);
      await first.getByLabel('Note text').fill('Recover this other-tab draft');
      await expect.poll(() => first.evaluate(() => typeof window.releaseTabWrite)).toBe('function');
      await second.getByLabel('Note text').fill('A separate acknowledged edit'); await saved(second);
      assert.deepEqual(await journals(second), [{ [`note/${fixture.textId}`]: { body: 'Recover this other-tab draft' } }]);
      await signOut(second);
      await expect.poll(() => first.locator('#app').evaluate(node => node.inert)).toBe(true);
      await expect(second.locator('.save-bar .status')).toHaveText('Let changes in all Eselsohr windows finish saving before signing out.', { timeout: 7000 });
      await expect.poll(() => first.locator('#app').evaluate(node => node.inert)).toBe(false);
      await expect(second.getByLabel('Email', { exact: true })).toHaveCount(0);
      assert.equal((await journals(second)).length, 1);
      await first.close();
      await second.reload(); await saved(second);
      await expect.poll(async () => (await fixture.adminDb.doc(path(fixture.textId)).get()).data().body).toBe('Recover this other-tab draft');
      assert.deepEqual(await journals(second), []);
    });
    await test.step('closing a sign-out requester thaws the other tab without discarding its pending edit', async () => {
      first = await newPage(); await first.goto(origin); await saved(first);
      await open(first, fixture.textId); await holdWrite(first);
      await first.getByLabel('Note text').fill('Pending edit survives requester closing');
      await expect.poll(() => first.evaluate(() => typeof window.releaseTabWrite)).toBe('function');
      await signOut(second);
      await expect.poll(() => first.locator('#app').evaluate(node => node.inert)).toBe(true);
      await second.close();
      await expect.poll(() => first.locator('#app').evaluate(node => node.inert), { timeout: 7000 }).toBe(false);
      assert.equal((await journals(first)).length, 1);
      await first.evaluate(() => window.releaseTabWrite()); await saved(first);
      assert.equal((await fixture.adminDb.doc(path(fixture.textId)).get()).data().body, 'Pending edit survives requester closing');
      await first.close();
      second = await newPage(); await second.goto(origin); await saved(second);
    });
    await test.step('sign-out drains every live tab before clearing drafts/cache and switching accounts', async () => {
      first = await newPage(); await first.goto(origin); await saved(first);
      await open(first, fixture.textId); await holdAcknowledgement(first);
      await first.getByLabel('Note text').fill('Acknowledged before account-wide sign-out');
      await expect.poll(() => first.evaluate(() => typeof window.releaseTabWrite), { timeout: serverTimeout }).toBe('function');
      // Only acknowledgement delivery is held; emulator latency precedes the sign-out deadline.
      assert.equal((await fixture.adminDb.doc(path(fixture.textId)).get()).data().body, 'Acknowledged before account-wide sign-out');
      await signOut(second);
      await expect.poll(() => first.locator('#app').evaluate(node => node.inert)).toBe(true);
      await first.evaluate(() => window.releaseTabWrite());
      for (const page of [first, second]) await expect(page.getByLabel('Email', { exact: true })).toBeVisible({ timeout: 15000 });
      assert.equal((await fixture.adminDb.doc(path(fixture.textId)).get()).data().body, 'Acknowledged before account-wide sign-out');
      assert.deepEqual(await journals(second), []);
      assert.equal(await second.evaluate(() => localStorage.getItem('eselsohr/demo-eselsohr/member')), null);
      await second.getByLabel('Email', { exact: true }).fill(sam.email);
      await second.getByLabel('Password', { exact: true }).fill(fixture.password);
      await second.getByRole('button', { name: 'Sign in', exact: true }).click(); await saved(second);
      await expect(second.locator('.note-row').filter({ hasText: 'Alex only' })).toHaveCount(0);
    });
  } catch (error) {
    console.error('Cross-tab diagnostics:', JSON.stringify({ errors, diagnostics }));
    throw error;
  } finally { await context.close(); }
});

test('account switches clear cross-tab coordination before delayed next-account reads', async ({ browser, fixture, errors }) => {
  test.slow();
  const context = await browser.newContext();
  await context.addInitScript(() => {
    if (!localStorage.getItem('eselsohr/demo-eselsohr/clear-cache/generation')) {
      // The previous app deleted IndexedDB but retained this SDK-owned marker.
      localStorage.setItem('firestore_targets_firestore/[DEFAULT]/demo-eselsohr/_2', JSON.stringify({ state: 'current', updateTimeMs: Date.now() }));
    }
  });
  const diagnostics = [];
  let delayed = false;
  await context.route('http://127.0.0.1:8080/**', async route => {
    if (delayed) await new Promise(resolve => setTimeout(resolve, 1200));
    await route.continue();
  });
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  for (const page of pages) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()); });
  }
  const [first, second] = pages;
  const coordination = page => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('firestore_') && key.includes('firestore/[DEFAULT]/demo-eselsohr/')));
  try {
    await first.goto(origin);
    await expect(first.getByLabel('Email', { exact: true })).toBeVisible();
    assert.deepEqual(await coordination(first), [], 'first startup repairs orphaned coordination before sign-in');
    await signIn(first, fixture.users[0], fixture.password); await saved(first);
    await second.goto(origin); await saved(second);
    for (const member of [1, 0, 1]) await test.step(`switch to ${member} with 1200ms server delay`, async () => {
      assert.ok((await coordination(second)).some(key => key.startsWith('firestore_targets_')), 'real SDK query markers exist before sign-out');
      await second.evaluate(() => { location.hash = '/people'; });
      await second.getByRole('button', { name: 'Sign out', exact: true }).click();
      for (const page of pages) await expect(page.getByLabel('Email', { exact: true })).toBeVisible({ timeout: 15000 });
      assert.deepEqual(await coordination(second), [], 'database and coordination state are cleared together');
      delayed = true;
      await second.getByLabel('Email', { exact: true }).fill(fixture.users[member].email);
      await second.getByLabel('Password', { exact: true }).fill(fixture.password);
      await second.getByRole('button', { name: 'Sign in', exact: true }).click();
      await Promise.all(pages.map(page => saved(page)));
      for (const page of pages) {
        await page.evaluate(() => { location.hash = '/'; });
        await expect(page.getByLabel('Search notes')).toBeVisible();
        await expect(page.locator('.note-row').filter({ hasText: member ? 'Sam only' : 'Alex only' })).toHaveCount(1);
        await expect(page.locator('.note-row').filter({ hasText: member ? 'Alex only' : 'Sam only' })).toHaveCount(0);
      }
      for (const user of fixture.users.slice(0, 2)) assert.equal((await fixture.adminDb.doc(`members/${user.uid}`).get()).data().active, true);
    });
    assert.deepEqual(diagnostics.filter(message => /Firestore shutting down|INTERNAL ASSERTION|does not have access/i.test(message)), []);
  } finally { await context.close(); }
});
