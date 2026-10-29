'use strict';

/* Book Collection — all app logic.
   Data lives in localStorage on each device and, once sync is set up, in one file
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
  ['borrowed', 'Borrowed'],
  ['other', 'Other'],
];
const SOURCE_LABEL = Object.fromEntries(SOURCES);
// Where a book is kept (chosen with Dianne, 29 Oct 2026). Blank = not set yet. "Unfiled" is a
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

/* ---------- sync with the private GitHub repo ---------- */

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

const Sync = {
  timer: null, busy: false, again: false, waiters: [],
  state: 'off', message: '', last: recall('lastSync'),

  cfg() { return recall('sync'); },
  setState(state, message = '') { this.state = state; this.message = message; renderSyncStatus(); },

  schedule(delay = 2500) {
    if (!this.cfg()) return;
    store('dirty', true);
    this.setState('pending');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), delay);
  },

  async api(path, opts = {}, cfg = this.cfg()) {
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}${path}`, {
      ...opts,
      cache: 'no-store',
      headers: {
        Authorization: 'Bearer ' + cfg.token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.headers || {}),
      },
    });
    return res;
  },

  async fail(res) {
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch {}
    const plain = {
      401: 'GitHub didn’t accept the access key. It may have expired: make a new one and paste it in Settings.',
      403: 'GitHub refused. The access key may not have “Contents: read and write” for this repo.',
      404: 'GitHub can’t find that repo with this access key. Check the repo name and that the key covers it.',
    }[res.status];
    return new Error(plain || `GitHub said ${res.status} ${detail}`.trim());
  },

  async pull() {
    const res = await this.api('/contents/' + DATA_FILE);
    if (res.status === 404) {
      // 404 means either "no data file yet" or "can't see the repo". Tell them apart.
      const repo = await this.api('');
      if (!repo.ok) throw await this.fail(repo);
      return { data: null, sha: null };
    }
    if (!res.ok) throw await this.fail(res);
    const meta = await res.json();
    let text;
    if (meta.content) text = b64decode(meta.content);
    else {
      // Files over 1 MB come without content; ask for the raw file instead.
      const raw = await this.api('/contents/' + DATA_FILE, { headers: { Accept: 'application/vnd.github.raw+json' } });
      if (!raw.ok) throw await this.fail(raw);
      text = await raw.text();
    }
    return { data: Object.assign(emptyDb(), JSON.parse(text)), sha: meta.sha };
  },

  // Only one sync runs at a time. A request made meanwhile waits, then runs once more.
  async run() {
    // Never before the collection has loaded: merging into an empty one would lose unsynced edits.
    if (!this.cfg() || !loaded) return;
    if (this.busy) { this.again = true; return new Promise(done => this.waiters.push(done)); }
    this.busy = true;
    do { this.again = false; await this.once(); } while (this.again);
    this.busy = false;
    this.waiters.splice(0).forEach(done => done());
  },

  async once() {
    if (!navigator.onLine) { this.setState('offline'); return; }
    this.setState('syncing');
    try {
      for (let attempt = 0; ; attempt++) {
        const { data, sha } = await this.pull();
        const merged = data ? mergeDb(db, data) : db;
        const changedHere = canon(merged) !== canon(db);
        db = merged;
        persist();
        if (changedHere) refreshAfterSync();
        if (data && canon(merged) === canon(data)) break; // GitHub already has everything
        // No indentation: about a third smaller to upload than the readable layout.
        const body = { message: `Update from ${deviceName()}`, content: b64encode(JSON.stringify(merged)) };
        if (sha) body.sha = sha;
        const res = await this.api('/contents/' + DATA_FILE, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (res.ok) break;
        // 409/422: another device saved in between. Fetch again and re-merge.
        if ((res.status === 409 || res.status === 422) && attempt < 3) { await sleep(800); continue; }
        throw await this.fail(res);
      }
      store('dirty', undefined);
      this.last = now();
      store('lastSync', this.last);
      this.setState('ok');
    } catch (e) {
      this.setState(navigator.onLine ? 'error' : 'offline', e.message);
    }
  },
};

// Re-render with merged data, unless that would wipe out something being typed.
let renderPending = false;
function refreshAfterSync() {
  const el = document.activeElement;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) { renderPending = true; return; }
  render();
}
document.addEventListener('focusout', () => {
  if (!renderPending) return;
  setTimeout(() => {
    const el = document.activeElement;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    renderPending = false;
    render();
  }, 300);
});

function renderSyncStatus() {
  const el = $('#syncStatus');
  if (!el) return;
  const cfg = Sync.cfg();
  if (!cfg) { el.innerHTML = `<span class="dot"></span><a href="#/settings">Only on this device. Set up sync</a>`; return; }
  const s = Sync.state;
  const text = {
    ok: 'Synced' + (Sync.last ? ' ' + new Date(Sync.last).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : ''),
    syncing: 'Syncing…', pending: 'Saving…', offline: 'Offline. Will sync later',
    error: 'Sync problem', off: 'Sync set up',
  }[s];
  const dot = { ok: 'ok', syncing: 'busy', pending: 'busy', error: 'err' }[s] || '';
  el.innerHTML = `<span class="dot ${dot}"></span><a href="#/settings" title="${esc(Sync.message)}">${esc(text)}</a>`;
}

/* ---------- Open Library ---------- */

const OL_FIELDS = 'key,title,subtitle,author_name,author_key,first_publish_year,cover_i,number_of_pages_median,language';

async function olSearch(query) {
  const digits = query.replace(/[\s-]/g, '');
  const isIsbn = /^(97[89])?\d{9}[\dXx]$/.test(digits);
  const params = isIsbn ? `isbn=${digits}` : `q=${encodeURIComponent(query)}`;
  const res = await fetch(`https://openlibrary.org/search.json?${params}&limit=20&fields=${OL_FIELDS}`);
  if (!res.ok) throw new Error('Open Library didn’t answer (' + res.status + '). Try again shortly.');
  const json = await res.json();
  return json.docs.map(d => docToBook(d, isIsbn ? digits : ''));
}

// A title search finds the book, not a particular edition (its first-listed edition is often
// foreign), so ISBN comes from the search or scan, or from the edition picked afterwards.
function docToBook(d, isbn = '') {
  return {
    title: d.title || '',
    subtitle: d.subtitle || '',
    authors: d.author_name || [],
    authorKeys: d.author_key || [],
    workKey: d.key || '',
    isbn,
    year: d.first_publish_year || '',
    pages: d.number_of_pages_median || '',
    coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`
      : isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false` : '',
  };
}

/* ---------- Apple Books ---------- */

// Apple's public store search, Australian store (Dianne's choice, 29 Oct 2026): no key, open to
// web pages, and far better than Open Library at new books and at ranking a bare title. It lists
// ebooks and audiobooks, so no publisher, pages or print ISBN; but the cover's file name is
// usually that ebook's or audiobook's own ISBN, which is kept for books she has in that form.
const APPLE_JUNK = /^(analysis|untitled)\b|\b(summary|study guide|a guide to|reflection on|book analysis|workbook|sparknotes|cliffsnotes)\b/i;
const surname = s => norm(s).split(' ').pop();
const sameBook = (a, b) => norm(a.title) === norm(b.title) &&
  (a.authors || []).some(x => (b.authors || []).some(y => surname(x) === surname(y)));

async function appleSearch(query) {
  const ask = async media => {
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=${media}&country=au&limit=15`);
    if (!res.ok) throw new Error('Apple Books didn’t answer (' + res.status + ')');
    return (await res.json()).results || [];
  };
  const [ebooks, audio] = await Promise.allSettled([ask('ebook'), ask('audiobook')]);
  if (ebooks.status === 'rejected' && audio.status === 'rejected') throw ebooks.reason;
  const out = [];
  const all = [...(ebooks.value || []).map(r => appleToBook(r, 'ebook')), ...(audio.value || []).map(r => appleToBook(r, 'audio'))];
  for (const c of all) {
    if (!c.title || !c.authors.length || APPLE_JUNK.test(c.title)) continue;
    const same = out.find(o => sameBook(o, c));
    if (!same) { out.push(c); continue; }
    same.ebookIsbn ||= c.ebookIsbn;
    same.audioIsbn ||= c.audioIsbn;
  }
  return out;
}

function appleToBook(r, kind) {
  const full = String(r.trackName || r.collectionName || '').replace(/\s*\((un)?abridged\)\s*$/i, '').trim();
  const [title, ...rest] = full.split(': ');
  const art = r.artworkUrl100 || '';
  return {
    title, subtitle: rest.join(': '),
    authors: String(r.artistName || '').split(/\s*[&,]\s*/).filter(Boolean),
    authorKeys: [], workKey: '', isbn: '',
    year: (r.releaseDate || '').slice(0, 4), pages: '',
    coverUrl: art.replace(/\/\d+x\d+bb\./, '/600x600bb.'),
    ebookIsbn: kind === 'ebook' ? (art.match(/\/(97[89]\d{10})\.\w+\//) || [])[1] || '' : '',
    audioIsbn: kind === 'audio' ? (art.match(/\/(97[89]\d{10})\.\w+\//) || [])[1] || '' : '',
    appleGenres: (r.genres || []).filter(g => g !== 'Books'),
    fromApple: true,
  };
}

// One book looked up in Apple's store by title and author, for its cover and categories. Apple
// allows about 20 requests a minute, so lookups made in the background are spaced 3.5 s apart.
let appleNext = 0;
async function appleMatch(b) {
  const wait = appleNext - Date.now();
  appleNext = Math.max(Date.now(), appleNext) + 3500;
  if (wait > 0) await sleep(wait);
  const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(b.title + ' ' + b.authors[0])}&media=ebook&country=au&limit=5`).catch(() => null);
  if (!res?.ok) return null;
  return ((await res.json()).results || []).map(r => appleToBook(r, 'ebook')).find(x => sameBook(x, b)) || null;
}

// Apple's shop categories (or Open Library's subjects) translated into the genre names Dianne's
// LibraryThing books use, so new books fit the same filters and charts. First match per category;
// order matters ("Travel Essays & Memoirs" is Travel, "Historical Fiction" isn't History).
const GENRE_MAP = [
  [/historical fiction/i, 'Historical Fiction'], [/sci-?fi|science fiction/i, 'Science Fiction'], [/science history/i, 'Science & Nature'],
  [/political science/i, 'Politics, Government, Law and Public Policy'], [/social science|sociolog/i, 'Sociology'],
  [/\btravel/i, 'Travel'], [/biograph|memoir/i, 'Biography & Memoir'],
  [/myster|crime|detective|sleuth/i, 'Mystery'], [/thriller|suspense/i, 'Suspense & Thriller'],
  [/\bhistory\b/i, 'History'], [/philosoph/i, 'Philosophy'],
  [/religio|spiritual|christian|buddh|bible|theolog/i, 'Religion & Spirituality'],
  [/young adult|\bteen/i, 'Young Adult'], [/\bkids\b|child|juvenile/i, "Children's Books"],
  [/romance/i, 'Romance'], [/poetry/i, 'Poetry'], [/music/i, 'Music'],
  [/science|nature|physics|chemistry|biology|ecology/i, 'Science & Nature'],
  [/health|mind & body|fitness|wellness|diet/i, 'Health & Wellness'], [/cook|food|wine/i, 'Food & Cooking'],
  [/business|finance|economics|management/i, 'Business'], [/\barts?\b|design|architecture|photograph/i, 'Art & Design'],
  [/politic|current affairs|\blaw\b|government/i, 'Politics, Government, Law and Public Policy'],
  [/anthropolog/i, 'Anthropology'],
  [/gender|sexuality|feminis/i, 'Sexuality and Gender Studies'], [/literary criticism|literature studies/i, 'Literature Studies and Criticism'],
  [/sport|outdoor|recreation|leisure|walking|hiking/i, 'Sports and Leisure'],
  [/reference|dictionar|encyclop/i, 'Reference'], [/computer|technology|internet/i, 'Technology'],
];
const FICTION_ONLY = ['Mystery', 'Suspense & Thriller', 'Romance', 'Historical Fiction', 'Science Fiction'];
const NONFICTION_ONLY = ['Literature Studies and Criticism', 'Reference', 'Business', 'Technology', 'Biography & Memoir'];
function genresFrom(cats, fromApple) {
  cats = cats.filter(c => c && c !== 'Books');
  if (!cats.length) return [];
  const specific = [];
  for (const cat of cats) {
    const hit = GENRE_MAP.find(([re]) => re.test(cat));
    if (hit && !specific.includes(hit[1])) specific.push(hit[1]);
  }
  // Apple lists its main categories first, so the first one that says Fiction or Nonfiction
  // decides ("Sophie's World" is tagged both). The first can be a niche one that says neither:
  // "Murder in the Sentier" leads with "Women Sleuths", then "Crime & Thrillers". Open Library
  // has no main subject, so a "fiction" subject decides it there.
  const fictiony = c => !/non-?fiction|true crime|criticism|studies/i.test(c) &&
    /fiction|literature|myster|thriller|crime|sleuth|romance|fantasy|classic|poetry|drama|short stor|comic/i.test(c);
  const side = c => {
    if (fictiony(c)) return 'fiction';
    const g = GENRE_MAP.find(([re]) => re.test(c))?.[1];
    if (/non-?fiction/i.test(c) || (g && !FICTION_ONLY.includes(g) && g !== 'Young Adult' && g !== "Children's Books")) return 'nonfiction';
    return null;
  };
  const fiction = fromApple ? cats.map(side).find(Boolean) === 'fiction'
    : cats.some(c => /\bfiction\b/i.test(c) && !/non-?fiction/i.test(c));
  if (!fromApple && !fiction && !specific.length) return [];
  // Shop labels can contradict the main category (Apple files Normal People under Literary
  // Criticism too), so a novel drops study-only genres and nonfiction drops novel-only ones.
  const wrongSide = fiction ? NONFICTION_ONLY : FICTION_ONLY;
  return [fiction ? 'Fiction' : 'Nonfiction', ...specific.filter(g => !wrongSide.includes(g)).slice(0, 4)];
}
// Genres for a book about to be added: Apple's categories if the search brought them, else an
// Apple lookup by title and author, else Open Library's subjects for the work.
async function guessGenres(c) {
  if (c.appleGenres?.length) return genresFrom(c.appleGenres, true);
  const a = c.authors?.[0] ? await appleMatch(c) : null;
  if (a?.appleGenres?.length) return genresFrom(a.appleGenres, true);
  if (c.workKey) {
    const w = await fetch(`https://openlibrary.org${c.workKey}.json`).then(r => r.ok ? r.json() : null).catch(() => null);
    if (w?.subjects?.length) return genresFrom(w.subjects, false);
  }
  return [];
}
// Books with no genre (added by hand, or saved before a lookup finished) get one in the
// background, once each: about 20 books took ~70 s on 29 Oct 2026, held back by Apple's limit.
const GenreFill = {
  running: false,
  async run() {
    if (this.running) return;
    this.running = true;
    for (let b; (b = books().find(x => !(x.genres || []).length && !x.genreChecked && x.authors?.[0])); ) {
      const genres = await guessGenres(b).catch(() => []);
      const cur = db.books[b.id];
      if (!cur || cur.deleted) continue;
      if (!(cur.genres || []).length) cur.genres = genres;
      cur.genreChecked = true;
      saveBook(cur);
    }
    this.running = false;
  },
};

