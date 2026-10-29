// The global pre-commit hook bumps this version on every commit.
const CACHE_NAME = 'books-v18';

const SHELL = [
  './', 'index.html', 'styles.css?v=1', 'app.js?v=1', 'manifest.json',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
  'vendor/zxing-0.21.3.min.js',
];

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's own copy, which GitHub Pages lets it keep for 10 minutes.
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('books-') && k !== CACHE_NAME).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// App files: try the network first so changes show up straight away, always asking GitHub
// whether the file changed (no-cache) rather than reusing the browser's 10-minute copy;
// fall back to the saved copy when offline. GitHub, Open Library and Apple are never cached here.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => hit || caches.match('index.html')))
  );
});
