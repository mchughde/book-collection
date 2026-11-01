// A pretend browser for the check suite: runs the app's scripts in jsdom with a pretend GitHub and canned
// Open Library / Apple answers. Nothing here ever touches the network: any request the fakes
// don't recognise is answered with an error and recorded, and the check that caused it fails.
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM, VirtualConsole } from 'jsdom';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

// The app folder: this project, or another copy of it (APP_DIR=…), used to prove the checks
// catch breakage without touching the real files. The app's scripts are the ones index.html
// loads, in its order, so the checks follow the page if files are added or renamed.
const ROOT = process.env.APP_DIR ? new URL(process.env.APP_DIR.replace(/\/?$/, '/'), 'file://' + process.cwd() + '/') : new URL('../', import.meta.url);
export const appFile = ROOT.pathname;
const indexHtml = fs.readFileSync(new URL('index.html', ROOT), 'utf8');
const SCRIPT_TAG = /<script src="([^"?]+)[^"]*"><\/script>/g;
const appScripts = [...indexHtml.matchAll(SCRIPT_TAG)].map(m => ({ name: m[1], code: fs.readFileSync(new URL(m[1], ROOT), 'utf8') }));
if (!appScripts.length) throw new Error('index.html loads no scripts');
const pageHtml = indexHtml.replace(SCRIPT_TAG, '');

// The pretend data repo. Deliberately not mchughde/book-collection-data.
export const OWNER = 'test-owner', REPO = 'test-data', TOKEN = 'github_pat_test';
const realRepo = /mchughde\/book-collection-data/;

// Errors in the app's background work (a promise that fails with nobody to catch it). In a real
// browser they'd show in the console; here they fail the check that was running.
export const strayErrors = [];
process.on('unhandledRejection', e => strayErrors.push('background error: ' + (e?.stack || e).toString().split('\n').slice(0, 2).join(' — ')));

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function until(cond, what = 'condition', ms = 3000) {
  const end = Date.now() + ms;
  for (;;) {
    let ok = false;
    try { ok = await cond(); } catch {}
    if (ok) return ok;
    if (Date.now() > end) throw new Error('Timed out waiting for ' + what);
    await sleep(5);
  }
}

const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/* ---------- pretend GitHub ---------- */

export class FakeGitHub {
  constructor({ isPrivate = true, bigFile = false } = {}) {
    this.files = new Map(); // path -> { text, sha }
    this.isPrivate = isPrivate;
    this.bigFile = bigFile; // answer like GitHub does for files over 1 MB: no content
    this.puts = []; // paths written, in order
    this.n = 0;
    this.conflictOnce = false; // next PUT is refused as if another device saved first
  }
  data(path = 'library.json') { const f = this.files.get(path); return f ? JSON.parse(f.text) : null; }
  async handle(url, opts) {
    const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(\/contents\/(.+))?$/);
    if (!m) return null;
    const auth = (opts.headers || {}).Authorization || '';
    if (auth !== 'Bearer ' + TOKEN) return json({ message: 'Bad credentials' }, 401);
    if (m[1] !== OWNER || m[2] !== REPO) return json({ message: 'Not Found' }, 404);
    if (!m[3]) return json({ private: this.isPrivate, full_name: `${OWNER}/${REPO}` });
    const path = decodeURIComponent(m[4]);
    const method = opts.method || 'GET';
    const f = this.files.get(path);
    if (method === 'GET') {
      if (!f) return json({ message: 'Not Found' }, 404);
      if (/raw/.test((opts.headers || {}).Accept || '')) return new Response(f.bytes || f.text, { status: 200 });
      return json({ sha: f.sha, content: this.bigFile ? '' : (f.bytes ? f.bytes.toString('base64') : b64(f.text)) });
    }
    if (method === 'PUT') {
      const body = JSON.parse(opts.body);
      if (this.conflictOnce) { this.conflictOnce = false; return json({ message: 'conflict' }, 409); }
      if (f && body.sha !== f.sha) return json({ message: 'sha does not match' }, f && !body.sha ? 422 : 409);
      const bytes = Buffer.from(body.content, 'base64');
      const rec = { sha: 'sha' + (++this.n), text: bytes.toString('utf8') };
      if (path.startsWith('covers/')) rec.bytes = bytes;
      this.files.set(path, rec);
      this.puts.push(path);
      return json({ content: { sha: rec.sha } }, f ? 200 : 201);
    }
    return json({ message: 'Method not allowed' }, 405);
  }
}

