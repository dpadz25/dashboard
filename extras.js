/* ═══════════════════════════════════════════════════════════════
   EXTRAS - everything added in the v2 redesign pass that is not a
   tweak to an existing widget.

   - Widget gallery: show/hide any widget, add photo / hours / Spotify
   - Photo widget (frames + shapes), hours tracker, Spotify now playing
   - Quick capture (phone), overdue carry-over, class tint, gentle motion

   Storage
   - extrasPrefs   {tint, motion, hidden:[cardId]}   synced
   - photoWidgets  [{id, kind, ...settings}]         synced (per-item merge)
   - hoursConfig   {goal, cats, entries, sheetUrl}   synced
   - photo images  IndexedDB dashStore 'photo:<id>'  device-local
   - spotify.*     tokens + client id                device-local, never synced

   Loaded BEFORE blocks.js so saved widgets exist in the DOM when the
   grid is built (same trick blocks.js uses for notes).
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';
const { $, uid, esc, load, save, todayStr } = window.dashUtil;

const PREFS_KEY = 'extrasPrefs';
const WIDGETS_KEY = 'photoWidgets';
const HOURS_KEY = 'hoursConfig';

const getPrefs = () => Object.assign({ tint: false, motion: true, hidden: [] }, load(PREFS_KEY, {}));
const setPrefs = (p) => { save(PREFS_KEY, p); applyPrefs(); };
const getWidgets = () => load(WIDGETS_KEY, []);
const saveWidgets = (w) => save(WIDGETS_KEY, w);

let toastTimer = null;
function toast(msg, undo) {
  let t = $('xToast');
  if (!t) { t = document.createElement('div'); t.id = 'xToast'; t.className = 'x-toast'; document.body.appendChild(t); }
  t.innerHTML = `<span>${esc(msg)}</span>` + (undo ? '<button type="button">Undo</button>' : '');
  if (undo) t.querySelector('button').onclick = () => { undo(); t.classList.remove('show'); };
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 5000);
}

/* ── PREFS: tint, motion, hidden widgets ───────────────────── */
function applyPrefs() {
  const p = getPrefs();
  document.body.classList.toggle('x-tint', !!p.tint);
  document.body.classList.toggle('x-motion', p.motion !== false);
  document.querySelectorAll('.block[data-card-id]').forEach((b) => {
    b.classList.toggle('x-hidden', p.hidden.includes(b.dataset.cardId));
  });
  if (window.blocks && window.blocks.relayout) window.blocks.relayout();
}

/* ── WIDGET LABELS ─────────────────────────────────────────── */
function labelOf(b) {
  const w = getWidgets().find((x) => x.id === b.dataset.cardId);
  if (w) return KINDS[w.kind] ? KINDS[w.kind].label : 'Widget';
  const l = (b.dataset.screenLabel || b.dataset.cardId || '').replace(/^\d+[a-z]?\s*/i, '');
  return l || b.dataset.cardId;
}

/* ── GALLERY MODAL ─────────────────────────────────────────── */
function openGallery() {
  closeGallery();
  const p = getPrefs();
  const blocks = [...document.querySelectorAll('.block[data-card-id]')];
  const m = document.createElement('div');
  m.className = 'x-modal'; m.id = 'xGallery';
  m.innerHTML = `
    <div class="x-modal-card" role="dialog" aria-label="Widgets">
      <div class="x-modal-head"><b>Widgets</b><button class="icon-btn" type="button" data-x="close" aria-label="Close">×</button></div>
      <div class="x-sub">Add</div>
      <div class="x-add-row">
        ${Object.keys(KINDS).map((k) => `<button type="button" class="btn-ghost" data-add="${k}">+ ${KINDS[k].label}</button>`).join('')}
        <button type="button" class="btn-ghost" data-add="sticker">+ Sticker</button>
      </div>
      <div class="x-sub">Show or hide</div>
      <div class="x-list">
        ${blocks.map((b) => {
          const id = b.dataset.cardId, on = !p.hidden.includes(id);
          return `<label class="x-row"><span>${esc(labelOf(b))}</span><input type="checkbox" data-vis="${esc(id)}" ${on ? 'checked' : ''}/></label>`;
        }).join('')}
      </div>
      <div class="x-sub">Layout</div>
      <button type="button" class="btn-ghost" data-reset>Arrange cards neatly</button>
      <div class="x-sub">Look and feel</div>
      <label class="x-row"><span>Tint tasks by class color</span><input type="checkbox" data-pref="tint" ${p.tint ? 'checked' : ''}/></label>
      <label class="x-row"><span>Gentle motion</span><input type="checkbox" data-pref="motion" ${p.motion !== false ? 'checked' : ''}/></label>
    </div>`;
  m.addEventListener('click', (e) => {
    if (e.target === m || e.target.closest('[data-x="close"]')) return closeGallery();
    if (e.target.closest('[data-reset]')) { resetPlacement(); closeGallery(); return; }
    const add = e.target.closest('[data-add]');
    if (add) { addWidget(add.dataset.add); closeGallery(); }
  });
  m.addEventListener('change', (e) => {
    const t = e.target, prefs = getPrefs();
    if (t.dataset.vis) {
      prefs.hidden = prefs.hidden.filter((x) => x !== t.dataset.vis);
      if (!t.checked) prefs.hidden.push(t.dataset.vis);
      setPrefs(prefs);
    } else if (t.dataset.pref) {
      prefs[t.dataset.pref] = t.checked;
      setPrefs(prefs);
    }
  });
  document.body.appendChild(m);
  requestAnimationFrame(() => m.classList.add('open'));
}
function closeGallery() { const m = $('xGallery'); if (m) m.remove(); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeGallery(); closeCapture(); } });

/* ── WIDGET FACTORY ────────────────────────────────────────── */
const KINDS = {
  photo:   { label: 'Photo',   build: buildPhoto },
  next:    { label: 'Up next', build: buildNext },
  hours:   { label: 'Hours',   build: buildHours },
  spotify: { label: 'Spotify', build: buildSpotify },
};

function shell(w, title) {
  const div = document.createElement('div');
  div.className = 'card block block-x block-x-' + w.kind;
  div.dataset.cardId = w.id;
  div.dataset.defaultSpan = '1';
  div.dataset.screenLabel = title;
  div.innerHTML = `
    <div class="x-head"><span class="x-title">${esc(title)}</span>
      <button class="x-del" type="button" title="Remove widget" aria-label="Remove widget">×</button></div>
    <div class="x-body"></div>`;
  div.querySelector('.x-del').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm('Remove this widget?')) return;
    saveWidgets(getWidgets().filter((x) => x.id !== w.id));
    if (w.kind === 'photo') { window.dashStore.del('photo:' + w.id); window.dashStore.del('photo:' + w.id + ':orig'); }
    if (w.kind === 'spotify') stopSpotify();
    window.blocks.removeBlock(div);
  });
  return div;
}

function mount(w) {
  const k = KINDS[w.kind];
  if (!k) return null;
  const node = k.build(w);
  return node;
}

function addWidget(kind) {
  const sticker = kind === 'sticker';
  if (sticker) kind = 'photo';
  const w = { id: kind + '-' + Date.now().toString(36), kind };
  if (sticker) Object.assign(w, { frame: 'sticker', shape: 'full' });
  
  saveWidgets(getWidgets().concat(w));
  const node = mount(w);
  window.blocks.addBlock(node, { w: 4 });
  applyPrefs();
}

// Saved widgets go into the DOM now, ahead of blocks.boot().
function restoreWidgets() {
  const host = $('blocks');
  if (!host) return;
  getWidgets().forEach((w) => { const n = mount(w); if (n) host.appendChild(n); });
}

/* ── PHOTO WIDGET ──────────────────────────────────────────── */
const FRAMES = { none: 'No frame', polaroid: 'Polaroid', tape: 'Taped', scrap: 'Scrapbook', film: 'Film', soft: 'Soft', dark: 'Dark', sticker: 'Sticker (cut-out)' };
const SHAPES = { full: 'Full size', rect: 'Rectangle', square: 'Square', circle: 'Circle', arch: 'Arch' };

/* Clears a white or checkered background baked into a picture: walks in from the edges and removes
   every pale, colourless pixel it can reach. Returns a transparent PNG data URL. */
