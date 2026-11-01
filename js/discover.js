'use strict';
// New books by followed authors.

/* ---------- new books by followed authors ---------- */

async function checkNewBooks() {
  const since = new Date().getFullYear() - 1;
  const found = [];
  for (const a of followed()) {
    const url = `https://openlibrary.org/search.json?author_key=${encodeURIComponent(a.key)}&sort=new&limit=12&fields=${OL_FIELDS}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Open Library didn’t answer (' + res.status + ')');
    const docs = (await res.json()).docs;
    for (const d of docs) {
      if (!d.first_publish_year || d.first_publish_year < since) continue;
      if (/^untitled\b/i.test(d.title || '')) continue; // publishers' placeholders for unannounced books
      // Skip editions in languages other than English or French, where Open Library says.
      if (d.language && d.language.length && !d.language.some(l => l === 'eng' || l === 'fre')) continue;
      found.push({ ...docToBook(d), authorName: a.name, authorKey: a.key });
    }
    await sleep(250); // be polite to Open Library
  }
  const result = { at: now(), items: found };
  store('discover', result);
  return result;
}

function viewDiscover() {
  setTitle('New books');
  const cache = recall('discover');
  const fresh = cache && Date.now() - new Date(cache.at) < 24 * 3600e3;
  const authors = followed();
  const suggestions = suggestedAuthors();

  const items = (cache?.items || []).filter(c => !findDuplicate(c) && !(db.dismissed[c.workKey] && !db.dismissed[c.workKey].deleted));
  const byAuthor = new Map();
  for (const c of items) { if (!byAuthor.has(c.authorName)) byAuthor.set(c.authorName, []); byAuthor.get(c.authorName).push(c); }

  $('#view').innerHTML = `
    <p class="muted" style="margin-top:0">Books from this year and last by authors you follow, found in Open Library.
      New releases can take a few weeks to appear there.</p>
    <div class="toolbar">
      <button class="btn" id="checkNow" ${authors.length ? '' : 'disabled'}>Check now</button>
      <span class="muted small">${cache ? 'Last checked ' + new Date(cache.at).toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : ''}</span>
    </div>
    <div id="found">${!authors.length ? '' : !items.length ? `<p class="muted">${cache ? 'Nothing new by the authors you follow.' : ''}</p>` :
      [...byAuthor].map(([name, list]) => `<h3 class="discover-author">${esc(name)}</h3>
        <div class="results">${list.map(c => `<div class="result">${coverHtml(c)}
          <div><div class="t">${esc(c.title)}</div><div class="a">${c.year}</div></div>
          <div class="row" style="margin:0;flex-wrap:nowrap"><button class="btn small primary" data-wish="${esc(c.workKey)}">+ Wishlist</button>
          <button class="btn small" data-dismiss="${esc(c.workKey)}">Not for me</button></div>
        </div>`).join('')}</div>`).join('')}</div>

    <h2>Authors you follow <span class="muted small">(${authors.length})</span></h2>
    ${authors.length ? `<div class="follow-list">${authors.map(a => `<span class="tag">${esc(a.name)}<button data-unfollow="${esc(a.key)}" data-name="${esc(a.name)}" aria-label="Stop following ${esc(a.name)}">×</button></span>`).join('')}</div>`
      : `<p class="muted">None yet. Follow authors from any book’s page, or from the suggestions and search below.</p>`}
    ${suggestions.length ? `<h3>Suggested from your reading</h3><p class="muted small" style="margin-top:0">Authors of books you rated 4 or 5 stars, or have several books by.</p>
      <div class="follow-list">${suggestions.map(a => `<button class="btn small" data-followkey="${esc(a.key)}" data-name="${esc(a.name)}">+ ${esc(a.name)}</button>`).join('')}</div>` : ''}
    <h3>Find an author</h3>
    <form class="toolbar" id="authorForm"><input class="search" type="search" id="authorQ" placeholder="Author’s name"><button class="btn" type="submit">Search</button></form>
    <div id="authorResults"></div>`;

  const view = $('#view');
  $('#checkNow').onclick = async () => {
    const btn = $('#checkNow');
    btn.disabled = true; btn.textContent = 'Checking…';
    try { await checkNewBooks(); } catch (e) { toast(e.message); }
    render();
  };
  view.querySelectorAll('[data-wish]').forEach(btn => btn.onclick = () => {
    const c = items.find(x => x.workKey === btn.dataset.wish);
    const b = newBook({ title: c.title, subtitle: c.subtitle, authors: c.authors, authorKeys: c.authorKeys, workKey: c.workKey,
      isbn: c.isbn, year: c.year, pages: c.pages, coverUrl: c.coverUrl, status: 'wishlist' });
    saveBook(b);
    toast(`Added “${b.title}” to your wishlist`);
    render();
  });
  view.querySelectorAll('[data-dismiss]').forEach(btn => btn.onclick = () => {
    db.dismissed[btn.dataset.dismiss] = { updatedAt: now() };
    commit(); render();
  });
  view.querySelectorAll('[data-unfollow]').forEach(btn => btn.onclick = () => { toggleFollow(btn.dataset.unfollow, btn.dataset.name); render(); });
  view.querySelectorAll('[data-followkey]').forEach(btn => btn.onclick = () => { toggleFollow(btn.dataset.followkey, btn.dataset.name); render(); });
  $('#authorForm').onsubmit = async e => {
    e.preventDefault();
    const q = $('#authorQ').value.trim();
    if (!q) return;
    const out = $('#authorResults');
    out.innerHTML = '<p class="muted">Searching…</p>';
    try {
      const res = await fetch(`https://openlibrary.org/search/authors.json?q=${encodeURIComponent(q)}&limit=8`);
      const docs = (await res.json()).docs || [];
      out.innerHTML = docs.length ? `<div class="results">${docs.map(d => {
        const key = d.key.replace('/authors/', '');
        const on = db.authors[key] && !db.authors[key].deleted;
        return `<div class="result" style="grid-template-columns:1fr auto"><div><div class="t">${esc(d.name)}</div>
          <div class="a">${d.top_work ? 'Known for ' + esc(d.top_work) + ' · ' : ''}${d.work_count || 0} works</div></div>
          ${on ? '<span class="muted small">Following</span>' : `<button class="btn small" data-followkey="${esc(key)}" data-name="${esc(d.name)}">+ Follow</button>`}</div>`;
      }).join('')}</div>` : '<p class="muted">No authors found.</p>';
      out.querySelectorAll('[data-followkey]').forEach(btn => btn.onclick = () => { toggleFollow(btn.dataset.followkey, btn.dataset.name); render(); });
    } catch { out.innerHTML = '<p class="muted">Couldn’t reach Open Library.</p>'; }
  };

  // Check automatically once a day when this page is opened.
  if (authors.length && !fresh && navigator.onLine && !viewDiscover.checking) {
    viewDiscover.checking = true;
    checkNewBooks().catch(() => {}).finally(() => { viewDiscover.checking = false; if (location.hash === '#/discover') render(); });
    $('#found').innerHTML = '<p class="muted">Checking for new books…</p>';
  }
}

function suggestedAuthors() {
  const counts = new Map();
  for (const b of books()) (b.authorKeys || []).forEach((key, i) => {
    if (!key) return;
    const e = counts.get(key) || { key, name: b.authors[i], n: 0, loved: false };
    e.n++; if (b.rating >= 4) e.loved = true;
    counts.set(key, e);
  });
  return [...counts.values()]
    .filter(a => (a.loved || a.n >= 2) && !(db.authors[a.key] && !db.authors[a.key].deleted))
    .sort((a, b) => b.n - a.n).slice(0, 12);
}