// Searches both at once (an ISBN goes to Open Library only). Apple's order leads, since it ranks
// well; a book both know keeps Open Library's details, for its editions and author links, with
// Apple's cover. Either one failing still leaves the other's results.
async function findBooks(query) {
  if (/^(97[89])?\d{9}[\dXx]$/.test(query.replace(/[\s-]/g, ''))) return olSearch(query);
  const [ol, apple] = await Promise.allSettled([olSearch(query), appleSearch(query)]);
  if (ol.status === 'rejected' && apple.status === 'rejected') throw ol.reason;
  const olList = ol.value || [], out = [];
  for (const a of apple.value || []) {
    const i = olList.findIndex(o => sameBook(o, a));
    if (i < 0) { out.push(a); continue; }
    const o = olList.splice(i, 1)[0];
    out.push({ ...o, subtitle: o.subtitle || a.subtitle, coverUrl: a.coverUrl || o.coverUrl, appleCover: a.coverUrl, ebookIsbn: a.ebookIsbn, audioIsbn: a.audioIsbn, appleGenres: a.appleGenres });
  }
  // Drop Apple-only listings whose title a higher-ranked result already has: cheap summaries
  // and knock-offs of popular books ("Normal People" by DailysBooks), which rank below the real one.
  const all = [...out, ...olList];
  return all.filter((c, i) => !(c.fromApple && !c.workKey &&
    all.slice(0, i).some(d => norm(d.title) === norm(c.title)))).slice(0, 30);
}

// A book found only by Apple's search may still be in Open Library under its title and author
// (a bare "Redwood" has 2,572 matches there). Linking it brings editions and author links.
async function linkToOpenLibrary(c) {
  const found = await olSearch(`${c.title} ${surname(c.authors[0])}`).catch(() => []);
  const o = found.find(x => sameBook(x, c));
  if (!o) return c;
  const keyFor = a => o.authorKeys[o.authors.findIndex(x => surname(x) === surname(a))] || '';
  return { ...c, workKey: o.workKey, authorKeys: c.authors.map(keyFor),
    year: o.year || c.year, pages: o.pages || c.pages, appleCover: c.coverUrl };
}

// A work's editions, English first then French, best-guess first: ones with an ISBN, then the
// most complete (cover, pages, publisher), print before audio, then newest. Many editions have
// no language recorded, so the ISBN's group fills in: 978-0/1 and 979-8 English, 978-2/979-10 French.
const editionCache = new Map();
const editionLooked = new Set(); // books whose missing publisher was already looked up
async function olEditions(workKey) {
  if (editionCache.has(workKey)) return editionCache.get(workKey);
  const res = await fetch(`https://openlibrary.org${workKey}/editions.json?limit=500`);
  if (!res.ok) throw new Error('Open Library didn’t answer (' + res.status + ')');
  const list = (await res.json()).entries?.map(editionFrom).filter(e => e && e.lang) || [];
  list.sort((a, b) => b.score - a.score || b.year.localeCompare(a.year));
  editionCache.set(workKey, list);
  return list;
}
function editionFrom(e) {
  const isbn = (e.isbn_13 || [])[0] || isbn10to13((e.isbn_10 || [])[0]);
  if (!isbn) return null;
  const langs = (e.languages || []).map(l => l.key);
  const lang = langs.includes('/languages/eng') ? 'en' : langs.includes('/languages/fre') ? 'fr'
    : langs.length ? '' : /^978[01]|^9798/.test(isbn) ? 'en' : /^9782|^97910/.test(isbn) ? 'fr' : '';
  const format = e.physical_format || '';
  const cover = e.covers?.[0] > 0 ? e.covers[0] : 0;
  const reprint = /^9798/.test(isbn) || PRINT_ON_DEMAND.test((e.publishers || [])[0] || '');
  return {
    isbn, lang, format,
    publisher: (e.publishers || [])[0] || '',
    year: (String(e.publish_date || '').match(/\d{4}/) || [''])[0],
    pages: e.number_of_pages || '',
    coverUrl: cover ? `https://covers.openlibrary.org/b/id/${cover}-M.jpg` : '',
    score: (lang === 'en' ? 100 : 0) + (cover ? 4 : 0) + (e.number_of_pages ? 2 : 0) + (e.publishers ? 1 : 0)
      - (/audio|cassette|cd|mp3/i.test(format) ? 5 : 0)
      - (reprint ? 10 : 0),
    reprint,
  };
}
// Self-published, print-on-demand and large-print reprints: listed, never preselected.
const PRINT_ON_DEMAND = /independent|diversified publishing|createspace|lulu|easy read|bibliolife|kessinger|forgotten books|nabu|wentworth|blurb|book on demand|books on demand|digireads|readaclassic|wildside|dodo press|echo library|general books|tredition|fq books|sheba blake/i;
// The exact edition for a searched or scanned ISBN, for its publisher and pages.
async function olEditionByIsbn(isbn) {
  const res = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
  return res.ok ? editionFrom(await res.json()) : null;
}
function isbn10to13(i) {
  if (!i || !/^\d{9}[\dXx]$/.test(i)) return '';
  const core = '978' + i.slice(0, 9);
  const sum = [...core].reduce((n, d, k) => n + Number(d) * (k % 2 ? 3 : 1), 0);
  return core + (10 - sum % 10) % 10;
}
const editionLabel = e => [e.publisher || 'Publisher not listed', e.year, e.pages && e.pages + ' pages',
  e.format && e.format.toLowerCase(), e.lang === 'fr' && 'French', 'ISBN ' + e.isbn].filter(Boolean).join(' · ');
// An edition fills in what it knows and leaves the rest (the work's cover, original year) alone.
function applyEdition(b, e) {
  b.isbn = e.isbn;
  b.publisher = e.publisher;
  if (e.pages) b.pages = e.pages;
  if (e.coverUrl) b.coverUrl = e.coverUrl;
}
// A select of editions, filled in once Open Library answers. `blank` is the first option's text.
async function fillEditionSelect(sel, workKey, blank, preselectBest, currentIsbn) {
  try {
    const list = await olEditions(workKey);
    if (!sel.isConnected) return list;
    sel.innerHTML = `<option value="">${esc(blank)}</option>` + list.slice(0, 60).map((e, i) =>
      `<option value="${i}" ${preselectBest && i === 0 && !e.reprint ? 'selected' : ''}>${esc(editionLabel(e))}${e.isbn === currentIsbn ? ' (current)' : ''}</option>`).join('');
    if (!list.length) sel.innerHTML = '<option value="">Open Library lists no English or French edition with an ISBN</option>';
    sel.disabled = !list.length;
    return list;
  } catch {
    if (sel.isConnected) { sel.innerHTML = '<option value="">Couldn’t load editions. Try again later.</option>'; sel.disabled = true; }
    return [];
  }
}

/* ---------- covers & cards ---------- */

// Open Library's cover server sometimes fails, and Safari can keep reusing a failed answer.
// Try twice more with a fresh address before showing the plain coloured cover. An ISBN cover
// asked for with default=false fails on purpose when there's no cover, so it isn't retried.
function coverFailed(img) {
  const tries = Number(img.dataset.tries || 0);
  if (tries < 2 && !img.src.includes('default=false')) {
    img.dataset.tries = tries + 1;
    img.style.visibility = 'hidden'; // no broken-image icon while waiting
    img.onload = () => { img.style.visibility = ''; };
    setTimeout(() => {
      if (!img.isConnected) return;
      const u = new URL(img.src);
      u.searchParams.set('retry', Date.now());
      img.src = u.href;
    }, 1500 * (tries + 1));
    return;
  }
  const box = img.parentNode;
  if (box?.isConnected) box.outerHTML = box.dataset.blank;
}
// The web address inside whatever was pasted: copying a picture can bring invisible
// placeholder characters (U+FFFC) along with its address.
const cleanUrl = s => (String(s || '').match(/https?:\/\/[^\s\uFFFC]+/) || [''])[0];

function coverHtml(b, badge = '') {
  const hue = SPINES[[...(b.title || 'x')].reduce((n, c) => n + c.charCodeAt(0), 0) % SPINES.length];
  const blank = `<div class="cover blank" style="background:${hue}">${esc(b.title)}${badge}</div>`;
  const url = cleanUrl(b.coverUrl);
  if (!url) return blank;
  return `<div class="cover"><img src="${esc(url)}" alt="" loading="lazy" onerror="coverFailed(this)">${badge}</div>`
    .replace('<div class="cover">', `<div class="cover" data-blank="${esc(blank)}">`);
}
// Ratings go in half stars, 0.5 to 5 (0 = not rated).
const ratingText = n => n ? (Math.floor(n) || '') + (n % 1 ? '½' : '') : '';
const starsText = n => n ? '★'.repeat(Math.floor(n)) + (n % 1 ? '½' : '') : '';

function cardHtml(b, opts = {}) {
  const badge = opts.badge ? `<span class="badge">${esc(opts.badge)}</span>` : '';
  const meta = [];
  if (b.rating) meta.push(`<span class="stars-sm" aria-label="${b.rating} stars">${starsText(b.rating)}</span>`);
  if (opts.meta) meta.push(`<span>${esc(opts.meta)}</span>`);
  const progress = opts.progress != null ? `<div class="progress" title="${opts.progress}%"><span style="width:${opts.progress}%"></span></div>` : '';
  return `<a class="card" href="#/book/${b.id}">
    ${coverHtml(b, badge)}
    ${progress}
    <div class="t">${esc(b.title)}</div>
    <div class="a">${esc(authorLine(b))}</div>
    ${meta.length ? `<div class="m">${meta.join('')}</div>` : ''}
  </a>`;
}
function percent(b) {
  const p = Number(b.progress), total = Number(b.pages);
  if (!p) return 0;
  if (total) return Math.min(100, Math.round(p / total * 100));
  return Math.min(100, p);
}

/* ---------- navigation ---------- */

const ICONS = {
  library: '<path d="M4 4h3v16H4zM9 4h3v16H9zM14.5 4.8l2.9-.8 3.9 15.2-2.9.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  reading: '<path d="M3 5.5C5.5 4.5 9 4.5 12 6.5c3-2 6.5-2 9-1v13c-2.5-1-6-1-9 1-3-2-6.5-2-9-1z M12 6.5v13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  read: '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  wishlist: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  all: '<rect x="4" y="4" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  discover: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M15.5 8.5l-2 5-5 2 2-5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  stats: '<path d="M5 20V11M12 20V5M19 20v-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  settings: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  stocktake: '<path d="M9 4h6v3H9zM7 5.5H5.5v15h13v-15H17M8.5 13l2.5 2.5 4.5-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  series: '<path d="M6 4h9v14H6zM9 7h9v14H9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  shelf: '<path d="M4 18h16M6 18V7h3v11M10 18V5h3v13M14.5 18l1.5-10 3 .5-1.5 9.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

function renderNav(route) {
  const all = books();
  const count = f => all.filter(f).length;
  const item = (href, name, label, n) =>
    `<a class="nav-item ${route === href ? 'active' : ''}" href="#/${href}">${icon(name)}<span>${esc(label)}</span>${n != null ? `<span class="count">${n}</span>` : ''}</a>`;
  let html = '';
  html += item('library', 'library', 'My library', count(isOwned));
  html += item('reading', 'reading', 'Reading', count(b => b.status === 'reading'));
  html += item('read', 'read', 'Read', count(hasRead));
  html += item('wishlist', 'wishlist', 'Wishlist', count(b => b.status === 'wishlist'));
  html += item('all', 'all', 'All books', all.length);
  if (allSeries().length) html += item('series', 'series', 'Series', allSeries().length);
  html += item('discover', 'discover', 'New books');
  html += `<div class="nav-heading"><span>Shelves</span><button id="newShelf">+ New</button></div>`;
  for (const s of shelves()) html += item('shelf/' + s.id, 'shelf', s.name, count(b => (b.shelves || []).includes(s.id)));
  if (!shelves().length) html += `<div class="muted small" style="padding:2px 10px">None yet</div>`;
  html += `<div class="nav-heading"></div>`;
  html += item('stats', 'stats', 'Reading stats');
  html += item('stocktake', 'stocktake', 'Stocktake');
  html += item('settings', 'settings', 'Settings & sync');
  $('#nav').innerHTML = html;
  $('#newShelf').onclick = () => {
    const name = prompt('Name for the new shelf');
    if (!name || !name.trim()) return;
    const s = { id: uid(), name: name.trim(), updatedAt: now() };
    db.shelves[s.id] = s;
    commit();
    location.hash = '#/shelf/' + s.id;
  };
}

function setTitle(t) { $('#pageTitle').textContent = t; document.title = t === 'Book Collection' ? t : `${t} · Book Collection`; }

/* ---------- list views ---------- */

// Search/filter choices are remembered per view while the app is open.
const viewState = {};

function sortBooks(list, sort) {
  const by = {
    added: (a, b) => (b.added || '').localeCompare(a.added || ''),
    title: (a, b) => a.title.localeCompare(b.title),
    author: (a, b) => (lastName(a) || '~').localeCompare(lastName(b) || '~') || a.title.localeCompare(b.title),
    finished: (a, b) => lastFinished(b).localeCompare(lastFinished(a)),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0) || a.title.localeCompare(b.title),
  }[sort] || (() => 0);
  return list.slice().sort(by);
}
function lastName(b) { const a = (b.authors || [])[0] || ''; return a.split(' ').pop(); }

function matches(b, q) {
  if (!q) return true;
  const hay = norm([b.title, b.subtitle, authorLine(b), b.isbn, (b.tags || []).join(' '), b.series, (b.genres || []).join(' '), locationLabel(b), b.review,
    ...(b.notes || []).map(n => n.text), ...(b.quotes || []).map(n => n.text)].join(' '));
  return norm(q).split(' ').every(w => hay.includes(w));
}