function cleanBg(src) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => {
      const sc = Math.min(1, 1400 / Math.max(im.width, im.height));
      const W = Math.round(im.width * sc), H = Math.round(im.height * sc);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'); x.drawImage(im, 0, 0, W, H);
      const d = x.getImageData(0, 0, W, H), p = d.data;
      const pale = (i) => { const r = p[i], g = p[i + 1], b = p[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b); return p[i + 3] > 0 && mn > 165 && mx - mn < 26; };
      const gone = new Uint8Array(W * H), stack = [];
      const seed = (px, py) => { const k = py * W + px; if (!gone[k] && pale(k * 4)) { gone[k] = 1; stack.push(k); } };
      for (let i = 0; i < W; i++) { seed(i, 0); seed(i, H - 1); }
      for (let j = 0; j < H; j++) { seed(0, j); seed(W - 1, j); }
      while (stack.length) {
        const k = stack.pop(), px = k % W, py = (k - px) / W;
        if (px > 0) seed(px - 1, py); if (px < W - 1) seed(px + 1, py);
        if (py > 0) seed(px, py - 1); if (py < H - 1) seed(px, py + 1);
      }
      const ring = [];
      for (let k = 0; k < W * H; k++) {
        if (gone[k]) continue;
        const px = k % W, py = (k - px) / W, i = k * 4;
        const near = (px > 0 && gone[k - 1]) || (px < W - 1 && gone[k + 1]) || (py > 0 && gone[k - W]) || (py < H - 1 && gone[k + W]);
        if (near && Math.min(p[i], p[i + 1], p[i + 2]) > 140 && Math.max(p[i], p[i + 1], p[i + 2]) - Math.min(p[i], p[i + 1], p[i + 2]) < 40) ring.push(k);
      }
      ring.forEach((k) => { gone[k] = 1; });
      for (let k = 0; k < W * H; k++) if (gone[k]) p[k * 4 + 3] = 0;
      x.putImageData(d, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    im.src = src;
  });
}

const tfStyle = (c) => {
  const z = (c.zoom || 100) / 100, px = c.px ?? 50, py = c.py ?? 50;
  return `object-position:${px}% ${py}%;transform-origin:${px}% ${py}%;transform:rotate(${c.rot || 0}deg) scale(${z}) scaleX(${c.flip ? -1 : 1})`;
};
function buildPhoto(w) {
  const node = shell(w, 'Photo');
  const body = node.querySelector('.x-body');
  const render = () => {
    const cur = getWidgets().find((x) => x.id === w.id) || w;
    const src = window.dashStore.getCached('photo:' + w.id);
    if (cur.caption) patch('caption', '');
    const fr = cur.frame || 'none', sh = cur.shape || 'full';
    body.innerHTML = `
      <div class="x-photo f-${fr} s-${sh}">
        <div class="x-photo-img">${src ? `<img alt="" draggable="false" style="${tfStyle(cur)}" src="${window.dashImg.cssUrl('photo:' + w.id, src)}"/>` : '<button type="button" class="x-drop">Add photo or GIF</button>'}</div>
      </div>
      ${src ? `<div class="x-photo-ctl"><button type="button" class="x-photo-change" data-k="style">Style</button><button type="button" class="x-photo-change" data-k="pick">Change photo</button><button type="button" class="x-photo-change" data-k="clean" title="Remove a white or checkered background baked into the picture">${window.dashStore.getCached('photo:' + w.id + ':orig') ? 'Restore background' : 'Clear background'}</button></div>
      <div class="x-photo-panel" hidden>
        <div class="x-tf">
          <label>Zoom<input type="range" data-t="zoom" min="100" max="400" value="${cur.zoom || 100}"/></label>
          <label>Move left / right<input type="range" data-t="px" min="0" max="100" value="${cur.px ?? 50}"/></label>
          <label>Move up / down<input type="range" data-t="py" min="0" max="100" value="${cur.py ?? 50}"/></label>
          <label>Rotate<input type="range" data-t="rot" min="-180" max="180" value="${cur.rot || 0}"/></label>
          <div class="x-tf-btns"><button type="button" class="x-photo-change" data-k="rot90">Turn 90°</button><button type="button" class="x-photo-change" data-k="flip">Flip</button><button type="button" class="x-photo-change" data-k="tfreset">Reset</button></div>
        </div>
        <label>Frame<select data-k="frame">${Object.keys(FRAMES).map((k) => `<option value="${k}"${k === fr ? ' selected' : ''}>${FRAMES[k]}</option>`).join('')}</select></label>
        <label>Shape<select data-k="shape">${Object.keys(SHAPES).map((k) => `<option value="${k}"${k === sh ? ' selected' : ''}>${SHAPES[k]}</option>`).join('')}</select></label>
        <button type="button" class="x-photo-change" data-k="done">Done</button>
      </div>` : ''}`;
  };
  const patch = (k, v) => { const all = getWidgets(); const x = all.find((y) => y.id === w.id); if (x) { x[k] = v; saveWidgets(all); } };
  const pick = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => inp.files[0] && useFile(inp.files[0]);
    inp.click();
  };
  const useFile = (file) => {
    window.dashImg.compressImage(file, 1400, (url) => { window.dashStore.set('photo:' + w.id, url); render(); });
  };
  /* Some PNGs have the grey and white "transparent" checkerboard painted into the picture itself.
     This walks in from the edges and clears every pale, colourless pixel it reaches, so the real
     picture (paper, ink, colour) stays and the page shows through where the checkers were. */
  const clearBackground = () => {
    const orig = window.dashStore.getCached('photo:' + w.id + ':orig');
    if (orig) { window.dashStore.set('photo:' + w.id, orig); window.dashStore.del('photo:' + w.id + ':orig'); render(); return; }
    const cur = window.dashStore.getCached('photo:' + w.id); if (!cur) return;
    cleanBg(cur).then((png) => {
      window.dashStore.set('photo:' + w.id + ':orig', cur);
      window.dashStore.set('photo:' + w.id, png);
      render();
    });
  };
  body.addEventListener('click', (e) => {
    if (e.target.closest('[data-k="clean"]')) return clearBackground();
    const kk = e.target.closest('[data-k]');
    if (kk && ['rot90', 'flip', 'tfreset'].includes(kk.dataset.k)) {
      const all = getWidgets(), x = all.find((y) => y.id === w.id); if (!x) return;
      if (kk.dataset.k === 'rot90') x.rot = (((x.rot || 0) + 90 + 180) % 360) - 180;
      if (kk.dataset.k === 'flip') x.flip = !x.flip;
      if (kk.dataset.k === 'tfreset') { x.zoom = 100; x.px = 50; x.py = 50; x.rot = 0; x.flip = false; }
      saveWidgets(all); render(); const pn = body.querySelector('.x-photo-panel'); if (pn) pn.hidden = false; return;
    }
    if (e.target.closest('[data-k="style"]')) { const pn = body.querySelector('.x-photo-panel'); if (pn) pn.hidden = false; return; }
    if (e.target.closest('[data-k="done"]')) { const pn = body.querySelector('.x-photo-panel'); if (pn) pn.hidden = true; return; }
    if (e.target.closest('.x-drop') || e.target.closest('[data-k="pick"]')) pick();
  });
  body.addEventListener('change', (e) => { const k = e.target.dataset.k; if (k === 'frame' || k === 'shape') { patch(k, e.target.value); render(); body.querySelector('.x-photo-panel').hidden = false; } });
  body.addEventListener('input', (e) => {
    const t = e.target.dataset.t; if (!t) return;
    patch(t, +e.target.value);
    const img = body.querySelector('.x-photo-img img'), cur = getWidgets().find((y) => y.id === w.id);
    if (img && cur) img.style.cssText = tfStyle(cur);
  });
  node.addEventListener('dragover', (e) => { e.preventDefault(); node.classList.add('x-over'); });
  node.addEventListener('dragleave', () => node.classList.remove('x-over'));
  node.addEventListener('drop', (e) => {
    e.preventDefault(); node.classList.remove('x-over');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) useFile(f);
  });
  window.dashStore.ready.then(render);
  render();
  return node;
}

