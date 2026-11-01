'use strict';
// Covers, cover photos (take, crop, upload) and book cards.

/* ---------- covers & cards ---------- */

// Open Library's cover server sometimes fails, and Safari can keep reusing a failed answer.
// Try twice more with a fresh address before showing the plain coloured cover. An ISBN cover
// asked for with default=false fails on purpose when there's no cover, so it isn't retried.
function coverFailed(img) {
  const tries = Number(img.dataset.tries || 0);
  if (tries < 2 && !img.src.includes('default=false')) {
    img.dataset.tries = tries + 1;
    img.style.visibility = 'hidden'; // no broken-image icon while waiting
    img.onload = () => { img.style.visibility = ''; };
    setTimeout(() => {
      if (!img.isConnected) return;
      const u = new URL(img.src);
      u.searchParams.set('retry', Date.now());
      img.src = u.href;
    }, 1500 * (tries + 1));
    return;
  }
  const box = img.parentNode;
  if (box?.isConnected) box.outerHTML = box.dataset.blank;
}
// The web address inside whatever was pasted: copying a picture can bring invisible
// placeholder characters (U+FFFC) along with its address.
const cleanUrl = s => (String(s || '').match(/https?:\/\/[^\s\uFFFC]+/) || [''])[0];

function coverHtml(b, badge = '') {
  const hue = SPINES[[...(b.title || 'x')].reduce((n, c) => n + c.charCodeAt(0), 0) % SPINES.length];
  const blank = `<div class="cover blank" style="background:${hue}">${esc(b.title)}${badge}</div>`;
  // A photo is filled in once this device has the file (see Photos); until then, or if it
  // can't be had, the book's other cover shows.
  if (b.coverPhoto) {
    const src = Photos.cached(b.coverPhoto);
    return `<div class="cover" data-blank="${esc(coverHtml({ ...b, coverPhoto: '' }, badge))}"><img ${src ? `src="${src}"` : ''} data-photo="${esc(b.coverPhoto)}" alt="">${badge}</div>`;
  }
  const url = cleanUrl(b.coverUrl);
  if (!url) return blank;
  return `<div class="cover"><img src="${esc(url)}" alt="" loading="lazy" onerror="coverFailed(this)">${badge}</div>`
    .replace('<div class="cover">', `<div class="cover" data-blank="${esc(blank)}">`);
}
/* ---------- cover photos ---------- */

// A photo taken of a book's cover (1 Nov 2026, her request, for stocktakes that turn up
// missing or wrong covers). It's cropped and shrunk on the device, then kept as its own JPEG:
// in IndexedDB as `photo:<path>`, and in the data repo at covers/<book id>-<time>.jpg, so
// library.json stays small. The book's coverPhoto names the file and wins over coverUrl;
// removing the photo brings the earlier cover back. Files replaced or removed stay in the repo.
const PHOTO_W = 600, PHOTO_MAX_H = 1000, PHOTO_QUALITY = 0.85;
const Photos = {
  urls: {}, blobs: {}, loading: {},
  pending() { return recall('photoPending') || []; },
  cached(path) { return this.urls[path] || ''; },
  // This device's copy, or the repo's (saved here for next time).
  get(path) {
    if (this.urls[path]) return Promise.resolve(this.urls[path]);
    return this.loading[path] ||= (async () => {
      let blob = this.blobs[path] || (Disk.ok ? await Disk.get('photo:' + path).catch(() => null) : null);
      if (!blob) {
        if (!Sync.cfg() || !navigator.onLine) throw new Error('Not on this device');
        const res = await Sync.api('/contents/' + path, { headers: { Accept: 'application/vnd.github.raw+json' } });
        if (!res.ok) throw new Error('GitHub said ' + res.status);
        blob = new Blob([await res.arrayBuffer()], { type: 'image/jpeg' });
        if (Disk.ok) Disk.put('photo:' + path, blob).catch(() => {});
      }
      return this.urls[path] = URL.createObjectURL(blob);
    })().finally(() => { delete this.loading[path]; });
  },
  async save(b, blob) {
    const path = `covers/${b.id}-${Date.now().toString(36)}.jpg`;
    this.blobs[path] = blob;
    this.urls[path] = URL.createObjectURL(blob);
    if (Disk.ok) await Disk.put('photo:' + path, blob).catch(() => {});
    store('photoPending', [...this.pending(), path]);
    b.coverPhoto = path;
    saveBook(b);
    if (!Sync.cfg() && !Disk.ok) toast('This device can’t keep the photo after the app closes. Set up sync to keep it.', 4500);
  },
  remove(b) { delete b.coverPhoto; saveBook(b); },
  async upload() {
    if (!this.pending().length) return;
    for (const path of this.pending()) {
      const blob = this.blobs[path] || (Disk.ok ? await Disk.get('photo:' + path).catch(() => null) : null);
      if (blob) {
        const res = await Sync.api('/contents/' + path, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `Cover photo from ${deviceName()}`, content: b64bytes(new Uint8Array(await blob.arrayBuffer())) }),
        });
        // 422: the file is already there (an earlier try got through before the app closed).
        if (!res.ok && res.status !== 422) throw await Sync.fail(res);
      }
      store('photoPending', this.pending().filter(p => p !== path));
    }
  },
};
// Photo covers are drawn without a picture when this device hasn't got the file yet; fetch it
// as each appears. If it can't be had, show the cover the book had before (or the plain one).
new MutationObserver(() => {
  document.querySelectorAll('img[data-photo]:not([src]):not([data-wait])').forEach(img => {
    img.dataset.wait = '1';
    Photos.get(img.dataset.photo).then(url => { img.src = url; }, () => {
      const box = img.parentNode;
      if (box?.isConnected) box.outerHTML = box.dataset.blank;
    });
  });
}).observe(document.body, { childList: true, subtree: true });