function renderList(cfg) {
  const st = viewState[cfg.key] ||= { q: '', read: 'all', source: '', location: '', tag: '', genre: '', status: '', sort: cfg.sort || 'added' };
  const draw = () => {
    let list = books().filter(cfg.filter);
    const total = list.length;
    if (cfg.statusChips && st.read !== 'all') list = list.filter(b => b.status === st.read);
    if (st.status) list = list.filter(b => b.status === st.status);
    if (st.source) list = list.filter(b => b.source === st.source || (b.reads || []).some(r => r.source === st.source));
    if (st.tag) list = list.filter(b => (b.tags || []).includes(st.tag));
    if (st.genre) list = list.filter(b => (b.genres || []).includes(st.genre));
    if (st.location) list = list.filter(b => st.location === 'none' ? !b.location : b.location === st.location);
    list = sortBooks(list.filter(b => matches(b, st.q)), st.sort);
    const grid = $('#grid');
    if (!total) { grid.outerHTML = `<div id="grid">${cfg.empty}</div>`; return; }
    grid.outerHTML = list.length
      ? `<div id="grid" class="grid">${list.map(b => cardHtml(b, cfg.card ? cfg.card(b) : {})).join('')}</div>`
      : `<div id="grid" class="empty"><p>No books match.</p></div>`;
    $('#shown').textContent = list.length === total ? `${total} book${total === 1 ? '' : 's'}` : `${list.length} of ${total}`;
  };

  const tags = allTags(), genres = allGenres();
  $('#view').innerHTML = `
    ${cfg.intro || ''}
    <div class="toolbar">
      <input class="search" type="search" id="q" placeholder="Search title, author, notes…" value="${esc(st.q)}">
      ${cfg.statusChips ? `<div class="chips" role="group" aria-label="Status">
        ${[['all', 'All'], ...STATUSES.filter(([v]) => v !== 'wishlist')].map(([v, l]) => `<button class="chip ${st.read === v ? 'on' : ''}" data-read="${v}">${l}</button>`).join('')}
      </div>` : ''}
      ${cfg.statusFilter ? `<select id="status" aria-label="Status"><option value="">Any status</option>${STATUSES.map(([v, l]) => `<option value="${v}" ${st.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}
      ${cfg.noSource ? '' : `<select id="source" aria-label="Source"><option value="">Any source</option>${SOURCES.filter(([v]) => !cfg.ownedOnly || v.startsWith('own-')).map(([v, l]) => `<option value="${v}" ${st.source === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`}
      ${cfg.noSource ? '' : `<select id="location" aria-label="Where it is">${locationOptions(st.location, 'Anywhere').replace('</option>', '</option><option value="none" ' + (st.location === 'none' ? 'selected' : '') + '>Not set yet</option>')}</select>`}
      ${genres.length ? `<select id="genre" aria-label="Genre"><option value="">Any genre</option>${genres.map(g => `<option ${st.genre === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>` : ''}
      ${tags.length ? `<select id="tag" aria-label="Tag"><option value="">Any tag</option>${tags.map(t => `<option ${st.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : ''}
      <select id="sort" aria-label="Sort">${SORTS.map(([v, l]) => `<option value="${v}" ${st.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="muted small" id="shown"></span>
    </div>
    <div id="grid"></div>`;
  $('#q').oninput = e => { st.q = e.target.value; draw(); };
  document.querySelectorAll('[data-read]').forEach(btn => btn.onclick = () => {
    st.read = btn.dataset.read;
    document.querySelectorAll('[data-read]').forEach(b => b.classList.toggle('on', b === btn));
    draw();
  });
  for (const id of ['status', 'source', 'location', 'genre', 'tag', 'sort']) {
    const el = $('#' + id);
    if (el) el.onchange = () => { st[id] = el.value; draw(); };
  }
  draw();
}

const emptyState = (title, text, addTo) => `<div class="empty"><h2>${title}</h2><p>${text}</p>
  <a class="btn primary" href="#/add${addTo ? '?to=' + addTo : ''}">+ Add a book</a></div>`;

function viewLibrary() {
  setTitle('My library');
  renderList({
    key: 'library', filter: isOwned, statusChips: true, ownedOnly: true,
    card: b => ({ meta: STATUS_LABEL[b.status] }),
    empty: emptyState('Your library is empty', 'Books you own, in print, ebook or audio, live here. You can see at a glance which ones you’ve read.', 'library'),
  });
}

function viewAll() {
  setTitle('All books');
  renderList({
    key: 'all', filter: () => true, statusFilter: true,
    card: b => ({ meta: STATUS_LABEL[b.status] }),
    empty: emptyState('No books yet', 'Add your first book by searching for it, scanning its barcode or typing it in.'),
  });
}

function viewWishlist() {
  setTitle('Wishlist');
  renderList({
    key: 'wishlist', filter: b => b.status === 'wishlist', noSource: true,
    intro: `<p class="muted small" style="margin-top:0">Books you’d like to read or buy. To see new books by authors you follow, open <a href="#/discover">New books</a>.</p>`,
    empty: emptyState('Nothing on your wishlist', 'Add books you’d like to read or buy. Open one and change its status when you get it.', 'wishlist'),
  });
}

// Every series, or one series in order once its numbers are set (Number in series, in Details).
function viewSeries(arg) {
  const name = arg ? decodeURIComponent(arg) : '';
  if (!name) {
    setTitle('Series');
    const names = allSeries();
    $('#view').innerHTML = names.length ? `<div class="series-list">${names.map(n => {
      const n2 = books().filter(b => b.series === n).length;
      return `<a class="series-row" href="#/series/${encodeURIComponent(n)}"><span>${esc(n)}</span><span class="muted small">${n2} book${n2 === 1 ? '' : 's'}</span></a>`;
    }).join('')}</div>` : `<div class="empty"><p>No series yet. Set a book’s series in its Details.</p></div>`;
    return;
  }
  setTitle(name);
  const num = b => parseFloat(b.seriesNo) || Infinity;
  const list = books().filter(b => b.series === name)
    .sort((a, b) => num(a) - num(b) || String(a.year).localeCompare(String(b.year)) || a.title.localeCompare(b.title));
  $('#view').innerHTML = `<a class="back" href="#/series" id="back">‹ All series</a>
    <p class="muted small">${list.length} book${list.length === 1 ? '' : 's'} in your collection${list.some(b => !b.seriesNo) ? '. Set each book’s number in series, in its Details, to put them in order' : ', in order'}.</p>
    <div class="grid">${list.map(b => cardHtml(b, { meta: [b.seriesNo && 'Book ' + b.seriesNo, STATUS_LABEL[b.status]].filter(Boolean).join(' · ') })).join('')}</div>`;
  $('#back').onclick = e => { if (inAppSteps > 0) { e.preventDefault(); history.back(); } };
}

// Opened from a genre bar on Reading stats.
function viewGenre(arg) {
  const g = decodeURIComponent(arg || '');
  setTitle(g || 'Genre');
  renderList({
    key: 'genre-' + g, filter: b => (b.genres || []).includes(g), statusFilter: true,
    card: b => ({ meta: STATUS_LABEL[b.status] }),
    empty: `<div class="empty"><p>No books in this genre.</p></div>`,
  });
}

function viewShelf(id) {
  const shelf = db.shelves[id];
  if (!shelf || shelf.deleted) { location.hash = '#/library'; return; }
  setTitle(shelf.name);
  renderList({
    key: 'shelf-' + id, filter: b => (b.shelves || []).includes(id), statusFilter: true,
    card: b => ({ meta: STATUS_LABEL[b.status] }),
    intro: `<div class="row" style="justify-content:flex-end;margin-top:-6px">
      <button class="btn small" id="renameShelf">Rename shelf</button>
      <button class="btn small danger" id="deleteShelf">Delete shelf</button></div>`,
    empty: `<div class="empty"><h2>This shelf is empty</h2><p>Open any book and tick “${esc(shelf.name)}” under Shelves to put it here.</p></div>`,
  });
  $('#renameShelf').onclick = () => {
    const name = prompt('New name for this shelf', shelf.name);
    if (!name || !name.trim()) return;
    shelf.name = name.trim(); shelf.updatedAt = now(); commit(); render();
  };
  $('#deleteShelf').onclick = () => {
    if (!confirm(`Delete the shelf “${shelf.name}”? The books stay in your collection.`)) return;
    shelf.deleted = true; shelf.updatedAt = now();
    for (const b of books()) if ((b.shelves || []).includes(id)) { b.shelves = b.shelves.filter(s => s !== id); b.updatedAt = now(); }
    commit();
    location.hash = '#/library';
  };
}

function viewReading() {
  setTitle('Reading');
  const reading = books().filter(b => b.status === 'reading').sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const next = sortBooks(books().filter(b => b.status === 'to-read'), 'added');
  const nextOwned = next.filter(isOwned), nextOther = next.filter(b => !isOwned(b));
  if (!reading.length && !next.length) {
    $('#view').innerHTML = emptyState('Not reading anything yet', 'Open a book and press “Start reading”. It will show here with your progress.');
    return;
  }
  $('#view').innerHTML = `
    <h2 style="margin-top:4px">Reading now</h2>
    ${reading.length ? `<div class="grid">${reading.map(b => cardHtml(b, { progress: percent(b), meta: SOURCE_LABEL[b.source] || '' })).join('')}</div>`
      : `<p class="muted">Nothing on the go. Pick something from below.</p>`}
    ${nextOwned.length ? `<h2>Up next from your library <span class="muted small">(${nextOwned.length})</span></h2>
      <div class="grid">${nextOwned.map(b => cardHtml(b)).join('')}</div>` : ''}
    ${nextOther.length ? `<h2>Want to read, not owned <span class="muted small">(${nextOther.length})</span></h2>
      <div class="grid">${nextOther.map(b => cardHtml(b, { meta: SOURCE_LABEL[b.source] || '' })).join('')}</div>` : ''}`;
}

function viewRead() {
  setTitle('Read');
  const st = viewState.read ||= { source: '', q: '', year: '' };
  // One entry per past read, so re-reads show in each year.
  const allEntries = [];
  for (const b of books()) {
    const past = pastReads(b);
    if (past.length) past.forEach(r => allEntries.push({ b, r, y: readYear(r) }));
    else if (b.status === 'read') allEntries.push({ b, r: { finished: '', source: b.source }, y: '' });
  }
  const years = [...new Set(allEntries.map(e => e.y).filter(Boolean))].sort().reverse();
  if (st.year && st.year !== 'unknown' && !years.includes(st.year)) st.year = '';
  const UNKNOWN = 'Year unknown';
  const draw = () => {
    let entries = allEntries;
    if (st.year) entries = entries.filter(e => e.y === (st.year === 'unknown' ? '' : st.year));
    if (st.source) entries = entries.filter(e => (e.r.source || e.b.source) === st.source);
    if (st.q) entries = entries.filter(e => matches(e.b, st.q));
    // Newest first; a known year beats a date-less one within it; unknown years last.
    const key = e => e.r.finished || (e.y ? e.y + '-00' : '');
    entries = entries.slice().sort((x, y) => key(y).localeCompare(key(x)));
    const groups = new Map();
    for (const e of entries) {
      const y = e.y || UNKNOWN;
      if (!groups.has(y)) groups.set(y, []);
      groups.get(y).push(e);
    }
    const finished = entries.filter(e => !e.r.dnf).length;
    $('#shown').textContent = st.year || st.source || st.q ? `${finished} book${finished === 1 ? '' : 's'} read` : '';
    $('#grid').innerHTML = !entries.length
      ? (allEntries.length ? '<div class="empty"><p>No books match.</p></div>'
        : emptyState('No finished books yet', 'When you finish a book, press “Finished” on its page. You can also add books you read in the past, with the year if you know it.'))
      : [...groups].map(([y, list]) => `<h2>${esc(y)} <span class="muted small">(${list.length})</span></h2>
        <div class="grid">${list.map(({ b, r }) => cardHtml(b, {
          badge: r.dnf ? 'Didn’t finish' : '',
          meta: [SOURCE_LABEL[r.source || b.source], r.finished ? fmtDate(r.finished).replace(/ \d{4}$/, '') : ''].filter(Boolean).join(' · '),
        })).join('')}</div>`).join('');
  };
  $('#view').innerHTML = `
    <div class="toolbar">
      <input class="search" type="search" id="q" placeholder="Search…" value="${esc(st.q)}">
      <select id="year" aria-label="Year read"><option value="">Every year</option>${years.map(y => `<option ${st.year === y ? 'selected' : ''}>${y}</option>`).join('')}
        ${allEntries.some(e => !e.y) ? `<option value="unknown" ${st.year === 'unknown' ? 'selected' : ''}>${UNKNOWN}</option>` : ''}</select>
      <select id="source" aria-label="Read as"><option value="">Any source</option>${SOURCES.map(([v, l]) => `<option value="${v}" ${st.source === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <span class="muted small" id="shown"></span>
    </div>
    <div id="grid"></div>`;
  $('#q').oninput = e => { st.q = e.target.value; draw(); };
  $('#year').onchange = e => { st.year = e.target.value; draw(); };
  $('#source').onchange = e => { st.source = e.target.value; draw(); };
  draw();
}

/* ---------- book page ---------- */

function viewBook(id) {
  const b = db.books[id];
  if (!b || b.deleted) { $('#view').innerHTML = `<div class="empty"><p>That book isn’t in your collection.</p><a href="#/library">Back to library</a></div>`; setTitle('Book'); return; }
  setTitle(b.title);
  const sourceOpts = (sel, blank) => `<option value="">${blank}</option>` + SOURCES.map(([v, l]) => `<option value="${v}" ${sel === v ? 'selected' : ''}>${l}</option>`).join('');
  const openRead = currentRead(b);
  const actions = [];
  if (b.status !== 'reading') actions.push(`<button class="btn primary" data-act="start">${hasRead(b) ? 'Read again' : 'Start reading'}</button>`);
  if (b.status === 'reading') actions.push(`<button class="btn primary" data-act="finish">Finished</button>`, `<button class="btn" data-act="dnf">Stopped reading</button>`);
  if (b.status === 'wishlist') actions.push(`<button class="btn" data-act="got">I’ve got it</button>`);

  const authors = (b.authors || []).map((name, i) => {
    const key = (b.authorKeys || [])[i];
    if (!key) return `<span>${esc(name)}</span>`;
    const on = db.authors[key] && !db.authors[key].deleted;
    return `<span>${esc(name)} <button class="link-btn small" data-follow="${esc(key)}" data-name="${esc(name)}">${on ? '✓ Following' : '+ Follow for new books'}</button></span>`;
  }).join('');

  $('#view').innerHTML = `
    <a class="back" href="#/library" id="back">‹ Back</a>
    <div class="book-head">
      ${coverHtml(b)}
      <div>
        <h2>${esc(b.title)}</h2>
        ${b.subtitle ? `<p class="sub">${esc(b.subtitle)}</p>` : ''}
        <div class="authors">${authors || '<span class="muted">Author unknown</span>'}</div>
        ${b.series || (b.genres || []).length ? `<div class="facts">${[
          b.series && `Series: <a href="#/series/${encodeURIComponent(b.series)}">${esc(b.series)}</a>${b.seriesNo ? ', book ' + esc(b.seriesNo) : ''}`,
          esc((b.genres || []).join(', '))].filter(Boolean).join(' · ')}</div>` : ''}
        <div class="facts" id="facts">${[b.year && (b.editionYear ? `${b.year} (this edition ${b.editionYear})` : b.year), b.pages && b.pages + ' pages', b.publisher, b.isbn && 'ISBN ' + b.isbn].filter(Boolean).map(esc).join(' · ')}</div>
        <div class="row">
          <label class="field">Status<select id="status">${STATUSES.map(([v, l]) => `<option value="${v}" ${b.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field">How I have it<select id="source">${sourceOpts(b.source, b.status === 'wishlist' ? 'Not yet' : 'Not set')}</select></label>
          ${b.status === 'wishlist' ? '' : `<label class="field">Where it is<select id="location">${locationOptions(b.location, 'Not set yet')}</select></label>`}
          ${b.location === 'other' ? `<label class="field">Where?<input type="text" id="locationOther" value="${esc(b.locationOther)}" placeholder="In a box in the garage" style="width:12em"></label>` : ''}
        </div>
        ${b.status === 'reading' ? `<div class="row"><label class="field">Page I’m on<input type="number" inputmode="numeric" id="progress" min="0" value="${esc(b.progress)}" style="width:7em"></label>
          ${b.pages ? `<span class="muted small" style="padding-bottom:9px">of ${esc(b.pages)} (${percent(b)}%)</span>` : ''}</div>` : ''}
        <div class="row">${actions.join('')}</div>
        <div class="row" style="align-items:center"><span class="muted small">My rating</span>
          <span class="stars" id="stars" role="group" aria-label="My rating">${[1, 2, 3, 4, 5].map(n => `<span class="star" style="--fill:${b.rating >= n ? 100 : b.rating === n - 0.5 ? 50 : 0}%">
            <button data-star="${n - 0.5}" aria-label="${ratingText(n - 0.5)} stars"></button><button data-star="${n}" aria-label="${n} star${n > 1 ? 's' : ''}"></button></span>`).join('')}</span>
          <span class="muted small">${b.rating ? ratingText(b.rating) + ' of 5' : 'Tap the left half of a star for a half'}</span></div>
      </div>
    </div>

    <div class="two-col">
      <div>
        <div class="panel">
          <h3>Review</h3>
          <textarea id="review" rows="5" placeholder="What did you think?">${esc(b.review)}</textarea>
        </div>
        <div class="panel">
          <h3>Quotes <span class="muted small">${(b.quotes || []).length || ''}</span></h3>
          ${entriesHtml(b.quotes, 'quote')}
          ${addEntryHtml('quote', 'Type or paste a passage…')}
        </div>
        <div class="panel">
          <h3>Notes <span class="muted small">${(b.notes || []).length || ''}</span></h3>
          ${entriesHtml(b.notes, 'note')}
          ${addEntryHtml('note', 'A thought, a character, something to look up…')}
        </div>
      </div>
      <div>
        <div class="panel">
          <h3>Reading history <button class="link-btn" data-act="addread">+ Add a past read</button></h3>
          ${(b.reads || []).length ? `<div class="reads">${b.reads.map(r => `
            <div class="read-row" data-read="${r.id}">
              <input type="date" data-f="started" value="${esc(r.started)}" aria-label="Started">
              <span class="muted">to</span>
              <input type="date" data-f="finished" value="${esc(r.finished)}" aria-label="Finished">
              ${r === openRead ? '' : `<label class="small year-field">Year <input type="text" data-f="year" inputmode="numeric" maxlength="4" placeholder="Unknown" value="${esc(readYear(r))}" ${r.finished ? 'disabled title="Comes from the finish date"' : ''} aria-label="Year read"></label>`}
              <select data-f="source" aria-label="Read as">${sourceOpts(r.source, 'Read as…')}</select>
              <label class="small"><input type="checkbox" data-f="dnf" ${r.dnf ? 'checked' : ''}> didn’t finish</label>
              <button class="icon-btn" data-delread aria-label="Remove this read">×</button>
            </div>`).join('')}</div>` : `<p class="muted small" style="margin:0">No reads recorded. ${openRead ? '' : 'Use “Start reading”, or add a past read. A year is enough if you don’t know the dates.'}</p>`}
        </div>
        <div class="panel">
          <h3>Shelves</h3>
          ${shelves().length ? `<div class="check-list">${shelves().map(s => `<label><input type="checkbox" data-shelf="${s.id}" ${(b.shelves || []).includes(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}</div>`
            : `<p class="muted small" style="margin:0">No shelves yet. Use “+ New” beside Shelves in the menu.</p>`}
        </div>
        <div class="panel">
          <h3>Tags</h3>
          <div class="tags">${(b.tags || []).map(t => `<span class="tag">${esc(t)}<button data-untag="${esc(t)}" aria-label="Remove tag ${esc(t)}">×</button></span>`).join('')}
            <input type="text" id="newTag" list="tagList" placeholder="Add a tag" style="width:9em">
            <datalist id="tagList">${allTags().filter(t => !(b.tags || []).includes(t)).map(t => `<option value="${esc(t)}">`).join('')}</datalist>
          </div>
        </div>
        <div class="panel">
          <h3>Details</h3>
          <div class="form-grid" style="margin:0;grid-template-columns:1fr 1fr">
            ${detailField('title', 'Title')}${detailField('subtitle', 'Subtitle')}
            <label class="field">Authors (comma between)<input type="text" id="d-authors" value="${esc(authorLine(b))}"></label>
            ${detailField('year', 'Year')}${detailField('pages', 'Pages', 'numeric')}${detailField('isbn', 'ISBN', 'numeric')}
            ${detailField('publisher', 'Publisher')}${detailField('coverUrl', 'Cover image web address')}
            ${detailField('series', 'Series')}${detailField('seriesNo', 'Number in series', 'decimal')}
            <label class="field">Genres (comma between)<input type="text" id="d-genres" value="${esc((b.genres || []).join(', '))}"></label>
          </div>
          ${b.workKey ? `<div class="row" style="margin:12px 0 0" id="editionRow">
            <button class="btn small" id="pickEdition">${b.isbn ? 'Change edition' : 'Choose edition'}</button>
            <span class="muted small">Fills in ISBN, publisher and pages from Open Library</span></div>` : ''}
          <div class="row" style="margin:12px 0 0;justify-content:space-between">
            <span class="muted small">Added ${fmtDate(b.added)}</span>
            <button class="btn small danger" data-act="delete">Delete book</button>
          </div>
        </div>
      </div>
    </div>`;

  function detailField(f, label, mode) {
    return `<label class="field">${label}<input type="text" id="d-${f}" value="${esc(b[f])}" ${mode ? `inputmode="${mode}"` : ''}></label>`;
  }

  const save = () => saveBook(b);
  const saveSoon = debounce(save, 700);
  const view = $('#view');

  // Go back within the app if we came from somewhere in it; otherwise to the library.
  $('#back').onclick = e => { if (inAppSteps > 0) { e.preventDefault(); history.back(); } };

  $('#status').onchange = e => { setStatus(b, e.target.value); save(); render(); };
  $('#source').onchange = e => { b.source = e.target.value; save(); };
  if ($('#location')) $('#location').onchange = e => { b.location = e.target.value; if (b.location !== 'other') b.locationOther = ''; save(); render(); };
  if ($('#locationOther')) $('#locationOther').onchange = e => { b.locationOther = e.target.value.trim(); save(); };
  const prog = $('#progress');
  if (prog) prog.onchange = () => { b.progress = prog.value; save(); render(); };
  $('#review').oninput = e => { b.review = e.target.value; saveSoon(); };
  $('#review').onblur = () => saveSoon.flush();

  // Books scanned before 29 Oct 2026 got an ISBN but no publisher: fill it in from that exact
  // edition, once per session, without redrawing the page (a review may be mid-typing).
  if (b.isbn && !b.publisher && !editionLooked.has(b.id)) {
    editionLooked.add(b.id);
    olEditionByIsbn(b.isbn).then(e => {
      if (!e?.publisher || b.publisher) return;
      b.publisher = e.publisher;
      if (e.pages) b.pages = e.pages;
      if (!b.coverUrl && e.coverUrl) b.coverUrl = e.coverUrl;
      save();
      if (!$('#facts') || location.hash !== '#/book/' + b.id) return;
      $('#facts').textContent = [b.year, b.pages && b.pages + ' pages', b.publisher, 'ISBN ' + b.isbn].filter(Boolean).join(' · ');
      $('#d-publisher').value = b.publisher;
      $('#d-pages').value = b.pages;
    }).catch(() => {});
  }

  const pick = $('#pickEdition');
  if (pick) pick.onclick = async () => {
    $('#editionRow').innerHTML = `<label class="field edition-field">Edition<select id="d-edition" disabled><option value="">Finding editions…</option></select></label>`;
    const sel = $('#d-edition');
    const list = await fillEditionSelect(sel, b.workKey, b.isbn ? 'Keep the current edition' : 'Choose one…', false, b.isbn);
    sel.onchange = () => {
      const e = list[sel.value];
      if (!e) return;
      applyEdition(b, e);
      save(); render();
      toast('Edition set: ' + editionLabel(e));
    };
  };

  $('#stars').onclick = e => {
    const n = Number(e.target.dataset.star);
    if (!n) return;
    b.rating = b.rating === n ? 0 : n;
    save(); render();
  };

  view.querySelectorAll('[data-follow]').forEach(btn => btn.onclick = () => {
    toggleFollow(btn.dataset.follow, btn.dataset.name);
    render();
  });

  view.querySelectorAll('[data-act]').forEach(btn => btn.onclick = () => {
    const act = btn.dataset.act;
    if (act === 'start') { setStatus(b, 'reading'); }
    if (act === 'finish') { setStatus(b, 'read'); toast('Finished. Add a rating or review while it’s fresh'); }
    if (act === 'dnf') { setStatus(b, 'dnf'); }
    if (act === 'got') { b.status = 'to-read'; if (!isOwned(b)) b.source = 'own-physical'; toast('Moved to your library. Change “How I have it” if it isn’t a physical copy'); }
    if (act === 'addread') { b.reads = [...(b.reads || []), { id: uid(), started: '', finished: '', year: '', source: b.source || '' }]; }
    if (act === 'delete') {
      if (!confirm(`Delete “${b.title}” and its notes and quotes?`)) return;
      b.deleted = true; save(); toast('Deleted'); location.hash = '#/library'; return;
    }
    save(); render();
  });

  view.querySelectorAll('.read-row').forEach(row => {
    const r = b.reads.find(x => x.id === row.dataset.read);
    row.querySelectorAll('[data-f]').forEach(inp => inp.onchange = () => {
      const f = inp.dataset.f;
      if (f === 'year') {
        const y = inp.value.trim();
        if (y && !validYear(y)) { toast('Type a year like 2019, or leave it blank if you don’t know'); inp.value = readYear(r); return; }
        r.year = y; save(); render(); return;
      }
      r[f] = inp.type === 'checkbox' ? inp.checked : inp.value;
      // Keep the year when a finish date is cleared: the year is often all that's known.
      if (f === 'finished') { if (r.finished) r.year = r.finished.slice(0, 4); save(); render(); return; }
      save();
    });
    row.querySelector('[data-delread]').onclick = () => {
      if (!confirm('Remove this read from the history?')) return;
      b.reads = b.reads.filter(x => x !== r);
      save(); render();
    };
  });

  view.querySelectorAll('[data-shelf]').forEach(cb => cb.onchange = () => {
    const set = new Set(b.shelves || []);
    cb.checked ? set.add(cb.dataset.shelf) : set.delete(cb.dataset.shelf);
    b.shelves = [...set];
    save();
  });

  const tagInput = $('#newTag');
  const addTag = () => {
    const tags = tagInput.value.split(',').map(t => t.trim()).filter(Boolean);
    if (!tags.length) return;
    b.tags = [...new Set([...(b.tags || []), ...tags])];
    save(); render();
    $('#newTag')?.focus();
  };
  tagInput.onkeydown = e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } };
  tagInput.onchange = addTag;
  view.querySelectorAll('[data-untag]').forEach(x => x.onclick = () => { b.tags = b.tags.filter(t => t !== x.dataset.untag); save(); render(); });

  for (const f of ['title', 'subtitle', 'year', 'pages', 'isbn', 'publisher', 'coverUrl', 'series', 'seriesNo']) {
    $('#d-' + f).onchange = e => {
      let v = e.target.value.trim();
      if (f === 'coverUrl' && v) {
        v = cleanUrl(v);
        if (!v) { toast('That isn’t a web address. Copy the picture’s address, starting https://'); e.target.value = b.coverUrl; return; }
      }
      b[f] = v; save(); if (['title', 'coverUrl', 'series', 'seriesNo'].includes(f)) render();
    };
  }
  $('#d-genres').onchange = e => {
    b.genres = [...new Set(e.target.value.split(',').map(s => s.trim()).filter(Boolean))];
    save(); render();
  };
  $('#d-authors').onchange = e => {
    const names = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
    // Keep each Open Library author link only while the name is unchanged.
    b.authorKeys = names.map(n => (b.authorKeys || [])[(b.authors || []).indexOf(n)] || '');
    b.authors = names;
    save(); render();
  };

  for (const kind of ['quote', 'note']) wireEntries(b, kind);
}

function entriesHtml(list = [], kind) {
  if (!list.length) return '';
  return `<div class="entries">${list.map(n => `
    <div class="entry ${kind}" data-entry="${n.id}">
      <div class="text">${kind === 'quote' ? '“' : ''}${esc(n.text)}${kind === 'quote' ? '”' : ''}</div>
      <div class="meta">${n.page ? `<span>p. ${esc(n.page)}</span>` : ''}<span>${fmtDate(n.date)}</span>
        <button class="link-btn small" data-edit>Edit</button><button class="link-btn small" data-del>Delete</button></div>
    </div>`).join('')}</div>`;
}
function addEntryHtml(kind, placeholder) {
  return `<div class="add-entry" data-add="${kind}">
    <textarea rows="2" placeholder="${placeholder}"></textarea>
    <div class="row"><input type="text" inputmode="numeric" placeholder="Page"><button class="btn small primary">Add ${kind}</button></div>
  </div>`;
}
function wireEntries(b, kind) {
  const field = kind === 'quote' ? 'quotes' : 'notes';
  const box = document.querySelector(`[data-add="${kind}"]`);
  const [text, page] = [box.querySelector('textarea'), box.querySelector('input')];
  box.querySelector('button').onclick = () => {
    if (!text.value.trim()) { text.focus(); return; }
    b[field] = [...(b[field] || []), { id: uid(), text: text.value.trim(), page: page.value.trim(), date: now() }];
    saveBook(b); render();
  };
  for (const el of document.querySelectorAll(`.entry.${kind}`)) {
    const n = b[field].find(x => x.id === el.dataset.entry);
    el.querySelector('[data-del]').onclick = () => {
      if (!confirm(`Delete this ${kind}?`)) return;
      b[field] = b[field].filter(x => x !== n); saveBook(b); render();
    };
    el.querySelector('[data-edit]').onclick = () => {
      el.innerHTML = `<div class="add-entry"><textarea rows="4">${esc(n.text)}</textarea>
        <div class="row"><input type="text" inputmode="numeric" placeholder="Page" value="${esc(n.page)}">
        <button class="btn small primary">Save</button><button class="btn small">Cancel</button></div></div>`;
      const [t, p] = [el.querySelector('textarea'), el.querySelector('input')];
      const [ok, cancel] = el.querySelectorAll('button');
      t.focus();
      ok.onclick = () => { n.text = t.value.trim(); n.page = p.value.trim(); saveBook(b); render(); };
      cancel.onclick = () => render();
    };
  }
}

// Status changes also keep the reading history in step.
function setStatus(b, status) {
  const prev = b.status;
  b.reads = b.reads || [];
  // An undated past read is not "open": only a started read left unfinished can be picked up again.
  const open = currentRead(b) || b.reads.findLast(r => r.started && !readYear(r) && !r.dnf);
  if (status === 'reading' && !open) b.reads.push({ id: uid(), started: today(), finished: '', year: '', source: b.source || '' });
  if ((status === 'read' || status === 'dnf') && prev === 'reading' && open) {
    open.finished = today();
    open.year = today().slice(0, 4);
    if (status === 'dnf') open.dnf = true;
  }
  if (status === 'read' && !b.reads.length) b.reads.push({ id: uid(), started: '', finished: '', year: '', source: b.source || '' });
  if (status !== 'reading') b.progress = '';
  b.status = status;
}

function toggleFollow(key, name) {
  const cur = db.authors[key];
  if (cur && !cur.deleted) { cur.deleted = true; cur.updatedAt = now(); toast(`Stopped following ${name}`); }
  else { db.authors[key] = { key, name, updatedAt: now() }; toast(`Following ${name}. New books will show under New books`); }
  store('discover', undefined); // force a fresh check
  commit();
}

function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  d.flush = () => { if (t) { clearTimeout(t); t = null; fn(); } };
  return d;
}

/* ---------- add a book ---------- */

let addState = { q: '', results: null, chosen: null, error: '' };

function viewAdd(params) {
  setTitle('Add a book');
  const to = params.get('to') || 'library';
  const defaults = {
    wishlist: { status: 'wishlist', source: '' },
    library: { status: 'to-read', source: 'own-physical' },
  }[to] || { status: 'to-read', source: 'own-physical' };

  const resultsHtml = () => {
    if (addState.error) return `<p class="muted">${esc(addState.error)}</p>`;
    if (!addState.results) return '';
    if (!addState.results.length) return `<p class="muted">Nothing found. Try fewer words, or <button class="link-btn" id="manual2">type the details in yourself</button>.</p>`;
    return `<div class="results">${addState.results.map((r, i) => {
      const dup = findDuplicate(r);
      return `<div class="result">
        ${coverHtml(r)}
        <div><div class="t">${esc(r.title)}</div><div class="a">${esc(r.authors.join(', '))}${r.year ? ' · ' + r.year : ''}${r.fromApple && !r.workKey ? ' · Apple Books' : ''}</div></div>
        ${dup ? `<a class="btn small" href="#/book/${dup.id}">In collection</a>` : `<button class="btn small" data-pick="${i}">Add</button>`}
      </div>`;
    }).join('')}</div>`;
  };

  const formHtml = c => `
    <div class="add-form" id="addForm">
      <div class="result" style="padding:0 0 14px">${coverHtml(c)}<div><div class="t">${esc(c.title) || 'New book'}</div><div class="a">${esc((c.authors || []).join(', '))}</div></div><span></span></div>
      ${c.manual ? `<div class="form-grid">
        <label class="field">Title<input type="text" id="m-title" required></label>
        <label class="field">Author(s), comma between<input type="text" id="m-authors"></label>
        <label class="field">Year<input type="text" id="m-year" inputmode="numeric"></label>
        <label class="field">Pages<input type="text" id="m-pages" inputmode="numeric"></label>
        <label class="field">ISBN<input type="text" id="m-isbn" inputmode="numeric"></label>
      </div>` : ''}
      ${c.workKey && !c.isbn ? `<div class="row" style="margin-bottom:4px"><label class="field edition-field">Edition
          <select id="a-edition" disabled><option value="">Finding editions…</option></select></label></div>
        <p class="muted small" style="margin:0 0 12px">A best guess. Pick yours if it’s listed, or scan the barcode to get the exact one.</p>` : ''}
      ${c.manual ? '' : `<div class="row" style="margin-bottom:4px"><label class="field edition-field">Genres (comma between)
          <input type="text" id="a-genres" placeholder="Finding genres…"></label></div>`}
      ${c.fromApple && !c.workKey ? `<p class="muted small" style="margin:0 0 12px">Found only in Apple Books, so there’s no publisher or page count. If you have the printed book, scanning its barcode adds its ISBN.</p>` : ''}
      <div class="row">
        <label class="field">Status<select id="a-status">${STATUSES.map(([v, l]) => `<option value="${v}" ${defaults.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field" id="a-yearField" ${defaults.status === 'read' ? '' : 'hidden'}>Year read<input type="text" id="a-year" inputmode="numeric" maxlength="4" placeholder="Unknown" style="width:6em"></label>
        <label class="field">How I have it<select id="a-source"><option value="">Not yet / not set</option>${SOURCES.map(([v, l]) => `<option value="${v}" ${defaults.source === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${shelves().length ? `<label class="field">Shelf<select id="a-shelf"><option value="">None</option>${shelves().map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>` : ''}
        <button class="btn primary" id="a-save">Add book</button>
        <button class="btn" id="a-cancel">Cancel</button>
      </div>
    </div>`;

  const draw = () => {
    $('#view').innerHTML = `
      <form class="toolbar" id="searchForm" style="margin-bottom:6px">
        <input class="search" type="search" id="aq" placeholder="Title, author or ISBN" value="${esc(addState.q)}" autocomplete="off" enterkeyhint="search">
        <button class="btn primary" type="submit">Search</button>
        <button class="btn" type="button" id="scanBtn">Scan barcode</button>
      </form>
      <p class="muted small" style="margin:0 0 6px">Book details come from Open Library and Apple Books. Can’t find it? <button class="link-btn" id="manual">Type it in yourself</button></p>
      ${addState.chosen ? formHtml(addState.chosen) : ''}
      <div id="results">${addState.chosen ? '' : resultsHtml()}</div>`;

    $('#searchForm').onsubmit = async e => {
      e.preventDefault();
      addState.q = $('#aq').value.trim();
      if (!addState.q) return;
      await runSearch();
    };
    $('#scanBtn').onclick = () => Scanner.open(async isbn => { addState.q = isbn; await runSearch(true); });
    const manual = () => { addState.chosen = { title: '', authors: [], manual: true }; draw(); $('#m-title').focus(); };
    $('#manual').onclick = manual;
    $('#manual2') && ($('#manual2').onclick = manual);
    document.querySelectorAll('[data-pick]').forEach(btn => btn.onclick = async () => {
      let c = addState.results[btn.dataset.pick];
      if (c.fromApple && !c.workKey) { btn.disabled = true; btn.textContent = '…'; c = await linkToOpenLibrary(c); }
      addState.chosen = c; draw(); window.scrollTo(0, 0);
    });

    if (addState.chosen) {
      $('#a-cancel').onclick = () => { addState.chosen = null; draw(); };
      // The chosen edition's details are added on save; meanwhile its cover shows in the form.
      const c = addState.chosen, edSel = $('#a-edition');
      let editions = [], exact = null;
      const showCover = () => {
        const e = editions[edSel.value];
        $('#addForm .cover').outerHTML = coverHtml({ ...c, coverUrl: c.appleCover || e?.coverUrl || c.coverUrl });
      };
      if (edSel) {
        edSel.onchange = showCover;
        fillEditionSelect(edSel, c.workKey, 'No particular edition', true).then(list => { editions = list; if (edSel.isConnected) showCover(); });
      }
      if (c.isbn) olEditionByIsbn(c.isbn).then(e => { exact = e; }).catch(() => {});
      // Genres arrive a moment later; a box already typed in is left alone.
      const gBox = $('#a-genres');
      if (gBox) guessGenres(c).then(g => {
        if (!gBox.isConnected || gBox.value) return;
        gBox.value = g.join(', ');
        gBox.placeholder = g.length ? '' : 'None found. Type some, or leave blank';
      }).catch(() => { gBox.placeholder = ''; });
      $('#a-status').onchange = e => { $('#a-yearField').hidden = e.target.value !== 'read'; };
      $('#a-save').onclick = () => {
        let c = addState.chosen;
        const edition = edSel && edSel.value !== '' ? editions[edSel.value] : exact;
        const yearRead = $('#a-status').value === 'read' ? $('#a-year').value.trim() : '';
        if (yearRead && !validYear(yearRead)) { toast('Type a year like 2019, or leave it blank if you don’t know'); $('#a-year').focus(); return; }
        if (c.manual) {
          const title = $('#m-title').value.trim();
          if (!title) { $('#m-title').focus(); return; }
          const isbn = $('#m-isbn').value.replace(/[\s-]/g, '');
          c = { title, authors: $('#m-authors').value.split(',').map(s => s.trim()).filter(Boolean),
            year: $('#m-year').value.trim(), pages: $('#m-pages').value.trim(), isbn,
            coverUrl: isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false` : '' };
          const dup = findDuplicate(c);
          if (dup && !confirm(`“${dup.title}” is already in your collection. Add it again anyway?`)) return;
        }
        const { manual, fromApple, appleCover, ebookIsbn, audioIsbn, appleGenres, ...fields } = c;
        const typedGenres = ($('#a-genres')?.value || '').split(',').map(g => g.trim()).filter(Boolean);
        const source = $('#a-source').value;
        const b = newBook({ ...fields, source, genres: [...new Set(typedGenres)], shelves: $('#a-shelf')?.value ? [$('#a-shelf').value] : [] });
        if (edition) applyEdition(b, edition);
        if (appleCover) b.coverUrl = appleCover;
        // An ebook or audiobook has its own ISBN, which Apple's listing gives and editions don't.
        if (/ebook/.test(source) && ebookIsbn) b.isbn = ebookIsbn;
        if (/audio/.test(source) && audioIsbn) b.isbn = audioIsbn;
        setStatus(b, $('#a-status').value);
        if (yearRead) b.reads[0].year = yearRead;
        saveBook(b);
        GenreFill.run(); // if the genres hadn't arrived yet
        addState = { q: '', results: null, chosen: null, error: '' };
        toast(`Added “${b.title}”`);
        location.hash = '#/book/' + b.id;
      };
    }
  };

  async function runSearch(fromScan) {
    addState.chosen = null; addState.error = ''; addState.results = null;
    draw();
    $('#results').innerHTML = '<p class="muted">Searching…</p>';
    try {
      addState.results = await findBooks(addState.q);
      if (fromScan && addState.results.length === 1 && !findDuplicate(addState.results[0])) addState.chosen = addState.results[0];
      if (fromScan && !addState.results.length) addState.error = `Open Library doesn’t know ISBN ${addState.q}. Type the details in yourself instead.`;
    } catch (e) { addState.error = navigator.onLine ? e.message : 'You’re offline. Searching needs the internet, but you can type the book in yourself.'; }
    draw();
  }

  draw();
  if (!addState.q && !addState.chosen && matchMedia('(hover: hover)').matches) $('#aq').focus();
}

/* ---------- barcode scanner ---------- */

const Scanner = {
  stream: null, running: false,
  // With continuous, the camera stays on: onIsbn returns a line to show, and the next book can be
  // scanned straight away (the same barcode is ignored for 4 seconds). onClose runs at the end.
  async open(onIsbn, { continuous = false, onClose = null } = {}) {
    if (!navigator.mediaDevices?.getUserMedia) { toast('This browser can’t use the camera here. Type the ISBN instead.'); return; }
    $('#scanner').hidden = false;
    $('#scanHint').textContent = 'Starting the camera…';
    $('#scanClose').textContent = continuous ? 'Done' : 'Cancel';
    $('#scanClose').onclick = () => { this.close(); if (onClose) onClose(); };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      this.close();
      toast(e.name === 'NotAllowedError' ? 'Camera permission was refused. You can allow it in Settings, or type the ISBN.' : 'Couldn’t start the camera: ' + e.message, 4500);
      return;
    }
    const video = $('#scanVideo');
    video.srcObject = this.stream;
    await video.play().catch(() => {});
    $('#scanHint').textContent = 'Point the camera at the barcode on the back of the book';
    this.running = true;
    const detect = await this.detector();
    let last = '', lastAt = 0;
    const loop = async () => {
      if (!this.running) return;
      let code = null;
      try { code = await detect(video); } catch {}
      if (code && /^97[89]\d{10}$/.test(code) && !(continuous && code === last && Date.now() - lastAt < 4000)) {
        if (navigator.vibrate) navigator.vibrate(60);
        if (!continuous) { this.close(); onIsbn(code); return; }
        last = code;
        $('#scanHint').textContent = 'Looking it up…';
        const line = await onIsbn(code);
        lastAt = Date.now();
        if (!this.running) return;
        $('#scanHint').textContent = `${line}. Scan the next book.`;
        setTimeout(loop, 500);
        return;
      }
      setTimeout(loop, 120);
    };
    loop();
  },
  async detector() {
    // Chrome has a built-in reader. Safari doesn't, so fall back to the bundled ZXing library.
    if ('BarcodeDetector' in window) {
      try {
        const formats = await BarcodeDetector.getSupportedFormats();
        if (formats.includes('ean_13')) {
          const d = new BarcodeDetector({ formats: ['ean_13'] });
          return async v => (await d.detect(v))[0]?.rawValue || null;
        }
      } catch {}
    }
    if (!window.ZXing) await new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = ZXING_SRC; s.onload = ok; s.onerror = () => fail(new Error('Couldn’t load the barcode reader'));
      document.head.appendChild(s);
    });
    const reader = new ZXing.MultiFormatReader();
    reader.setHints(new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13]], [ZXing.DecodeHintType.TRY_HARDER, true]]));
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return v => {
      if (!v.videoWidth) return null;
      // Read only the middle band of the picture, where the frame on screen is.
      const w = v.videoWidth, h = Math.round(v.videoHeight * 0.4);
      canvas.width = w; canvas.height = h;
      ctx.drawImage(v, 0, Math.round((v.videoHeight - h) / 2), w, h, 0, 0, w, h);
      try {
        return reader.decodeWithState(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(canvas)))).getText();
      } catch { return null; }
    };
  },
  close() {
    this.running = false;
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null;
    $('#scanVideo').srcObject = null;
    $('#scanner').hidden = true;
  },
};

/* ---------- new books by followed authors ---------- */

async function checkNewBooks() {
  const since = new Date().getFullYear() - 1;
  const found = [];
  for (const a of followed()) {
    const url = `https://openlibrary.org/search.json?author_key=${encodeURIComponent(a.key)}&sort=new&limit=12&fields=${OL_FIELDS}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Open Library didn’t answer (' + res.status + ')');
    const docs = (await res.json()).docs;
    for (const d of docs) {
      if (!d.first_publish_year || d.first_publish_year < since) continue;
      if (/^untitled\b/i.test(d.title || '')) continue; // publishers' placeholders for unannounced books
      // Skip editions in languages other than English or French, where Open Library says.
      if (d.language && d.language.length && !d.language.some(l => l === 'eng' || l === 'fre')) continue;
      found.push({ ...docToBook(d), authorName: a.name, authorKey: a.key });
    }
    await sleep(250); // be polite to Open Library
  }
  const result = { at: now(), items: found };
  store('discover', result);
  return result;
}

function viewDiscover() {
  setTitle('New books');
  const cache = recall('discover');
  const fresh = cache && Date.now() - new Date(cache.at) < 24 * 3600e3;
  const authors = followed();
  const suggestions = suggestedAuthors();

  const items = (cache?.items || []).filter(c => !findDuplicate(c) && !(db.dismissed[c.workKey] && !db.dismissed[c.workKey].deleted));
  const byAuthor = new Map();
  for (const c of items) { if (!byAuthor.has(c.authorName)) byAuthor.set(c.authorName, []); byAuthor.get(c.authorName).push(c); }

  $('#view').innerHTML = `
    <p class="muted" style="margin-top:0">Books from this year and last by authors you follow, found in Open Library.
      New releases can take a few weeks to appear there.</p>
    <div class="toolbar">
      <button class="btn" id="checkNow" ${authors.length ? '' : 'disabled'}>Check now</button>
      <span class="muted small">${cache ? 'Last checked ' + new Date(cache.at).toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : ''}</span>
    </div>
    <div id="found">${!authors.length ? '' : !items.length ? `<p class="muted">${cache ? 'Nothing new by the authors you follow.' : ''}</p>` :
      [...byAuthor].map(([name, list]) => `<h3 class="discover-author">${esc(name)}</h3>
        <div class="results">${list.map(c => `<div class="result">${coverHtml(c)}
          <div><div class="t">${esc(c.title)}</div><div class="a">${c.year}</div></div>
          <div class="row" style="margin:0;flex-wrap:nowrap"><button class="btn small primary" data-wish="${esc(c.workKey)}">+ Wishlist</button>
          <button class="btn small" data-dismiss="${esc(c.workKey)}">Not for me</button></div>
        </div>`).join('')}</div>`).join('')}</div>

    <h2>Authors you follow <span class="muted small">(${authors.length})</span></h2>
    ${authors.length ? `<div class="follow-list">${authors.map(a => `<span class="tag">${esc(a.name)}<button data-unfollow="${esc(a.key)}" data-name="${esc(a.name)}" aria-label="Stop following ${esc(a.name)}">×</button></span>`).join('')}</div>`
      : `<p class="muted">None yet. Follow authors from any book’s page, or from the suggestions and search below.</p>`}
    ${suggestions.length ? `<h3>Suggested from your reading</h3><p class="muted small" style="margin-top:0">Authors of books you rated 4 or 5 stars, or have several books by.</p>
      <div class="follow-list">${suggestions.map(a => `<button class="btn small" data-followkey="${esc(a.key)}" data-name="${esc(a.name)}">+ ${esc(a.name)}</button>`).join('')}</div>` : ''}
    <h3>Find an author</h3>
    <form class="toolbar" id="authorForm"><input class="search" type="search" id="authorQ" placeholder="Author’s name"><button class="btn" type="submit">Search</button></form>
    <div id="authorResults"></div>`;

  const view = $('#view');
  $('#checkNow').onclick = async () => {
    const btn = $('#checkNow');
    btn.disabled = true; btn.textContent = 'Checking…';
    try { await checkNewBooks(); } catch (e) { toast(e.message); }
    render();
  };
  view.querySelectorAll('[data-wish]').forEach(btn => btn.onclick = () => {
    const c = items.find(x => x.workKey === btn.dataset.wish);
    const b = newBook({ title: c.title, subtitle: c.subtitle, authors: c.authors, authorKeys: c.authorKeys, workKey: c.workKey,
      isbn: c.isbn, year: c.year, pages: c.pages, coverUrl: c.coverUrl, status: 'wishlist' });
    saveBook(b);
    toast(`Added “${b.title}” to your wishlist`);
    render();
  });
  view.querySelectorAll('[data-dismiss]').forEach(btn => btn.onclick = () => {
    db.dismissed[btn.dataset.dismiss] = { updatedAt: now() };
    commit(); render();
  });
  view.querySelectorAll('[data-unfollow]').forEach(btn => btn.onclick = () => { toggleFollow(btn.dataset.unfollow, btn.dataset.name); render(); });
  view.querySelectorAll('[data-followkey]').forEach(btn => btn.onclick = () => { toggleFollow(btn.dataset.followkey, btn.dataset.name); render(); });
  $('#authorForm').onsubmit = async e => {
    e.preventDefault();
    const q = $('#authorQ').value.trim();
    if (!q) return;
    const out = $('#authorResults');
    out.innerHTML = '<p class="muted">Searching…</p>';
    try {
      const res = await fetch(`https://openlibrary.org/search/authors.json?q=${encodeURIComponent(q)}&limit=8`);
      const docs = (await res.json()).docs || [];
      out.innerHTML = docs.length ? `<div class="results">${docs.map(d => {
        const key = d.key.replace('/authors/', '');
        const on = db.authors[key] && !db.authors[key].deleted;
        return `<div class="result" style="grid-template-columns:1fr auto"><div><div class="t">${esc(d.name)}</div>
          <div class="a">${d.top_work ? 'Known for ' + esc(d.top_work) + ' · ' : ''}${d.work_count || 0} works</div></div>
          ${on ? '<span class="muted small">Following</span>' : `<button class="btn small" data-followkey="${esc(key)}" data-name="${esc(d.name)}">+ Follow</button>`}</div>`;
      }).join('')}</div>` : '<p class="muted">No authors found.</p>';
      out.querySelectorAll('[data-followkey]').forEach(btn => btn.onclick = () => { toggleFollow(btn.dataset.followkey, btn.dataset.name); render(); });
    } catch { out.innerHTML = '<p class="muted">Couldn’t reach Open Library.</p>'; }
  };

  // Check automatically once a day when this page is opened.
  if (authors.length && !fresh && navigator.onLine && !viewDiscover.checking) {
    viewDiscover.checking = true;
    checkNewBooks().catch(() => {}).finally(() => { viewDiscover.checking = false; if (location.hash === '#/discover') render(); });
    $('#found').innerHTML = '<p class="muted">Checking for new books…</p>';
  }
}

function suggestedAuthors() {
  const counts = new Map();
  for (const b of books()) (b.authorKeys || []).forEach((key, i) => {
    if (!key) return;
    const e = counts.get(key) || { key, name: b.authors[i], n: 0, loved: false };
    e.n++; if (b.rating >= 4) e.loved = true;
    counts.set(key, e);
  });
  return [...counts.values()]
    .filter(a => (a.loved || a.n >= 2) && !(db.authors[a.key] && !db.authors[a.key].deleted))
    .sort((a, b) => b.n - a.n).slice(0, 12);
}

/* ---------- stats ---------- */

function viewStats() {
  setTitle('Reading stats');
  const all = books();
  const st = viewState.stats ||= { year: '', allGenres: false };
  const year = String(new Date().getFullYear());
  const reads = all.flatMap(b => finishedReads(b).map(r => ({ b, r })));
  // Books marked Read with no read recorded count as read in an unknown year.
  const bare = all.filter(b => b.status === 'read' && !finishedReads(b).length).map(b => ({ b, r: { source: b.source } }));
  const years = [...new Set(reads.map(x => readYear(x.r)).filter(Boolean))].sort().reverse();
  const unknownReads = [...reads.filter(x => !readYear(x.r)), ...bare];
  if (st.year && st.year !== 'unknown' && !years.includes(st.year)) st.year = '';

  // The charts describe the whole collection, or the books read in the chosen year.
  const yearReads = !st.year ? null : st.year === 'unknown' ? unknownReads : reads.filter(x => readYear(x.r) === st.year);
  const scope = yearReads ? [...new Set(yearReads.map(x => x.b))] : all;
  const label = !st.year ? 'your collection' : st.year === 'unknown' ? 'books read in an unknown year' : `books read in ${st.year}`;

  const bars = (rows, unit, opts = {}) => {
    const max = Math.max(1, ...rows.map(r => r[1]));
    return `<div class="bars">${rows.map(([l, v, href]) => {
      const tip = `${l}: ${v} ${unit}${v === 1 ? '' : 's'}`;
      const inner = `<span>${esc(l)}</span><div class="track"><div class="fill" style="width:${v / max * 100}%"></div></div><span class="v">${v}</span>`;
      return href ? `<a class="bar" href="${href}" title="${esc(tip)}">${inner}</a>` : `<div class="bar${v ? '' : ' zero'}" title="${esc(tip)}">${inner}</div>`;
    }).join('')}</div>${opts.after || ''}`;
  };
  const tile = (n, l) => `<div class="tile"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const count = (list, key) => { const m = {}; list.forEach(x => { const k = key(x); if (k != null) m[k] = (m[k] || 0) + 1; }); return m; };
  const avg = list => { const r = list.filter(b => b.rating); return r.length ? (r.reduce((n, b) => n + b.rating, 0) / r.length).toFixed(1) + '★' : '–'; };
  const bySource = list => Object.entries(count(list, x => SOURCE_LABEL[x.r.source || x.b.source] || 'Not recorded')).sort((a, b) => b[1] - a[1]);

  // Fiction vs Nonfiction, as a ring: two parts plus books with no genre yet.
  const kind = b => (b.genres || []).includes('Fiction') ? 'Fiction' : (b.genres || []).includes('Nonfiction') ? 'Nonfiction' : 'No genre yet';
  const kinds = count(scope, kind);
  const ring = () => {
    const parts = [['Nonfiction', 'var(--chart-a)'], ['Fiction', 'var(--chart-b)'], ['No genre yet', 'var(--line)']].map(([k, c]) => [k, kinds[k] || 0, c]).filter(p => p[1]);
    const total = parts.reduce((n, p) => n + p[1], 0);
    if (!total) return '<p class="muted">No books yet.</p>';
    const r = 54, C = 2 * Math.PI * r, gap = parts.length > 1 ? 2 : 0;
    let at = 0;
    const arcs = parts.map(([k, v, c]) => {
      const len = v / total * C;
      const arc = `<circle r="${r}" cx="70" cy="70" fill="none" stroke="${c}" stroke-width="22" stroke-dasharray="${Math.max(0, len - gap)} ${C}" stroke-dashoffset="${-at}"><title>${k}: ${v} (${Math.round(v / total * 100)}%)</title></circle>`;
      at += len;
      return arc;
    }).join('');
    return `<div class="ring-wrap"><svg class="ring" viewBox="0 0 140 140" role="img" aria-label="${parts.map(p => `${p[0]} ${p[1]}`).join(', ')}">
        <g transform="rotate(-90 70 70)">${arcs}</g>
        <text x="70" y="66" text-anchor="middle" class="ring-n">${total}</text><text x="70" y="84" text-anchor="middle" class="ring-l">books</text></svg>
      <ul class="legend">${parts.map(([k, v, c]) => `<li><span class="swatch" style="background:${c}"></span>${k}<span class="v">${v} · ${Math.round(v / total * 100)}%</span></li>`).join('')}</ul></div>`;
  };

  // Genres, longest first, without the Fiction/Nonfiction split shown above. Each opens those books.
  const genreRows = Object.entries(count(scope.flatMap(b => (b.genres || []).filter(g => g !== 'Fiction' && g !== 'Nonfiction')), g => g))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shownGenres = st.allGenres ? genreRows : genreRows.slice(0, 12);

  // Publication dates by decade, newest first. Imported books use the first-publication year.
  // Decades before 1900 are sparse, so they share one bar.
  const decades = count(scope, b => !/^\d{4}$/.test(String(b.year)) ? 'No date' : b.year < 1900 ? 'Before 1900' : String(b.year).slice(0, 3) + '0s');
  const order = k => k === 'No date' ? -2 : k === 'Before 1900' ? -1 : Number(k.slice(0, 4));
  const decadeRows = Object.entries(decades).sort((a, b) => order(b[0]) - order(a[0]));

  // Ratings in half stars, from the highest used to the lowest used: steps outside that range
  // are left off, but a gap inside it stays visible as an empty row.
  const ratings = count(scope.filter(b => b.rating), b => b.rating);
  const used = Object.keys(ratings).map(Number);
  const ratingRows = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5]
    .filter(n => n <= Math.max(...used) && n >= Math.min(...used))
    .map(n => [ratingText(n) + (n <= 1 ? ' star' : ' stars'), ratings[n] || 0]);
  const unrated = scope.filter(b => !b.rating).length;

  const perYear = count(reads, x => readYear(x.r) || null);
  const yearRows = [...Object.entries(perYear).sort((a, b) => b[0].localeCompare(a[0])), ...(unknownReads.length ? [['Year unknown', unknownReads.length]] : [])];
  const owned = all.filter(isOwned);
  const thisYear = reads.filter(x => readYear(x.r) === year);
  const pages = list => list.reduce((n, x) => n + (Number(x.b.pages) || 0), 0).toLocaleString('en-AU');

  $('#view').innerHTML = `
    <div class="toolbar">
      <label class="field" style="flex-direction:row;align-items:center;gap:8px">Show
        <select id="statsYear" aria-label="Which books">
          <option value="">Whole collection</option>
          ${years.map(y => `<option value="${y}" ${st.year === y ? 'selected' : ''}>Books read in ${y}</option>`).join('')}
          ${unknownReads.length ? `<option value="unknown" ${st.year === 'unknown' ? 'selected' : ''}>Books read, year unknown</option>` : ''}
        </select></label>
    </div>
    <div class="tiles">${yearReads ? `
      ${tile(yearReads.length, `book${yearReads.length === 1 ? '' : 's'} read${st.year === 'unknown' ? ', year unknown' : ' in ' + st.year}`)}
      ${tile(pages(yearReads), 'pages')}
      ${tile(avg(scope), 'average rating')}` : `
      ${tile(thisYear.length, `book${thisYear.length === 1 ? '' : 's'} finished in ${year}`)}
      ${tile(pages(thisYear), `pages read in ${year}`)}
      ${tile(all.filter(b => b.status === 'reading').length, 'reading now')}
      ${tile(owned.length, 'books I own')}
      ${tile(owned.filter(b => !hasRead(b)).length, 'owned, not read yet')}
      ${tile(all.filter(b => b.status === 'wishlist').length, 'on the wishlist')}
      ${tile(avg(all), 'average rating')}`}
    </div>
    <div class="chart-grid">
      <section><h2>Fiction vs Nonfiction</h2>${ring()}</section>
      <section><h2>Ratings</h2>${unrated === scope.length ? '<p class="muted">No ratings yet.</p>' : bars(ratingRows, 'book', { after: `<p class="muted small">${unrated} not rated. Average ${avg(scope)}.</p>` })}</section>
    </div>
    <h2>Genres <span class="muted small">(${label})</span></h2>
    ${genreRows.length ? bars(shownGenres.map(([g, n]) => [g, n, '#/genre/' + encodeURIComponent(g)]), 'book', {
      after: genreRows.length > 12 ? `<button class="link-btn" id="moreGenres">${st.allGenres ? 'Show the top 12' : `Show all ${genreRows.length} genres`}</button>` : '' })
      : '<p class="muted">No genres yet. Imported books have them; add them to others in Details.</p>'}
    <h2>Publication dates</h2>
    ${bars(decadeRows, 'book')}
    ${yearReads ? '' : `<h2>Books finished each year</h2>
    ${yearRows.length ? bars(yearRows, 'book') : '<p class="muted">No finished books recorded yet.</p>'}`}
    <h2>How I read them, ${yearReads ? (st.year === 'unknown' ? 'year unknown' : st.year) : year}</h2>
    ${(yearReads || thisYear).length ? bars(bySource(yearReads || thisYear), 'book') : '<p class="muted">Nothing finished this year yet.</p>'}
    ${yearReads ? '' : `<h2>How I read them, all time</h2>
    ${reads.length + bare.length ? bars(bySource([...reads, ...bare]), 'book') : '<p class="muted">No books marked read yet.</p>'}`}`;

  $('#statsYear').onchange = e => { st.year = e.target.value; viewStats(); };
  const more = $('#moreGenres');
  if (more) more.onclick = () => { st.allGenres = !st.allGenres; viewStats(); };
}

/* ---------- settings ---------- */

function viewSettings() {
  setTitle('Settings & sync');
  const cfg = Sync.cfg();
  $('#view').innerHTML = `<div class="settings">
    <section>
      <h2 style="margin-top:4px">Sync between Mac, iPad and iPhone</h2>
      ${cfg ? `<p>Syncing with the private repo <code>${esc(cfg.owner)}/${esc(cfg.repo)}</code>.
          <span class="muted">${Sync.state === 'error' ? '' : Sync.last ? 'Last synced ' + new Date(Sync.last).toLocaleString('en-AU') + '.' : ''}</span></p>
        ${Sync.state === 'error' ? `<p style="color:var(--err)">${esc(Sync.message)}</p>` : ''}
        <div class="row"><button class="btn primary" id="syncNow">Sync now</button><button class="btn" id="changeKey">Change access key</button><button class="btn danger" id="stopSync">Stop syncing on this device</button></div>`
      : `<p>Your books are saved on this device only. To have the same books on every device, the app saves them to a private GitHub repo.
          Each device needs a GitHub access key, pasted in once.</p>`}
      <div id="syncForm" ${cfg ? 'hidden' : ''}>
        <ol class="small">
          <li>On github.com, open <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens</b>, then <b>Generate new token</b>.</li>
          <li>Name it “Book Collection”. Choose the longest expiry offered.</li>
          <li>Under <b>Repository access</b> choose <b>Only select repositories</b> → <code>book-collection-data</code>.</li>
          <li>Under <b>Permissions</b> set <b>Contents</b> to <b>Read and write</b>. Then generate it and copy it.</li>
          <li>Paste it below. You can use the same key on every device.</li>
        </ol>
        <div class="form-grid">
          <label class="field">GitHub account<input type="text" id="s-owner" value="${esc(cfg?.owner || 'mchughde')}" autocapitalize="off" autocorrect="off"></label>
          <label class="field">Data repo<input type="text" id="s-repo" value="${esc(cfg?.repo || 'book-collection-data')}" autocapitalize="off" autocorrect="off"></label>
        </div>
        <label class="field">Access key<input type="password" id="s-token" autocomplete="off" placeholder="github_pat_…"></label>
        <p class="muted small">The key is kept on this device only. Anyone with it can read your book data, so don’t share it.</p>
        <div class="row"><button class="btn primary" id="connect">Connect</button><span id="connectMsg" class="small"></span></div>
      </div>
    </section>
    <section>
      <h2>Backup</h2>
      <p>${cfg ? 'GitHub keeps every saved version of your books, so the repo is already a backup. ' : ''}You can also save a copy as a file, or bring books in from one.</p>
      <div class="row"><button class="btn" id="export">Save a backup file</button>
        <label class="btn">Load a backup file<input type="file" id="import" accept=".json,application/json" hidden></label></div>
      <p class="muted small">Loading a backup merges it with what’s here. Nothing is deleted, and the newer copy of each book wins.</p>
    </section>
    <section>
      <h2>Import from LibraryThing</h2>
      <p>Bring in books from LibraryThing’s JSON export. Books already in your collection are skipped, and covers are looked up afterwards.</p>
      <div class="row"><label class="btn">Choose the export file<input type="file" id="ltFile" accept=".json,application/json" hidden></label></div>
      <div id="ltPreview"></div>
      <p class="small" id="coverProgress"></p>
    </section>
    <section>
      <h2>On this device</h2>
      <p class="small muted">${books().length} books, ${shelves().length} shelves, ${followed().length} followed authors. Book details and covers come from <a href="https://openlibrary.org" target="_blank" rel="noopener">Open Library</a>.</p>
    </section>
  </div>`;

  const showForm = () => { $('#syncForm').hidden = false; $('#s-token').focus(); };
  if (cfg) {
    $('#syncNow').onclick = () => Sync.run().then(render);
    $('#changeKey').onclick = showForm;
    $('#stopSync').onclick = () => {
      if (!confirm('Stop syncing on this device? Your books stay here, and the copy on GitHub is kept.')) return;
      store('sync', undefined); Sync.setState('off'); render();
    };
  }
  $('#connect').onclick = async () => {
    const next = { owner: $('#s-owner').value.trim(), repo: $('#s-repo').value.trim(), token: $('#s-token').value.trim() || cfg?.token || '' };
    const msg = $('#connectMsg');
    if (!next.owner || !next.repo || !next.token) { msg.textContent = 'Fill in all three.'; return; }
    msg.textContent = 'Checking…';
    try {
      const res = await Sync.api('', {}, next);
      if (!res.ok) throw await Sync.fail(res);
      const repo = await res.json();
      if (!repo.private) {
        msg.innerHTML = `<span style="color:var(--err)">That repo is public. Your books would be visible to anyone. Use a private repo.</span>`;
        return;
      }
      store('sync', next);
      msg.textContent = 'Connected. Syncing…';
      await Sync.run();
      render();
      toast(Sync.state === 'ok' ? 'Sync is set up on this device' : Sync.message);
    } catch (e) { msg.innerHTML = `<span style="color:var(--err)">${esc(e.message)}</span>`; }
  };
  $('#export').onclick = () => {
    const blob = new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `book-collection-data-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  Covers.show();
  $('#ltFile').onchange = async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const box = $('#ltPreview');
    try {
      const { fresh, skipped } = readLibraryThing(await file.text());
      const n = (f, one, many) => { const k = fresh.filter(f).length; return k ? `${k} ${k === 1 ? one : many}` : ''; };
      box.innerHTML = `<div class="panel" style="margin-top:12px">
        <p style="margin-top:0"><strong>${fresh.length + skipped.length} books in the file.</strong> ${fresh.length} new${skipped.length ? `; ${skipped.length} already in your collection will be skipped (${skipped.slice(0, 3).map(b => '“' + esc(b.title) + '”').join(', ')}${skipped.length > 3 ? '…' : ''})` : ''}.</p>
        <p class="small">They’ll come in as Read, year unknown, and owned. ${[n(b => b.series, 'has a series', 'have a series'), n(b => b.tags.length, 'has tags', 'have tags'), n(b => b.rating, 'has a rating', 'have a rating'), n(b => b.source === 'own-ebook', 'is an ebook', 'are ebooks')].filter(Boolean).join(', ')}.</p>
        <div class="row" style="margin-bottom:0">${fresh.length ? `<button class="btn primary" id="ltGo">Import ${fresh.length} book${fresh.length === 1 ? '' : 's'}</button>` : ''}<button class="btn" id="ltCancel">Cancel</button></div>
      </div>`;
      $('#ltCancel').onclick = () => { box.innerHTML = ''; };
      if ($('#ltGo')) $('#ltGo').onclick = () => {
        for (const b of fresh) db.books[b.id] = b;
        commit();
        box.innerHTML = '';
        toast(`Imported ${fresh.length} books. Finding covers…`, 4000);
        renderNav('settings');
        Covers.run();
      };
    } catch (err) { box.innerHTML = `<p style="color:var(--err)">${esc(err.message)}</p>`; }
  };
  $('#import').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data.books !== 'object') throw new Error('That file isn’t a Book Collection backup.');
      const before = books().length;
      db = mergeDb(db, Object.assign(emptyDb(), data));
      commit();
      toast(`Backup loaded: ${books().length - before} new books`);
      render();
    } catch (err) { toast(err.message, 4000); }
  };
}

/* ---------- stocktake ---------- */

// Going shelf by shelf: each book scanned (or found by title) gets its place recorded and is ticked
// off (checkedAt). Barcodes that aren't in the collection go on a list of new books to add, kept on
// this device. Ebooks and audiobooks have nothing to scan, so they're given their app in batches.
const Stock = {
  place: recall('stockPlace') || 'lounge',
  other: recall('stockOther') || '',
  fresh: recall('stockNew') || [],
  log: [],
  where() { return { location: this.place, locationOther: this.place === 'other' ? this.other : '' }; },
  placeName() { return this.place === 'other' ? (this.other || 'Other') : LOCATION_LABEL[this.place]; },
  note(text, kind) { this.log.unshift({ text, kind }); this.log.length = Math.min(this.log.length, 40); return text; },
  found(id) {
    const b = db.books[id];
    Object.assign(b, this.where(), { checkedAt: now() });
    let extra = '';
    if (b.status === 'wishlist') { b.status = 'to-read'; b.source = 'own-physical'; extra = ' (moved from your wishlist)'; }
    saveBook(b);
    return this.note(`✓ ${b.title}${extra}`, 'ok');
  },
  async scan(isbn) {
    let b = books().find(x => x.isbn && (x.isbn === isbn || isbn10to13(x.isbn) === isbn));
    let info = null;
    if (!b) {
      // A different edition of a book already here still counts: match by Open Library's work.
      info = (await olSearch(isbn).catch(() => []))[0] || null;
      if (info) b = findDuplicate(info);
      if (b && !b.isbn) db.books[b.id].isbn = isbn;
    }
    if (b) return this.found(b.id);
    const already = this.fresh.find(f => f.isbn === isbn);
    if (already) return this.note(`Already on the new list: ${already.title}`, 'new');
    const f = {
      isbn, title: info?.title || '', subtitle: info?.subtitle || '', authors: info?.authors || [],
      authorKeys: info?.authorKeys || [], workKey: info?.workKey || '', year: info?.year || '', pages: info?.pages || '',
      coverUrl: info?.coverUrl || `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`, ...this.where(),
    };
    this.fresh.unshift(f);
    store('stockNew', this.fresh);
    return this.note(`New: ${f.title || 'ISBN ' + isbn + ' (not found online)'}`, 'new');
  },
  async addFresh(f) {
    if (!f.title) {
      const title = prompt(`Open Library doesn’t know ISBN ${f.isbn}. What’s the book’s title?`);
      if (!title || !title.trim()) return false;
      f.title = title.trim();
      f.authors = (prompt('And the author? (leave blank if unsure)') || '').split(',').map(a => a.trim()).filter(Boolean);
    }
    const b = newBook({ ...f, source: 'own-physical', checkedAt: now(), genres: await guessGenres(f).catch(() => []), genreChecked: true });
    setStatus(b, 'to-read');
    const e = await olEditionByIsbn(f.isbn).catch(() => null);
    if (e) { applyEdition(b, e); if (f.coverUrl.includes('/b/id/')) b.coverUrl = f.coverUrl; }
    saveBook(b);
    this.drop(f.isbn);
    return true;
  },
  drop(isbn) { this.fresh = this.fresh.filter(f => f.isbn !== isbn); store('stockNew', this.fresh); },
};

function viewStocktake(arg) {
  if (arg === 'missing') {
    setTitle('Not found yet');
    renderList({
      key: 'stock-missing', filter: b => b.source === 'own-physical' && !b.checkedAt, noSource: true,
      intro: `<a class="back" href="#/stocktake">‹ Stocktake</a><p class="muted small">Printed books you own that haven’t been scanned or found in this stocktake. They may be lent, given away, or not reached yet.</p>`,
      card: b => ({ meta: locationLabel(b) || 'Place not set' }),
      empty: `<div class="empty"><p>Every printed book you own has been found.</p><a href="#/stocktake">Back to the stocktake</a></div>`,
    });
    return;
  }
  setTitle('Stocktake');
  const physical = books().filter(b => b.source === 'own-physical');
  const checked = physical.filter(b => b.checkedAt);
  const rooms = Object.entries(checked.reduce((m, b) => { const k = locationLabel(b) || 'Place not set'; m[k] = (m[k] || 0) + 1; return m; }, {}))
    .sort((a, b) => b[1] - a[1]);
  const digital = books().filter(b => ['own-ebook', 'own-audio'].includes(b.source) && !b.location)
    .sort((a, b) => a.title.localeCompare(b.title));
  const roomOptions = ROOMS.map(k => `<option value="${k}" ${Stock.place === k ? 'selected' : ''}>${LOCATION_LABEL[k]}</option>`).join('') +
    `<option value="other" ${Stock.place === 'other' ? 'selected' : ''}>Other (say where)</option>`;

  $('#view').innerHTML = `
    <p class="muted" style="margin-top:0">Go shelf by shelf. Each book you scan is ticked off and its place recorded. Books that aren’t in your collection yet go on a list to add.</p>
    <div class="panel" style="margin-top:0">
      <div class="row" style="margin-top:0">
        <label class="field">Books in<select id="stPlace">${roomOptions}</select></label>
        ${Stock.place === 'other' ? `<label class="field">Where?<input type="text" id="stOther" value="${esc(Stock.other)}" placeholder="Garage, box 2" style="width:12em"></label>` : ''}
        <button class="btn primary" id="stScan">Scan books</button>
      </div>
      <div class="row">
        <form id="stIsbnForm" class="row" style="margin:0"><input type="text" id="stIsbn" inputmode="numeric" placeholder="Or type an ISBN" style="width:11em"><button class="btn">Check</button></form>
        <input type="search" class="search" id="stFind" placeholder="No barcode? Find it by title or author" style="flex:1;min-width:14em">
      </div>
      <div id="stMatches"></div>
      ${Stock.log.length ? `<ul class="stock-log">${Stock.log.slice(0, 12).map(l => `<li class="${l.kind}">${esc(l.text)}</li>`).join('')}</ul>` : ''}
    </div>

    <h2>New books found <span class="muted small">${Stock.fresh.length ? '(' + Stock.fresh.length + ')' : ''}</span></h2>
    ${Stock.fresh.length ? `<div class="results">${Stock.fresh.map(f => `<div class="result">
        ${coverHtml(f)}
        <div><div class="t">${esc(f.title || 'Not found online')}</div><div class="a">${esc([f.authors.join(', '), 'ISBN ' + f.isbn, f.location === 'other' ? f.locationOther || 'Other' : LOCATION_LABEL[f.location]].filter(Boolean).join(' · '))}</div></div>
        <div class="row" style="margin:0;flex-wrap:nowrap"><button class="btn small primary" data-addnew="${f.isbn}">Add</button><button class="btn small" data-dropnew="${f.isbn}">Remove</button></div>
      </div>`).join('')}</div>
      <p class="small muted">They’re added as owned, printed, To read, with the place you scanned them in. Kept on this device until added.</p>`
      : '<p class="muted">None yet. Books you scan that aren’t in your collection will appear here.</p>'}

    <h2>Progress</h2>
    <div class="tiles">
      <div class="tile"><div class="n">${checked.length}</div><div class="l">of ${physical.length} printed books found</div></div>
      <a class="tile" href="#/stocktake/missing" style="text-decoration:none;color:inherit"><div class="n">${physical.length - checked.length}</div><div class="l">not found yet ›</div></a>
    </div>
    ${rooms.length ? `<div class="bars" style="margin-top:14px">${rooms.map(([k, n]) => `<div class="bar"><span>${esc(k)}</span><div class="track"><div class="fill" style="width:${n / Math.max(...rooms.map(r => r[1])) * 100}%"></div></div><span class="v">${n}</span></div>`).join('')}</div>` : ''}
    ${checked.length ? `<p><button class="link-btn" id="stRestart">Start a new stocktake</button> <span class="muted small">(clears the ticks, keeps every place)</span></p>` : ''}

    <h2>Ebooks and audiobooks: which app?</h2>
    ${digital.length ? `<div class="row" style="margin-top:0">
        <label class="field">App<select id="stApp">${EBOOK_APPS.map(k => `<option value="${k}">${LOCATION_LABEL[k]}</option>`).join('')}</select></label>
        <button class="btn" id="stApply">Set for ticked books</button>
        <button class="link-btn" id="stAll">Tick all</button>
      </div>
      <div class="check-list stock-digital">${digital.map(b => `<label><input type="checkbox" data-dig="${b.id}"> ${esc(b.title)} <span class="muted small">${esc(authorLine(b))}</span></label>`).join('')}</div>`
      : '<p class="muted">Every ebook and audiobook you own has its app set.</p>'}`;

  const refresh = () => { if (location.hash.startsWith('#/stocktake')) viewStocktake(); };
  $('#stPlace').onchange = e => { Stock.place = e.target.value; store('stockPlace', Stock.place); refresh(); };
  if ($('#stOther')) $('#stOther').onchange = e => { Stock.other = e.target.value.trim(); store('stockOther', Stock.other); };
  const ready = () => {
    if (Stock.place === 'other' && !Stock.other) { toast('Say where first, in the “Where?” box'); $('#stOther').focus(); return false; }
    return true;
  };
  $('#stScan').onclick = () => { if (ready()) Scanner.open(isbn => Stock.scan(isbn), { continuous: true, onClose: refresh }); };
  $('#stIsbnForm').onsubmit = async e => {
    e.preventDefault();
    const raw = $('#stIsbn').value.replace(/[\s-]/g, '');
    const isbn = raw.length === 10 ? isbn10to13(raw) : raw;
    if (!/^97[89]\d{10}$/.test(isbn)) { toast('That doesn’t look like an ISBN. It’s the 10 or 13 digits by the barcode.'); return; }
    if (!ready()) return;
    toast(await Stock.scan(isbn));
    refresh();
  };
  $('#stFind').oninput = e => {
    const q = e.target.value.trim();
    const hits = q.length < 2 ? [] : books().filter(b => matches(b, q)).slice(0, 8);
    $('#stMatches').innerHTML = hits.length ? `<div class="results">${hits.map(b => `<div class="result">${coverHtml(b)}
        <div><div class="t">${esc(b.title)}</div><div class="a">${esc([authorLine(b), locationLabel(b), b.checkedAt ? 'found ✓' : ''].filter(Boolean).join(' · '))}</div></div>
        <button class="btn small primary" data-here="${b.id}">It’s here</button></div>`).join('')}</div>`
      : q.length >= 2 ? '<p class="muted small">Not in your collection. Add it with “+ Add book”.</p>' : '';
    document.querySelectorAll('[data-here]').forEach(btn => btn.onclick = () => {
      if (!ready()) return;
      toast(Stock.found(btn.dataset.here));
      refresh();
    });
  };
  document.querySelectorAll('[data-addnew]').forEach(btn => btn.onclick = async () => {
    btn.disabled = true;
    const f = Stock.fresh.find(x => x.isbn === btn.dataset.addnew);
    if (await Stock.addFresh(f)) toast(`Added “${f.title}”`);
    refresh();
  });
  document.querySelectorAll('[data-dropnew]').forEach(btn => btn.onclick = () => { Stock.drop(btn.dataset.dropnew); refresh(); });
  if ($('#stRestart')) $('#stRestart').onclick = () => {
    if (!confirm('Start a new stocktake? The ticks are cleared; every book keeps its place.')) return;
    for (const b of books()) if (b.checkedAt) { delete b.checkedAt; b.updatedAt = now(); }
    commit();
    Stock.log = [];
    refresh();
  };
  if ($('#stApply')) {
    $('#stAll').onclick = () => document.querySelectorAll('[data-dig]').forEach(c => { c.checked = true; });
    $('#stApply').onclick = () => {
      const ids = [...document.querySelectorAll('[data-dig]:checked')].map(c => c.dataset.dig);
      if (!ids.length) { toast('Tick the books first'); return; }
      const app = $('#stApp').value;
      for (const id of ids) Object.assign(db.books[id], { location: app, locationOther: '', updatedAt: now() });
      commit();
      toast(`${ids.length} book${ids.length === 1 ? '' : 's'} set to ${LOCATION_LABEL[app]}`);
      refresh();
    };
  }
}

/* ---------- LibraryThing import ---------- */

// LibraryThing's JSON export: an object of books keyed by id. Dianne's (29 Oct 2026) has 267 books
// entered 2012–13, with no read status, dates or reviews, so books come in as Read, year unknown
// (her choice). The export has no covers; Covers.run() looks them up afterwards.
const TAG_FIXES = { autobigraphy: ['autobiography'], psycholgy: ['psychology'], 'London. United Kingdom': ['London', 'United Kingdom'] };
const plainText = s => { const t = document.createElement('textarea'); t.innerHTML = String(s || ''); return t.value.trim(); };

// Series come with their translations ("Ania z Zielonego Wzgórza", "La saga d'Anne", "Anne of
// Green Gables"). Prefer a name with no accents or foreign words, then the most frequent, then the
// most English-looking, then the first. "{Schama}" is LibraryThing telling series apart. Tested
// on Dianne's export (29 Oct 2026): every multi-name series came out in English.
const FOREIGN_WORDS = new Set('z i e et la le les dai del de der die das und och og el los las il di da du komisario inspektor kolekcja juhtum juhtumid trylogia'.split(' '));
const ENGLISH_WORDS = new Set('the of and in on to by for with inspector detective mystery mysteries series trilogy guide guides travel novels books chronicles adventures collection complete'.split(' '));
function pickSeriesName(list) {
  const names = list.map(n => plainText(n).replace(/\s*\{[^}]*\}\s*$/, '')).filter(Boolean);
  const freq = new Map();
  names.forEach(n => freq.set(n, (freq.get(n) || 0) + 1));
  const words = n => n.toLowerCase().match(/[a-z]+/g) || [];
  const score = (n, i) => [
    /[^\x00-\x7f]/.test(n) || words(n).some(w => FOREIGN_WORDS.has(w)) ? 0 : 1,
    freq.get(n), words(n).filter(w => ENGLISH_WORDS.has(w)).length, -i];
  const higher = (a, b) => { const k = a.findIndex((v, j) => v !== b[j]); return k >= 0 && a[k] > b[k]; };
  let best = '', bestScore = null;
  names.forEach((n, i) => {
    const sc = score(n, i);
    if (!bestScore || higher(sc, bestScore)) { best = n; bestScore = sc; }
  });
  return best;
}

function fromLibraryThing(x) {
  const people = x.authors || [];
  const authors = people.filter(a => !a.role).map(a => plainText(a.fl)).filter(Boolean);
  const helpers = people.filter(a => a.role).map(a => `${a.role}: ${plainText(a.fl)}`);
  const tags = [...new Set((x.tags || []).map(plainText).flatMap(t => TAG_FIXES[t] || [t]))];
  const ebook = (x.format || []).some(f => /ebook/i.test(f.text)) || tags.some(t => t.toLowerCase() === 'ebook');
  const series = pickSeriesName(x.series || []);
  const b = newBook({
    title: plainText(x.title), authors,
    isbn: x.isbn?.['2'] || isbn10to13(x.isbn?.['0']) || '',
    year: (String(x.date || '').match(/\d{4}/) || [''])[0],
    pages: parseInt(x.pages) || '',
    publisher: plainText(String(x.publication || '').split(' (')[0]),
    source: ebook ? 'own-ebook' : 'own-physical',
    rating: Math.round((Number(x.rating) || 0) * 2) / 2,
    tags, series, genres: (x.genre || []).filter(g => !/^General /.test(g)),
    notes: helpers.length ? [{ id: uid(), text: helpers.join('\n'), page: '', date: now() }] : [],
    added: /^\d{4}-\d\d-\d\d$/.test(x.entrydate || '') ? x.entrydate + 'T12:00:00.000Z' : now(),
    ltId: String(x.books_id || ''), needsCover: true,
  });
  setStatus(b, 'read');
  return b;
}

function readLibraryThing(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file isn’t a LibraryThing JSON export.'); }
  const list = data && typeof data === 'object' ? Object.values(data) : [];
  if (!list.length || !list.every(x => x && x.books_id && 'title' in x)) throw new Error('That file isn’t a LibraryThing JSON export.');
  const fresh = [], skipped = [];
  for (const x of list) {
    const b = fromLibraryThing(x);
    // Each LibraryThing entry is its own copy (two volumes can share a title), so only books
    // already in the collection are skipped.
    const here = books().find(o => o.ltId && o.ltId === b.ltId) || findDuplicate(b);
    (here ? skipped : fresh).push(b);
  }
  return { fresh, skipped };
}

// Covers, and Open Library's work and author links, for imported books: Open Library by ISBN,
// then by title and author, then Apple Books. Two at a time, saving as it goes; it carries on
// next time the app opens if it was closed part way. Apple allows about 20 requests a minute.
const Covers = {
  running: false, done: 0, total: 0, found: 0,
  async run() {
    if (this.running) return;
    const queue = books().filter(b => b.needsCover);
    if (!queue.length) return;
    Object.assign(this, { running: true, done: 0, found: 0, total: queue.length });
    this.show();
    const worker = async () => {
      for (let b; (b = queue.shift()); ) {
        await this.one(b).catch(() => {});
        this.done++;
        this.show();
        if (this.done % 12 === 0 && /^#\/(library|all|read|series)/.test(location.hash)) refreshAfterSync();
      }
    };
    await Promise.all([worker(), worker()]);
    this.running = false;
    FirstYears.run();
    this.show();
    if (/^#\/(library|all|read|series)/.test(location.hash)) refreshAfterSync();
    toast(`Covers found for ${this.found} of ${this.total} imported books`, 4000);
  },
  async one(b) {
    let cover = '', o = null;
    if (b.isbn) o = (await olSearch(b.isbn).catch(() => []))[0];
    if (!o && b.authors[0]) o = (await olSearch(`${b.title} ${surname(b.authors[0])}`).catch(() => [])).find(x => sameBook(x, b));
    if (o?.coverUrl.includes('/b/id/')) cover = o.coverUrl;
    if (!cover && b.authors[0]) cover = await this.apple(b);
    const cur = db.books[b.id];
    if (!cur || cur.deleted) return;
    if (o) {
      cur.workKey ||= o.workKey;
      if (!(cur.authorKeys || []).some(Boolean)) cur.authorKeys = cur.authors.map(a => o.authorKeys[o.authors.findIndex(x => surname(x) === surname(a))] || '');
    }
    if (!cur.coverUrl) cur.coverUrl = cover || (cur.isbn ? `https://covers.openlibrary.org/b/isbn/${cur.isbn}-M.jpg?default=false` : '');
    if (cover) this.found++;
    delete cur.needsCover;
    saveBook(cur);
  },
  async apple(b) { return (await appleMatch(b))?.coverUrl || ''; },
  show() {
    const el = $('#coverProgress');
    if (el) el.textContent = this.running ? `Finding covers: ${this.done} of ${this.total}…` : this.total ? `Covers found for ${this.found} of ${this.total} imported books.` : '';
  },
};

// LibraryThing's year is the edition's (Anne of Green Gables came in as a 1990s book), while
// books added here carry the first-publication year. This swaps in Open Library's first year
// for imported books once they have a work link, 50 to a request, keeping the edition's year.
const FirstYears = {
  running: false,
  async run() {
    const todo = books().filter(b => b.ltId && b.workKey && !b.yearChecked);
    if (this.running || !todo.length) return;
    this.running = true;
    for (let i = 0; i < todo.length; i += 50) {
      const batch = todo.slice(i, i + 50);
      const q = 'key:(' + batch.map(b => `"${b.workKey}"`).join(' OR ') + ')';
      const res = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&fields=key,first_publish_year&limit=100`).catch(() => null);
      if (!res?.ok) break;
      const first = Object.fromEntries(((await res.json()).docs || []).map(d => [d.key, d.first_publish_year]));
      for (const b of batch) {
        const cur = db.books[b.id];
        if (!cur || cur.deleted) continue;
        const y = first[cur.workKey];
        if (y && String(y) !== String(cur.year)) { cur.editionYear = cur.year; cur.year = y; }
        cur.yearChecked = true;
        cur.updatedAt = now();
      }
      commit();
    }
    this.running = false;
  },
};

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