/* ── UP NEXT ───────────────────────────────────────────────── */
function buildNext(w) {
  const node = shell(w, 'Up next');
  const body = node.querySelector('.x-body');
  const render = () => {
    const open = load('plannerTasks', []).filter((t) => (t.status || (t.done ? 'done' : 'todo')) !== 'done');
    open.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || String(a.dueTime || '').localeCompare(String(b.dueTime || '')));
    const t = open[0];
    if (!t) { body.innerHTML = '<p class="x-note">Nothing left. Enjoy it.</p>'; return; }
    const c = load('schoolClasses', []).find((x) => x.id === t.classId);
    const diff = t.dueDate ? Math.round((new Date(t.dueDate + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 86400000) : null;
    const when = diff === null ? 'No date' : diff < 0 ? 'Overdue' : diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : `In ${diff} days`;
    body.innerHTML = `
      <h3 class="x-next-t">${esc(t.text)}</h3>
      <p class="x-note">${c ? esc(c.name) + ' \u00b7 ' : ''}${esc((t.type || 'task').charAt(0).toUpperCase() + (t.type || 'task').slice(1))}</p>
      <span class="x-when${diff !== null && diff < 0 ? ' late' : ''}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18v16H3zM3 10h18M8 3v4M16 3v4"/></svg>${when}${t.dueTime ? ' \u00b7 ' + esc(t.dueTime) : ''}</span>`;
  };
  render();
  const list = $('plannerList');
  if (list) new MutationObserver(render).observe(list, { childList: true });
  return node;
}

/* ── HOURS TRACKER ─────────────────────────────────────────── */
const HOUR_CATS = [
  { key: 'direct',   label: 'Direct client',          color: '#b8501e' },
  { key: 'isup',     label: 'Individual supervision', color: '#3a5d8f' },
  { key: 'gsup',     label: 'Group supervision',      color: '#6b4a8f' },
  { key: 'indirect', label: 'Indirect',               color: '#c98a2e' },
  { key: 'training', label: 'Training / education',   color: '#2e6f6a' },
  { key: 'research', label: 'Research',               color: '#4f7a3a' },
  { key: 'other',    label: 'Other',                  color: '#8a7c6b' },
];
// First run: start from the totals in the Fall 2026 hours sheet (28.67 h) so the card
// is not empty. Syncing the sheet replaces these.
const SEED = [['direct', 3.25], ['gsup', 7.5], ['indirect', 16.17], ['training', 1.75]];
const getHours = () => {
  const stored = load(HOURS_KEY, null);
  if (!stored) {
    const fresh = { goal: 600, sheetUrl: '', entries: SEED.map((e) => ({ id: uid(), cat: e[0], h: e[1], d: todayStr(), src: 'seed' })) };
    saveHours(fresh);
    return fresh;
  }
  return Object.assign({ goal: 600, entries: [], sheetUrl: '' }, stored);
};
const saveHours = (h) => save(HOURS_KEY, h);
const sumCat = (h, k) => h.entries.filter((e) => e.cat === k).reduce((a, e) => a + (+e.h || 0), 0);
const r2 = (n) => Math.round(n * 100) / 100;

// Tiny CSV reader (quoted fields, commas). Sheet columns: Category, Hours.
function parseCsv(txt) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"' && txt[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && txt[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function catKey(label) {
  const l = String(label).toLowerCase();
  if (l.includes('group')) return 'gsup';
  if (l.includes('individual')) return 'isup';
  if (l.includes('indirect')) return 'indirect';
  if (l.includes('direct')) return 'direct';
  if (l.includes('train')) return 'training';
  if (l.includes('research')) return 'research';
  return 'other';
}

function buildHours(w) {
  const node = shell(w, 'Practicum hours');
  const body = node.querySelector('.x-body');
  const render = () => {
    const h = getHours();
    const v = {}; HOUR_CATS.forEach((c) => { v[c.key] = sumCat(h, c.key); });
    const total = HOUR_CATS.reduce((a, c) => a + v[c.key], 0);
    const sup = v.isup + v.gsup, nonClient = total - v.direct - sup;
    const pct = Math.min(100, (total / h.goal) * 100);
    const bar = (label, val, right, of) => `<div class="x-hrow"><div><span>${label}</span><b>${right}</b></div><div class="x-bar"><i style="width:${Math.min(100, (val / of) * 100)}%"></i></div></div>`;
    const end = new Date(2027, 4, 12), now = new Date();
    const weeks = Math.max(1, (end - now) / (7 * 86400000));
    const perWeek = Math.max(0, h.goal - total) / weeks;
    const ratio = v.direct > 0 ? (sup / v.direct) * 5 : 0;
    const latest = h.entries.slice().sort((x, y) => String(y.d).localeCompare(String(x.d)))[0];
    const circ = 2 * Math.PI * 18;
    body.innerHTML = `
      <div class="x-hr-top">
        <div><div class="x-hr-big">${r2(total)} of ${h.goal} h</div></div>
        <div class="x-ring"><svg viewBox="0 0 44 44" width="48" height="48"><circle cx="22" cy="22" r="18" fill="none" stroke="var(--surface2)" stroke-width="4"/><circle cx="22" cy="22" r="18" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - pct / 100)}" transform="rotate(-90 22 22)"/></svg><b>${Math.round(pct)}%</b></div>
      </div>
      ${bar('Direct client (40% needed)', v.direct, `${r2(v.direct)} / 240 h`, 240)}
      ${bar('Supervision', sup, `${r2(sup)} h \u00b7 ${total ? Math.round(sup / total * 100) : 0}% of total`, h.goal)}
      ${bar('Non-client', nonClient, `${r2(nonClient)} h \u00b7 ${total ? Math.round(nonClient / total * 100) : 0}% of total`, h.goal)}
      <div class="x-chips">${HOUR_CATS.map((c) => `<span class="x-chip"><i style="background:${c.color}"></i>${c.label} ${r2(v[c.key])}</span>`).join('')}</div>
      <p class="x-hr-note">Supervision ratio: ${r2(ratio)} per 5 direct hours (need 1).<br>To finish by May 12 you need about ${Math.ceil(perWeek)} h a week.<br>Next form: Record of Supervised Hours, Fall, due Nov 14.</p>
      ${latest ? `<div class="x-glabel2">Latest entry</div><div class="x-latest"><span class="x-chip">${esc(String(latest.d).slice(5))}</span><span>${esc((HOUR_CATS.find((c) => c.key === latest.cat) || {}).label || '')}</span><b>${r2(latest.h)} h</b></div>` : ''}
      <details class="x-hr-more"><summary>Log hours or sync a sheet</summary>
        <form class="x-hr-add">
          <input name="h" type="number" step="0.25" min="0" placeholder="Hours" required/>
          <select name="cat">${HOUR_CATS.map((c) => `<option value="${c.key}">${c.label}</option>`).join('')}</select>
          <button class="btn-add" type="submit">Log</button>
        </form>
        <div class="x-hr-sheet">
          <input name="url" placeholder="Google Sheet link" value="${esc(h.sheetUrl)}"/>
          <button class="btn-ghost" type="button" data-sync>Sync now</button>
        </div>
        <label class="x-hr-file btn-ghost">Import file (.xlsx or .csv)<input name="file" type="file" accept=".csv,.xlsx,.xls" hidden/></label>
        <div class="x-hr-msg"></div>
      </details>`;
  };
  const msg = (t) => { const e = body.querySelector('.x-hr-msg'); if (e) e.textContent = t; };
  body.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target, v = parseFloat(f.h.value);
    if (!(v > 0)) return;
    const h = getHours();
    h.entries.push({ id: uid(), cat: f.cat.value, h: v, d: todayStr(), src: 'manual' });
    saveHours(h); render();
  });
  body.addEventListener('change', (e) => { if (e.target.name === 'url') { const h = getHours(); h.sheetUrl = e.target.value.trim(); saveHours(h); } });
  // Turn sheet rows (Category + Hours columns) into entries.
  const applyRows = (rows) => {
    const h = getHours();
    // The real header row can sit under a title and notes, so look through the first rows for it.
    let hr = -1, ci = -1, hi = -1;
    for (let i = 0; i < Math.min(rows.length, 20) && hr < 0; i++) {
      const head = (rows[i] || []).map((x) => String(x).trim().toLowerCase());
      const c = head.findIndex((x) => x.startsWith('categor') || x.endsWith('category')), k0 = head.findIndex((x) => x.startsWith('hour')), k = k0 >= 0 ? k0 : head.findIndex((x) => /\bhours?\b/.test(x) && !/log/.test(x));
      // Google leaves the label blank on number and date columns, so when only Category is named,
      // the Hours column is the numeric one right beside it (on the left).
      const nums = (col) => rows.slice(i + 1, i + 11).filter((r) => parseFloat((r || [])[col]) > 0).length;
      const kk = k >= 0 ? k : (c > 0 && nums(c - 1) > 0 ? c - 1 : -1);
      if (c >= 0 && kk >= 0) { hr = i; ci = c; hi = kk; }
    }
    if (hr < 0) { msg('Could not find Category and Hours columns. Add the Hours Log tab to the link (open that tab and copy the address) and try again. First cells I saw: ' + rows.slice(0, 6).map((r) => (r || []).filter(Boolean).slice(0, 3).join(' | ').slice(0, 40)).filter(Boolean).join(' / ')); return false; }
    const di = (rows[hr] || []).findIndex((x) => /(^|\s)date$/.test(String(x).trim().toLowerCase()));
    const di2 = di >= 0 ? di : (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String((rows[hr + 1] || [])[0] || '').trim()) ? 0 : -1);
    const isoDate = (v) => {
      const m = String(v || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : todayStr();
    };
    const fresh = rows.slice(hr + 1).filter((r) => parseFloat(r[hi]) > 0 && String(r[ci] || '').trim())
      .map((r) => ({ id: uid(), cat: catKey(r[ci]), h: parseFloat(r[hi]), d: di2 >= 0 ? isoDate(r[di2]) : todayStr(), src: 'sheet' }));
    h.entries = h.entries.filter((x) => x.src !== 'sheet' && x.src !== 'seed').concat(fresh);
    saveHours(h); render(); msg(`Imported ${fresh.length} rows.`);
    return true;
  };
  // A normal Google Sheets link works if the sheet is shared as "Anyone with the link can view".
  // A "Publish to web" CSV link works too.
  const sheetUrls = (url) => {
    const m = url.match(/\/spreadsheets\/d\/([\w-]+)/), g = (url.match(/[?#&]gid=(\d+)/) || [])[1] || '0';
    if (/\/d\/e\//.test(url)) return [url.includes('output=csv') ? url : url.replace(/\/pub.*$/, '') + '/pub?output=csv&gid=' + g];
    if (!m) return [url];
    const base = `https://docs.google.com/spreadsheets/d/${m[1]}`;
    const list = [];
    if (!/[?#&]gid=/.test(url)) list.push(`${base}/gviz/tq?tqx=out:csv&headers=0&sheet=${encodeURIComponent('Hours Log')}`);
    list.push(`${base}/gviz/tq?tqx=out:csv&headers=0&gid=${g}`, `${base}/export?format=csv&gid=${g}`);
    return list;
  };
  const loadXlsx = () => window.XLSX ? Promise.resolve(window.XLSX) : new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    sc.onload = () => res(window.XLSX); sc.onerror = rej; document.head.appendChild(sc);
  });
  body.addEventListener('change', async (e) => {
    if (e.target.name !== 'file' || !e.target.files[0]) return;
    const f = e.target.files[0]; msg('Reading file…');
    try {
      let rows;
      if (/\.csv$/i.test(f.name)) rows = parseCsv(await f.text());
      else {
        const X = await loadXlsx();
        const wb = X.read(await f.arrayBuffer(), { type: 'array' });
        const name = wb.SheetNames.find((n) => /hours/i.test(n)) || wb.SheetNames[0];
        rows = X.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
      }
      applyRows(rows);
    } catch (err) { msg('Could not read that file. Try saving the Hours Log tab as CSV.'); }
    e.target.value = '';
  });
  body.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-sync]')) return;
    const h = getHours();
    if (!h.sheetUrl) return msg('Paste your Google Sheet link first, or use Import file.');
    msg('Syncing…');
    for (const u of sheetUrls(h.sheetUrl)) {
      try {
        const r = await fetch(u);
        if (!r.ok) continue;
        const txt = await r.text();
        if (/^\s*<(!doctype|html)/i.test(txt)) continue;
        if (applyRows(parseCsv(txt))) return;
        return;
      } catch (err) { /* try next */ }
    }
    msg('Google blocked the read because the sheet is private. In the sheet, click Share, set General access to "Anyone with the link" (Viewer), copy that link here, and try again. Or use Import file below.');
  });
  render();
  return node;
}

