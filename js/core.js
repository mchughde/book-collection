'use strict';
// Settings lists, small helpers, the collection itself and how it is kept on this device.
/* Book Collection. The app is plain script files loaded in order by index.html (no build);
   they share one scope, as if they were one file, so later files use what earlier ones define.
   Data lives in IndexedDB on each device and, once sync is set up, in one file
   (library.json) in a private GitHub repo. Every record carries updatedAt, and the
   newer copy of each record wins when two devices' data are merged. */

// Every key starts with this: all mchughde.github.io apps share one localStorage.
const KEY = 'bookcollection.';
const DATA_FILE = 'library.json';
const ZXING_SRC = 'vendor/zxing-0.21.3.min.js';

const SOURCES = [
  ['own-physical', 'Own · physical'],
  ['own-ebook', 'Own · ebook'],
  ['own-audio', 'Own · audiobook'],
  ['lib-physical', 'Library · physical'],
  ['lib-ebook', 'Library · ebook'],
  ['lib-audio', 'Library · audiobook'],
  // Read while she subscribes to Prime, and gone if she cancels (or Amazon rotates it out), so
  // not owned: it stays out of My library. Always in the Kindle app.
  ['prime-ebook', 'Prime Reading · ebook'],
  ['borrowed', 'Borrowed'],
  ['other', 'Other'],
];
const SOURCE_LABEL = Object.fromEntries(SOURCES);
// Where a book is kept (chosen 29 Oct 2026). Blank = not set yet. "Unfiled" is a
// book that's here but not on a shelf; "Other" comes with its own words in locationOther.
const LOCATIONS = [
  ['lounge', 'Lounge'], ['study-a', 'Study – bookcase A'], ['study-b', 'Study – bookcase B'],
  ['spare-room', 'Spare room'], ['unfiled', 'Unfiled'],
  ['kindle', 'Kindle'], ['apple-books', 'Apple Books'], ['google-books', 'Google Play Books'], ['adobe', 'Adobe Digital Editions'],
  ['other', 'Other'],
];
const LOCATION_LABEL = Object.fromEntries(LOCATIONS);
const ROOMS = ['lounge', 'study-a', 'study-b', 'spare-room', 'unfiled'];
const EBOOK_APPS = ['kindle', 'apple-books', 'google-books', 'adobe'];
const locationLabel = b => b.location === 'other' ? (b.locationOther || 'Other') : LOCATION_LABEL[b.location] || '';
const locationOptions = (sel, blank, only) => `<option value="">${blank}</option>` +
  [['Rooms', ROOMS], ['Ebook apps', EBOOK_APPS]].filter(([, keys]) => !only || keys.some(k => only.includes(k)))
    .map(([group, keys]) => `<optgroup label="${group}">${keys.filter(k => !only || only.includes(k)).map(k => `<option value="${k}" ${sel === k ? 'selected' : ''}>${LOCATION_LABEL[k]}</option>`).join('')}</optgroup>`).join('') +
  `<option value="other" ${sel === 'other' ? 'selected' : ''}>Other (say where)</option>`;

const STATUSES = [
  ['wishlist', 'Wishlist'],
  ['to-read', 'To read'],
  ['reading', 'Reading'],
  ['read', 'Read'],
  ['dnf', 'Didn’t finish'],
];
const STATUS_LABEL = Object.fromEntries(STATUSES);
const SORTS = [
  ['added', 'Recently added'],
  ['title', 'Title'],
  ['author', 'Author'],
  ['finished', 'Recently finished'],
  ['rating', 'Rating'],
];
const SPINES = ['#7a2e2a', '#2f5d50', '#3b4f7a', '#8a6a2b', '#5b3d6b', '#4a5a3a', '#7a4b2e'];

/* ---------- small helpers ---------- */

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => new Date().toISOString();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const isOwned = b => (b.source || '').startsWith('own-');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}
function store(name, value) {
  try {
    if (value === undefined) localStorage.removeItem(KEY + name);
    else localStorage.setItem(KEY + name, JSON.stringify(value));
  } catch (e) { toast('Couldn’t save on this device: ' + e.message); }
}
function recall(name) {
  try { return JSON.parse(localStorage.getItem(KEY + name)); } catch { return null; }
}
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}
function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  return 'Mac';
}

