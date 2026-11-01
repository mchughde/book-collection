'use strict';
// Reading stats.

/* ---------- stats ---------- */

function viewStats() {
  setTitle('Reading stats');
  const all = books();
  const st = viewState.stats ||= { year: '', allGenres: false };
  const year = String(new Date().getFullYear());
  const reads = all.flatMap(b => finishedReads(b).map(r => ({ b, r })));
  // Books marked Read with no read recorded count as read in an unknown year.
  const bare = all.filter(b => b.status === 'read' && !finishedReads(b).length).map(b => ({ b, r: { source: b.source } }));
  const years = [...new Set(reads.map(x => readYear(x.r)).filter(Boolean))].sort().reverse();
  const unknownReads = [...reads.filter(x => !readYear(x.r)), ...bare];
  if (st.year && st.year !== 'unknown' && !years.includes(st.year)) st.year = '';

  // The charts describe the whole collection, or the books read in the chosen year.
  const yearReads = !st.year ? null : st.year === 'unknown' ? unknownReads : reads.filter(x => readYear(x.r) === st.year);
  const scope = yearReads ? [...new Set(yearReads.map(x => x.b))] : all;
  const label = !st.year ? 'your collection' : st.year === 'unknown' ? 'books read in an unknown year' : `books read in ${st.year}`;

  const bars = (rows, unit, opts = {}) => {
    const max = Math.max(1, ...rows.map(r => r[1]));
    return `<div class="bars">${rows.map(([l, v, href]) => {
      const tip = `${l}: ${v} ${unit}${v === 1 ? '' : 's'}`;
      const inner = `<span>${esc(l)}</span><div class="track"><div class="fill" style="width:${v / max * 100}%"></div></div><span class="v">${v}</span>`;
      return href ? `<a class="bar" href="${href}" title="${esc(tip)}">${inner}</a>` : `<div class="bar${v ? '' : ' zero'}" title="${esc(tip)}">${inner}</div>`;
    }).join('')}</div>${opts.after || ''}`;
  };
  const tile = (n, l) => `<div class="tile"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const count = (list, key) => { const m = {}; list.forEach(x => { const k = key(x); if (k != null) m[k] = (m[k] || 0) + 1; }); return m; };
  const avg = list => { const r = list.filter(b => b.rating); return r.length ? (r.reduce((n, b) => n + b.rating, 0) / r.length).toFixed(1) + '★' : '–'; };
  const bySource = list => Object.entries(count(list, x => SOURCE_LABEL[x.r.source || x.b.source] || 'Not recorded')).sort((a, b) => b[1] - a[1]);

  // Fiction vs Nonfiction, as a ring: two parts plus books with no genre yet.
  const kind = b => (b.genres || []).includes('Fiction') ? 'Fiction' : (b.genres || []).includes('Nonfiction') ? 'Nonfiction' : 'No genre yet';
  const kinds = count(scope, kind);
  const ring = () => {
    const parts = [['Nonfiction', 'var(--chart-a)'], ['Fiction', 'var(--chart-b)'], ['No genre yet', 'var(--line)']].map(([k, c]) => [k, kinds[k] || 0, c]).filter(p => p[1]);
    const total = parts.reduce((n, p) => n + p[1], 0);
    if (!total) return '<p class="muted">No books yet.</p>';
    const r = 54, C = 2 * Math.PI * r, gap = parts.length > 1 ? 2 : 0;
    let at = 0;
    const arcs = parts.map(([k, v, c]) => {
      const len = v / total * C;
      const arc = `<circle r="${r}" cx="70" cy="70" fill="none" stroke="${c}" stroke-width="22" stroke-dasharray="${Math.max(0, len - gap)} ${C}" stroke-dashoffset="${-at}"><title>${k}: ${v} (${Math.round(v / total * 100)}%)</title></circle>`;
      at += len;
      return arc;
    }).join('');
    return `<div class="ring-wrap"><svg class="ring" viewBox="0 0 140 140" role="img" aria-label="${parts.map(p => `${p[0]} ${p[1]}`).join(', ')}">
        <g transform="rotate(-90 70 70)">${arcs}</g>
        <text x="70" y="66" text-anchor="middle" class="ring-n">${total}</text><text x="70" y="84" text-anchor="middle" class="ring-l">books</text></svg>
      <ul class="legend">${parts.map(([k, v, c]) => `<li><span class="swatch" style="background:${c}"></span>${k}<span class="v">${v} · ${Math.round(v / total * 100)}%</span></li>`).join('')}</ul></div>`;
  };

  // Genres, longest first, without the Fiction/Nonfiction split shown above. Each opens those books.
  const genreRows = Object.entries(count(scope.flatMap(b => (b.genres || []).filter(g => g !== 'Fiction' && g !== 'Nonfiction')), g => g))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shownGenres = st.allGenres ? genreRows : genreRows.slice(0, 12);

  // Publication dates by decade, newest first. Imported books use the first-publication year.
  // Decades before 1900 are sparse, so they share one bar.
  const decades = count(scope, b => !/^\d{4}$/.test(String(b.year)) ? 'No date' : b.year < 1900 ? 'Before 1900' : String(b.year).slice(0, 3) + '0s');
  const order = k => k === 'No date' ? -2 : k === 'Before 1900' ? -1 : Number(k.slice(0, 4));
  const decadeRows = Object.entries(decades).sort((a, b) => order(b[0]) - order(a[0]));

  // Ratings in half stars, from the highest used to the lowest used: steps outside that range
  // are left off, but a gap inside it stays visible as an empty row.
  const ratings = count(scope.filter(b => b.rating), b => b.rating);
  const used = Object.keys(ratings).map(Number);
  const ratingRows = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5]
    .filter(n => n <= Math.max(...used) && n >= Math.min(...used))
    .map(n => [ratingText(n) + (n <= 1 ? ' star' : ' stars'), ratings[n] || 0]);
  const unrated = scope.filter(b => !b.rating).length;

  const perYear = count(reads, x => readYear(x.r) || null);
  const yearRows = [...Object.entries(perYear).sort((a, b) => b[0].localeCompare(a[0])), ...(unknownReads.length ? [['Year unknown', unknownReads.length]] : [])];
  const owned = all.filter(isOwned);
  const thisYear = reads.filter(x => readYear(x.r) === year);
  const pages = list => list.reduce((n, x) => n + (Number(x.b.pages) || 0), 0).toLocaleString('en-AU');

  $('#view').innerHTML = `
    <div class="toolbar">
      <label class="field" style="flex-direction:row;align-items:center;gap:8px">Show
        <select id="statsYear" aria-label="Which books">
          <option value="">Whole collection</option>
          ${years.map(y => `<option value="${y}" ${st.year === y ? 'selected' : ''}>Books read in ${y}</option>`).join('')}
          ${unknownReads.length ? `<option value="unknown" ${st.year === 'unknown' ? 'selected' : ''}>Books read, year unknown</option>` : ''}
        </select></label>
    </div>
    <div class="tiles">${yearReads ? `
      ${tile(yearReads.length, `book${yearReads.length === 1 ? '' : 's'} read${st.year === 'unknown' ? ', year unknown' : ' in ' + st.year}`)}
      ${tile(pages(yearReads), 'pages')}
      ${tile(avg(scope), 'average rating')}` : `
      ${tile(thisYear.length, `book${thisYear.length === 1 ? '' : 's'} finished in ${year}`)}
      ${tile(pages(thisYear), `pages read in ${year}`)}
      ${tile(all.filter(b => b.status === 'reading').length, 'reading now')}
      ${tile(owned.length, 'books I own')}
      ${tile(owned.filter(b => !hasRead(b)).length, 'owned, not read yet')}
      ${tile(all.filter(b => b.status === 'wishlist').length, 'on the wishlist')}
      ${tile(avg(all), 'average rating')}`}
    </div>
    <div class="chart-grid">
      <section><h2>Fiction vs Nonfiction</h2>${ring()}</section>
      <section><h2>Ratings</h2>${unrated === scope.length ? '<p class="muted">No ratings yet.</p>' : bars(ratingRows, 'book', { after: `<p class="muted small">${unrated} not rated. Average ${avg(scope)}.</p>` })}</section>
    </div>
    <h2>Genres <span class="muted small">(${label})</span></h2>
    ${genreRows.length ? bars(shownGenres.map(([g, n]) => [g, n, '#/genre/' + encodeURIComponent(g)]), 'book', {
      after: genreRows.length > 12 ? `<button class="link-btn" id="moreGenres">${st.allGenres ? 'Show the top 12' : `Show all ${genreRows.length} genres`}</button>` : '' })
      : '<p class="muted">No genres yet. Imported books have them; add them to others in Details.</p>'}
    <h2>Publication dates</h2>
    ${bars(decadeRows, 'book')}
    ${yearReads ? '' : `<h2>Books finished each year</h2>
    ${yearRows.length ? bars(yearRows, 'book') : '<p class="muted">No finished books recorded yet.</p>'}`}
    <h2>How I read them, ${yearReads ? (st.year === 'unknown' ? 'year unknown' : st.year) : year}</h2>
    ${(yearReads || thisYear).length ? bars(bySource(yearReads || thisYear), 'book') : '<p class="muted">Nothing finished this year yet.</p>'}
    ${yearReads ? '' : `<h2>How I read them, all time</h2>
    ${reads.length + bare.length ? bars(bySource([...reads, ...bare]), 'book') : '<p class="muted">No books marked read yet.</p>'}`}`;

  $('#statsYear').onchange = e => { st.year = e.target.value; viewStats(); };
  const more = $('#moreGenres');
  if (more) more.onclick = () => { st.allGenres = !st.allGenres; viewStats(); };
}