/* ---------- canned Open Library and Apple answers ---------- */

// A tiny made-up catalogue. Each work has editions; Apple knows some of them, with categories.
export const WORKS = [
  { key: '/works/OL1W', title: 'The Remains of the Day', author: 'Kazuo Ishiguro', akey: 'OL1A', year: 1989, cover: 111, pages: 258,
    subjects: ['Fiction', 'Butlers', 'England'],
    apple: ['Fiction & Literature', 'Literary Fiction'],
    editions: [
      { isbn_13: ['9780571258246'], publishers: ['Faber & Faber'], publish_date: '2010', number_of_pages: 258, covers: [112], languages: [{ key: '/languages/eng' }], physical_format: 'Paperback' },
      { isbn_13: ['9798000000001'], publishers: ['Independently published'], publish_date: '2023', number_of_pages: 250, languages: [{ key: '/languages/eng' }] },
      { isbn_13: ['9782070000001'], publishers: ['Gallimard'], publish_date: '2001', languages: [{ key: '/languages/fre' }] },
    ] },
  { key: '/works/OL2W', title: 'Normal People', author: 'Sally Rooney', akey: 'OL2A', year: 2018, cover: 221, pages: 273,
    subjects: ['Fiction', 'Love stories'], apple: ['Fiction & Literature', 'Literary Criticism'],
    editions: [{ isbn_13: ['9780571334650'], publishers: ['Faber & Faber'], publish_date: '2018', number_of_pages: 273, covers: [222], languages: [{ key: '/languages/eng' }] }] },
  { key: '/works/OL3W', title: 'Anne of Green Gables', author: 'L. M. Montgomery', akey: 'OL3A', year: 1908, cover: 331, pages: 320,
    subjects: ['Fiction', 'Orphans'], apple: null,
    editions: [{ isbn_13: ['9780141321592'], publishers: ['Puffin'], publish_date: '2008', number_of_pages: 320, covers: [332], languages: [{ key: '/languages/eng' }] },
      { isbn_10: ['0553213131'], publishers: ['Bantam'], publish_date: '1982', number_of_pages: 309, languages: [{ key: '/languages/eng' }] }] },
  { key: '/works/OL4W', title: 'A Short History of Nearly Everything', author: 'Bill Bryson', akey: 'OL4A', year: 2003, cover: 441, pages: 544,
    subjects: ['Science', 'Popular works'], apple: ['Science & Nature', 'Nonfiction'],
    editions: [{ isbn_13: ['9780552997041'], publishers: ['Black Swan'], publish_date: '2004', number_of_pages: 544, covers: [442], languages: [{ key: '/languages/eng' }] }] },
];
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const isbn10to13 = i => { const core = '978' + i.slice(0, 9); const sum = [...core].reduce((n, d, k) => n + Number(d) * (k % 2 ? 3 : 1), 0); return core + (10 - sum % 10) % 10; };
const isbnsOf = w => w.editions.flatMap(e => [...(e.isbn_13 || []), ...(e.isbn_10 || []).map(isbn10to13)]);
const doc = w => ({ key: w.key, title: w.title, author_name: [w.author], author_key: [w.akey], first_publish_year: w.year, cover_i: w.cover, number_of_pages_median: w.pages, language: ['eng'] });
const matchQuery = (w, q) => norm(q).split(' ').every(word => norm(w.title + ' ' + w.author).split(' ').includes(word));

