// The global pre-commit hook bumps this version on every commit.
const CACHE_NAME = 'books-v6';

const SHELL = [
  './', 'index.html', 'styles.css?v=1', 'app.js?v=1', 'manifest.json',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
  'vendor/zxing-0.21.3.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('books-') && k !== CACHE_NAME).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// App files: try the network first so changes show up straight away;
// fall back to the saved copy when offline. GitHub and Open Library are never cached here.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => hit || caches.match('index.html')))
  );
});
