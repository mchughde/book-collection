'use strict';
// Settings: sync set-up, backup, LibraryThing import screen.

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
