// Book Collection check suite. Runs the real app.js in a pretend browser, with a pretend GitHub
// and canned Open Library / Apple answers, and checks the main things the app does.
//   node tests/check.mjs            (from the project folder; first time: cd tests && npm install)
//   APP=some/other/app.js node tests/check.mjs   checks a different copy of app.js
// Never touches the real data repo or the internet.
let H;
try { H = await import('./harness.mjs'); } catch (e) {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  console.log('The test tools aren’t installed yet. Run this once, then try again:\n  cd tests && npm install');
  process.exit(2);
}
const { openDevice, FakeGitHub, until, sleep, syncCfg, TOKEN, OWNER, REPO, appFile } = H;

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
class Fail extends Error {}
const ok = (cond, msg) => { if (!cond) throw new Fail(msg); };
const eq = (got, want, msg) => ok(JSON.stringify(got) === JSON.stringify(want), `${msg}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
const thisYear = String(new Date().getFullYear());

// Devices opened during a check, so their errors are counted and they're closed afterwards.
let opened = [];
const open = async opts => { const d = await openDevice(opts); opened.push(d); return d; };

// Puts books straight into a device's collection (for checks that aren't about adding).
function seed(d, list, extra = {}) {
  const db = d.db;
  const made = list.map(f => { const b = d.js('newBook')(f); db.books[b.id] = b; return b; });
  Object.assign(db.shelves, extra.shelves || {});
  d.js('persist()');
  return made;
}
async function chooseFile(d, sel, text) {
  const input = d.$(sel);
  Object.defineProperty(input, 'files', { value: [{ name: 'file.json', text: async () => text }], configurable: true });
  input.dispatchEvent(new d.window.Event('change'));
}
const enter = (d, el) => el.dispatchEvent(new d.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

/* ---------- adding books ---------- */

check('Adding a book by search fills in title, author, edition, cover, genres, status, year read, and place', async () => {
  const d = await open();
  await d.go('#/add');
  d.$('#aq').value = 'remains of the day';
  d.submit('#searchForm');
  await until(() => d.$('[data-pick="0"]'), 'search results');
  ok(d.text('#results').includes('The Remains of the Day'), 'the book is in the search results');
  d.click('[data-pick="0"]');
  await until(() => d.$('#a-edition') && !d.$('#a-edition').disabled, 'editions to load');
  await until(() => d.$$('#a-genres [data-ungenre]').length, 'genre guess');
  eq(d.$$('#a-genres [data-ungenre]').map(b => b.dataset.ungenre), ['Fiction'], 'genre guessed from Apple');
  ok(d.$('#a-edition').selectedOptions[0].textContent.includes('Faber'), 'best edition (Faber, not the reprint) is preselected');
  d.set('#a-status', 'read');
  ok(!d.$('#a-yearField').hidden, '“Year read” shows when status is Read');
  d.$('#a-year').value = '2019';
  d.set('#a-source', 'own-physical');
  d.set('#a-location', 'study-a');
  d.set('#a-genres select', '+new');
  const typed = d.$('#a-genres input');
  ok(!typed.hidden, 'New genre… shows a box to type in');
  typed.value = 'Classics';
  enter(d, typed);
  d.click('#a-save');
  await until(() => d.window.location.hash.startsWith('#/book/'), 'the new book’s page');
  const b = d.book('The Remains of the Day');
  ok(b, 'book saved');
  eq(b.authors, ['Kazuo Ishiguro'], 'authors');
  eq(b.status, 'read', 'status');
  eq(b.reads.map(r => r.year), ['2019'], 'one read, in 2019');
  eq(b.source, 'own-physical', 'how I have it');
  eq(b.location, 'study-a', 'where it is');
  eq(b.isbn, '9780571258246', 'ISBN from the chosen edition');
  eq(b.publisher, 'Faber & Faber', 'publisher from the chosen edition');
  eq(b.genres, ['Fiction', 'Classics'], 'genres');
  ok(b.coverUrl.includes('mzstatic.com') && b.coverUrl.includes('600x600'), 'Apple’s large cover is used');
  eq(d.window.location.hash, '#/book/' + b.id, 'opens the book');
  eq(JSON.parse(d.window.localStorage.getItem('bookcollection.addPlace')), { print: 'study-a' }, 'place remembered for the next print book');
});

check('Adding a past read with no year keeps it as “Year unknown”; a bad year is refused', async () => {
  const d = await open();
  await d.go('#/add');
  d.click('#manual');
  d.$('#m-title').value = 'Pretend Book';
  d.$('#m-authors').value = 'Ann Author, Bob Writer';
  d.set('#a-status', 'read');
  d.set('#a-source', 'own-ebook');
  d.click('#a-save');
  await until(() => d.book('Pretend Book'), 'book saved');
  const b = d.book('Pretend Book');
  eq(b.authors, ['Ann Author', 'Bob Writer'], 'authors split at the comma');
  eq(b.reads.length, 1, 'one read');
  eq(d.js('readYear')(b.reads[0]), '', 'its year is unknown');
  await d.go('#/read');
  ok(d.text('#grid').includes('Year unknown') && d.text('#grid').includes('Pretend Book'), 'Read page lists it under Year unknown');

  await d.go('#/add');
  d.click('#manual');
  d.$('#m-title').value = 'Another';
  d.set('#a-status', 'read');
  d.$('#a-year').value = '19';
  d.click('#a-save');
  await sleep(10);
  ok(!d.book('Another'), 'not saved with a year like “19”');
  ok(d.toast().includes('Type a year like 2019'), 'explains what to type');
  d.$('#a-year').value = '2020';
  d.click('#a-save');
  await until(() => d.book('Another'), 'saved with 2020');
  eq(d.book('Another').reads[0].year, '2020', 'year read');
});

check('Wishlist → “I’ve got it” moves a book into My library', async () => {
  const d = await open();
  await d.go('#/add?to=wishlist');
  d.click('#manual');
  eq(d.$('#a-status').value, 'wishlist', 'status starts as Wishlist');
  ok(d.$('#a-locField').hidden, 'no “Where it is” for a wishlist book');
  d.$('#m-title').value = 'Wanted Book';
  d.click('#a-save');
  await until(() => d.book('Wanted Book'), 'book saved');
  const b = d.book('Wanted Book');
  eq([b.status, b.source, b.location], ['wishlist', '', ''], 'wishlist book');
  await d.go('#/wishlist');
  ok(d.text('#grid').includes('Wanted Book'), 'on the Wishlist page');
  await d.go('#/book/' + b.id);
  d.click('[data-act="got"]');
  const after = d.db.books[b.id];
  eq([after.status, after.source], ['to-read', 'own-physical'], 'now owned, to read');
  await d.go('#/library');
  ok(d.text('#grid').includes('Wanted Book'), 'in My library');
  await d.go('#/wishlist');
  ok(!d.text('#view').includes('Wanted Book'), 'gone from the Wishlist');
});

/* ---------- the book page ---------- */

check('Start reading, Finished, and Read again keep the reading history right', async () => {
  const d = await open();
  const [b] = seed(d, [{ title: 'Readable', authors: ['A Writer'], source: 'own-physical' }]);
  await d.go('#/book/' + b.id);
  d.click('[data-act="start"]');
  let x = d.db.books[b.id];
  eq(x.status, 'reading', 'status Reading');
  eq(x.reads.length, 1, 'a read is started');
  ok(x.reads[0].started && !x.reads[0].finished, 'started today, not finished');
  d.click('[data-act="finish"]');
  x = d.db.books[b.id];
  eq(x.status, 'read', 'status Read');
  eq(x.reads[0].year, thisYear, 'finished this year');
  await d.go('#/read');
  ok(d.text('#grid').includes(thisYear) && d.text('#grid').includes('Readable'), 'Read page lists it under this year');
  await d.go('#/book/' + b.id);
  d.click('[data-act="start"]');
  x = d.db.books[b.id];
  eq(x.reads.length, 2, 'Read again adds a second read');
  eq(x.reads[0].year, thisYear, 'the first read is kept');
});

check('Ratings go in half stars, and tapping the same star again clears it', async () => {
  const d = await open();
  const [b] = seed(d, [{ title: 'Rated', authors: ['R'] }]);
  await d.go('#/book/' + b.id);
  d.click('[data-star="3.5"]');
  eq(d.db.books[b.id].rating, 3.5, 'left half of the 4th star = 3½');
  const fills = d.$$('#stars .star').map(s => s.style.getPropertyValue('--fill'));
  eq(fills, ['100%', '100%', '100%', '50%', '0%'], 'stars drawn as 3½');
  ok(d.text('#stars + span').includes('3½ of 5'), 'says “3½ of 5”');
  d.click('[data-star="3.5"]');
  eq(d.db.books[b.id].rating, 0, 'same star again clears the rating');
  d.click('[data-star="5"]');
  eq(d.db.books[b.id].rating, 5, 'five stars');
});

check('Genre picker: pick an existing genre, type a new one (matching capitals), remove one', async () => {
  const d = await open();
  const [, b] = seed(d, [{ title: 'Has genres', genres: ['Travel', 'History'] }, { title: 'No genres' }]);
  await d.go('#/book/' + b.id);
  const options = d.$$('#d-genres select option').map(o => o.textContent);
  ok(options.includes('History') && options.includes('Travel') && options.includes('New genre…'), 'menu lists genres already used, and New genre…');
  d.set('#d-genres select', 'History');
  eq(d.db.books[b.id].genres, ['History'], 'picked History');
  d.set('#d-genres select', '+new');
  const input = d.$('#d-genres input');
  input.value = 'travel';
  enter(d, input);
  eq(d.db.books[b.id].genres, ['History', 'Travel'], '“travel” takes the existing spelling “Travel”');
  d.set('#d-genres select', '+new');
  d.$('#d-genres input').value = 'Poetry, Drama';
  enter(d, d.$('#d-genres input'));
  eq(d.db.books[b.id].genres, ['History', 'Travel', 'Poetry', 'Drama'], 'several typed with commas');
  d.click('[data-ungenre="History"]');
  eq(d.db.books[b.id].genres, ['Travel', 'Poetry', 'Drama'], '× removes a genre');
  await d.go('#/genre/Poetry');
  ok(d.text('#grid').includes('No genres'), 'genre page lists the book');
});

check('Series: set on the book page, listed on Series, shown in number order', async () => {
  const d = await open();
  const [one, two, loose] = seed(d, [{ title: 'Anne of Avonlea' }, { title: 'Anne of Green Gables' }, { title: 'Anne of the Island' }]);
  await d.go('#/book/' + one.id);
  d.set('#d-series', 'Anne of Green Gables');
  d.set('#d-seriesNo', '2');
  await d.go('#/book/' + two.id);
  d.set('#d-series', 'Anne of Green Gables');
  d.set('#d-seriesNo', '1');
  await d.go('#/book/' + loose.id);
  d.set('#d-series', 'Anne of Green Gables');
  ok(d.text('#nav').includes('Series'), 'Series appears in the menu');
  await d.go('#/series');
  ok(d.text('#view').includes('Anne of Green Gables 3 books'), 'Series page lists it with 3 books');
  await d.go('#/series/' + encodeURIComponent('Anne of Green Gables'));
  const order = d.$$('#view .grid a[href^="#/book/"]').map(a => d.db.books[a.getAttribute('href').split('/')[2]].title);
  eq([...new Set(order)], ['Anne of Green Gables', 'Anne of Avonlea', 'Anne of the Island'], 'in number order, unnumbered last');
  ok(d.text('#view').includes('Set each book’s number'), 'suggests numbering the unnumbered one');
});

check('Shelves: make one, put a book on it, rename it, delete it (the book stays)', async () => {
  const d = await open();
  const [b] = seed(d, [{ title: 'Shelved', source: 'own-physical' }]);
  d.window.__prompts.push('Favourites');
  d.click('#newShelf');
  await until(() => d.window.location.hash.startsWith('#/shelf/'), 'the new shelf');
  const id = d.window.location.hash.split('/')[2];
  eq(d.db.shelves[id].name, 'Favourites', 'shelf made');
  await d.go('#/book/' + b.id);
  d.set(`[data-shelf="${id}"]`, true);
  eq(d.db.books[b.id].shelves, [id], 'book is on the shelf');
  await d.go('#/shelf/' + id);
  ok(d.text('#grid').includes('Shelved'), 'shelf page lists the book');
  ok(d.text('#nav').includes('Favourites 1'), 'menu shows the shelf with 1 book');
  d.window.__prompts.push('Best ever');
  d.click('#renameShelf');
  eq(d.db.shelves[id].name, 'Best ever', 'renamed');
  d.click('#deleteShelf');
  await sleep(15);
  ok(d.db.shelves[id].deleted, 'shelf deleted (kept as a tombstone so it syncs)');
  eq(d.db.books[b.id].shelves, [], 'book taken off the deleted shelf');
  ok(d.book('Shelved'), 'book still in the collection');
});

check('Deleting a book keeps a tombstone (so the deletion syncs) and hides it everywhere', async () => {
  const d = await open();
  const [b] = seed(d, [{ title: 'Doomed', source: 'own-physical' }]);
  await d.go('#/book/' + b.id);
  d.click('[data-act="delete"]');
  await sleep(15);
  ok(d.db.books[b.id] && d.db.books[b.id].deleted === true, 'record kept with deleted: true');
  await d.go('#/all');
  ok(!d.text('#view').includes('Doomed'), 'not listed in All books');
});

/* ---------- stocktake ---------- */

check('Stocktake: typed ISBNs find books (same ISBN, ISBN-10, other edition), wishlist books move to owned, unknown ones go on the new list', async () => {
  const d = await open();
  const [rem, anne, normal, bryson] = seed(d, [
    { title: 'The Remains of the Day', authors: ['Kazuo Ishiguro'], isbn: '9780571258246', source: 'own-physical' },
    { title: 'Anne of Green Gables', authors: ['L. M. Montgomery'], isbn: '0553213131', source: 'own-physical' },
    { title: 'Normal People', authors: ['Sally Rooney'], isbn: '9780571334650', status: 'wishlist' },
    { title: 'A Short History of Nearly Everything', authors: ['Bill Bryson'], workKey: '/works/OL4W', source: 'own-physical' },
    { title: 'Never scanned', authors: ['Nobody'], source: 'own-physical' },
  ]);
  await d.go('#/stocktake');
  d.set('#stPlace', 'lounge');
  const scan = async isbn => { d.$('#stIsbn').value = isbn; d.submit('#stIsbnForm'); await sleep(25); };
  await scan('978-0-571-25824-6');
  eq([d.db.books[rem.id].location, !!d.db.books[rem.id].checkedAt], ['lounge', true], 'same ISBN: placed in the Lounge and ticked');
  d.set('#stPlace', 'study-b');
  await scan('0553213131');
  eq(d.db.books[anne.id].location, 'study-b', 'ISBN-10 on the book matches');
  await scan('9780571334650');
  eq([d.db.books[normal.id].status, d.db.books[normal.id].source], ['to-read', 'own-physical'], 'wishlist book found on a shelf is now owned');
  ok(d.toast().includes('moved from your wishlist'), 'and says so');
  await scan('9780552997041');
  eq([d.db.books[bryson.id].location, d.db.books[bryson.id].isbn], ['study-b', '9780552997041'], 'another edition of a book here matches by work, and fills the missing ISBN');
  await scan('9780000000002');
  ok(d.text('#view').includes('New books found (1)'), 'unknown ISBN goes on the new-books list');
  eq(JSON.parse(d.window.localStorage.getItem('bookcollection.stockNew')).map(f => f.isbn), ['9780000000002'], 'kept on this device');
  await scan('12345');
  ok(d.toast().includes('doesn’t look like an ISBN'), 'nonsense is refused with an explanation');
  await d.go('#/stocktake/missing');
  ok(d.text('#grid').includes('Never scanned') && !d.text('#grid').includes('Remains'), 'Not found yet lists only unscanned printed books');
});

/* ---------- LibraryThing import ---------- */

const LT_EXPORT = JSON.stringify({
  1001: { books_id: '1001', title: 'Anne of Green Gables', authors: [{ fl: 'L. M. Montgomery' }], isbn: { 0: '0553213131' },
    date: '1982', pages: '309 ', publication: 'Bantam (1982), Mass Market Paperback', tags: ['classics', 'psycholgy'], rating: 3.5,
    genre: ['Fiction and Literature', 'General Fiction'], series: ['Ania z Zielonego Wzgórza', 'Anne of Green Gables', 'La saga d\'Anne', 'Anne of Green Gables'],
    entrydate: '2012-10-03', format: [{ text: 'Paperback' }] },
  1002: { books_id: '1002', title: 'Les Mis&eacute;rables', authors: [{ fl: 'Victor Hugo' }, { fl: 'Norman Denny', role: 'Translator' }],
    isbn: { 2: '9780140444308' }, format: [{ text: 'Ebook' }], tags: ['London. United Kingdom', 'autobigraphy'], entrydate: '2013-01-05',
    publication: 'Penguin Classics (1982)' },
  1003: { books_id: '1003', title: 'Normal People', authors: [{ fl: 'Sally Rooney' }] },
});

check('LibraryThing import reads the export: names, ISBN, tags fixed, series in English, rating, ebook, translator', async () => {
  const d = await open();
  seed(d, [{ title: 'Normal People', authors: ['Sally Rooney'] }]);
  const { fresh, skipped } = d.js('readLibraryThing')(LT_EXPORT);
  eq([fresh.length, skipped.map(b => b.title)], [2, ['Normal People']], '2 new, the one already here skipped');
  const anne = fresh.find(b => b.ltId === '1001'), les = fresh.find(b => b.ltId === '1002');
  eq(anne.isbn, '9780553213133', 'ISBN-10 turned into ISBN-13');
  eq([anne.year, anne.pages, anne.publisher, anne.rating], ['1982', 309, 'Bantam', 3.5], 'year, pages, publisher, half-star rating');
  eq(anne.tags, ['classics', 'psychology'], 'misspelt tag fixed');
  eq(anne.genres, ['Fiction and Literature'], '“General …” genres dropped');
  eq(anne.series, 'Anne of Green Gables', 'series name picked in English');
  eq([anne.status, anne.reads.length, d.js('readYear')(anne.reads[0]), anne.source], ['read', 1, '', 'own-physical'], 'Read, year unknown, owned in print');
  eq(anne.added, '2012-10-03T12:00:00.000Z', 'entry date kept as Added');
  ok(anne.needsCover, 'marked for a cover lookup');
  eq(les.title, 'Les Misérables', 'HTML entities decoded');
  eq(les.authors, ['Victor Hugo'], 'translator isn’t an author');
  eq(les.notes.map(n => n.text), ['Translator: Norman Denny'], 'translator kept in a note');
  eq(les.source, 'own-ebook', 'ebook from the format');
  eq(les.tags, ['London', 'United Kingdom', 'autobiography'], 'tag split and fixed');
  eq(les.publisher, 'Penguin Classics', 'publisher before the bracket');
  let msg = '';
  try { d.js('readLibraryThing')('{"x": 1}'); } catch (e) { msg = e.message; }
  ok(msg.includes('isn’t a LibraryThing JSON export'), 'a wrong file is refused in plain words');
  msg = '';
  try { d.js('readLibraryThing')('not json'); } catch (e) { msg = e.message; }
  ok(msg.includes('isn’t a LibraryThing JSON export'), 'a broken file is refused in plain words');
});

check('LibraryThing import from Settings: preview, import, covers and first-publication years found, re-import skips', async () => {
  const d = await open();
  await d.go('#/settings');
  await chooseFile(d, '#ltFile', LT_EXPORT);
  await until(() => d.$('#ltGo'), 'import preview');
  ok(d.text('#ltPreview').includes('3 books in the file') && d.text('#ltPreview').includes('3 new'), 'preview counts the books');
  d.click('#ltGo');
  await sleep(20);
  await d.idle();
  eq(d.books().length, 3, '3 books imported');
  const anne = d.book('Anne of Green Gables');
  eq(anne.coverUrl, 'https://covers.openlibrary.org/b/id/331-M.jpg', 'cover found through Open Library');
  eq([anne.workKey, anne.authorKeys], ['/works/OL3W', ['OL3A']], 'work and author links filled in');
  eq([anne.year, anne.editionYear], [1908, '1982'], 'first-publication year swapped in, edition year kept');
  ok(!anne.needsCover && !d.book('Les Misérables').needsCover, 'cover lookups finished');
  ok(d.book('Les Misérables').coverUrl.includes('/b/isbn/9780140444308'), 'no cover found: falls back to the ISBN cover address');
  await d.go('#/settings');
  await chooseFile(d, '#ltFile', LT_EXPORT);
  await until(() => d.$('#ltCancel'), 'second preview');
  ok(!d.$('#ltGo') && d.text('#ltPreview').includes('0 new'), 'importing the same file again adds nothing');
});

/* ---------- backup ---------- */

check('Backup: “Save a backup file” holds the whole collection; loading one merges (newer wins, nothing deleted)', async () => {
  const d = await open();
  const [x, y] = seed(d, [{ title: 'Kept X', updatedAt: '2026-06-01T00:00:00.000Z' }, { title: 'Kept Y', updatedAt: '2026-06-01T00:00:00.000Z' }]);
  await d.go('#/settings');
  d.click('#export');
  const files = d.window.__downloads || [];
  eq(files.map(f => f.name), [`book-collection-data-${d.js('today()')}.json`], 'one dated file saved');
  const saved = JSON.parse(await d.window.__blobs[files[0].href].text());
  ok(d.js('canon')(saved) === d.js('canon')(d.db), 'the file matches the collection exactly');

  const backup = JSON.parse(JSON.stringify(saved));
  backup.books[x.id].title = 'X from backup (newer)'; backup.books[x.id].updatedAt = '2026-07-01T00:00:00.000Z';
  backup.books[y.id].title = 'Y from backup (older)'; backup.books[y.id].updatedAt = '2026-05-01T00:00:00.000Z';
  const z = d.js('newBook')({ title: 'Only in backup' });
  backup.books[z.id] = z;
  await chooseFile(d, '#import', JSON.stringify(backup));
  await until(() => d.toast().startsWith('Backup loaded'), 'backup to load');
  eq(d.toast(), 'Backup loaded: 1 new books', 'says how many are new');
  eq(d.db.books[x.id].title, 'X from backup (newer)', 'newer copy in the backup wins');
  eq(d.db.books[y.id].title, 'Kept Y', 'older copy in the backup loses');
  ok(d.book('Only in backup'), 'book only in the backup is added');
  await d.go('#/settings');
  await chooseFile(d, '#import', '{"hello": 1}');
  await until(() => d.toast().includes('isn’t a Book Collection backup'), 'wrong file message');
});

/* ---------- sync ---------- */

check('Merge rules: the newer change wins, deletions win only when newer, nothing on one side is lost', async () => {
  const d = await open();
  const mergeDb = d.js('mergeDb');
  const at = day => `2026-01-0${day}T00:00:00.000Z`;
  const mk = books => ({ version: 1, books, shelves: {}, authors: {}, dismissed: {} });
  const a = mk({ x: { id: 'x', title: 'new', updatedAt: at(2) }, d1: { id: 'd1', deleted: true, updatedAt: at(3) }, e1: { id: 'e1', deleted: true, updatedAt: at(1) }, onlyA: { id: 'onlyA', updatedAt: at(1) } });
  const b = mk({ x: { id: 'x', title: 'old', updatedAt: at(1) }, d1: { id: 'd1', title: 'edit', updatedAt: at(2) }, e1: { id: 'e1', title: 'edited after', updatedAt: at(2) }, onlyB: { id: 'onlyB', updatedAt: at(1) } });
  for (const [m, label] of [[mergeDb(a, b), 'this way round'], [mergeDb(b, a), 'the other way round']]) {
    eq(m.books.x.title, 'new', `newer edit wins (${label})`);
    eq(m.books.d1.deleted, true, `newer deletion wins (${label})`);
    eq(m.books.e1.title, 'edited after', `edit made after a deletion wins (${label})`);
    ok(m.books.onlyA && m.books.onlyB, `books on only one side are kept (${label})`);
  }
  const s = mergeDb({ ...mk({}), shelves: { s: { name: 'A', updatedAt: at(1) } } }, { ...mk({}), shelves: { s: { name: 'B', updatedAt: at(2) } }, authors: { k: { name: 'Au', updatedAt: at(1) } } });
  eq([s.shelves.s.name, s.authors.k.name], ['B', 'Au'], 'shelves and followed authors merge the same way');
});

check('Sync through a pretend GitHub: two devices share books, edits made apart both survive, deletions travel', async () => {
  const gh = new FakeGitHub();
  const mac = await open({ name: 'Mac', github: gh, storage: syncCfg });
  const phone = await open({ name: 'iPhone', ua: 'iPhone', github: gh, storage: syncCfg });
  await mac.sync();
  eq(mac.js('Sync.state'), 'ok', 'Mac connects');
  const [x] = seed(mac, [{ title: 'Les Misérables — test 📚', authors: ['Victor Hugo'] }]);
  await mac.sync();
  ok(gh.data().books[x.id], 'the book reaches GitHub');
  await phone.sync();
  ok(phone.book('Les Misérables — test 📚'), 'iPhone receives it, accents and emoji intact');

  await sleep(3);
  const px = phone.db.books[x.id]; px.rating = 4.5; phone.js('saveBook')(px);
  seed(mac, [{ title: 'Second book' }]);
  await mac.sync(); await phone.sync(); await mac.sync();
  eq(mac.db.books[x.id].rating, 4.5, 'Mac gets the rating made on the iPhone');
  ok(phone.book('Second book'), 'iPhone gets the book added on the Mac meanwhile');
  ok(mac.js('canon')(mac.db) === phone.js('canon')(phone.db), 'both devices end with identical data');

  const del = mac.db.books[x.id]; del.deleted = true; mac.js('saveBook')(del);
  await mac.sync(); await phone.sync();
  ok(!phone.book('Les Misérables — test 📚'), 'a deletion on the Mac reaches the iPhone');
  ok(gh.data().books[x.id].deleted, 'GitHub keeps the tombstone');
  ok(gh.puts.every(p => p === 'library.json'), 'only library.json written');
});

check('Sync: two devices saving at once both keep their changes (GitHub refuses one, it retries)', async () => {
  const gh = new FakeGitHub();
  const a = await open({ name: 'Mac', github: gh, storage: syncCfg });
  const b = await open({ name: 'iPad', ua: 'iPad', github: gh, storage: syncCfg });
  await a.sync(); await b.sync();
  seed(a, [{ title: 'From the Mac' }]);
  seed(b, [{ title: 'From the iPad' }]);
  gh.conflictOnce = true;
  await Promise.all([a.js('Sync.run()'), b.js('Sync.run()')]);
  await a.sync(); await b.sync();
  for (const d of [a, b]) ok(d.book('From the Mac') && d.book('From the iPad'), `${d.name} has both books`);
  eq(a.js('Sync.state'), 'ok', 'no sync problem shown');
});

check('Sync: big data files (GitHub sends no content over 1 MB) are fetched raw', async () => {
  const gh = new FakeGitHub();
  const a = await open({ name: 'Mac', github: gh, storage: syncCfg });
  seed(a, [{ title: 'In a big file' }]);
  await a.sync();
  gh.bigFile = true;
  const b = await open({ name: 'iPhone', ua: 'iPhone', github: gh, storage: syncCfg });
  await b.sync();
  ok(b.book('In a big file'), 'book arrives through the raw download');
  ok(b.requests.some(r => r.url.endsWith('/contents/library.json')) && b.js('Sync.state') === 'ok', 'sync ok');
});

check('Sync: a wrong access key and a public repo are explained in plain words', async () => {
  const gh = new FakeGitHub();
  const bad = await open({ github: gh, storage: { 'bookcollection.sync': { owner: OWNER, repo: REPO, token: 'github_pat_wrong' } } });
  await bad.sync();
  eq(bad.js('Sync.state'), 'error', 'wrong key: sync problem');
  ok(/access key/.test(bad.js('Sync.message')), 'message mentions the access key: ' + bad.js('Sync.message'));
  await bad.go('#/settings');
  ok(bad.text('#view').includes('access key'), 'Settings shows the message');

  const pub = new FakeGitHub({ isPrivate: false });
  const d = await open({ github: pub });
  await d.go('#/settings');
  d.$('#s-owner').value = OWNER; d.$('#s-repo').value = REPO; d.$('#s-token').value = TOKEN;
  d.click('#connect');
  await until(() => d.text('#connectMsg').includes('public'), 'public repo message');
  ok(!d.window.localStorage.getItem('bookcollection.sync'), 'a public repo is not used');
  pub.isPrivate = true;
  d.click('#connect');
  await until(() => d.window.localStorage.getItem('bookcollection.sync'), 'connected');
  await until(() => d.js('Sync.state') === 'ok', 'first sync');
});

check('Cover photos upload before the data, and another device fetches the photo', async () => {
  const gh = new FakeGitHub();
  const a = await open({ name: 'iPhone', ua: 'iPhone', github: gh, storage: syncCfg });
  const [b] = seed(a, [{ title: 'Photographed', coverUrl: 'https://covers.openlibrary.org/b/id/1-M.jpg' }]);
  await a.sync();
  gh.puts.length = 0;
  await a.js('Photos').save(a.db.books[b.id], new a.window.Blob(['pretend jpeg'], { type: 'image/jpeg' }));
  await a.sync();
  const path = a.db.books[b.id].coverPhoto;
  ok(path && path.startsWith(`covers/${b.id}-`), 'book names its photo file');
  eq(gh.puts, [path, 'library.json'], 'photo uploaded first, then the data');
  eq(gh.files.get(path).text, 'pretend jpeg', 'photo stored in the data repo');
  const mac = await open({ name: 'Mac', github: gh, storage: syncCfg });
  await mac.sync();
  await mac.go('#/book/' + b.id);
  await until(() => mac.$('img[data-photo]')?.src.startsWith('blob:'), 'photo to download');
  await a.go('#/book/' + b.id);
  a.click('#unphotoCover');
  ok(!a.db.books[b.id].coverPhoto, '“Remove photo” brings the old cover back');
});

/* ---------- storage ---------- */

check('A collection kept in localStorage (before 29 Oct 2026) moves into IndexedDB on first open', async () => {
  const old = { version: 1, books: { k1: { id: 'k1', title: 'Old storage book', authors: [], updatedAt: '2026-10-01T00:00:00.000Z' } }, shelves: {}, authors: {}, dismissed: {} };
  const d = await open({ storage: { 'bookcollection.data': old } });
  ok(d.book('Old storage book'), 'book is there');
  ok(d.js('Disk.ok'), 'IndexedDB in use');
  ok(!d.window.localStorage.getItem('bookcollection.data'), 'old localStorage copy removed');
  const stored = await d.js('Disk.get("data")');
  ok(stored.books.k1, 'IndexedDB holds the book');
});

/* ---------- every page ---------- */

check('Every page in the menu draws without errors (with a varied collection)', async () => {
  const d = await open();
  const shelf = { id: 'sh1', name: 'Paris', updatedAt: '2026-10-01T00:00:00.000Z' };
  const list = seed(d, [
    { title: 'Reading Now', authors: ['A'], status: 'reading', source: 'own-ebook', location: 'kindle', pages: 300, progress: '120', reads: [{ id: 'r1', started: '2026-10-01', finished: '', year: '', source: 'own-ebook' }] },
    { title: 'Read in 2024', authors: ['B'], status: 'read', source: 'own-physical', location: 'lounge', rating: 4.5, genres: ['Fiction', 'Mystery'], year: 1950, reads: [{ id: 'r2', started: '', finished: '2024-03-02', year: '2024', source: 'own-physical' }], shelves: ['sh1'], tags: ['paris'], series: 'Maigret', seriesNo: '3' },
    { title: 'Read Unknown', authors: ['C'], status: 'read', source: 'library', genres: ['Nonfiction', 'History'], year: 1850, reads: [{ id: 'r3', started: '', finished: '', year: '', source: 'library' }] },
    { title: 'Did Not Finish', authors: ['D'], status: 'dnf', source: 'prime-ebook', reads: [{ id: 'r4', started: '2025-01-01', finished: '2025-02-01', year: '2025', dnf: true, source: 'prime-ebook' }] },
    { title: 'Wished For', authors: ['E'], status: 'wishlist' },
    { title: 'Elsewhere', authors: ['F'], source: 'own-physical', location: 'other', locationOther: 'Garage box', checkedAt: '2026-10-02T00:00:00.000Z', quotes: [{ id: 'q', text: 'A quote', page: '3', date: '2026-10-01T00:00:00.000Z' }], notes: [{ id: 'n', text: 'A note', page: '', date: '2026-10-01T00:00:00.000Z' }], workKey: '/works/OL1W' },
  ], { shelves: { sh1: shelf } });
  d.db.authors.OL9A = { key: 'OL9A', name: 'Followed Author', updatedAt: '2026-10-01T00:00:00.000Z' };
  const routes = [
    ['#/library', 'My library'], ['#/reading', 'Reading'], ['#/read', 'Read'], ['#/wishlist', 'Wishlist'], ['#/all', 'All books'],
    ['#/series', 'Series'], ['#/series/Maigret', 'Maigret'], ['#/genre/Mystery', 'Mystery'], ['#/shelf/sh1', 'Paris'],
    ['#/stocktake', 'Stocktake'], ['#/stocktake/missing', 'Not found yet'], ['#/discover', 'New books'], ['#/stats', 'Reading stats'],
    ['#/settings', 'Settings & sync'], ['#/add', 'Add a book'], ['#/add?to=wishlist', 'Add a book'],
    ...list.map(b => ['#/book/' + b.id, b.title]), ['#/book/no-such-book', 'Book'],
  ];
  for (const [hash, title] of routes) {
    await d.go(hash);
    await sleep(10);
    eq(d.text('#pageTitle'), title, `${hash} title`);
    ok(d.$('#view').children.length > 0, `${hash} shows something`);
    ok(!d.errors.length, `${hash} drew without errors: ${d.errors.join('; ')}`);
  }
  await d.go('#/reading');
  ok(d.text('#view').includes('Reading Now'), 'Reading lists the book being read');
  await d.go('#/stats');
  ok(d.text('#view').includes('Mystery') && d.text('#view').includes('2024'), 'stats show genres and years');
  await d.go('#/nonsense');
  await until(() => d.window.location.hash === '#/library', 'unknown page goes to the library');
  await d.go('#/shelf/missing');
  await until(() => d.window.location.hash === '#/library', 'missing shelf goes to the library');
  ok(d.text('#nav').includes('My library'), 'menu drawn');
});

/* ---------- run ---------- */

const only = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const todo = only ? checks.filter(c => only.test(c.name)) : checks;
console.log(`Book Collection checks — ${appFile}\n`);
let passed = 0;
const failed = [];
const t0 = Date.now();
for (const c of todo) {
  opened = [];
  let why = '';
  try {
    await Promise.race([c.fn(), sleep(20000).then(() => { throw new Fail('took longer than 20 seconds'); })]);
    const errs = opened.flatMap(d => d.errors);
    if (errs.length) why = 'the app reported errors:\n        ' + errs.join('\n        ');
  } catch (e) {
    why = e instanceof Fail ? e.message : (e.stack || String(e)).split('\n').slice(0, 4).join('\n        ');
  }
  opened.forEach(d => d.close());
  if (why) { failed.push(c.name); console.log(`  ✗ ${c.name}\n      ${why}`); }
  else { passed++; console.log(`  ✓ ${c.name}`); }
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(failed.length
  ? `\nFAILED: ${failed.length} of ${todo.length} checks failed (${secs} s). Don’t put this version live until they pass.`
  : `\nALL PASSED: ${passed} of ${todo.length} checks (${secs} s).`);
process.exitCode = failed.length ? 1 : 0;
setTimeout(() => process.exit(), 50);
