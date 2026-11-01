'use strict';
// Adding a book, and the barcode scanner.

/* ---------- add a book ---------- */

let addState = { q: '', results: null, chosen: null, error: '' };

function viewAdd(params) {
  setTitle('Add a book');
  const to = params.get('to') || 'library';
  const defaults = {
    wishlist: { status: 'wishlist', source: '' },
    library: { status: 'to-read', source: 'own-physical' },
  }[to] || { status: 'to-read', source: 'own-physical' };
  // Where it is starts at the last place used for that kind of owned copy (on this device),
  // so a run of Kindle ebooks or one shelf of print books needs picking only once.
  const placeKind = s => /^own-(ebook|audio)/.test(s) ? 'digital' : s === 'own-physical' ? 'print' : '';
  const lastPlace = s => s === 'prime-ebook' ? 'kindle' : (recall('addPlace') || {})[placeKind(s)] || '';

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
      ${c.manual ? '' : `<div class="row" style="margin-bottom:12px"><div class="field edition-field">Genres
          ${genrePickerHtml('a-genres', [], 'Finding genres…')}</div></div>`}
      ${c.fromApple && !c.workKey ? `<p class="muted small" style="margin:0 0 12px">Found only in Apple Books, so there’s no publisher or page count. If you have the printed book, scanning its barcode adds its ISBN.</p>` : ''}
      <div class="row">
        <label class="field">Status<select id="a-status">${STATUSES.map(([v, l]) => `<option value="${v}" ${defaults.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field" id="a-yearField" ${defaults.status === 'read' ? '' : 'hidden'}>Year read<input type="text" id="a-year" inputmode="numeric" maxlength="4" placeholder="Unknown" style="width:6em"></label>
        <label class="field">How I have it<select id="a-source"><option value="">Not yet / not set</option>${SOURCES.map(([v, l]) => `<option value="${v}" ${defaults.source === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field" id="a-locField" ${defaults.status === 'wishlist' ? 'hidden' : ''}>Where it is<select id="a-location">${locationOptions(lastPlace(defaults.source), 'Not set yet')}</select></label>
        <label class="field" id="a-otherField" hidden>Where?<input type="text" id="a-locationOther" placeholder="In a box in the garage" style="width:12em"></label>
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
      // Genres arrive a moment later; once she has picked or removed one, the guess is left out.
      let addGenres = [], genresTouched = false;
      const drawGenres = note => {
        const box = $('#a-genres');
        if (!box) return;
        box.outerHTML = genrePickerHtml('a-genres', addGenres, note);
        wireGenrePicker($('#a-genres'), addGenres, g => { addGenres = g; genresTouched = true; drawGenres(); });
      };
      if ($('#a-genres')) {
        drawGenres('Finding genres…');
        guessGenres(c).then(g => {
          if (genresTouched) return;
          addGenres = g;
          drawGenres(g.length ? '' : 'None found. Pick some, or leave blank');
        }).catch(() => { if (!genresTouched) drawGenres(); });
      }
      $('#a-status').onchange = e => {
        $('#a-yearField').hidden = e.target.value !== 'read';
        $('#a-locField').hidden = e.target.value === 'wishlist';
        $('#a-otherField').hidden = $('#a-locField').hidden || $('#a-location').value !== 'other';
      };
      let placePicked = false;
      $('#a-source').onchange = e => { if (!placePicked) $('#a-location').value = lastPlace(e.target.value); };
      $('#a-location').onchange = e => {
        placePicked = true;
        $('#a-otherField').hidden = e.target.value !== 'other';
        if (e.target.value === 'other') $('#a-locationOther').focus();
      };
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
        // Includes a new genre typed but not yet confirmed with Return.
        const genres = [...addGenres, ...typedGenres($('#a-genres input')?.value || '')];
        const source = $('#a-source').value;
        // Not called `location`: that would hide window.location, used below to open the book.
        const place = $('#a-locField').hidden ? '' : $('#a-location').value;
        const locationOther = place === 'other' ? $('#a-locationOther').value.trim() : '';
        if (place && place !== 'other' && placeKind(source)) store('addPlace', { ...recall('addPlace'), [placeKind(source)]: place });
        const b = newBook({ ...fields, source, location: place, locationOther, genres: [...new Set(genres)], shelves: $('#a-shelf')?.value ? [$('#a-shelf').value] : [] });
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