function openLibrary(url) {
  const p = url.searchParams;
  if (url.pathname === '/search.json') {
    if (p.get('isbn')) return json({ docs: WORKS.filter(w => isbnsOf(w).includes(p.get('isbn'))).map(doc) });
    if (p.get('author_key')) return json({ docs: [] });
    const q = p.get('q') || '';
    const keys = q.match(/\/works\/OL\d+W/g);
    if (keys) return json({ docs: WORKS.filter(w => keys.includes(w.key)).map(w => ({ key: w.key, first_publish_year: w.year })) });
    return json({ docs: WORKS.filter(w => matchQuery(w, q)).map(doc) });
  }
  if (url.pathname === '/search/authors.json') return json({ docs: [] });
  let m = url.pathname.match(/^(\/works\/OL\d+W)(\/editions)?\.json$/);
  if (m) {
    const w = WORKS.find(x => x.key === m[1]);
    if (!w) return json({ error: 'notfound' }, 404);
    return m[2] ? json({ entries: w.editions }) : json({ key: w.key, title: w.title, subjects: w.subjects });
  }
  m = url.pathname.match(/^\/isbn\/(\d+)\.json$/);
  if (m) {
    for (const w of WORKS) for (const e of w.editions) {
      if ([...(e.isbn_13 || []), ...(e.isbn_10 || []).map(isbn10to13)].includes(m[1])) return json({ ...e, works: [{ key: w.key }] });
    }
    return json({ error: 'notfound' }, 404);
  }
  return null;
}

function apple(url) {
  if (url.pathname !== '/search') return null;
  if (url.searchParams.get('media') !== 'ebook') return json({ results: [] });
  const term = url.searchParams.get('term') || '';
  const results = WORKS.filter(w => w.apple && norm(term).split(' ').some(t => t.length > 3 && norm(w.title).includes(t)))
    .map(w => ({ trackName: w.title, artistName: w.author, releaseDate: w.year + '-01-01T00:00:00Z',
      artworkUrl100: `https://is1-ssl.mzstatic.com/image/thumb/Publication/${w.editions[0].isbn_13[0]}.jpg/100x100bb.jpg`, genres: ['Books', ...w.apple] }));
  return json({ results });
}

/* ---------- a device: one pretend browser running the app ---------- */