/* ── SPOTIFY PLAYER ────────────────────────────────────────── */
// Device-local on purpose: tokens must never reach Firestore.
const SP = { id: 'spotify.clientId', tok: 'spotify.token', ver: 'spotify.verifier' };
const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative user-library-read user-library-modify';
const NEED_SCOPE = 'playlist-read-private';
const redirectUri = () => location.origin + location.pathname;
let spTimer = null, spTick = null;
const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function spLogin() {
  const cid = lsGet(SP.id);
  if (!cid) return;
  const ver = b64u(crypto.getRandomValues(new Uint8Array(48)));
  lsSet(SP.ver, ver);
  const chal = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ver)));
  const q = new URLSearchParams({ client_id: cid, response_type: 'code', redirect_uri: redirectUri(), scope: SCOPES, code_challenge_method: 'S256', code_challenge: chal });
  location.href = 'https://accounts.spotify.com/authorize?' + q;
}
async function spToken(params) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.assign({ client_id: lsGet(SP.id) }, params)),
  });
  if (!r.ok) throw new Error('token');
  const j = await r.json();
  const old = lsGet(SP.tok) || {};
  lsSet(SP.tok, { access: j.access_token, refresh: j.refresh_token || old.refresh, scope: j.scope || old.scope || '', exp: Date.now() + (j.expires_in - 60) * 1000 });
}
// Back from Spotify's login page with ?code=...
async function spHandleRedirect() {
  const u = new URL(location.href), code = u.searchParams.get('code');
  if (!code || !lsGet(SP.ver)) return;
  u.searchParams.delete('code'); u.searchParams.delete('state');
  history.replaceState(null, '', u.pathname + u.search + u.hash);
  try { await spToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), code_verifier: lsGet(SP.ver) }); }
  catch (_) {}
  lsSet(SP.ver, null);
}
async function spApi(path, method, body) {
  let t = lsGet(SP.tok);
  if (!t) return null;
  if (Date.now() > t.exp) { try { await spToken({ grant_type: 'refresh_token', refresh_token: t.refresh }); t = lsGet(SP.tok); } catch (_) { lsSet(SP.tok, null); return null; } }
  const r = await fetch('https://api.spotify.com/v1' + path, { method: method || 'GET', headers: { Authorization: 'Bearer ' + t.access, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204) return { empty: true };
  if (!r.ok) return { error: r.status };
  return r.json().catch(() => ({ empty: true }));
}
function stopSpotify() { clearInterval(spTimer); clearInterval(spTick); spTimer = spTick = null; }

const SP_ICON = {
  prev: '<svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5l11 7L4 19z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4M3 11v-1a4 4 0 014-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 01-4 4H3"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 5.8-8 11-8 11z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
};

function buildSpotify(w) {
  const node = shell(w, 'Spotify');
  const body = node.querySelector('.x-body');
  const fmt = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const st = { prog: 0, at: 0, dur: 0, playing: false, uri: '', id: '', lists: null, view: 'now', volDrag: false, repeat: 'off' };
  const hasScope = () => { const t = lsGet(SP.tok); return !!(t && (t.scope || '').includes(NEED_SCOPE)); };

  const drawSample = () => {
    stopSpotify();
    drawPlayer();
    q('.x-sp-title').textContent = 'Sample track one';
    q('.x-sp-artist').textContent = 'Artist name';
    q('.x-bar i').style.width = '40%';
    q('.x-t-cur').textContent = '1:15'; q('.x-t-dur').textContent = '3:24';
    body.querySelectorAll('button[data-sp]:not([data-sp=connect])').forEach((b) => { b.disabled = true; });
    q('.x-sp-vol').disabled = true;
    q('.x-sp-msg').innerHTML = '<button class="btn-ghost" type="button" data-sp="connect">Connect Spotify</button>';
  };
  const drawSetup = () => {
    stopSpotify();
    body.className = 'x-body';
    body.innerHTML = lsGet(SP.id)
      ? `<p class="x-note">Connect your Spotify account.</p><button class="btn-add" type="button" data-sp="login">Connect</button> <button class="btn-ghost" type="button" data-sp="reset">Change Client ID</button>`
      : `<p class="x-note">Paste your Spotify app Client ID. Redirect URI to register:</p><code class="x-code">${esc(redirectUri())}</code>
<div class="x-hr-sheet"><input name="cid" placeholder="Client ID"/><button class="btn-add" type="button" data-sp="save">Save</button></div>`;
  };

  /* Player shell. Built once so the record keeps spinning between polls. */
  const drawPlayer = () => {
    body.className = 'x-body x-sp2';
    body.innerHTML = `
<div class="x-sp-bg"></div>
<div class="x-sp-tabs" role="tablist">
  <button type="button" data-sp="tab-now" class="on">Now playing</button>
  <button type="button" data-sp="tab-lists">Playlists</button>
  <button type="button" data-sp="disconnect" class="x-sp-off">Disconnect</button>
</div>
<div class="x-sp-now">
  <div class="x-disc-wrap">
    <div class="x-disc"><div class="x-disc-label"><img alt="" hidden/></div></div>
    <div class="x-sleeve"><img alt="" hidden/><i class="x-sleeve-sun"></i></div>
    <div class="x-arm"><i></i></div>
  </div>
  <div class="x-sp-panel">
    <div class="x-sp-info">
      <div class="x-sp-meta"><b class="x-sp-title">Nothing playing</b><span class="x-sp-artist">Start Spotify on any device</span><em class="x-sp-album"></em></div>
      <button type="button" class="x-sp-like" data-sp="like" aria-label="Save to Liked Songs" aria-pressed="false">${SP_ICON.heart}</button>
    </div>
    <div class="x-bar" data-sp="seek"><i></i></div>
    <div class="x-sp-time"><span class="x-t-cur">0:00</span><span class="x-t-dur">0:00</span></div>
    <div class="x-sp-ctl">
      <button type="button" data-sp="shuffle" class="sm" aria-label="Shuffle" aria-pressed="false">${SP_ICON.shuffle}</button>
      <button type="button" data-sp="prev" aria-label="Previous">${SP_ICON.prev}</button>
      <button type="button" data-sp="toggle" class="big" aria-label="Play or pause">${SP_ICON.play}</button>
      <button type="button" data-sp="next" aria-label="Next">${SP_ICON.next}</button>
      <button type="button" data-sp="repeat" class="sm" aria-label="Repeat" aria-pressed="false">${SP_ICON.repeat}</button>
    </div>
    <div class="x-sp-foot"><i></i><span class="x-sp-dev"></span><input class="x-sp-vol" type="range" min="0" max="100" value="50" aria-label="Volume"/></div>
    <p class="x-sp-msg" role="status"></p>
  </div>
</div>
<div class="x-sp-lists" hidden></div>`;
  };
  const q = (s) => body.querySelector(s);
  const msg = (t) => { const m = q('.x-sp-msg'); if (m) { m.textContent = t || ''; clearTimeout(msg.t); if (t) msg.t = setTimeout(() => { m.textContent = ''; }, 4000); } };

  const paintProgress = () => {
    if (!q('.x-bar')) return;
    const cur = Math.min(st.dur, st.prog + (st.playing ? Date.now() - st.at : 0));
    q('.x-bar i').style.width = (st.dur ? (cur / st.dur) * 100 : 0) + '%';
    q('.x-t-cur').textContent = fmt(cur);
    q('.x-t-dur').textContent = fmt(st.dur);
  };

  const checkLiked = async (id) => {
    let r = await spApi('/me/library/contains?uris=' + encodeURIComponent('spotify:track:' + id));
    if (!Array.isArray(r)) r = await spApi('/me/tracks/contains?ids=' + id);
    if (Array.isArray(r) && st.id === id) { const b = q('.x-sp-like'); if (b) { b.classList.toggle('on', !!r[0]); b.setAttribute('aria-pressed', !!r[0]); } }
  };

  const update = (j) => {
    if (!q('.x-disc')) return;
    const it = j && j.item;
    st.playing = !!(j && j.is_playing && it);
    const disc = q('.x-disc-wrap');
    disc.classList.toggle('playing', st.playing);
    const tg = q('[data-sp=toggle]');
    tg.innerHTML = st.playing ? SP_ICON.pause : SP_ICON.play;
    if (!it) {
      q('.x-sp-title').textContent = 'Nothing playing';
      q('.x-sp-artist').textContent = 'Start Spotify on any device';
      q('.x-sp-album').textContent = '';
      q('.x-sleeve img').hidden = true; q('.x-disc-label img').hidden = true;
      q('.x-sp-bg').style.backgroundImage = '';
      st.prog = st.dur = 0; st.id = ''; paintProgress();
      return;
    }
    const images = (it.album && it.album.images) || (it.images) || [];
    const art = (images[1] || images[0] || {}).url || '';
    const names = it.artists ? it.artists.map((a) => a.name).join(', ') : (it.show ? it.show.name : '');
    q('.x-sp-title').textContent = it.name;
    q('.x-sp-artist').textContent = names;
    q('.x-sp-album').textContent = it.album ? it.album.name : '';
    const img = q('.x-sleeve img');
    if (art && img.getAttribute('src') !== art) img.src = art;
    img.hidden = !art;
    const lab = q('.x-disc-label img');
    if (art && lab.getAttribute('src') !== art) lab.src = art;
    lab.hidden = !art;
    q('.x-sp-bg').style.backgroundImage = art ? `url("${art.replace(/"/g, '')}")` : '';
    st.prog = j.progress_ms || 0; st.at = Date.now(); st.dur = it.duration_ms || 0; st.uri = it.uri;
    if (st.id !== it.id) { st.id = it.id; if (it.type === 'track') checkLiked(it.id); q('.x-sp-like').classList.remove('on'); }
    paintProgress();
    const sh = q('[data-sp=shuffle]'), rp = q('[data-sp=repeat]');
    sh.classList.toggle('on', !!j.shuffle_state); sh.setAttribute('aria-pressed', !!j.shuffle_state);
    st.repeat = j.repeat_state || 'off';
    rp.classList.toggle('on', st.repeat !== 'off'); rp.classList.toggle('one', st.repeat === 'track'); rp.setAttribute('aria-pressed', st.repeat !== 'off');
    if (j.device) {
      q('.x-sp-dev').textContent = 'Playing on ' + j.device.name; q('.x-sp-tabs').title = 'Playing on ' + j.device.name;
      if (!st.volDrag && j.device.volume_percent != null) q('.x-sp-vol').value = j.device.volume_percent;
    }
    if (st.view === 'tracks') markPlayingRow();
  };

  const poll = async () => {
    if (document.hidden || !lsGet(SP.tok)) return;
    const j = await spApi('/me/player');
    if (!j) return drawSample();
    if (j.error) { if (q('.x-sp-msg')) msg('Spotify error ' + j.error + '. Check your app settings.'); return; }
    update(j.empty ? null : j);
  };

  const start = () => {
    stopSpotify();
    if (!q('.x-disc')) drawPlayer();
    poll();
    spTimer = setInterval(poll, 4000);
    spTick = setInterval(paintProgress, 400);
  };

  const act = async (path, method, okMsg) => {
    const r = await spApi(path, method);
    if (r && r.error === 404) msg('No active device. Open Spotify somewhere first.');
    else if (r && r.error === 403) msg('Spotify blocked that. Playback control needs Premium.');
    else if (r && r.error) msg('Spotify error ' + r.error);
    else if (okMsg) msg(okMsg);
    setTimeout(poll, 350);
    return r;
  };

  /* ── playlists ── */
  const lists = () => q('.x-sp-lists');
  const showView = (v) => {
    st.view = v === 'now' ? 'now' : st.view === 'tracks' && v === 'lists' ? 'tracks' : v;
    q('.x-sp-now').hidden = v !== 'now';
    lists().hidden = v === 'now';
    q('[data-sp=tab-now]').classList.toggle('on', v === 'now');
    q('[data-sp=tab-lists]').classList.toggle('on', v !== 'now');
    st.view = v;
  };
  const reconnectHtml = () => `<p class="x-note">Playlists need extra permission.</p><button class="btn-add" type="button" data-sp="login">Reconnect Spotify</button>`;
  const coverOf = (o) => ((o.images || [])[o.images && o.images.length > 1 ? 1 : 0] || {}).url || '';

  const drawLists = async () => {
    showView('lists');
    const el = lists();
    if (!hasScope()) { el.innerHTML = reconnectHtml(); return; }
    if (!st.lists) {
      el.innerHTML = '<p class="x-note">Loading playlists…</p>';
      const r = await spApi('/me/playlists?limit=50');
      if (!r || r.error) { el.innerHTML = `<p class="x-note">Couldn't load playlists${r && r.error ? ' (' + r.error + ')' : ''}.</p>`; return; }
      st.lists = (r.items || []).filter(Boolean);
    }
    el.innerHTML = `
<input class="x-sp-find" type="search" placeholder="Filter playlists" aria-label="Filter playlists"/>
<ul class="x-pl">${st.lists.map((p) => `
<li><button type="button" data-sp="open" data-id="${esc(p.id)}" data-name="${esc(p.name)}">
<span class="x-pl-art">${coverOf(p) ? `<img alt="" loading="lazy" src="${esc(coverOf(p))}"/>` : ''}</span>
<span class="x-pl-meta"><b>${esc(p.name)}</b><span>${esc(p.owner && p.owner.display_name || '')}</span></span>
</button></li>`).join('') || '<li class="x-note">No playlists found.</li>'}</ul>`;
  };

  const drawTracks = async (id, name) => {
    st.view = 'tracks'; st.plId = id;
    const el = lists();
    el.innerHTML = `<div class="x-pl-head"><button type="button" data-sp="lists-back" aria-label="Back to playlists">${SP_ICON.back}</button><b>${esc(name)}</b><button type="button" class="btn-add" data-sp="play-list" data-id="${esc(id)}">Play</button></div><p class="x-note">Loading…</p>`;
    // /items replaced /tracks for dev-mode apps in 2026; fall back for older ones.
    let r = await spApi('/playlists/' + id + '/items?limit=100');
    if (r && r.error) r = await spApi('/playlists/' + id + '/tracks?limit=100');
    const head = el.firstElementChild.outerHTML;
    if (!r || r.error) { el.innerHTML = head + `<p class="x-note">${r && r.error === 403 ? 'Spotify only lets this app read playlists you own or collaborate on.' : 'Couldn\'t load tracks.'}</p>`; return; }
    const rows = (r.items || []).map((e) => e && (e.item || e.track)).filter((t) => t && t.uri && t.type !== 'episode');
    el.innerHTML = head + `<ul class="x-tr">${rows.map((t) => `
<li><button type="button" data-sp="play-track" data-uri="${esc(t.uri)}" data-id="${esc(id)}">
<span class="x-tr-n"><img alt="" loading="lazy" src="${esc(coverOf(t.album || {}))}"/></span>
<span class="x-pl-meta"><b>${esc(t.name)}</b><span>${esc((t.artists || []).map((a) => a.name).join(', '))}</span></span>
<span class="x-tr-d">${fmt(t.duration_ms)}</span>
</button></li>`).join('') || '<li class="x-note">Empty playlist.</li>'}</ul>`;
    markPlayingRow();
  };
  const markPlayingRow = () => {
    body.querySelectorAll('.x-tr button').forEach((b) => b.classList.toggle('now', b.dataset.uri === st.uri));
  };

  /* ── events ── */
  body.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-sp]'); if (!a) return;
    const k = a.dataset.sp;
    if (k === 'save') { const v = body.querySelector('[name=cid]').value.trim(); if (v) { lsSet(SP.id, v); drawSetup(); } }
    else if (k === 'connect') drawSetup();
    else if (k === 'disconnect') { lsSet(SP.tok, null); stopSpotify(); drawSample(); }
    else if (k === 'login') spLogin();
    else if (k === 'reset') { lsSet(SP.id, null); lsSet(SP.tok, null); drawSetup(); }
    else if (k === 'tab-now') showView('now');
    else if (k === 'tab-lists') { if (st.view === 'tracks') showView('tracks'); else drawLists(); }
    else if (k === 'lists-back') drawLists();
    else if (k === 'open') drawTracks(a.dataset.id, a.dataset.name);
    else if (k === 'play-list') { await act('/me/player/play', 'PUT'); /* replaced below */ }
    else if (k === 'prev') act('/me/player/previous', 'POST');
    else if (k === 'next') act('/me/player/next', 'POST');
    else if (k === 'toggle') { st.playing = !st.playing; st.prog = st.prog; st.at = Date.now(); act(st.playing ? '/me/player/play' : '/me/player/pause', 'PUT'); }
    else if (k === 'shuffle') act('/me/player/shuffle?state=' + !a.classList.contains('on'), 'PUT');
    else if (k === 'repeat') act('/me/player/repeat?state=' + (st.repeat === 'off' ? 'context' : st.repeat === 'context' ? 'track' : 'off'), 'PUT');
    else if (k === 'seek') {
      const r = a.getBoundingClientRect(), ms = Math.round(((e.clientX - r.left) / r.width) * st.dur);
      st.prog = ms; st.at = Date.now(); paintProgress();
      act('/me/player/seek?position_ms=' + ms, 'PUT');
    }
    else if (k === 'like' && st.id) {
      const on = !a.classList.contains('on'), uri = encodeURIComponent('spotify:track:' + st.id);
      a.classList.toggle('on', on); a.setAttribute('aria-pressed', on);
      let r = await spApi('/me/library?uris=' + uri, on ? 'PUT' : 'DELETE');
      if (r && r.error) r = await spApi('/me/tracks?ids=' + st.id, on ? 'PUT' : 'DELETE');
      if (r && r.error) { a.classList.toggle('on', !on); a.setAttribute('aria-pressed', !on); msg('Couldn\'t update Liked Songs. Try reconnecting Spotify.'); }
      else msg(on ? 'Saved to Liked Songs' : 'Removed from Liked Songs');
    }
  });
  // play actions need a JSON body, which spApi supports through its third arg
  body.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-sp=play-list],[data-sp=play-track]'); if (!a) return;
    const ctx = 'spotify:playlist:' + a.dataset.id;
    const payload = a.dataset.sp === 'play-track' ? { context_uri: ctx, offset: { uri: a.dataset.uri } } : { context_uri: ctx };
    const r = await spApi('/me/player/play', 'PUT', payload);
    if (r && r.error === 404) { showView('now'); msg('No active device. Open Spotify somewhere first.'); }
    else if (r && r.error === 403) { showView('now'); msg('Spotify blocked that. Playback control needs Premium.'); }
    else { showView('now'); setTimeout(poll, 500); }
  });
  body.addEventListener('input', (e) => {
    if (e.target.matches('.x-sp-vol')) {
      st.volDrag = true; clearTimeout(st.volT);
      const v = e.target.value;
      st.volT = setTimeout(async () => { await spApi('/me/player/volume?volume_percent=' + v, 'PUT'); st.volDrag = false; }, 200);
    } else if (e.target.matches('.x-sp-find')) {
      const t = e.target.value.toLowerCase();
      body.querySelectorAll('.x-pl li').forEach((li) => { li.hidden = !li.textContent.toLowerCase().includes(t); });
    }
  });

  stopSpotify();
  if (lsGet(SP.tok)) start(); else drawSample();
  spHandleRedirect().then(() => { if (lsGet(SP.tok) && !spTimer) start(); });
  return node;
}

