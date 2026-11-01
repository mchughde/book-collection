'use strict';
// Stocktake.

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
  note(text, kind, id) { this.log.unshift({ text, kind, id }); this.log.length = Math.min(this.log.length, 40); return text; },
  found(id) {
    const b = db.books[id];
    Object.assign(b, this.where(), { checkedAt: now() });
    let extra = '';
    if (b.status === 'wishlist') { b.status = 'to-read'; b.source = 'own-physical'; extra = ' (moved from your wishlist)'; }
    saveBook(b);
    return this.note(`✓ ${b.title}${extra}`, 'ok', id);
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

function wirePhotoButtons(box, after) {
  box.querySelectorAll('[data-photo-book]').forEach(btn => btn.onclick = () => PhotoEditor.open(db.books[btn.dataset.photoBook], after));
}

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
      ${Stock.log.length ? `<ul class="stock-log">${Stock.log.slice(0, 12).map(l => {
        // A book found shows its cover, so a missing or wrong one can be photographed there and then.
        const b = l.id && db.books[l.id];
        return b ? `<li class="${l.kind} with-cover">${coverHtml(b)}<span>${esc(l.text)}</span><button class="btn small" data-photo-book="${b.id}">${b.coverPhoto ? 'Replace photo' : 'Photo cover'}</button></li>`
          : `<li class="${l.kind}">${esc(l.text)}</li>`;
      }).join('')}</ul>` : ''}
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
        <div class="row" style="margin:0;flex-wrap:nowrap"><button class="btn small primary" data-here="${b.id}">It’s here</button><button class="btn small" data-photo-book="${b.id}">Photo cover</button></div></div>`).join('')}</div>`
      : q.length >= 2 ? '<p class="muted small">Not in your collection. Add it with “+ Add book”.</p>' : '';
    wirePhotoButtons($('#stMatches'), () => $('#stFind').dispatchEvent(new Event('input')));
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
  if ($('.stock-log')) wirePhotoButtons($('.stock-log'), refresh);
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
