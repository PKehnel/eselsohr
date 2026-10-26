import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { expect } from 'playwright/test';

// Upgrade an actual cache-first worker while its old editing page stays open.
export async function workerUpdateChecks(browser) {
  const root = new URL('../dist/', import.meta.url);
  const currentWorker = await readFile(new URL('sw.js', root), 'utf8');
  const files = JSON.parse(currentWorker.match(/const FILES = (\[[^\n]+\]);/)[1]);
  const legacyHtml = '<!doctype html><title>Earlier app</title><main id="legacy-page"><h1>Earlier cached app</h1><textarea aria-label="Pending draft"></textarea></main><script src="/legacy.js"></script>';
  const legacyJs = 'document.querySelector("textarea").value=localStorage.getItem("synthetic-draft")||"";';
  const legacyWorker = `const CACHE='eselsohr-shell-legacy';self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['/index.html','/legacy.js']))));self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.mode==='navigate'&&url.pathname==='/')event.respondWith(caches.open(CACHE).then(cache=>cache.match('/index.html')));else if(['/index.html','/legacy.js'].includes(url.pathname)&&!url.search)event.respondWith(caches.open(CACHE).then(cache=>cache.match(url.pathname)));});`;
  let updated = false, workerUpdated = false, unavailable = false, stalled = false, held = 0;
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://127.0.0.1').pathname;
      response.setHeader('Cache-Control', 'no-cache');
      if (path === '/sw.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(workerUpdated ? currentWorker : legacyWorker); return; }
      if (path === '/legacy.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(legacyJs); return; }
      if (['/', '/index.html'].includes(path) && !updated) { response.setHeader('Content-Type', 'text/html'); response.end(legacyHtml); return; }
      if (['/', '/index.html'].includes(path) && stalled) { held++; return; }
      if (['/', '/index.html'].includes(path) && unavailable) { response.writeHead(503); response.end(); return; }
      const file = path === '/' ? '/index.html' : path;
      if (!files.includes(file)) { response.writeHead(404); response.end(); return; }
      response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'application/json');
      response.end(await readFile(new URL(`.${file}`, root)));
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const context = await browser.newContext();
  try {
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    const page = await context.newPage();
    await page.goto(origin);
    await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; });
    await page.reload();
    await page.getByLabel('Pending draft').fill('Keep this pending edit');
    await page.evaluate(() => { localStorage.setItem('synthetic-draft', 'Keep this pending edit'); localStorage.setItem('synthetic-session', 'retain-session'); });
    updated = true;
    await page.reload();
    await expect(page.locator('#legacy-page')).toBeVisible();
    await expect(page.getByLabel('Pending draft')).toHaveValue('Keep this pending edit');
    await page.evaluate(() => { window.previousWorker = navigator.serviceWorker.controller; });
    workerUpdated = true;
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== window.previousWorker)).toBe(true);
    // Worker activation updates delivery, without navigating the old editing page.
    await expect(page.getByLabel('Pending draft')).toHaveValue('Keep this pending edit');
    await expect(page.locator('#legacy-page')).toBeVisible();
    assert.equal(await page.evaluate(() => localStorage.getItem('synthetic-session')), 'retain-session');
    assert.equal(await page.evaluate(() => localStorage.getItem('synthetic-draft')), 'Keep this pending edit');
    await page.goto(origin);
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await expect(page.locator('#legacy-page')).toHaveCount(0);
    await context.setOffline(true); await page.reload();
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await context.setOffline(false); unavailable = true; await page.reload();
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    unavailable = false; stalled = true;
    for (const path of ['/', '/index.html?update=stalled']) {
      const reopened = await context.newPage();
      const started = performance.now();
      await reopened.goto(`${origin}${path}`, { waitUntil: 'commit', timeout: 5000 });
      assert.ok(performance.now() - started < 4500, 'Cached navigation has a short bound while the server never responds');
      await expect(reopened.getByLabel('Email', { exact: true })).toBeVisible();
      await reopened.close();
    }
    assert.equal(held, 2, 'Both ordinary and explicit-update requests really reached the stalled server');
    stalled = false;
    await page.reload();
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => localStorage.getItem('synthetic-draft')), 'Keep this pending edit');
    assert.equal(await page.evaluate(() => localStorage.getItem('synthetic-session')), 'retain-session');
    console.log('PASS cache-first worker upgrade with an open draft, current online HTML, offline/503 fallback and bounded stalled navigation');
  } finally {
    await context.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
