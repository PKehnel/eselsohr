import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';

// Cache only public build files. Auth, Firestore and note data never enter CacheStorage.
export function offlineBuild() {
  return {
    name: 'eselsohr-offline', apply: 'build',
    async closeBundle() {
      const files = (await readdir('dist', { recursive: true, withFileTypes: true }))
        .filter(file => file.isFile() && file.name !== 'sw.js')
        .map(file => `${file.parentPath}/${file.name}`.replace(/^dist/, '')).sort();
      const hash = createHash('sha256');
      for (const file of files) hash.update(await readFile(`dist${file}`));
      const cache = `eselsohr-shell-${hash.digest('hex').slice(0, 16)}`;
      const source = `const CACHE = ${JSON.stringify(cache)};
const FILES = ${JSON.stringify(files)};
const NAVIGATION_TIMEOUT = 2000;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
// Replace the worker, preserving open pages and their Auth/Firestore/draft storage.
// Navigation gets current HTML online; editing pages are never force-reloaded.
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('eselsohr-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate' && ['/', '/index.html'].includes(url.pathname)) {
    event.respondWith((async () => {
      const abort = new AbortController();
      let timer;
      const cached = () => caches.open(CACHE).then(cache => cache.match('/index.html'));
      try {
        return await Promise.race([
          fetch(event.request, { cache: 'no-cache', signal: abort.signal }).then(response => {
            if (!response.ok) throw new Error('App update unavailable');
            return response;
          }),
          new Promise(resolve => { timer = setTimeout(() => { abort.abort(); resolve(cached()); }, NAVIGATION_TIMEOUT); }),
        ]);
      } catch { return await cached(); }
      finally { clearTimeout(timer); }
    })());
  } else if (FILES.includes(url.pathname) && !url.search) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname)));
  }
});
`;
      await writeFile('dist/sw.js', source);
    },
  };
}
