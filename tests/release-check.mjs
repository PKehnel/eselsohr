// Run after npm run build, with the Hosting emulator serving dist on loopback.
// Browser requests to cloud services are intercepted: no live login or writes.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { chromium, expect } from 'playwright/test';
import { loadEnv } from 'vite';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { screenshot } from './browser.mjs';
import { workerUpdateChecks } from './worker-update.mjs';
import { productionTarget } from '../tools/target.mjs';

const { values } = parseArgs({ options: { live: { type: 'boolean', default: false }, project: { type: 'string' }, mode: { type: 'string', default: 'production' }, screenshots: { type: 'boolean' } } });
const root = new URL('..', import.meta.url);
const env = { ...loadEnv(values.mode, root.pathname, 'VITE_'), ...process.env };
productionTarget(values.project, env, { live: values.live });
const origin = values.live ? `https://${values.project}.web.app` : 'http://127.0.0.1:5000';
const response = await fetch(origin);
assert.equal(response.status, 200);
assert.equal(response.headers.get('cache-control'), 'no-cache');
assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
const csp = response.headers.get('content-security-policy');
for (const directive of ["script-src 'self'", "style-src 'self'", "frame-ancestors 'none'", "object-src 'none'"]) assert.ok(csp.includes(directive));
assert.equal(csp.includes('unsafe-inline'), false);
const html = await response.text();
assert.equal(html, await readFile(new URL('dist/index.html', root), 'utf8'));
const manifest = await (await fetch(`${origin}/manifest.webmanifest`)).json();
assert.deepEqual([manifest.id, manifest.start_url, manifest.scope, manifest.display], ['/', '/', '/', 'standalone']);
assert.equal(manifest.background_color, '#e7ede7'); assert.equal(manifest.theme_color, '#e7ede7');
for (const asset of ['/manifest.webmanifest', '/sw.js', '/icons/icon-192.png', '/icons/icon-512.png', '/themes/donkey-v1/corner-loaf.webp', '/themes/donkey-v1/idle-blink.webp', '/themes/donkey-v1/completion-pounce.webp', ...['online-sage', 'offline', 'bin', 'people'].map(name => `/themes/donkey-ui/${name}.webp`)]) {
  const reply = await fetch(`${origin}${asset}`);
  assert.equal(reply.status, 200); assert.equal(reply.headers.get('cache-control'), 'no-cache');
  assert.deepEqual(Buffer.from(await reply.arrayBuffer()), await readFile(new URL(`dist${asset}`, root)));
}
const artwork = JSON.parse(await readFile(new URL('docs/ASSETS.json', root), 'utf8'));
for (const { path, sha256 } of artwork) {
  assert.equal(createHash('sha256').update(await readFile(new URL(`dist/${path}`, root))).digest('hex'), sha256, `Reviewed runtime asset: ${path}`);
}
const assets = await readdir(new URL('dist/assets/', root));
for (const name of assets) {
  const reply = await fetch(`${origin}/assets/${name}`);
  assert.equal(reply.status, 200); assert.match(reply.headers.get('cache-control'), /immutable/);
  const source = await readFile(new URL(`dist/assets/${name}`, root), 'utf8');
  assert.equal(await reply.text(), source);
  for (const forbidden of ['@example.test', 'BEGIN PRIVATE KEY', '"type":"service_account"']) assert.equal(source.includes(forbidden), false);
}
assert.equal(html.includes('design-preview'), false);
assert.deepEqual((await readdir(new URL('dist/', root))).sort(), ['assets', 'icons', 'index.html', 'manifest.webmanifest', 'sw.js', 'themes']);
console.log(`PASS production target, served file bytes, stable manifest and ${values.live ? 'live' : 'emulator'} Hosting headers`);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const failures = [];
  const intercepted = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', entry => { if (entry.type() === 'error' && !entry.text().includes('400')) failures.push(entry.text()); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    intercepted.push(url.hostname);
    if (url.hostname === 'identitytoolkit.googleapis.com' && url.pathname.endsWith('/accounts:signInWithPassword')) {
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 400, message: 'INVALID_LOGIN_CREDENTIALS' } }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(origin);
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('autocomplete', 'username');
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('autocomplete', 'current-password');
  await page.keyboard.press('Tab'); await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeFocused();
  assert.equal(await page.locator('.donkey').evaluate(image => image.complete && image.naturalWidth > 0), true);
  await screenshot(page, `${values.live ? 'live-sign-in' : 'production-sign-in'}.png`, { fullPage: true });
  for (const [scheme, expected] of [['dark', '#e7ede7'], ['light', '#e7ede7']]) {
    await page.emulateMedia({ colorScheme: scheme });
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('meta[name=theme-color]')].find(meta => matchMedia(meta.media).matches)?.content), expected);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(231, 237, 231)');
  }
  await page.getByLabel('Email', { exact: true }).fill('check@example.test');
  await page.getByLabel('Password', { exact: true }).fill('Synthetic-check-only');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Could not sign in. Check your email and password.');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  assert.ok(intercepted.includes('identitytoolkit.googleapis.com'));
  // Exercise the CSP connections separately; routes intercept every remote request.
  for (const hostname of ['securetoken.googleapis.com', 'firestore.googleapis.com', 'firebaseinstallations.googleapis.com']) {
    await page.evaluate(async hostname => { await fetch(`https://${hostname}/eselsohr-csp-check`); }, hostname);
    assert.ok(intercepted.includes(hostname));
  }
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const cachedUrls = await page.evaluate(async () => {
    const names = await caches.keys();
    return (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(request => request.url)))).flat();
  });
  const publicFiles = (await readdir(new URL('dist/', root), { recursive: true, withFileTypes: true }))
    .filter(file => file.isFile() && file.name !== 'sw.js')
    .map(file => `/${relative(new URL('dist/', root).pathname, join(file.parentPath, file.name)).split(sep).join('/')}`);
  assert.ok(cachedUrls.every(url => new URL(url).origin === origin), 'CacheStorage contains only this public origin');
  assert.deepEqual(cachedUrls.map(url => new URL(url).pathname).sort(), publicFiles.sort(), 'every public build file is cached, with no note data or extra files');
  await context.setOffline(true);
  await page.close();
  const reopened = await context.newPage();
  reopened.on('pageerror', error => failures.push(error.message));
  await reopened.goto(origin);
  await expect(reopened.getByLabel('Password', { exact: true })).toBeVisible();
  assert.equal(await reopened.locator('.donkey').evaluate(image => image.complete && image.naturalWidth > 0), true);
  assert.equal(await reopened.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(231, 237, 231)');
  await context.setOffline(false);
  console.log('PASS offline cold page launch, complete public shell/artwork cache and uniform sage canvas');
  assert.deepEqual(failures, []);
  console.log('PASS built login, donkey loading, keyboard/autofill and CSP-permitted Auth/token/Firestore connections (intercepted)');
  if (!values.live) await workerUpdateChecks(browser);
} finally { await browser.close(); }
