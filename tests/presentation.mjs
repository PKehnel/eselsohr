import assert from 'node:assert/strict';
import { expect } from 'playwright/test';
import { test } from './fixtures.mjs';
import { path } from './emulator.mjs';
import { origin, signIn, saved, open, network, screenshot, serverTimeout, focusUndo, pauseClock } from './browser.mjs';
import { mountFamilyScene } from './motion-scene.mjs';

async function field(db, id, key, value) {
  await expect.poll(async () => (await db.doc(path(id)).get()).data()?.[key], { timeout: serverTimeout }).toEqual(value);
}

test('completion motion follows local acknowledgement, skips remote updates and respects cooldown', async ({ fixture, browser, errors }) => {
  const { adminDb, textId, password, checklistId, itemPath } = fixture;
  await adminDb.doc(path(textId)).update({ title: 'Weekend plan', body: 'Newest offline draft' });
  const alex = fixture.users[0];
  const sam = fixture.users[1];
  const extra = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const watcher = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const [local, remote] = await Promise.all([extra.newPage(), watcher.newPage()]);
    for (const page of [local, remote]) page.on('pageerror', error => errors.push(error.message));
    await Promise.all([signIn(local, alex, password), signIn(remote, sam, password)]);
    await Promise.all([saved(local), saved(remote)]);
    await Promise.all([open(local, checklistId), open(remote, checklistId)]);
    await Promise.all([saved(local), saved(remote)]);
    await expect(local.locator('.donkey-motion')).toHaveCount(1);
    await adminDb.doc(itemPath).update({ checked: false });
    await expect(local.getByRole('checkbox')).not.toBeChecked();
    await local.evaluate(async () => {
      Math.random = () => 0;
      await Promise.all(['idle-blink', 'completion-pounce'].map(name => {
        const image = new Image(); image.src = `/themes/donkey-v1/${name}.webp`; return image.decode();
      }));
    });
    await local.getByRole('checkbox').check();
    await expect.poll(async () => (await adminDb.doc(itemPath).get()).data().checked).toBe(true);
    await expect(local.locator('.donkey-motion')).toHaveAttribute('data-playing', 'completion');
    await expect(local.locator('.save-companion .action-art:not([hidden])')).toBeHidden();
    await expect(local.locator('.save-companion .donkey-sprite')).toBeVisible();
    await expect(remote.getByRole('checkbox')).toBeChecked();
    await expect(remote.locator('.donkey-motion')).not.toHaveAttribute('data-playing');
    await screenshot(local, 'donkey-completion.png');
    await local.getByRole('checkbox').uncheck(); await saved(local);
    await expect(local.locator('.save-companion .action-art:not([hidden])')).toBeVisible();
    await expect(local.locator('.donkey-sprite')).toBeHidden();
    await local.getByRole('checkbox').check(); await saved(local);
    await expect(local.locator('.donkey-motion')).not.toHaveAttribute('data-playing');
    await local.getByRole('button', { name: 'Back', exact: true }).click();
    await local.getByRole('button', { name: 'Notebook menu', exact: true }).click();
    await local.getByRole('button', { name: 'Donkey animations', exact: true }).click();
    await local.getByRole('button', { name: 'Donkey animations', exact: true }).click();
    await expect(local.getByRole('button', { name: 'Donkey animations', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await local.reload(); await saved(local);
    await local.getByRole('button', { name: 'Notebook menu', exact: true }).click();
    await local.getByRole('button', { name: 'Donkey animations', exact: true }).click();
    await expect(local.getByRole('button', { name: 'Donkey animations', exact: true })).toHaveAttribute('aria-pressed', 'false');
  } finally { await extra.close(); await watcher.close(); }
});

test('idle animation plays once, skips typing/dialogs and stops for hidden/reduced/off/teardown', async ({ browser, errors }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.goto(origin);
    await pauseClock(page);
    await page.evaluate(async () => {
      Math.random = () => 0;
      const { DonkeyMotion } = await import('/src/views/donkey-motion.ts');
      const motion = new DonkeyMotion(); window.motionCheck = motion;
      const area = document.createElement('section'); area.style.cssText = 'position:fixed;top:0;left:0;width:80px;height:80px'; document.body.append(area);
      motion.attach(area);
      await Promise.all(['idle-blink', 'completion-pounce'].map(name => {
        const image = new Image(); image.src = `/themes/donkey-v1/${name}.webp`; return image.decode();
      }));
    });
    const motion = page.locator('.donkey-motion');
    await page.clock.runFor(60000); await expect(motion).toHaveAttribute('data-playing', 'idle');
    const first = await page.locator('.donkey-sprite').getAttribute('style');
    await page.clock.runFor(500);
    assert.notEqual(await page.locator('.donkey-sprite').getAttribute('style'), first);
    await page.clock.runFor(1020); await expect(motion).not.toHaveAttribute('data-playing');
    await page.evaluate(() => {
      const input = document.createElement('input'); input.style.cssText = 'position:fixed;top:100px;left:0';
      document.body.append(input); input.focus({ preventScroll: true });
    });
    await page.clock.runFor(60000); await expect(motion).not.toHaveAttribute('data-playing');
    await page.evaluate(() => { document.activeElement.blur(); const dialog = document.createElement('dialog'); document.body.append(dialog); dialog.showModal(); });
    await page.clock.runFor(60000); await expect(motion).not.toHaveAttribute('data-playing');
    await page.evaluate(() => document.querySelector('dialog').close());
    await page.clock.runFor(58480); await expect(motion).toHaveAttribute('data-playing', 'idle');
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect(motion).not.toHaveAttribute('data-playing');
    await page.clock.runFor(150000); await expect(motion).not.toHaveAttribute('data-playing');
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.runFor(150000); await expect(motion).not.toHaveAttribute('data-playing');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => window.motionCheck.setEnabled(false));
    await page.clock.runFor(150000); await expect(motion).not.toHaveAttribute('data-playing');
    await page.evaluate(() => { window.motionCheck.setEnabled(true); window.motionCheck.attach(null); });
    await page.clock.runFor(150000); await expect(motion).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.motionCheck.root.dataset.playing), undefined);
  } finally { await context.close(); }
});

