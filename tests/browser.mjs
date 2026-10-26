import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { expect } from 'playwright/test';
import { measure } from '../tools/test-profile.mjs';

export const origin = 'http://127.0.0.1:5173';
export const serverTimeout = 20000;

export async function requireEmulatorApp() {
  const response = await fetch(`${origin}/src/firebase.ts`);
  assert.equal(response.status, 200);
  const config = await response.text();
  assert.match(config, /"VITE_FIREBASE_PROJECT_ID":\s*"demo-eselsohr"/);
  assert.match(config, /"VITE_USE_EMULATORS":\s*"true"/);
}

export async function signIn(page, user, password) {
  await measure('browser.navigate', () => page.goto(origin));
  await measure('browser.sign-in', async () => {
    await page.getByLabel('Email', { exact: true }).fill(user.email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  });
}

export async function saved(page) {
  await measure('browser.saved', async () => {
    // Resolve all three conditions together in one browser-side assertion.
    // These are still the app's server-acknowledged state, not just local writes.
    const ready = page.locator('#app').filter({
      has: page.locator('.save-companion[data-state="saved"][data-connection="online"]'),
    }).locator('.save-bar .status');
    await expect(ready, 'Saved requires server acknowledgement and an online companion').toHaveText('Saved', { timeout: serverTimeout });
  });
}

export async function open(page, id) {
  await page.evaluate(id => { location.hash = `/notes/${id}`; }, id);
  await expect(page.getByLabel('Note title')).toBeVisible();
}

export async function share(page, audience, people = []) {
  await page.getByRole('button', { name: /^Sharing: / }).click();
  const sheet = page.getByRole('dialog', { name: 'Sharing', exact: true });
  await sheet.getByRole('radio', { name: { private: 'Private', selected: 'Selected people', everyone: 'Everyone' }[audience], exact: true }).check();
  for (const name of people) await sheet.getByRole('checkbox', { name, exact: true }).check();
  await commitSharing(page);
}

export async function commitSharing(page) {
  const sheet = page.getByRole('dialog', { name: 'Sharing', exact: true });
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  // A status read can race dialog removal. Observe removal atomically and allow
  // the same server budget as other acknowledged writes, rather than UI timing.
  await expect(sheet, 'Sharing closes after server acknowledgement').toHaveCount(0, { timeout: serverTimeout });
  await saved(page);
}

export async function pointerBox(locator) {
  let box;
  // Listener updates can replace a row between visibility and geometry reads.
  await expect.poll(async () => { box = await locator.boundingBox(); return !!box; }).toBe(true);
  return box;
}

// Non-expiry tests can use the normal keyboard-focus pause while inspecting
// server/peer state, instead of spending the short Undo window on test I/O.
export async function focusUndo(page) {
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  await expect(undo).toBeVisible({ timeout: serverTimeout });
  await undo.focus();
}

// Pause before the action under measurement. The lead time accommodates browser
// round trips; advancing to it must not consume an active Undo/debounce window.
export async function pauseClock(page) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 5000));
}

const networkContexts = new WeakSet();
const networkKey = 'eselsohr-test/network';

export async function network(page, enabled) {
  const context = page.context();
  if (!networkContexts.has(context)) {
    // The SDK's disabled state belongs to one instance, so restore it before
    // App.start opens listeners after a navigation. Keep this in the test fixture.
    await context.route('**/src/firebase.ts', async route => {
      const response = await route.fetch();
      let body = await response.text();
      const moduleUrl = body.match(/from\s+"([^"]*firebase_firestore\.js[^"]*)"/)[1];
      const opening = 'const ready = auth.authStateReady().then(';
      assert.ok(body.includes(opening), 'Network fixture must run before backend readiness');
      body = body.replace(opening, `const ready = Promise.all([auth.authStateReady(), sessionStorage.getItem(${JSON.stringify(networkKey)}) === 'off' ? testDisableNetwork(db) : Promise.resolve()]).then(`);
      body += `\nimport {disableNetwork as testDisableNetwork} from ${JSON.stringify(moduleUrl)};`;
      await route.fulfill({ response, body });
    });
    networkContexts.add(context);
  }
  await page.evaluate(async ({enabled, networkKey}) => {
    const current = sessionStorage.getItem(networkKey) !== 'off';
    if (current === enabled) return;
    const source = await (await fetch('/src/firebase.ts')).text();
    const moduleUrl = source.match(/from\s+"([^"]*firebase_firestore\.js[^"]*)"/)[1];
    const sdk = await import(moduleUrl);
    await (enabled ? sdk.enableNetwork : sdk.disableNetwork)(sdk.getFirestore());
    sessionStorage.setItem(networkKey, enabled ? 'on' : 'off');
  }, {enabled, networkKey});
}

// Review artifacts are opt-in and never overwrite dated documentation evidence.
export async function screenshot(page, name, options = {}) {
  if (!process.argv.includes('--screenshots') && process.env.ESELSOHR_SCREENSHOTS !== '1') return;
  const directory = new URL('../test-artifacts/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ ...options, path: new URL(name, directory).pathname });
}