/* ── OVERDUE CARRY-OVER ────────────────────────────────────── */
function setupCarry() {
  const list = $('plannerList');
  if (!list) return;
  const chip = document.createElement('div');
  chip.id = 'xCarry'; chip.className = 'x-carry'; chip.hidden = true;
  const host = $('xCarryHost');
  if (host) host.appendChild(chip); else list.parentElement.insertBefore(chip, list);
  const overdue = () => load('plannerTasks', []).filter((t) => !t.done && t.dueDate && t.dueDate < todayStr() && !t.repeat);
  const refresh = () => {
    const n = overdue().length;
    chip.hidden = !n;
    chip.innerHTML = n ? `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V4M4 4h13l-2 4 2 4H4"/></svg><span class="x-carry-t"><b>${n}</b> task${n === 1 ? ' is' : 's are'} overdue</span><span class="x-carry-btns"><button type="button" class="btn-ghost" data-to="0">Move to today</button><button type="button" class="btn-ghost" data-to="1">Tomorrow</button></span>` : '';
  };
  chip.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const target = new Date(); target.setDate(target.getDate() + (+btn.dataset.to || 0));
    const tk = keyOf(target);
    const tasks = load('plannerTasks', []), ids = new Set(overdue().map((t) => t.id));
    const before = new Map(tasks.filter((t) => ids.has(t.id)).map((t) => [t.id, t.dueDate]));
    tasks.forEach((t) => { if (ids.has(t.id)) t.dueDate = tk; });
    save('plannerTasks', tasks);
    window.dash.renderPlanner(); window.dash.renderAgenda();
    toast(`Moved ${ids.size} to ${+btn.dataset.to ? 'tomorrow' : 'today'}`, () => {
      const cur = load('plannerTasks', []);
      cur.forEach((t) => { if (before.has(t.id)) t.dueDate = before.get(t.id); });
      save('plannerTasks', cur);
      window.dash.renderPlanner(); window.dash.renderAgenda();
    });
  });
  new MutationObserver(refresh).observe(list, { childList: true });
  refresh();
}