// Pick or take a photo, crop it to the cover's edges, and save it as the book's cover.
const PhotoEditor = {
  open(b, onDone) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.hidden = true;
    document.body.append(input); // iOS needs it in the page
    input.onchange = async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;
      try { this.edit(b, await this.load(file), onDone); }
      catch { toast('That picture couldn’t be opened. Try a JPEG or PNG, or take the photo again.', 4500); }
    };
    input.click();
  },
  // The photo, the right way up (browsers apply the camera's rotation), at most 1600 px across:
  // plenty for a 600 px cover, and quick to redraw while cropping.
  async load(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c;
    } finally { URL.revokeObjectURL(url); }
  },
  edit(b, canvas, onDone) {
    const el = document.createElement('div');
    el.className = 'photo-editor';
    el.innerHTML = `<p class="pe-hint">Drag the corners to the edges of the cover</p>
      <div class="pe-stage"><div class="pe-wrap"><div class="pe-crop">${['nw', 'ne', 'sw', 'se'].map(h => `<span class="pe-h ${h}" data-h="${h}"></span>`).join('')}</div></div></div>
      <div class="pe-bar"><button class="btn" data-pe="cancel">Cancel</button><button class="btn" data-pe="rotate">Rotate ↻</button><button class="btn primary" data-pe="use">Use as cover</button></div>`;
    document.body.append(el);
    const wrap = el.querySelector('.pe-wrap'), box = el.querySelector('.pe-crop'), stage = el.querySelector('.pe-stage');
    wrap.prepend(canvas);
    // The crop, as fractions of the photo. It starts as a book-shaped (2:3) frame in the middle.
    let crop;
    const reset = () => {
      let h = 0.86, w = h * canvas.height / canvas.width * 2 / 3;
      if (w > 0.86) { h *= 0.86 / w; w = 0.86; }
      crop = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
    };
    const draw = () => Object.assign(box.style, { left: crop.x * 100 + '%', top: crop.y * 100 + '%', width: crop.w * 100 + '%', height: crop.h * 100 + '%' });
    const fit = () => {
      const k = Math.min(stage.clientWidth / canvas.width, stage.clientHeight / canvas.height);
      wrap.style.width = canvas.width * k + 'px';
      wrap.style.height = canvas.height * k + 'px';
    };
    reset(); fit(); draw();
    window.addEventListener('resize', fit);
    const close = () => { window.removeEventListener('resize', fit); el.remove(); };

    // Drag a corner to resize, or inside the frame to move it.
    const MIN = 0.08;
    box.onpointerdown = e => {
      e.preventDefault();
      const h = e.target.dataset.h || '', r = wrap.getBoundingClientRect(), start = { ...crop }, x0 = e.clientX, y0 = e.clientY;
      box.setPointerCapture(e.pointerId);
      box.onpointermove = m => {
        const dx = (m.clientX - x0) / r.width, dy = (m.clientY - y0) / r.height;
        let { x, y, w, h: ht } = start;
        if (!h) {
          x = Math.min(Math.max(0, x + dx), 1 - w);
          y = Math.min(Math.max(0, y + dy), 1 - ht);
        } else {
          if (h.includes('w')) { const nx = Math.min(Math.max(0, x + dx), x + w - MIN); w += x - nx; x = nx; }
          if (h.includes('e')) w = Math.min(Math.max(MIN, w + dx), 1 - x);
          if (h.includes('n')) { const ny = Math.min(Math.max(0, y + dy), y + ht - MIN); ht += y - ny; y = ny; }
          if (h.includes('s')) ht = Math.min(Math.max(MIN, ht + dy), 1 - y);
        }
        crop = { x, y, w, h: ht };
        draw();
      };
      box.onpointerup = box.onpointercancel = () => { box.onpointermove = null; };
    };

    el.querySelector('[data-pe="cancel"]').onclick = close;
    el.querySelector('[data-pe="rotate"]').onclick = () => {
      const src = document.createElement('canvas');
      [src.width, src.height] = [canvas.width, canvas.height];
      src.getContext('2d').drawImage(canvas, 0, 0);
      [canvas.width, canvas.height] = [src.height, src.width];
      const g = canvas.getContext('2d');
      g.translate(canvas.width, 0);
      g.rotate(Math.PI / 2);
      g.drawImage(src, 0, 0);
      reset(); fit(); draw();
    };
    el.querySelector('[data-pe="use"]').onclick = async e => {
      e.target.disabled = true;
      // Shrink to 600 px wide (no larger than the crop itself), height to suit, at most 1000 px.
      const sx = crop.x * canvas.width, sy = crop.y * canvas.height, sw = crop.w * canvas.width, sh = crop.h * canvas.height;
      let w = Math.min(PHOTO_W, sw), h = w * sh / sw;
      if (h > PHOTO_MAX_H) { w *= PHOTO_MAX_H / h; h = PHOTO_MAX_H; }
      const out = document.createElement('canvas');
      out.width = Math.round(w); out.height = Math.round(h);
      const g = out.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
      const blob = await new Promise(ok => out.toBlob(ok, 'image/jpeg', PHOTO_QUALITY));
      if (!blob) { toast('Couldn’t make the cover. Please try again.'); e.target.disabled = false; return; }
      await Photos.save(b, blob);
      close();
      toast('Cover photo saved');
      if (onDone) onDone();
    };
  },
};

