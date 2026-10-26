import { test } from './fixtures.mjs';
import assert from 'node:assert/strict';
import { expect } from 'playwright/test';
import { path, privatePath } from './emulator.mjs';
import { FieldValue } from 'firebase-admin/firestore';
import { origin, signIn, saved, open, network, screenshot, share, commitSharing, serverTimeout } from './browser.mjs';

test('sharing access, revocation, offline recovery and conflicts', async ({ browser, fixture, errors }) => {
  // Six multi-client transitions share one lifecycle; individual server waits stay 20s.
  test.setTimeout(180000);
  const { password, adminDb, users: [alex, sam, jo], createdNoteIds } = fixture;
  const contexts = await Promise.all([0, 1, 2, 3].map(() => browser.newContext({ viewport: { width: 390, height: 844 } })));
  const [p, q, r, otherOwner] = await Promise.all(contexts.map(context => context.newPage()));
  for (const page of [p, q, r, otherOwner]) page.on('pageerror', error => errors.push(error.message));
  const dialog = page => page.getByRole('dialog', { name: 'Sharing', exact: true });
  const sharing = page => page.getByRole('button', { name: /^Sharing: / });
  const back = page => page.getByRole('button', { name: 'Back', exact: true }).click();
  const field = (id, key, value) => expect.poll(async () => (await adminDb.doc(path(id)).get()).get(key), { timeout: serverTimeout }).toEqual(value);
  let textId, listId, everyoneId;
  try {
    await Promise.all([[p, alex], [q, sam], [r, jo], [otherOwner, alex]].map(([page, user]) => signIn(page, user, password)));
    await Promise.all([p, q, r, otherOwner].map(saved));
    await r.evaluate(() => {
      window.seenNoteIds = new Set();
      new MutationObserver(() => document.querySelectorAll('[data-note-id]').forEach(note => window.seenNoteIds.add(note.dataset.noteId)))
        .observe(document.querySelector('#app'), { childList: true, subtree: true });
    });
    await test.step('Text/List creation starts private; selected people and Everyone are explicit later choices', async () => {
      for (const kind of ['text', 'list']) {
        await p.getByRole('button', { name: 'Add', exact: true }).click();
        await p.getByRole('button', { name: kind === 'text' ? 'Text' : 'List', exact: true }).click();
        await expect(p.getByLabel('Note title')).toBeVisible();
        const id = new URL(p.url()).hash.slice('#/notes/'.length); createdNoteIds.push(id);
        if (kind === 'text') textId = id; else listId = id;
        await expect(p.getByLabel(kind === 'text' ? 'Note text' : 'New checklist item', { exact: true })).toBeFocused();
        await p.getByLabel('Note title').fill(`Selected ${kind} regression`);
        if (kind === 'text') await p.getByLabel('Note text').fill('Selected text stays with its people.');
        else { await p.getByLabel('New checklist item').fill('Selected groceries'); await p.getByLabel('New checklist item').press('Enter'); }
        await saved(p);
        await field(id, 'audience', 'private'); await field(id, 'sharedWith', [alex.uid]);
        for (const page of [q, r]) await expect(page.locator(`[data-note-id="${id}"]`)).toHaveCount(0);
        await share(p, 'selected', ['sam']);
        await field(id, 'audience', 'selected'); await field(id, 'sharedWith', [alex.uid, sam.uid]);
        await expect(q.locator(`[data-note-id="${id}"]`)).toBeVisible();
        await expect(r.locator(`[data-note-id="${id}"]`)).toHaveCount(0);
        assert.equal(await r.evaluate(id => window.seenNoteIds.has(id), id), false, 'excluded member never receives a private/selected card');
        await expect(sharing(p)).toHaveText('Selected people');
        await back(p);
      }
      await p.getByRole('button', { name: 'Add', exact: true }).click();
      await p.getByRole('button', { name: 'Text', exact: true }).click();
      await expect(p.getByLabel('Note title')).toBeVisible();
      everyoneId = new URL(p.url()).hash.slice('#/notes/'.length); createdNoteIds.push(everyoneId);
      await p.getByLabel('Note title').fill('Everyone sharing regression'); await saved(p);
      await field(everyoneId, 'audience', 'private');
      await expect(r.locator(`[data-note-id="${everyoneId}"]`)).toHaveCount(0);
      await share(p, 'everyone');
      await field(everyoneId, 'audience', 'everyone');
      await expect(sharing(p)).toHaveText('Everyone');
      await expect(r.locator(`[data-note-id="${everyoneId}"]`)).toBeVisible();
    });
    await test.step('legacy private lists share in place, distinguish owner paths, and become private again with rows intact', async () => {
      const id = `legacy-sharing-${fixture.run}`, ownId = `private:${id}`, participantId = `member:${encodeURIComponent(alex.uid)}:${id}`;
      const ref = adminDb.doc(privatePath(alex.uid, id));
      const metadata = { createdBy: alex.uid, updatedBy: alex.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
      await ref.set({ kind: 'checklist', title: 'Legacy private list', body: '', state: 'active', pinned: false, ...metadata });
      await ref.collection('items').doc('row').set({ text: 'Legacy row', checked: false, ...metadata });
      await open(p, ownId); await saved(p); await expect(sharing(p)).toHaveText('Private');
      await share(p, 'selected', ['sam']);
      await expect(q.locator(`[data-note-id="${participantId}"]`)).toBeVisible();
      await open(q, participantId); await saved(q);
      await q.getByLabel('Checklist item', { exact: true }).fill('Legacy participant edit'); await saved(q);
      await expect(p.getByLabel('Checklist item', { exact: true })).toHaveValue('Legacy participant edit');
      await share(p, 'everyone');
      await expect(r.locator(`[data-note-id="${participantId}"]`)).toBeVisible();
      await share(p, 'private');
      await expect(q.getByText('This note is unavailable.', { exact: true })).toBeVisible();
      await expect(r.locator(`[data-note-id="${participantId}"]`)).toHaveCount(0);
      // Rapidly cross both filtered queries with an overlapping owner listener.
      // Acknowledged changes must never reopen Sharing with an older audience.
      for (let repeat = 0; repeat < 3; repeat++) {
        await share(p, 'everyone');
        await expect(sharing(p)).toHaveText('Everyone');
        await share(p, 'selected', ['sam']);
        await expect(sharing(p)).toHaveText('Selected people');
        await share(p, 'private');
        await expect(sharing(p)).toHaveText('Private');
      }
      await expect(q.getByText('This note is unavailable.', { exact: true })).toBeVisible();
      await expect(r.locator(`[data-note-id="${participantId}"]`)).toHaveCount(0);
      assert.equal((await ref.collection('items').doc('row').get()).get('text'), 'Legacy participant edit');
      assert.equal((await adminDb.doc(path(id)).get()).exists, false, 'sharing does not copy or relocate the note');
      await back(q); await back(p);
      await open(p, everyoneId);
    });
    await test.step('creator can change existing sharing; participants see access without editing it', async () => {
      await open(q, listId); await saved(q); await sharing(q).click();
      await expect(dialog(q).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
      for (const control of await dialog(q).locator('input').all()) await expect(control).toBeDisabled();
      await expect(dialog(q).getByText('Only the creator can change sharing.')).toBeVisible();
      await q.keyboard.press('Escape'); await expect(sharing(q)).toBeFocused();
      await q.getByLabel('Checklist item', { exact: true }).fill('Edited by a selected person'); await saved(q);
      await sharing(p).click();
      await dialog(p).getByRole('radio', { name: 'Selected people', exact: true }).check();
      await dialog(p).getByRole('checkbox', { name: 'jo', exact: true }).check();
      await commitSharing(p);
      await field(everyoneId, 'sharedWith', [alex.uid, jo.uid]);
      await expect(r.locator(`[data-note-id="${everyoneId}"]`)).toBeVisible();
      await back(q); await expect(q.locator(`[data-note-id="${everyoneId}"]`)).toHaveCount(0);
      await p.getByRole('button', { name: 'Pin', exact: true }).click(); await saved(p);
      await back(p); await p.getByRole('button', { name: 'Actions: Everyone sharing regression', exact: true }).click();
      await p.getByRole('button', { name: 'Move to bin', exact: true }).click(); await saved(p);
      await field(everyoneId, 'sharedWith', [alex.uid, jo.uid]);
      await p.getByRole('button', { name: 'Undo', exact: true }).click(); await saved(p);
      await open(p, everyoneId); await sharing(p).click();
      await dialog(p).getByRole('radio', { name: 'Everyone', exact: true }).check(); await commitSharing(p);
      await field(everyoneId, 'sharedWith', []);
      await expect(q.locator(`[data-note-id="${everyoneId}"]`)).toBeVisible();
    });
    await test.step('removing an open participant clears note/rows/drafts and stale cached reopening; re-adding restores access', async () => {
      await Promise.all([open(p, listId), open(q, listId)]); await Promise.all([saved(p), saved(q)]);
      await network(q, false);
      await q.getByLabel('Checklist item', { exact: true }).fill('Revoked pending draft');
      await q.getByLabel('Note title').fill('Revoked title draft');
      await sharing(p).click();
      await dialog(p).getByRole('checkbox', { name: 'sam', exact: true }).uncheck();
      await dialog(p).getByRole('checkbox', { name: 'jo', exact: true }).check(); await commitSharing(p);
      await network(q, true);
      await expect(q.getByText('This note is unavailable.', { exact: true })).toBeVisible();
      await expect(q.getByLabel('Note title')).toHaveCount(0); await expect(q.locator('.check-row')).toHaveCount(0);
      await expect.poll(() => q.evaluate(id => Object.entries(localStorage).filter(([key]) => key.includes('/drafts/')).every(([, value]) => !value.includes(id)), listId)).toBe(true);
      await network(q, false); await q.reload();
      await expect(q.getByText('This note is unavailable.', { exact: true })).toBeVisible();
      await expect(q.getByLabel('Note title')).toHaveCount(0);
      await network(q, false);
      const offlineRead = await q.evaluate(async id => {
        const source = await (await fetch('/src/firebase.ts')).text();
        const sdk = await import(source.match(/from\s+"([^"]*firebase_firestore\.js[^"]*)"/)[1]);
        try { await sdk.getDocFromServer(sdk.doc(sdk.getFirestore(), 'notebooks/home/notes', id)); return 'server read succeeded'; }
        catch (error) { return error.code; }
      }, fixture.otherId);
      assert.equal(offlineRead, 'unavailable', 'reloaded SDK remains offline until explicit reconnect');
      await network(q, true); await network(q, true); await back(q); await saved(q);
      await expect(q.locator(`[data-note-id="${everyoneId}"]`)).toBeVisible();
      await expect(q.getByLabel('Email', { exact: true })).toHaveCount(0);
      await q.getByLabel('Search notes').fill('Selected groceries'); await expect(q.locator(`[data-note-id="${listId}"]`)).toHaveCount(0);
      await q.getByLabel('Search notes').fill('');
      await open(r, listId); await saved(r);
      await expect(r.getByLabel('Checklist item', { exact: true })).toHaveValue('Edited by a selected person');
      await sharing(p).click(); await dialog(p).getByRole('checkbox', { name: 'sam', exact: true }).check(); await commitSharing(p);
      await expect(q.locator(`[data-note-id="${listId}"]`)).toBeVisible();
      await open(q, listId); await saved(q);
      await expect(q.getByLabel('Note title')).toHaveValue('Selected list regression');
      await expect(q.getByLabel('Checklist item', { exact: true })).toHaveValue('Edited by a selected person');
      await q.getByLabel('Checklist item', { exact: true }).fill('Access restored'); await saved(q);
      await expect(p.getByLabel('Checklist item', { exact: true })).toHaveValue('Access restored');
    });
    await test.step('sharing changes require online acknowledgement and detect concurrent creator changes', async () => {
      await sharing(p).click();
      await dialog(p).getByRole('checkbox', { name: 'sam', exact: true }).uncheck();
      await network(p, false);
      await dialog(p).getByRole('button', { name: 'Save', exact: true }).click();
      await expect(dialog(p).getByRole('status')).toHaveText('Could not update sharing. Check your connection and try again.');
      assert.ok((await adminDb.doc(path(listId)).get()).get('sharedWith').includes(sam.uid));
      await expect(dialog(p).getByRole('checkbox', { name: 'sam', exact: true })).not.toBeChecked();
      await network(p, true); await saved(p); await commitSharing(p);
      await open(otherOwner, listId); await sharing(otherOwner).click();
      await dialog(otherOwner).getByRole('checkbox', { name: 'sam', exact: true }).check();
      await sharing(p).click(); await dialog(p).getByRole('radio', { name: 'Everyone', exact: true }).check(); await commitSharing(p);
      await dialog(otherOwner).getByRole('button', { name: 'Save', exact: true }).click();
      await expect(dialog(otherOwner).getByRole('status')).toHaveText('Sharing changed in another window. Close and reopen Sharing to see the latest people.');
      await field(listId, 'audience', 'everyone');
      await otherOwner.keyboard.press('Escape');
      await back(p); await p.getByRole('button', { name: 'Actions: Selected list regression', exact: true }).click();
      await p.getByRole('button', { name: 'Sharing', exact: true }).click();
      await expect(dialog(p).getByRole('radio', { name: 'Everyone', exact: true })).toBeChecked();
      await p.keyboard.press('Escape');
    });
    await test.step('sharing sheet fits narrow/large text, keeps 48px targets, supports keyboard cancel without saving', async () => {
      await open(p, textId);
      for (const [width, font] of [[390, 16], [320, 32]]) {
        await p.setViewportSize({ width, height: 844 });
        await p.evaluate(font => { document.documentElement.style.fontSize = `${font}px`; }, font);
        await sharing(p).click();
        const geometry = await dialog(p).evaluate(root => {
          const box = root.getBoundingClientRect();
          return { left: box.left, right: box.right, width: innerWidth, overflow: root.scrollWidth > root.clientWidth,
            targets: [...root.querySelectorAll('.sharing-person,button')].map(target => { const rect = target.getBoundingClientRect(); return [rect.width, rect.height]; }) };
        });
        assert.ok(geometry.left >= 0 && geometry.right <= geometry.width && !geometry.overflow);
        assert.ok(geometry.targets.every(([width, height]) => width >= 48 && height >= 48));
        await dialog(p).getByRole('checkbox', { name: 'jo', exact: true }).check();
        await screenshot(p, `sharing-${width}-${font}.png`);
        await p.keyboard.press('Escape'); await expect(sharing(p)).toBeFocused();
        await field(textId, 'sharedWith', [alex.uid, sam.uid]);
      }
    });
  } finally { await Promise.all(contexts.map(context => context.close())); }
});

test('active member recovers from a denied query through Update app without losing Auth or drafts', async ({ browser, fixture, errors }) => {
  const { password, users: [alex] } = fixture;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin); await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await page.evaluate(async ({ uid, id }) => {
      const { NotesRepository } = await import('/src/notes.ts');
      const source = await (await fetch('/src/firebase.ts')).text();
      const moduleUrl = source.match(/from\s+"([^"]*firebase_firestore\.js[^"]*)"/)[1];
      const { collection, onSnapshot } = await import(moduleUrl);
      // The earlier app's real broad query is rejected by current rules.
      NotesRepository.prototype.notes = function(_receive, fail) { return onSnapshot(collection(this.db, 'notebooks/home/notes'), () => {}, fail); };
      localStorage.setItem(`eselsohr/demo-eselsohr/drafts/${uid}`, JSON.stringify({ [`note/${id}`]: { body: 'x'.repeat(40001) } }));
    }, { uid: alex.uid, id: fixture.textId });
    await page.getByLabel('Email', { exact: true }).fill(alex.email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('This version could not open your notes. Update the app or retry.', { exact: true })).toBeVisible();
    await expect(page.getByText('Access to the notebook was lost.', { exact: false })).toHaveCount(0);
    assert.ok(await page.evaluate(uid => Object.keys(localStorage).some(key => key.startsWith(`eselsohr/demo-eselsohr/drafts/${uid}/writers/`)), alex.uid));
    await page.getByRole('button', { name: 'Update app', exact: true }).click();
    await expect(page.getByLabel('Search notes')).toBeVisible();
    assert.equal(new URL(page.url()).pathname, '/index.html');
    assert.ok(new URL(page.url()).searchParams.has('update'));
    await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
    await open(page, fixture.textId);
    await expect(page.getByLabel('Note text')).toHaveValue('x'.repeat(40001));
    await page.getByLabel('Note text').fill('Recovered journal after app update');
    await page.getByRole('button', { name: 'Retry', exact: true }).click(); await saved(page);
    await expect.poll(async () => (await fixture.adminDb.doc(path(fixture.textId)).get()).get('body'), { timeout: serverTimeout }).toBe('Recovered journal after app update');
  } finally { await context.close(); }
});