/* ── QUICK CAPTURE (phone) ─────────────────────────────────── */
const WD = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
// "read ch 4 #psych friday 5pm daily" -> {text, date, time, classId, repeat}
function parseCapture(raw) {
  let text = ' ' + raw + ' ', date = '', time = '', repeat = '', classId = '';
  const take = (re, fn) => { const m = text.match(re); if (m) { fn(m); text = text.replace(re, ' '); } };
  take(/\s#(\w+)/i, (m) => {
    const q = m[1].toLowerCase();
    const c = load('schoolClasses', []).find((x) => x.name.toLowerCase().includes(q));
    if (c) classId = c.id; else text += ' #' + m[1];
  });
  take(/\s(daily|weekdays|weekly|monthly)\b/i, (m) => { repeat = m[1].toLowerCase(); });
  take(/\s(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/i, (m) => {
    let h = +m[1] % 12; if (m[3].toLowerCase() === 'pm') h += 12;
    time = pad(h) + ':' + (m[2] || '00');
  });
  const now = new Date(); now.setHours(0, 0, 0, 0);
  take(/\s(today|tonight)\b/i, () => { date = keyOf(now); });
  take(/\s(tomorrow|tmrw)\b/i, () => { const d = new Date(now); d.setDate(d.getDate() + 1); date = keyOf(d); });
  take(/\s(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/i, (m) => {
    const d = new Date(now); const t = WD.indexOf(m[1].toLowerCase().slice(0, 3));
    d.setDate(d.getDate() + ((t - d.getDay() + 7) % 7 || 7)); date = keyOf(d);
  });
  if (repeat && !date) date = keyOf(now);
  return { text: text.replace(/\s+/g, ' ').trim(), date, time, classId, repeat };
}
function closeCapture() { const s = $('xCapture'); if (s) s.remove(); }
function openCapture() {
  closeCapture();
  const s = document.createElement('div');
  s.id = 'xCapture'; s.className = 'x-modal open x-sheet';
  s.innerHTML = `<form class="x-modal-card">
    <input class="t-input" name="q" placeholder="read ch 4 #psych friday 5pm" autocomplete="off" autofocus/>
    <div class="x-hint" id="xCapHint">Try: tomorrow, friday, 5pm, daily, #class</div>
    <div class="x-add-row"><button class="btn-ghost" type="button" data-x="close">Cancel</button><button class="btn-add" type="submit">Add task</button></div></form>`;
  const q = s.querySelector('[name=q]'), hint = s.querySelector('#xCapHint');
  q.addEventListener('input', () => {
    const p = parseCapture(q.value), bits = [];
    if (p.date) bits.push(p.date); if (p.time) bits.push(p.time); if (p.repeat) bits.push(p.repeat);
    if (p.classId) { const c = load('schoolClasses', []).find((x) => x.id === p.classId); if (c) bits.push(c.name); }
    hint.textContent = bits.length ? bits.join(' · ') : 'Try: tomorrow, friday, 5pm, daily, #class';
  });
  s.addEventListener('click', (e) => { if (e.target === s || e.target.closest('[data-x="close"]')) closeCapture(); });
  s.addEventListener('submit', (e) => {
    e.preventDefault();
    const p = parseCapture(q.value);
    if (!p.text) return;
    // One creation path: fill the planner's own form and let addTask run.
    $('taskName').value = p.text; $('taskDue').value = p.date;
    if ($('taskTime')) $('taskTime').value = p.time;
    $('taskClass').value = p.classId; $('taskRepeat').value = p.repeat;
    window.dash.addTask();
    closeCapture();
    toast('Task added');
  });
  document.body.appendChild(s);
  q.focus();
}

/* ── LEFT RAIL (Sky and Forest) ───────────────────────────────
   renderQlinks() rebuilds #sideRailInner whenever links change, so the
   extra sections are re-added by a MutationObserver. Quick links, Add
   link and Edit links stay owned by dashboard.js. */
const SPACES = [
  { label: 'Home',     icon: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10', act: () => window.scrollTo({ top: 0, behavior: 'smooth' }) },
  { label: 'Planner',  icon: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2', act: () => window.dashUtil.scrollToCard('planner') },
  { label: 'Calendar', icon: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4', act: () => window.dashUtil.scrollToCard('agenda') },
  { label: 'Classes',  icon: 'M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5', act: () => window.dash.openClassesModal() },
  { label: 'Practicum', icon: 'M9 4h6l1 2h3v15H5V6h3zM9 14l2 2 4-4', act: () => { const h = document.querySelector('.block-x-hours'); h ? window.dashUtil.scrollToCard(h.dataset.cardId) : addWidget('hours'); } },
];
const svgI = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="${d}"/></svg>`;
try { localStorage.removeItem('xRailMini'); document.body.classList.remove('rail-mini'); } catch (_) {}
function markSpace() {
  const btns = document.querySelectorAll('.x-space[data-i]'); if (!btns.length) return;
  const mid = window.scrollY + window.innerHeight * 0.35;
  const top = (id) => { const n = document.querySelector('.block[data-card-id="' + id + '"]'); return n ? n.getBoundingClientRect().top + window.scrollY : 1e9; };
  let on = 0; if (mid >= top('agenda')) on = 2; else if (mid >= top('planner')) on = 1;
  btns.forEach((b) => b.classList.toggle('on', +b.dataset.i === on));
}
window.addEventListener('scroll', markSpace, { passive: true });
function decorateRail() {
  const wrap = $('sideRailInner');
  if (!wrap || wrap.querySelector('.x-spaces')) return;
  const brand = wrap.querySelector('.side-rail-brand');
  const spaces = document.createElement('div');
  spaces.className = 'x-spaces';
  spaces.innerHTML = '<div class="x-glabel">Spaces</div>' + SPACES.map((s, i) =>
    `<button type="button" class="x-space" data-i="${i}">${svgI(s.icon)}<span>${s.label}</span></button>`).join('') +
    '<div class="x-glabel">Quick links</div>';
  spaces.addEventListener('click', (e) => { const b = e.target.closest('.x-space'); if (b) SPACES[+b.dataset.i].act(); });
  brand ? brand.after(spaces) : wrap.prepend(spaces);

  const foot = document.createElement('div');
  foot.className = 'x-railfoot';
  foot.innerHTML = [
    ['Quick capture', 'M12 5v14M5 12h14', openCapture],
    ['Add widget', 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13v7M13 16.5h7', openGallery],
    ['Customize', 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6', () => window.tweaks && window.tweaks.open()],
  ].map((r, i) => `<button type="button" class="x-space dashed" data-f="${i}">${svgI(r[1])}<span>${r[0]}</span></button>`).join('');
  const acts = [openCapture, openGallery, () => window.tweaks && window.tweaks.open()];
  foot.addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) acts[+b.dataset.f](); });
  const stamp = document.createElement('div'); stamp.className = 'x-stamp'; stamp.textContent = 'Redesign build 5';
  foot.appendChild(stamp);
  wrap.appendChild(foot);
  markSpace();
}
function watchRail() {
  const wrap = $('sideRailInner');
  if (!wrap) return;
  decorateRail();
  new MutationObserver(() => { if (!wrap.querySelector('.x-spaces')) decorateRail(); }).observe(wrap, { childList: true });
}

/* Phone tab bar (shown only on small screens by redesign.css). */
function buildTabbar() {
  const bar = document.createElement('nav');
  bar.className = 'x-tabbar'; bar.setAttribute('aria-label', 'Sections');
  const tabs = [
    ['Home', 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10', () => window.scrollTo({ top: 0, behavior: 'smooth' })],
    ['Planner', 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2', () => window.dashUtil.scrollToCard('planner')],
    ['Calendar', 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4', () => window.dashUtil.scrollToCard('agenda')],
    ['Habits', 'M20 6L9 17l-5-5', () => window.dashUtil.scrollToCard('habits')],
    ['Links', 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7', () => window.dash.toggleMobileLinks()],
  ];
  bar.innerHTML = tabs.map((t, i) => `<button type="button" data-t="${i}">${svgI(t[1])}<span>${t[0]}</span></button>`).join('');
  bar.addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) tabs[+b.dataset.t][2](); });
  document.body.appendChild(bar);
}


/* ── CARD RESTRUCTURE to the Paper mockup (idempotent) ─────────
   Moves a few existing nodes around (ids and handlers are untouched) so the
   cards read like the mockup: eyebrow + serif summary + ring, ghost buttons with text, etc. */
const ICO = {
  trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>',
  get palette() { return PALETTE; },
};
function restyleCards() {
  const q = (s) => document.querySelector(s);
  // Habits + Dailies: eyebrow over a serif summary, ring at right
  [['habits', 'habitSummary', 'Colors and habits', 'editHabitBtn'], ['dailies', 'dailySummary', 'Edit dailies', 'editDailyBtn']].forEach(([card, sumId, btnLabel, btnId]) => {
    const c = q('.block[data-card-id="' + card + '"]');
    if (!c || c.dataset.restyled) return;
    const hl = c.querySelector('.habits-header-left');
    if (!hl) return;
    const lab = hl.querySelector('.sec-label'), ring = hl.querySelector('.ring-wrap');
    const wrap = document.createElement('div'); wrap.className = 'x-hdr-text';
    const h2 = document.createElement('h2'); h2.id = sumId; h2.className = 'x-summary'; h2.textContent = '';
    wrap.append(lab, h2);
    hl.prepend(wrap);
    if (ring) hl.appendChild(ring);
    const btn = $(btnId);
    if (btn) {
      btn.className = 'btn-ghost x-ghost-end';
      btn.innerHTML = ICO.palette + '<span>' + btnLabel + '</span>';
      const scale = c.querySelector('.block-scale') || c;
      const grid = c.querySelector('.habits-grid') || null;
      const holder = document.createElement('div'); holder.className = 'x-end-row'; holder.appendChild(btn);
      const panel = c.querySelector('.habits-edit-panel, .dailies-edit-panel');
      if (card === 'habits' && grid) grid.after(holder); else scale.appendChild(holder);
      if (panel && card === 'habits') holder.after(panel);
    }
    c.dataset.restyled = '1';
  });
  if (window.dash) { window.dash.renderHabits && window.dash.renderHabits(); window.dash.renderDailies && window.dash.renderDailies(); }

  // Dailies: one add box per group
  document.querySelectorAll('.daily-group').forEach((g) => {
    if (g.querySelector('.x-gadd')) return;
    const key = g.dataset.group, label = (g.querySelector('.daily-group-label') || {}).textContent || '';
    const nice = key.charAt(0).toUpperCase() + key.slice(1);
    const row = document.createElement('div'); row.className = 'x-gadd';
    row.innerHTML = `<input class="t-input" placeholder="Add to ${nice}" aria-label="Add to ${nice}"/><button class="btn-add" type="button" aria-label="Add to ${nice}">+</button>`;
    const go = () => {
      const v = row.querySelector('input').value.trim(); if (!v) return;
      const hid = $('newDailyLabel-' + key);
      if (hid) { hid.value = v; window.dash.addDailyItem(key); row.querySelector('input').value = ''; }
    };
    row.querySelector('button').onclick = go;
    row.querySelector('input').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    g.appendChild(row);
  });

  // Ghost buttons with words, like the mockup
  [['clearDoneLife', 'Clear done'], ['clearDoneShopping', 'Clear checked']].forEach(([fn, txt]) => {
    const b = q('.icon-btn[onclick*="' + fn + '"]');
    if (b && !b.dataset.labeled) { b.className = 'btn-ghost'; b.innerHTML = ICO.trash + '<span>' + txt + '</span>'; b.dataset.labeled = '1'; }
  });

  // Currently: add a title with an input, like the mockup
  const cc = q('#currentlyCarousel');
  const ctl = q('.block[data-card-id="currently"] .carousel-controls');
  if (ctl && !ctl.parentElement.querySelector('.x-cur-add')) {
    const old = ctl.querySelector('.btn-ghost'); if (old) old.style.display = 'none';
    const row = document.createElement('div'); row.className = 'x-cur-add';
    row.innerHTML = '<input class="t-input" placeholder="Add a title"/><button class="btn-add" type="button">Add</button>';
    const go = () => { const v = row.querySelector('input').value.trim(); if (v) { window.dash.curAdd(v); row.querySelector('input').value = ''; } };
    row.querySelector('button').onclick = go;
    row.querySelector('input').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    ctl.after(row);
  }
}

/* ── DEFAULT PLACEMENT LOGIC ───────────────────────────────────
   The page is built in bands so every edge lines up:
   1. Full width: the week strip, then the greeting.
   2. A wide column plus a narrow column (63 / 37): the planner and agenda on the wide side,
      Up next and Hours on the narrow side. Dates and Goals join the narrow side only while it is
      shorter than the wide side, so the two sides end near the same line.
   3. Three equal columns for everything else. Cards are dealt tallest first into whichever column is
      currently shortest, then sorted back into a steady reading order inside each column.
   Heights are measured from the cards themselves and the deal runs twice, because a card's height
   changes once its column width does. */
const WIDE_FIRST = ['planner', 'agenda'];
const NARROW_FIRST = ['@next', '@hours'];
const NARROW_MORE = ['dates', 'goals'];
const READ_ORDER = ['habits', 'dailies', 'goals', 'dates', 'life', 'shopping', 'currently', 'health', 'people', '@spotify', 'clock', 'pomodoro'];
function cardHeight(id) {
  const n = document.querySelector('#blocks .block[data-card-id="' + id + '"]');
  const h = n ? n.getBoundingClientRect().height : 0;
  return h > 40 ? h : 180;
}
function planRows(ids) {
  const real = (k) => ids[k] || k;
  const all = [...document.querySelectorAll('#blocks .block[data-card-id]')].map((b) => b.dataset.cardId);
  const h = (k) => cardHeight(real(k));
  const sum = (arr) => arr.reduce((t, k) => t + h(k), 0);
  const wide = WIDE_FIRST.filter((k) => all.includes(real(k)));
  const narrow = NARROW_FIRST.filter((k) => all.includes(real(k)));
  const more = [];
  NARROW_MORE.forEach((k) => { if (all.includes(real(k)) && sum(narrow) < sum(wide)) narrow.push(k); else more.push(k); });
  const placed = new Set([...wide, ...narrow, 'daystrip', 'header'].map(real));
  const pool = all.filter((id) => !placed.has(id));
  const rank = (id) => { const i = READ_ORDER.findIndex((k) => real(k) === id); return i < 0 ? 100 : i; };
  const cols = [[], [], []], hs = [0, 0, 0];
  [...pool].sort((x, y) => cardHeight(y) - cardHeight(x) || rank(x) - rank(y)).forEach((id) => {
    const i = hs.indexOf(Math.min(...hs));
    cols[i].push(id); hs[i] += cardHeight(id);
  });
  cols.forEach((c) => c.sort((x, y) => rank(x) - rank(y)));
  const out = [];
  const put = (id, x, w, y) => out.push({ id, x, w, y, h: null });
  put('daystrip', 0, 12, 0);
  put('header', 0, 12, 1);
  wide.forEach((k, i) => put(real(k), 0, 7, 1000 + i));
  narrow.forEach((k, i) => put(real(k), 7, 5, 1000 + i));
  cols.forEach((c, ci) => c.forEach((id, i) => put(id, ci * 4, 4, 2000 + i)));
  return out;
}
function applyPaperLayout() {
  const need = (kind) => {
    let w = getWidgets().find((x) => x.kind === kind);
    if (!w) { w = { id: kind + '-' + Date.now().toString(36), kind }; saveWidgets(getWidgets().concat(w)); const n = mount(w); if (n) document.getElementById('blocks').appendChild(n); }
    return w.id;
  };
  const ids = { '@next': need('next'), '@hours': need('hours'), '@spotify': need('spotify') };
  // Hidden cards keep their slot so showing them later does not reshuffle the page.
  window.blocks.applyGrid(planRows(ids));
  window.blocks.applyGrid(planRows(ids));
  const p = getPrefs();
  p.hidden = p.hidden.filter((id) => !Object.values(ids).includes(id));
  setPrefs(p);
  decorateBlocks();
}
function seedLayout() {
  const p = getPrefs();
  if (!p.layoutEven) { applyPaperLayout(); const q = getPrefs(); q.paperLayout = q.layoutEven = true; q.seeded = q.seeded2 = true; setPrefs(q); }
}
function resetPlacement() { applyPaperLayout(); }

/* ── CARD HOVER CHROME (name pill, hide, customize, add note) ──
   The drag handle, background button and note button already exist from blocks.js and
   dashboard.js. This labels the handle and adds a hide button, then CSS lays them out like the mockup. */
const EYE_OFF = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.9 17.9A10.1 10.1 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M1 1l22 22"/></svg>';
const PALETTE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="14.5" cy="7" r="1"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
function decorateBlocks() {
  document.querySelectorAll('.block[data-card-id]').forEach((b) => {
    const handle = b.querySelector(':scope > .block-handle');
    if (handle) handle.dataset.name = labelOf(b);
    if (b.querySelector(':scope > .x-chrome') || !handle) return;
    const c = document.createElement('div');
    c.className = 'x-chrome';
    c.innerHTML = `<button type="button" data-a="hide" title="Hide this card" aria-label="Hide this card">${EYE_OFF}</button>
      <button type="button" data-a="bg" title="Customize card" aria-label="Customize card">${PALETTE}</button>
      <button type="button" data-a="add" title="Add a note below" aria-label="Add a note below">${PLUS}</button>`;
    c.addEventListener('mousedown', (e) => e.stopPropagation());
    c.addEventListener('click', (e) => {
      const a = e.target.closest('button'); if (!a) return;
      e.stopPropagation();
      if (a.dataset.a === 'hide') {
        const id = b.dataset.cardId, p = getPrefs();
        if (!p.hidden.includes(id)) p.hidden.push(id);
        setPrefs(p);
        toast(labelOf(b) + ' hidden', () => { const q = getPrefs(); q.hidden = q.hidden.filter((x) => x !== id); setPrefs(q); });
      } else if (a.dataset.a === 'bg') {
        const btn = b.querySelector(':scope > .card-bg-btn'); if (btn) btn.click();
      } else {
        const btn = b.querySelector(':scope > .block-insert'); if (btn) btn.click();
      }
    });
    b.appendChild(c);
  });
}

/* ── BOOT ──────────────────────────────────────────────────── */
function initUi() {
  // Phone quick-capture button (CSS shows it on small screens only)
  const f = document.createElement('button');
  f.className = 'x-fab'; f.type = 'button'; f.setAttribute('aria-label', 'Quick add task'); f.textContent = '+';
  f.onclick = openCapture;
  document.body.appendChild(f);
  setupCarry();
  watchRail();
  buildTabbar();
  // blocks.boot() runs after this (it waits for the image store), so wait for the grid.
  let tries = 0;
  const wait = setInterval(() => {
    if (document.querySelector('#blocks > .block-scale, #blocks.is-grid')) { clearInterval(wait); seedLayout(); applyPrefs(); decorateBlocks(); restyleCards(); setInterval(decorateBlocks, 1500); }
    else if (++tries > 100) clearInterval(wait);
  }, 100);
  applyPrefs();
}

/* ── TAP TO REVEAL CARD CONTROLS (touch screens) ───────────── */
document.addEventListener('click', (e) => {
  if (!window.matchMedia('(hover: none), (max-width: 860px)').matches) return;
  const hit = e.target.closest('#blocks > .block');
  document.querySelectorAll('#blocks > .block.x-tap').forEach((b) => { if (b !== hit) b.classList.remove('x-tap'); });
  if (hit && !e.target.closest('.x-chrome, .block-handle, .card-bg-btn, .block-insert')) hit.classList.add('x-tap');
}, true);

restoreWidgets();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUi);
else window.addEventListener('load', initUi);
window.addEventListener('load', applyPrefs);

window.extras = { cleanBg, resetPlacement, decorateBlocks, openGallery, addWidget, openCapture, parseCapture };
})();