// Ratings go in half stars, 0.5 to 5 (0 = not rated).
const ratingText = n => n ? (Math.floor(n) || '') + (n % 1 ? '½' : '') : '';
const starsText = n => n ? '★'.repeat(Math.floor(n)) + (n % 1 ? '½' : '') : '';

function cardHtml(b, opts = {}) {
  const badge = opts.badge ? `<span class="badge">${esc(opts.badge)}</span>` : '';
  const meta = [];
  if (b.rating) meta.push(`<span class="stars-sm" aria-label="${b.rating} stars">${starsText(b.rating)}</span>`);
  if (opts.meta) meta.push(`<span>${esc(opts.meta)}</span>`);
  const progress = opts.progress != null ? `<div class="progress" title="${opts.progress}%"><span style="width:${opts.progress}%"></span></div>` : '';
  return `<a class="card" href="#/book/${b.id}">
    ${coverHtml(b, badge)}
    ${progress}
    <div class="t">${esc(b.title)}</div>
    <div class="a">${esc(authorLine(b))}</div>
    ${meta.length ? `<div class="m">${meta.join('')}</div>` : ''}
  </a>`;
}
function percent(b) {
  const p = Number(b.progress), total = Number(b.pages);
  if (!p) return 0;
  if (total) return Math.min(100, Math.round(p / total * 100));
  return Math.min(100, p);
}