test('family waits 30 seconds, uses only bottom whitespace, follows in threes and cancels safely', async ({ browser, errors }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.clock.install();
    await page.goto(origin); await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await pauseClock(page);
    await mountFamilyScene(page);
    const family = page.locator('.donkey-family');
    await page.clock.runFor(30000); await expect(family).toHaveCount(0);
    await page.clock.runFor(1); await expect(family).toBeVisible();
    const geometry = await family.evaluate(layer => {
      const box = layer.getBoundingClientRect(), list = document.querySelector('.note-list').getBoundingClientRect(), dock = document.querySelector('.notebook-dock').getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, notes: list.bottom, dock: dock.top, pointerEvents: getComputedStyle(layer).pointerEvents,
        sizes: [...layer.children].map(child => Number.parseFloat(child.style.width)) };
    });
    assert.ok(geometry.top >= geometry.notes + 16); assert.ok(geometry.bottom <= geometry.dock - 12);
    assert.equal(geometry.pointerEvents, 'none');
    assert.equal(geometry.sizes.length, 3); assert.ok(geometry.sizes[0] > geometry.sizes[1] && geometry.sizes[1] >= geometry.sizes[2]);
    await screenshot(page, 'donkey-chase-mobile.png');
    await page.evaluate(() => document.dispatchEvent(new Event('pointerdown'))); await expect(family).toHaveCount(0);
    await page.clock.runFor(120000); await expect(family).toHaveCount(0); // One crossing per opening, even after cancellation.
    await page.evaluate(() => window.mountFamilyCheck(16));
    await page.clock.runFor(30001); await expect(family).toHaveCount(0);
    await page.evaluate(() => window.fillFamilyNotes(1));
    await page.clock.runFor(10000); await expect(family).toBeVisible();
    await page.evaluate(() => window.fillFamilyNotes(16));
    // ResizeObserver delivery uses real rendering turns even with the clock paused.
    await expect.poll(async () => { await page.clock.runFor(50); return family.count(); }).toBe(0);
    for (const guard of ['typing', 'dialog', 'off', 'hidden', 'reduced']) {
      await page.evaluate(() => window.mountFamilyCheck(1));
      if (guard === 'typing') await page.getByLabel('Search notes').focus();
      if (guard === 'dialog') await page.evaluate(() => { const dialog = document.createElement('dialog'); document.body.append(dialog); dialog.showModal(); });
      if (guard === 'off') await page.evaluate(() => window.motionCheck.setEnabled(false));
      if (guard === 'hidden') await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
      if (guard === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.clock.runFor(40001); await expect(family).toHaveCount(0);
      await page.evaluate(() => {
        document.querySelector('dialog[open]')?.close(); document.activeElement?.blur();
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        document.dispatchEvent(new Event('visibilitychange')); window.motionCheck.setEnabled(true);
      });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    }
    await page.evaluate(() => window.mountFamilyCheck(1)); await page.clock.runFor(30001); await expect(family).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' }); await expect(family).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => window.mountFamilyCheck(1)); await page.clock.runFor(30001); await expect(family).toBeVisible();
    await page.clock.runFor(10300); await expect(family).toHaveCount(0);
    await page.evaluate(() => window.mountFamilyCheck(1)); await page.clock.runFor(30001); await expect(family).toBeVisible();
    await page.evaluate(() => window.motionCheck.destroy()); await expect(family).toHaveCount(0);
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  } finally { await context.close(); }
});

