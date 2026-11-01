'use strict';
// The router, and starting the app. Loaded last: it uses everything above.

/* ---------- router ---------- */

function render() {
  const [path, query] = (location.hash.slice(2) || 'library').split('?');
  const params = new URLSearchParams(query || '');
  const [view, arg] = path.split('/');
  renderNav(path);
  renderSyncStatus();
  closeMenu();
  const addLink = $('#addBtn');
  addLink.href = view === 'wishlist' ? '#/add?to=wishlist' : '#/add';
  addLink.hidden = view === 'add';
  switch (view) {
    case 'library': viewLibrary(); break;
    case 'reading': viewReading(); break;
    case 'read': viewRead(); break;
    case 'wishlist': viewWishlist(); break;
    case 'all': viewAll(); break;
    case 'shelf': viewShelf(arg); break;
    case 'series': viewSeries(arg); break;
    case 'genre': viewGenre(arg); break;
    case 'stocktake': viewStocktake(arg); break;
    case 'book': viewBook(arg); break;
    case 'add': viewAdd(params); break;
    case 'discover': viewDiscover(); break;
    case 'stats': viewStats(); break;
    case 'settings': viewSettings(); break;
    default: location.hash = '#/library';
  }
}

let lastPath = '';
let inAppSteps = 0;
window.addEventListener('hashchange', () => {
  inAppSteps++;
  const path = location.hash.split('?')[0];
  if (path !== lastPath) window.scrollTo(0, 0);
  lastPath = path;
  render();
});

function closeMenu() { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('open'); }
$('#menuBtn').onclick = () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('open'); };
$('#scrim').onclick = closeMenu;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#scanner').hidden) Scanner.close(); });

// Sync when the app opens, comes back to the front, or gets its connection back.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Sync.run(); });
window.addEventListener('online', () => Sync.run());
setInterval(() => { if (document.visibilityState === 'visible') Sync.run(); }, 5 * 60e3);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // When an update takes over, reload once so it shows now rather than on the next open.
  // Not mid-typing, and not on the very first visit (nothing older to replace).
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading || document.activeElement?.matches('input, textarea')) return;
    reloading = true;
    location.reload();
  });
}

lastPath = location.hash.split('?')[0];
loadDb().then(data => {
  db = data;
  loaded = true;
  render();
  Sync.run();
  Covers.run();
  FirstYears.run();
  GenreFill.run();
});
