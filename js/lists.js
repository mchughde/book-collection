'use strict';
// The menu and the list pages: library, all books, wishlist, series, genre, shelf, reading, read.

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