test('typing stays steady; donkey shows connection problems and its menu supports dismissal/previews', async ({ fixture, browser, errors }) => {
  const { adminDb, textId, password, checklistId } = fixture;
  await adminDb.doc(path(textId)).update({ title: 'Weekend plan', body: 'Newest offline draft' });
  const alex = fixture.users[0];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await signIn(page, alex, password); await saved(page);
    const trigger = page.getByRole('button', { name: 'Notebook menu', exact: true });
    await trigger.click();
    await expect(page.locator('.sync-entry')).toBeHidden();
    await screenshot(page, 'notebook-menu.png');
    await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    await open(page, checklistId); await saved(page);
    const title = page.getByLabel('Note title');
    const initialTitle = await title.inputValue();
    const positions = () => page.locator('.editor-nav, .editor-title, .check-row').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
    const beforeTyping = await positions();
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.editor-nav, .editor-title, .check-row')];
      const baseline = nodes.map(node => node.getBoundingClientRect().top);
      const check = window.typingCheck = { frames: 0, shifted: false, changedArt: false, frame: 0 };
      const sample = () => {
        check.frames++;
        check.shifted ||= nodes.some((node, i) => Math.abs(node.getBoundingClientRect().top - baseline[i]) > .5);
        check.changedArt ||= !document.querySelector('.save-companion .action-art:not([hidden]) img')?.src.endsWith('/online-sage.webp');
        check.frame = requestAnimationFrame(sample);
      };
      sample();
    });
    for (const suffix of ['a', 'ab', 'abc']) {
      await title.fill(`${initialTitle} ${suffix}`);
      await expect(page.locator('.save-companion')).toHaveAttribute('data-state', 'pending');
      assert.deepEqual(await positions(), beforeTyping, 'typing must not move the editor or list');
      await expect(page.locator('.save-companion .action-art:not([hidden]) img')).toHaveAttribute('src', '/themes/donkey-ui/online-sage.webp');
      await expect(page.locator('.sync-entry')).toBeHidden();
    }
    await title.blur(); await saved(page);
    assert.deepEqual(await positions(), beforeTyping, 'acknowledgement must not move the editor or list');
    const row = page.getByLabel('Checklist item', { exact: true }).first();
    const originalRow = await row.inputValue();
    await row.press('End'); await row.pressSequentially(' xyz', { delay: 80 }); await saved(page);
    const typing = await page.evaluate(() => { cancelAnimationFrame(window.typingCheck.frame); return window.typingCheck; });
    assert.ok(typing.frames > 2, 'observe the debounce, submitted write and acknowledgement');
    assert.equal(typing.shifted, false, 'no editor/list shift during any sampled frame');
    assert.equal(typing.changedArt, false, 'no drawing switch during any sampled frame');
    await row.fill(originalRow); await row.blur(); await saved(page);
    await title.fill(initialTitle); await title.blur(); await saved(page);
    await page.evaluate(() => { location.hash = '/bin'; }); await saved(page);
    await expect(page.locator('.save-companion .action-art:not([hidden]) img')).toHaveAttribute('src', '/themes/donkey-ui/bin.webp');
    await context.setOffline(true);
    await trigger.click();
    await expect(page.locator('.sync-entry')).toContainText('Offline');
    await expect(page.locator('.sync-entry')).toHaveAttribute('data-state', 'offline');
    await expect(page.locator('.save-companion .action-art:not([hidden]) img')).toHaveAttribute('src', '/themes/donkey-ui/offline.webp');
    await page.keyboard.press('Escape'); await context.setOffline(false); await saved(page);
    await expect(page.locator('.save-companion .action-art:not([hidden]) img')).toHaveAttribute('src', '/themes/donkey-ui/bin.webp');
    await open(page, textId); await saved(page); await network(page, false);
    await page.getByLabel('Note text').fill('Draft waiting for a real acknowledgement');
    await expect(page.locator('.save-companion')).toHaveAttribute('data-state', 'pending');
    await expect(page.locator('.save-companion .action-art:not([hidden]) img')).toHaveAttribute('src', '/themes/donkey-ui/offline.webp');
    await trigger.click(); await expect(page.locator('.sync-entry')).toHaveText('Connecting to the notebook…');
    await expect(page.locator('.sync-entry')).toHaveAttribute('data-state', 'pending');
    await network(page, true); await saved(page);
    await expect(page.locator('.sync-entry')).toBeHidden();
    await page.keyboard.press('Escape');
    await page.getByLabel('Note text').fill('Newest offline draft'); await page.getByLabel('Note text').blur(); await saved(page);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    const before = (await adminDb.doc(path(textId)).get()).data();
    await trigger.click(); await page.getByRole('button', { name: 'Donkey animations', exact: true }).click();
    const stage = page.locator('.motion-stage');
    await expect(stage.locator('.donkey-motion')).toHaveCount(1);
    await page.evaluate(async () => {
      await Promise.all(['/themes/donkey-v1/idle-blink.webp', '/themes/donkey-v1/completion-pounce.webp'].map(src => { const image = new Image(); image.src = src; return image.decode(); }));
    });
    for (const [label, kind] of [['Preview blink', 'idle'], ['Preview pounce', 'completion'], ['Preview bin toss', 'toss'], ['Preview donkey chase', 'family']]) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(stage.locator('.donkey-motion')).toHaveAttribute('data-playing', kind);
      if (kind === 'toss') {
        await expect(stage.locator('.flying-note')).toBeAttached();
      }
      if (kind === 'family') {
        await expect(stage.locator('.running-donkey')).toHaveCount(3);
        const clearance = await stage.evaluate(surface => ({
          top: surface.querySelector('.donkey-family').getBoundingClientRect().top,
          bottom: surface.querySelector('.donkey-family').getBoundingClientRect().bottom,
          stage: surface.getBoundingClientRect().top,
          bin: surface.querySelector('.preview-bin').getBoundingClientRect().top,
        }));
        assert.ok(clearance.bottom <= clearance.bin - 18, 'preview stays entirely above the bin');
        assert.ok(clearance.top >= clearance.stage + 4, 'preview keeps the ears inside its stage');
      }
    }
    await page.setViewportSize({ width: 320, height: 844 });
    await page.addStyleTag({ content: ':root { font-size:32px; }' });
    await page.getByRole('button', { name: 'Preview donkey chase', exact: true }).click();
    await expect(stage.locator('.donkey-family')).toBeVisible();
    const largePreview = await stage.locator('.donkey-family').boundingBox();
    assert.ok(largePreview.y >= 0 && largePreview.y + largePreview.height <= 844, 'large-text preview scrolls the actual stage into view');
    await screenshot(page, 'donkey-chase-preview-large.png');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(stage.locator('.donkey-motion')).not.toHaveAttribute('data-playing');
    await expect(page.locator('.flying-note')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Preview bin toss' })).toBeDisabled();
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.donkey-settings')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    assert.deepEqual((await adminDb.doc(path(textId)).get()).data(), before);
  } finally { await context.close(); }
});

