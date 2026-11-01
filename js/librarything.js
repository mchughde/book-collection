'use strict';
// Reading a LibraryThing export, then finding covers and first-publication years.

/* ---------- LibraryThing import ---------- */

// LibraryThing's JSON export: an object of books keyed by id. Hers (29 Oct 2026) has 267 books
// entered 2012–13, with no read status, dates or reviews, so books come in as Read, year unknown
// (her choice). The export has no covers; Covers.run() looks them up afterwards.
const TAG_FIXES = { autobigraphy: ['autobiography'], psycholgy: ['psychology'], 'London. United Kingdom': ['London', 'United Kingdom'] };
const plainText = s => { const t = document.createElement('textarea'); t.innerHTML = String(s || ''); return t.value.trim(); };

// Series come with their translations ("Ania z Zielonego Wzgórza", "La saga d'Anne", "Anne of
// Green Gables"). Prefer a name with no accents or foreign words, then the most frequent, then the
// most English-looking, then the first. "{Schama}" is LibraryThing telling series apart. Tested
// on her export (29 Oct 2026): every multi-name series came out in English.
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
