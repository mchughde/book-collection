'use strict';
// The book page.

/* ---------- book page ---------- */

// A search, not a product page: many ISBNs here are UK/US editions the Australian store
// doesn't sell, and /dp/<isbn> then lands on "page not found". Title + first author finds
// whatever editions it has, print and Kindle side by side.
function amazonUrl(b) {
  const q = [b.title, (b.authors || [])[0]].filter(Boolean).join(' ');
  return `https://www.amazon.com.au/s?k=${encodeURIComponent(q)}&i=stripbooks`;
}

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
  actions.push(`<a class="btn" href="${esc(amazonUrl(b))}" target="_blank" rel="noopener noreferrer">Find on Amazon</a>`);

  const authors = (b.authors || []).map((name, i) => {
    const key = (b.authorKeys || [])[i];
    if (!key) return `<span>${esc(name)}</span>`;
    const on = db.authors[key] && !db.authors[key].deleted;
    return `<span>${esc(name)} <button class="link-btn small" data-follow="${esc(key)}" data-name="${esc(name)}">${on ? '✓ Following' : '+ Follow for new books'}</button></span>`;
  }).join('');

  $('#view').innerHTML = `
    <a class="back" href="#/library" id="back">‹ Back</a>
    <div class="book-head">
      <div>
        ${coverHtml(b)}
        <div class="cover-actions">
          <button class="link-btn small" id="photoCover">${b.coverPhoto ? 'Replace cover photo' : 'Use a photo as the cover'}</button>
          ${b.coverPhoto ? `<button class="link-btn small" id="unphotoCover">Remove photo</button>` : ''}
        </div>
      </div>
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
            <div class="field" style="grid-column:1/-1">Genres${genrePickerHtml('d-genres', b.genres || [])}</div>
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
  $('#photoCover').onclick = () => PhotoEditor.open(b, render);
  if ($('#unphotoCover')) $('#unphotoCover').onclick = () => {
    if (!confirm(b.coverUrl ? 'Remove the photo and go back to the cover it had before?' : 'Remove the cover photo?')) return;
    Photos.remove(b); render();
  };

  $('#status').onchange = e => { setStatus(b, e.target.value); save(); render(); };
  $('#source').onchange = e => {
    b.source = e.target.value;
    if (b.source === 'prime-ebook' && !b.location) { b.location = 'kindle'; save(); render(); return; }
    save();
  };
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
      if (f === 'coverUrl' && v) delete b.coverPhoto; // a newly typed address is her latest choice
      b[f] = v; save(); if (['title', 'coverUrl', 'series', 'seriesNo'].includes(f)) render();
    };
  }
  wireGenrePicker($('#d-genres'), b.genres || [], g => { b.genres = g; save(); render(); });
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