test('acknowledged local bin moves may toss; Undo, offline replay and remote moves do not', async ({ fixture, browser, errors }) => {
  const { adminDb, textId, password } = fixture;
  await adminDb.doc(path(textId)).update({ title: 'Weekend plan', body: 'Newest offline draft' });
  const alex = fixture.users[0];
  const sam = fixture.users[1];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const watcher = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const [page, remote] = await Promise.all([context.newPage(), watcher.newPage()]);
    for (const target of [page, remote]) target.on('pageerror', error => errors.push(error.message));
    await Promise.all([signIn(page, alex, password), signIn(remote, sam, password)]); await Promise.all([saved(page), saved(remote)]);
    await page.evaluate(() => { Math.random = () => 0; });
    const move = async () => {
      await page.getByRole('button', { name: 'Actions: Weekend plan', exact: true }).click();
      await page.getByRole('button', { name: 'Move to bin', exact: true }).click();
    };
    await move(); await focusUndo(page); await field(adminDb, textId, 'state', 'archived');
    await expect(page.locator('.notebook-toolbar .donkey-motion')).toHaveAttribute('data-playing', 'toss');
    await expect(remote.locator('.donkey-motion')).not.toHaveAttribute('data-playing');
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await saved(page); await field(adminDb, textId, 'state', 'active');
    await expect(page.locator('.flying-note')).toHaveCount(0);
    await network(page, false); await move();
    await expect(page.locator('.save-companion')).toHaveAttribute('data-state', 'pending');
    await expect(page.locator('.donkey-motion')).toHaveCount(0);
    await network(page, true); await saved(page); await field(adminDb, textId, 'state', 'archived');
    await expect(page.locator('.donkey-motion')).not.toHaveAttribute('data-playing');
    await page.getByRole('button', { name: 'Bin', exact: true }).click();
    await page.getByRole('button', { name: 'Actions: Weekend plan', exact: true }).click();
    await page.getByRole('button', { name: 'Restore', exact: true }).click(); await field(adminDb, textId, 'state', 'active');
  } finally { await context.close(); await watcher.close(); }
});