/* ---------- data ---------- */

const emptyDb = () => ({ version: 1, books: {}, shelves: {}, authors: {}, dismissed: {} });
// Filled from device storage by loadDb() before the first render and sync.
let db = emptyDb();
let loaded = false;

const live = map => Object.values(map).filter(x => !x.deleted);
const books = () => live(db.books);
const shelves = () => live(db.shelves).sort((a, b) => a.name.localeCompare(b.name));
const followed = () => live(db.authors).sort((a, b) => a.name.localeCompare(b.name));

/* ---------- device storage ---------- */

// The collection lives in IndexedDB. localStorage gives each site about 5 MB, and every
// mchughde.github.io app shares that one allowance (Recipes keeps photos there), so a library
// of hundreds of books could run out. Small settings stay in localStorage. If IndexedDB is
// missing or fails, the collection falls back to localStorage, as it was before 29 Oct 2026.
const Disk = {
  ok: false, dbp: null,
  open() {
    return this.dbp ||= new Promise((ok, fail) => {
      if (!globalThis.indexedDB) return fail(new Error('No IndexedDB'));
      const req = indexedDB.open('bookcollection', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error);
    });
  },
  async run(mode, fn) {
    const idb = await this.open();
    return new Promise((ok, fail) => {
      const tx = idb.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => ok(req.result);
      tx.onerror = tx.onabort = () => fail(tx.error);
    });
  },
  get(key) { return this.run('readonly', s => s.get(key)); },
  put(key, value) { return this.run('readwrite', s => s.put(value, key)); },
};

// Moves a collection kept in localStorage into IndexedDB, checking the copy before freeing
// the old one. If both exist (IndexedDB failed once and the fallback was used), they're merged.
async function loadDb() {
  try {
    const old = recall('data');
    let data = await Disk.get('data');
    if (old) {
      const want = data ? mergeDb(Object.assign(emptyDb(), data), Object.assign(emptyDb(), old)) : old;
      await Disk.put('data', want);
      data = await Disk.get('data');
      if (canon(data) !== canon(want)) throw new Error('The copy didn’t match');
      store('data', undefined);
    }
    Disk.ok = true;
    return Object.assign(emptyDb(), data || {});
  } catch {
    return Object.assign(emptyDb(), recall('data') || {});
  }
}

// One write at a time; changes made meanwhile are written straight after, latest only.
let saving = false, saveAgain = false;
function persist() {
  if (!Disk.ok) { store('data', db); return; }
  if (saving) { saveAgain = true; return; }
  saving = true;
  Disk.put('data', db)
    .catch(() => { Disk.ok = false; store('data', db); })
    .finally(() => { saving = false; if (saveAgain) { saveAgain = false; persist(); } });
}
function commit() { persist(); Sync.schedule(); }
function saveBook(b) {
  b.updatedAt = now();
  db.books[b.id] = b;
  commit();
}

function newBook(fields) {
  return {
    id: uid(), title: '', subtitle: '', authors: [], authorKeys: [], isbn: '', workKey: '',
    coverUrl: '', year: '', pages: '', publisher: '',
    status: 'to-read', source: '', reads: [], progress: '', rating: 0,
    review: '', notes: [], quotes: [], shelves: [], tags: [],
    series: '', seriesNo: '', genres: [], location: '', locationOther: '',
    added: now(), updatedAt: now(), ...fields,
  };
}

// A read ends with a finish date, or just a year when the date isn't known. Blank = year unknown.
const readYear = r => (r.finished || '').slice(0, 4) || r.year || '';
// The read under way while a book is Reading: the latest one with no end recorded.
const currentRead = b => {
  if (b.status !== 'reading') return undefined;
  const open = (b.reads || []).filter(r => !readYear(r) && !r.dnf);
  return open.findLast(r => r.started) || open.at(-1);
};
// Past reads, including ones in an unknown year (no date, no year, but the book was read).
const pastReads = b => (b.reads || []).filter(r => r !== currentRead(b) &&
  (readYear(r) || r.dnf || b.status === 'read' || b.status === 'reading' || !r.started));