export async function openDevice({ name = 'Mac', ua = 'Macintosh', github = null, hash = '#/library', storage = {}, idb = null, wait = true } = {}) {
  const errors = [];
  const requests = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(`${name}: ${e.message}${e.detail ? ' — ' + (e.detail.stack || e.detail) : ''}`));
  vc.on('error', (...a) => errors.push(`${name}: console.error ${a.map(String).join(' ')}`));
  const dom = new JSDOM(pageHtml, { url: 'https://mchughde.github.io/book-collection/' + hash, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;

  // Timers run 1000× faster, so Apple's 3.5 s spacing and the 2.5 s sync delay don't slow the run.
  const realSet = w.setTimeout.bind(w);
  w.setTimeout = (fn, ms = 0, ...args) => realSet(fn, Math.min(ms, 1e6) / 1000, ...args);
  w.setInterval = () => 0; // the 5-minute background sync is left out; checks sync on purpose
  w.scrollTo = () => {};
  w.TextEncoder = TextEncoder; // jsdom leaves these out; every real browser has them
  w.TextDecoder = TextDecoder;
  // A "Save a backup file" link is clicked to download; record the file instead of navigating.
  const anchorClick = w.HTMLAnchorElement.prototype.click;
  w.HTMLAnchorElement.prototype.click = function () { if (this.download) (w.__downloads ||= []).push({ name: this.download, href: this.href }); else anchorClick.call(this); };
  w.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  w.indexedDB = idb || new IDBFactory();
  w.IDBKeyRange = IDBKeyRange;
  w.URL.createObjectURL = blob => { const u = 'blob:test/' + Math.random().toString(36).slice(2); (w.__blobs ||= {})[u] = blob; return u; };
  w.URL.revokeObjectURL = () => {};
  // jsdom's Blob lacks text() and arrayBuffer(), which every real browser has.
  const readBlob = (blob, how) => new Promise((ok, fail) => { const r = new w.FileReader(); r.onload = () => ok(r.result); r.onerror = () => fail(r.error); r[how](blob); });
  w.Blob.prototype.text ||= function () { return readBlob(this, 'readAsText'); };
  w.Blob.prototype.arrayBuffer ||= function () { return readBlob(this, 'readAsArrayBuffer'); };
  // Answers for prompt() and confirm(), queued by the checks. Unexpected ones are errors.
  w.__prompts = [];
  w.prompt = msg => { if (!w.__prompts.length) { errors.push(`${name}: unexpected prompt "${msg}"`); return null; } return w.__prompts.shift(); };
  w.confirm = () => (w.__confirm ?? true);
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));

  w.fetch = async (input, opts = {}) => {
    const url = new URL(String(input));
    requests.push({ url: url.href, method: opts.method || 'GET' });
    if (realRepo.test(url.href)) { errors.push(`${name}: tried to reach the REAL data repo: ${url.href}`); return json({}, 599); }
    let res = null;
    if (url.host === 'api.github.com') res = github ? await github.handle(url, opts) : null;
    else if (url.host === 'openlibrary.org') res = openLibrary(url);
    else if (url.host === 'itunes.apple.com') res = apple(url);
    if (!res) { errors.push(`${name}: unexpected network request ${opts.method || 'GET'} ${url.href}`); return json({ message: 'not faked' }, 599); }
    return res;
  };

  // Run as scripts (not eval) so their top-level let/const are visible to later w.eval calls.
  // Each file runs as its own script, as in the browser, so they share one scope the same way.
  const ctx = dom.getInternalVMContext();
  // A real browser downloads each file before running it, so the app's start-up (loading the
  // collection) can get going before later files arrive. Pausing between files does the same here,
  // so a file loaded too early is caught.
  for (const f of appScripts) { vm.runInContext(f.code, ctx, { filename: f.name }); await sleep(3); }
  vm.runInContext('globalThis.__setDb = v => { db = v; };', ctx);
  const dev = {
    name, window: w, document: w.document, errors, requests, github,
    js: src => w.eval(src),
    get db() { return w.eval('db'); },
    set db(v) { w.__setDb(v); },
    $: sel => w.document.querySelector(sel),
    $$: sel => [...w.document.querySelectorAll(sel)],
    // Visible words, with a space between elements (textContent runs "Fav" and "1" together).
    text: sel => {
      const el = w.document.querySelector(sel);
      if (!el) return '';
      const out = [], walk = w.document.createTreeWalker(el, 4);
      while (walk.nextNode()) out.push(walk.currentNode.nodeValue);
      return out.join(' ').replace(/\s+/g, ' ').trim();
    },
    toast: () => w.document.querySelector('#toast').textContent,
    books: () => Object.values(w.eval('db').books).filter(b => !b.deleted),
    book: title => Object.values(w.eval('db').books).find(b => b.title === title && !b.deleted),
    async go(h) {
      if (w.location.hash === h) w.eval('render()');
      else { w.location.hash = h; await until(() => w.location.hash === h, 'hash ' + h); }
      await sleep(15);
    },
    click(sel) { const el = typeof sel === 'string' ? w.document.querySelector(sel) : sel; if (!el) throw new Error('Nothing to click: ' + sel); el.click(); },
    set(sel, value, event = 'change') {
      const el = typeof sel === 'string' ? w.document.querySelector(sel) : sel;
      if (!el) throw new Error('No field: ' + sel);
      if (el.type === 'checkbox') el.checked = value; else el.value = value;
      el.dispatchEvent(new w.Event(event, { bubbles: true }));
    },
    submit(sel) { w.document.querySelector(sel).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); },
    // One sync to the end, plus any it set off.
    async sync() { w.eval('clearTimeout(Sync.timer)'); await w.eval('Sync.run()'); await sleep(5); return w.eval('Sync'); },
    // Lets the background jobs (covers, genres, first years) finish.
    async idle() { await until(() => !w.eval('Covers.running || GenreFill.running || FirstYears.running'), 'background jobs', 5000); await sleep(10); },
    close() { w.close(); },
  };
  if (wait) { await until(() => w.eval('loaded'), 'app to load'); await sleep(10); await dev.idle(); }
  return dev;
}

export const syncCfg = { 'bookcollection.sync': { owner: OWNER, repo: REPO, token: TOKEN } };