test('small/large-text layouts, dialog keyboard dismissal and missing artwork', async ({ fixture, p, q }) => {
  const { adminDb, textId, checklistId } = fixture;
  await adminDb.doc(path(textId)).update({ title: 'Weekend plan', body: 'Newest offline draft' });
  await expect(p.getByRole('heading', { name: 'Notes', exact: true, level: 1 })).toHaveClass('sr-only');
  await expect(p.getByRole('heading', { name: 'Notes', exact: true, level: 2 })).toHaveClass('sr-only');
  await screenshot(p, 'home-mobile.png', { fullPage: true });
  await expect.poll(() => p.locator('.note-grid').first().evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length), {
    message: 'The initial notebook snapshots settle into two columns',
  }).toBe(2);
  await expect(p.locator('.donkey-motion')).toHaveCount(1);
  for (const width of [320, 390, 1024]) {
    await p.setViewportSize({ width, height: 844 });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  await p.setViewportSize({ width: 320, height: 844 });
  await p.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await p.addStyleTag({ content: ':root { font-size: 32px; }' });
  assert.equal(await p.locator('.note-grid').first().evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length), 1);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await p.evaluate(() => document.getAnimations().length), 0);
  await p.getByRole('button', { name: 'Add', exact: true }).click();
  for (const name of ['List', 'Text']) await expect(p.getByRole('button', { name, exact: true })).toBeVisible();
  await screenshot(p, 'add-menu-large-dark.png', { fullPage: true });
  await p.keyboard.press('Escape'); await expect(p.getByRole('dialog')).toHaveCount(0);
  await screenshot(p, 'home-large-dark.png', { fullPage: true });
  await open(p, checklistId);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await expect(p.locator('.check-row').first().getByRole('button')).toHaveCount(1);
  await expect(p.locator('.item-options').first()).toHaveText('⋯');
  await p.locator('.item-options').first().click();
  await expect(p.getByRole('dialog', { name: 'List item actions' })).toBeVisible();
  await expect(p.getByRole('button', { name: /^Remove / })).toBeVisible();
  await p.keyboard.press('Escape'); await expect(p.locator('.item-options').first()).toBeFocused();
  const textWidth = await p.getByLabel('Checklist item', { exact: true }).first().evaluate(input => input.getBoundingClientRect().width);
  assert.ok(textWidth >= 150, 'even 320px / 200% text keeps useful checklist writing space');
  await screenshot(p, 'editor-large-dark.png', { fullPage: true });
  await open(p, textId);
  const writing = await p.getByLabel('Note text').evaluate(input => ({ bottom: input.getBoundingClientRect().bottom, resize: getComputedStyle(input).resize }));
  assert.equal(writing.resize, 'none'); assert.ok(writing.bottom >= 814, 'text editor extends to the lower screen padding');
  await screenshot(p, 'text-editor-large.png', { fullPage: true });
  await open(q, checklistId);
  await q.context().route('**/themes/**', route => route.abort()); await q.reload(); await saved(q);
  await expect(q.locator('.save-companion .action-art:not([hidden]) .art-fallback')).toBeVisible();
  await q.getByLabel('Checklist item', { exact: true }).first().fill('Artwork-independent edit');
  await saved(q);
});