const finishedReads = b => pastReads(b).filter(r => !r.dnf);
const lastFinished = b => finishedReads(b).map(r => r.finished || r.year || '').sort().pop() || '';
const hasRead = b => b.status === 'read' || finishedReads(b).length > 0;
const validYear = y => /^\d{4}$/.test(y) && y >= '1900' && y <= String(new Date().getFullYear());
const authorLine = b => (b.authors || []).join(', ');
const allTags = () => [...new Set(books().flatMap(b => b.tags || []))].sort((a, b) => a.localeCompare(b));
const allGenres = () => [...new Set(books().flatMap(b => b.genres || []))].sort((a, b) => a.localeCompare(b));
const allSeries = () => [...new Set(books().map(b => b.series).filter(Boolean))].sort((a, b) => a.localeCompare(b));

// Genres as removable chips, with a menu of the genres already in the collection and
// "New genre…" for one that isn't there yet. `note` shows while there are none (e.g. still finding them).
function genrePickerHtml(id, chosen, note = '') {
  const others = allGenres().filter(g => !chosen.includes(g));
  return `<div class="tags" id="${id}">${chosen.map(g => `<span class="tag">${esc(g)}<button type="button" data-ungenre="${esc(g)}" aria-label="Remove genre ${esc(g)}">×</button></span>`).join('')}
    ${!chosen.length && note ? `<span class="muted small">${esc(note)}</span>` : ''}
    <select aria-label="Add a genre"><option value="">Add a genre…</option>${others.map(g => `<option>${esc(g)}</option>`).join('')}<option value="+new">New genre…</option></select>
    <input type="text" placeholder="Type a new genre" hidden style="width:11em"></div>`;
}
// Typed genres that match an existing one apart from capitals use the existing spelling.
const typedGenres = text => text.split(',').map(s => s.trim()).filter(Boolean)
  .map(g => allGenres().find(x => x.toLowerCase() === g.toLowerCase()) || g);
function wireGenrePicker(box, chosen, onChange) {
  const sel = box.querySelector('select'), input = box.querySelector('input');
  const add = names => onChange([...new Set([...chosen, ...names])]);
  sel.onchange = () => {
    if (sel.value === '+new') { sel.hidden = true; input.hidden = false; input.focus(); }
    else if (sel.value) add([sel.value]);
  };
  const addTyped = () => {
    const names = typedGenres(input.value);
    if (names.length) add(names);
    else { input.hidden = true; sel.hidden = false; sel.value = ''; }
  };
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); addTyped(); }
    if (e.key === 'Escape') { input.value = ''; addTyped(); }
  };
  input.onchange = addTyped;
  box.querySelectorAll('[data-ungenre]').forEach(x => x.onclick = () => onChange(chosen.filter(g => g !== x.dataset.ungenre)));
}

function findDuplicate(c) {
  const t = norm(c.title), a = norm((c.authors || [])[0]);
  return books().find(b =>
    (c.workKey && b.workKey === c.workKey) ||
    (c.isbn && b.isbn === c.isbn) ||
    (norm(b.title) === t && norm((b.authors || [])[0]) === a));
}

// Records are merged one at a time: whichever copy was changed last wins.
function mergeMaps(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    if (!cur || (v.updatedAt || '') > (cur.updatedAt || '')) out[k] = v;
  }
  return out;
}
function mergeDb(a, b) {
  return {
    version: 1,
    books: mergeMaps(a.books, b.books),
    shelves: mergeMaps(a.shelves, b.shelves),
    authors: mergeMaps(a.authors, b.authors),
    dismissed: mergeMaps(a.dismissed, b.dismissed),
  };
}
// Key order differs between devices, so compare with keys sorted.
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
