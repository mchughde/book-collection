'use strict';
// Sync with the private GitHub repo.

/* ---------- sync with the private GitHub repo ---------- */

function b64encode(str) { return b64bytes(new TextEncoder().encode(str)); }
function b64bytes(bytes) {
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
    // Cover photos go up first, so another device never sees a book naming a photo that isn't
    // there yet. A photo that fails doesn't hold up the rest; it's tried again next time.
    const photoError = await Photos.upload().then(() => '', e => e.message);
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
      this.setState(photoError ? 'error' : 'ok', photoError && 'Cover photo not uploaded yet: ' + photoError);
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
