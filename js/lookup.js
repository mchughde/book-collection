'use strict';
// Book details from Open Library and Apple Books: search, editions, genres.

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

// Apple's public store search, Australian store (chosen 29 Oct 2026): no key, open to
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

// Apple's shop categories (or Open Library's subjects) translated into the genre names her
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
