/* ──────────────────────────────────────────────────────────────
   BLOCKS — free 12-column grid: drag anywhere, snap-to-cell resize, + insert
   ────────────────────────────────────────────────────────────────
   LAYOUT MODEL:
     #blocks is a 12-column CSS grid on desktop. Each card has a cell
     position and size: { id, x, y, w, h } where x and w are columns (0-11)
     and y and h are rows of 10px. Cards float up to close gaps, and when you
     drag or resize one the others shuffle out of the way. h is null for a
     card that sizes itself to its content (the default), or a number once
     you have resized it by hand. On phones the same cards simply stack in
     reading order. All pointer maths is done in CSS pixels so it stays
     exact even when the page is scaled (the 80% default).
   ────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const STORAGE_LAYOUT_V4 = 'dashboard.blocks.layout.v4';   // free grid items
  const STORAGE_LAYOUT_V3 = 'dashboard.blocks.layout.v3';   // legacy nested rows/cols
  const STORAGE_LAYOUT_V2 = 'dashboard.blocks.layout.v2';   // legacy flat fracs
  const STORAGE_LAYOUT_V1 = 'dashboard.blocks.layout.v1';   // legacy span 1|2
  const STORAGE_NOTES     = 'dashboard.blocks.notes.v1';
  const STORAGE_MHEIGHTS  = 'dashboard.blocks.mheights.v1'; // phone-only crop heights, kept apart from desktop --bh
  const STORAGE_TABH      = 'dashboard.blocks.tabheights.v1'; // per-tab heights for tabbed cards (agenda): { "id::tab": {d,m} }

  const MIN_FRAC   = 0.12;
  const MAX_FRAC   = 1;
  const MIN_HEIGHT = 40;    // px — free vertical resize floor
  const COMPACT_H  = 92;    // px — below this, trim padding so widgets can go truly compact
  const GAP        = 16;    // px — space between cards (column gap and bottom margin)
  const COLS       = 12;    // grid columns
  const UNIT       = 10;    // px — height of one grid row
  const MIN_W      = 2;     // narrowest card, in columns
  const MIN_H      = 4;     // shortest card, in rows

  // Six-dot grip icon, drawn as an SVG so it scales crisply.
  const HANDLE_SVG = `
    <svg viewBox="0 0 10 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true">
      <circle cx="2.2" cy="2.5"  r="1.25"/><circle cx="7.8" cy="2.5"  r="1.25"/>
      <circle cx="2.2" cy="8"    r="1.25"/><circle cx="7.8" cy="8"    r="1.25"/>
      <circle cx="2.2" cy="13.5" r="1.25"/><circle cx="7.8" cy="13.5" r="1.25"/>
    </svg>`;

  const GRIP_SVG = `
    <svg viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="1.1"/>
      <circle cx="8"  cy="12" r="1.1"/>
      <circle cx="12" cy="8"  r="1.1"/>
      <circle cx="4"  cy="12" r="1.1"/>
      <circle cx="8"  cy="8"  r="1.1"/>
      <circle cx="12" cy="4"  r="1.1"/>
    </svg>`;

  const PLUS_SVG = `
    <svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M6 1.5v9M1.5 6h9"/>
    </svg>`;

  const NOTE_SVG = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
      <path d="M14 3v6h6M9 13h6M9 17h4"/>
    </svg>`;

  const CLOSE_SVG = `
    <svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M2 2l8 8M10 2l-8 8"/>
    </svg>`;

  // Up/down chevrons — the phone-only "drag to crop height" pull tab.
  const MCROP_SVG = `
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M5 6l3-3 3 3M5 10l3 3 3-3"/>
    </svg>`;

  let container = null;
  let dragState = null;
  let resizeState = null;
  let scrollRAF = null;

  /* ── BOOT ───────────────────────────────────────────────── */
  function boot() {
    container = document.getElementById('blocks');
    if (!container) return;
    container.classList.add('is-grid');

    restoreNotes();                 // recreate user-inserted note blocks first
    items = reconcile(loadItems());
    container.querySelectorAll('.block').forEach((b) => { injectHandles(b); ro.observe(b); });

    // Background-image buttons for notes and anything created after dash.boot().
    if (window.dash && window.dash.injectCardBgButtons) {
      window.dash.injectCardBgButtons();
      window.dash.applyAllCardBgs();
    }

    applyMScale();                  // restore any phone-only crop heights
    items.forEach((it) => { const b = blockOf(it.id); if (b) tabHeightInto(b, it); });
    relayout({ animate: false });
    syncDomOrder();
    saveLayout();

    const mq = window.matchMedia('(min-width: 881px)');
    const onMq = () => { if (mq.matches) relayout({ animate: false }); else { syncDomOrder(); applyMScale(); } };
    if (mq.addEventListener) mq.addEventListener('change', onMq); else mq.addListener(onMq);
    let _mscaleRaf = null;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(_mscaleRaf);
      _mscaleRaf = requestAnimationFrame(() => { applyMScale(); scheduleRelayout(); });
    });

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
    window.addEventListener('blur', cancelInteractions);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cancelInteractions();
    });

    bindTouch();
    setupMcropReveal();
  }

  /* Phone pull-tabs are hidden until you interact with a widget, so they no
     longer clutter the gaps between cards. Touching a widget fades in its
     tab; it fades back out a couple seconds after you stop touching. */
  function setupMcropReveal() {
    const isPhone = () => !window.matchMedia('(min-width: 881px)').matches;
    let hideTimer = null;
    const hideIdle = () => {
      if (!container) return;
      container.querySelectorAll('.block.show-mcrop').forEach((b) => {
        if (!b.classList.contains('is-mcropping')) b.classList.remove('show-mcrop');
      });
    };
    const scheduleHide = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hideIdle, 2600); };
    const reveal = (node) => {
      if (!isPhone() || !node || !node.closest || !container) return;
      const block = node.closest('.block');
      if (!block || !container.contains(block)) { scheduleHide(); return; }
      container.querySelectorAll('.block.show-mcrop').forEach((b) => {
        if (b !== block) b.classList.remove('show-mcrop');
      });
      block.classList.add('show-mcrop');
      scheduleHide();
    };
    document.addEventListener('pointerdown', (e) => reveal(e.target), { passive: true });
  }


  /* ── LAYOUT LOAD (legacy) ───────────────────────────────── */
  // Returns an array of rows: [{ cols: [{ frac, items:[{id,h}] }] }] or null.
  function loadLayout() {
    // v3 — nested
    try {
      const v3 = JSON.parse(localStorage.getItem(STORAGE_LAYOUT_V3) || 'null');
      const rows = (v3 && Array.isArray(v3.rows)) ? v3.rows : (Array.isArray(v3) ? v3 : null);
      if (rows) return migrateDaystrip(rows);
    } catch (_) {}

    // v2 — flat list of { id, frac, h } → pack into rows
    let flat = null;
    try { flat = JSON.parse(localStorage.getItem(STORAGE_LAYOUT_V2) || 'null'); } catch (_) {}
    if (!Array.isArray(flat)) {
      // v1 — span 1|2
      try {
        const v1 = JSON.parse(localStorage.getItem(STORAGE_LAYOUT_V1) || 'null');
        if (Array.isArray(v1)) flat = v1.map((e) => ({ id: e.id, frac: e.span === 1 ? 0.5 : 1, h: null }));
      } catch (_) {}
    }
    if (Array.isArray(flat)) return migrateDaystrip(packFlat(flat));

    return null; // signal: build default from current DOM order
  }

  // Layouts saved before the 7-day strip existed don't include it, and
  // unknown blocks normally get appended at the BOTTOM — the strip belongs
  // at the top, so prepend it as its own row once.
  function migrateDaystrip(rows) {
    const has = rows.some(r => (r.cols || []).some(c => (c.items || []).some(it => it.id === 'daystrip')));
    if (!has && document.querySelector('.block[data-card-id="daystrip"]')) {
      rows.unshift({ cols: [{ frac: 1, items: [{ id: 'daystrip', h: null }] }] });
    }
    return rows;
  }

  // Greedily pack a flat ordered list into rows (cumulative frac ≤ 1).
  function packFlat(flat) {
    const rows = [];
    let cur = [];
    let sum = 0;
    flat.forEach((e) => {
      const f = clampFrac(e.frac || 1);
      if (cur.length && sum + f > 1.001) { rows.push({ cols: cur }); cur = []; sum = 0; }
      cur.push({ frac: f, items: [{ id: e.id, h: e.h || null }] });
      sum += f;
    });
    if (cur.length) rows.push({ cols: cur });
    return rows;
  }

  function defaultLayout() {
    const flat = [...container.querySelectorAll('.block')].map((b) => ({
      id:   b.dataset.cardId,
      frac: parseFloat(b.style.getPropertyValue('--frac')) || (b.dataset.defaultSpan === '1' ? 0.5 : 1),
      h:    null,
    }));
    return packFlat(flat);
  }


  /* ── GRID MODEL ─────────────────────────────────────────── */
  let items = [];                       // [{ id, x, y, w, h, f }]  f = height fixed by the user
  const isDesktop = () => window.matchMedia('(min-width: 881px)').matches;
  const blockOf = (id) => container && container.querySelector('.block[data-card-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
  const itemOf = (id) => items.find((i) => i.id === id);
  const isVisible = (b) => !!b && getComputedStyle(b).display !== 'none';

  // The page may be scaled with CSS zoom (the 80% default). Pointer coordinates and
  // getBoundingClientRect are in screen pixels, but layout values (px) are CSS pixels.
  function zoomFactor() {
    const w = container.offsetWidth;
    return w ? container.getBoundingClientRect().width / w : 1;
  }
  function colGeom() {
    const W = container.offsetWidth;
    const colW = (W - GAP * (COLS - 1)) / COLS;
    return { W, colW, step: colW + GAP };
  }

  /* Saved layouts → grid items. v4 is read as-is; the older row/column layout is converted once. */
  function loadItems() {
    try {
      const v4 = JSON.parse(localStorage.getItem(STORAGE_LAYOUT_V4) || 'null');
      if (v4 && Array.isArray(v4.items)) return v4.items.map(cleanItem).filter(Boolean);
    } catch (_) {}
    return convertRows(loadLayout() || defaultLayout());
  }
  function cleanItem(i) {
    if (!i || !i.id) return null;
    const w = Math.max(MIN_W, Math.min(COLS, Math.round(+i.w) || COLS));
    const x = Math.max(0, Math.min(COLS - w, Math.round(+i.x) || 0));
    const h = i.h ? Math.max(MIN_H, Math.round(+i.h)) : null;
    return { id: i.id, x, y: Number.isFinite(+i.y) ? +i.y : 0, w, h, f: !!h };
  }
  function convertRows(rows) {
    const out = [];
    rows.forEach((row, ri) => {
      const cols = (row.cols || []).filter((c) => c && (c.items || []).length);
      if (!cols.length) return;
      const fr = cols.map((c) => Math.max(MIN_FRAC, c.frac || 1 / cols.length));
      const sum = fr.reduce((a, b) => a + b, 0);
      const raw = fr.map((f) => (f / sum) * COLS);
      const ws = raw.map((r) => Math.max(MIN_W, Math.floor(r)));
      let tot = ws.reduce((a, b) => a + b, 0);
      const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
      for (let k = 0; tot < COLS; k = (k + 1) % order.length) { ws[order[k][1]]++; tot++; }
      for (let k = 0; tot > COLS; k = (k + 1) % ws.length) { if (ws[k] > MIN_W) { ws[k]--; tot--; } }
      let x = 0;
      cols.forEach((c, ci) => {
        c.items.forEach((it, k) => out.push({ id: it.id, x, y: ri * 1000 + k, w: ws[ci], h: it.h ? Math.max(MIN_H, Math.ceil((it.h + GAP) / UNIT)) : null, f: !!it.h }));
        x += ws[ci];
      });
    });
    return out;
  }
  // Keep exactly the cards that exist; give any new card a home at the bottom.
  function reconcile(list) {
    const present = [...container.querySelectorAll('.block[data-card-id]')];
    const ids = new Set(present.map((b) => b.dataset.cardId));
    const out = list.filter((i) => ids.has(i.id));
    const have = new Set(out.map((i) => i.id));
    present.forEach((b) => {
      if (have.has(b.dataset.cardId)) return;
      const w = b.dataset.defaultSpan === '1' ? 6 : COLS;
      out.push({ id: b.dataset.cardId, x: 0, y: 1e6 + out.length, w, h: null, f: false });
    });
    return out;
  }

  /* Layout: every visible card floats up until it rests on another card or the top edge.
     Cards are visited top to bottom, so the one dragged or resized (given sort priority on a
     tie) keeps its place and the rest flow around it. */
  function pack(priorityId) {
    const vis = items.filter((i) => i.vis);
    vis.sort((a, b) => a.y - b.y || a.x - b.x || (b.id === priorityId) - (a.id === priorityId));
    const placed = [];
    vis.forEach((it) => {
      const cands = [0].concat(placed.map((p) => p.y + p.h)).sort((a, b) => a - b);
      let at = cands[cands.length - 1];
      for (const y of cands) {
        if (!placed.some((p) => p.x < it.x + it.w && it.x < p.x + p.w && p.y < y + it.h && y < p.y + p.h)) { at = y; break; }
      }
      it.y = at;
      placed.push(it);
    });
  }

  let relayoutRaf = null;
  function scheduleRelayout() {
    if (relayoutRaf) return;
    relayoutRaf = requestAnimationFrame(() => { relayoutRaf = null; if (!dragState && !resizeState) relayout({ animate: true }); });
  }
  const ro = (typeof ResizeObserver !== 'undefined') ? new ResizeObserver(() => scheduleRelayout()) : { observe() {}, unobserve() {} };

  // Measure self-sizing cards, pack, and write the positions into CSS.
  function relayout(opts) {
    if (!container) return;
    opts = opts || {};
    const desktop = isDesktop();
    const z = zoomFactor();
    const before = new Map();
    // Measuring briefly collapses the grid; hold its height so the page does not jump.
    const keepH = container.offsetHeight;
    if (desktop) container.style.minHeight = keepH + 'px';
    if (opts.animate && desktop) container.querySelectorAll(':scope > .block').forEach((b) => before.set(b, b.getBoundingClientRect()));

    items.forEach((it) => {
      const b = blockOf(it.id);
      it.vis = isVisible(b);
      if (!b || !it.vis) return;
      b.style.setProperty('--gc', (it.x + 1) + ' / span ' + it.w);
      if (!desktop) return;
      if (it.f) { b.style.setProperty('--gr', 'auto / span ' + it.h); }
      else {
        b.style.removeProperty('--bh');
        b.classList.remove('block--fixed', 'block--compact');
        b.style.setProperty('--gr', 'auto / span 1');           // measure the natural height
        it.h = Math.max(MIN_H, Math.ceil((b.getBoundingClientRect().height / z + GAP) / UNIT));
      }
    });
    if (!desktop) { container.style.minHeight = ''; return; }

    pack(opts.priorityId);

    items.forEach((it) => {
      const b = blockOf(it.id);
      if (!b || !it.vis) return;
      b.style.setProperty('--gc', (it.x + 1) + ' / span ' + it.w);
      b.style.setProperty('--gr', (it.y + 1) + ' / span ' + it.h);
      if (it.f) {
        b.style.setProperty('--bh', (it.h * UNIT - GAP) + 'px');
        syncFixed(b);
      }
    });

    container.style.minHeight = '';
    if (opts.animate) {
      before.forEach((r0, b) => {
        if (b.classList.contains('is-dragging')) return;
        const r1 = b.getBoundingClientRect();
        const dx = (r0.left - r1.left) / z, dy = (r0.top - r1.top) / z;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        b.style.transition = 'none';
        b.style.translate = dx + 'px ' + dy + 'px';
        requestAnimationFrame(() => requestAnimationFrame(() => {
          b.style.transition = '';
          b.style.translate = '';
        }));
      });
    }
    if (dragState || resizeState) paintGuides();
  }

  // The DOM order only matters on phones (cards stack in reading order).
  function syncDomOrder() {
    if (!container) return;
    items.slice().sort((a, b) => a.y - b.y || a.x - b.x).forEach((it) => {
      const b = blockOf(it.id);
      if (b && b.parentElement === container) container.appendChild(b);
    });
    container.querySelectorAll(':scope > .block-grid-guides').forEach((g) => g.remove());
  }

  function bottomOf(x0, x1) {
    return items.filter((i) => i.vis).reduce((m, i) => (i.x < x1 && x0 < i.x + i.w ? Math.max(m, i.y + i.h) : m), 0);
  }

  function saveLayout() {
    if (!container) return;
    const out = items.map((it) => {
      const b = blockOf(it.id);
      return { id: it.id, x: it.x, y: it.y, w: it.w, h: (it.f && !(b && tabHKey(b))) ? it.h : null };
    });
    try { localStorage.setItem(STORAGE_LAYOUT_V4, JSON.stringify({ v: 4, items: out })); } catch (_) {}
  }

  // Tabbed cards (the agenda) keep a height per tab; apply the one for the current tab.
  function tabHeightInto(block, it) {
    const key = tabHKey(block);
    if (!key) return;
    const o = loadTabH();
    const h = o[key] ? o[key].d : null;
    if (h && h >= MIN_HEIGHT) { it.f = true; it.h = Math.max(MIN_H, Math.ceil((h + GAP) / UNIT)); }
    else { it.f = false; }
  }

  // Toggle the fixed-height class so CSS clips overflow & tucks handles in.
  // Below COMPACT_H we also trim padding so the box can reach ~40px.
  function syncFixed(b) {
    const bh = parseFloat(b.style.getPropertyValue('--bh'));
    if (bh) {
      b.classList.add('block--fixed');
      b.classList.toggle('block--compact', bh < COMPACT_H);
    } else {
      b.classList.remove('block--fixed', 'block--compact');
    }
  }

  /* ── HANDLE INJECTION ───────────────────────────────────── */
  function injectHandles(block) {
    if (block.__blocksReady) return;
    block.__blocksReady = true;

    // Wrap the widget's own content so the phone resize can scale it as a
    // unit, independent of the chrome (handles + pull tab), which stay
    // full-size siblings outside the scaled wrapper.
    ensureScaleWrap(block);

    const dragH = el('button', 'block-handle', { type: 'button', title: 'Drag to move' });
    dragH.innerHTML = HANDLE_SVG;
    dragH.addEventListener('mousedown', (e) => startDrag(e, block));

    const grip = el('div', 'block-resize-grip', { title: 'Drag to resize' });
    grip.innerHTML = GRIP_SVG;
    grip.addEventListener('mousedown', (e) => startResize(e, block, 'corner'));

    const edge = el('div', 'block-edge-resize', { title: 'Drag to change width' });
    edge.addEventListener('mousedown', (e) => startResize(e, block, 'edge'));

    const edgeBottom = el('div', 'block-edge-resize-bottom', { title: 'Drag to change height (double-click to fit content)' });
    edgeBottom.addEventListener('mousedown', (e) => startResize(e, block, 'bottom'));
    edgeBottom.addEventListener('dblclick', (e) => { e.preventDefault(); e.stopPropagation(); resetHeight(block); });

    // Phone-only pull tab: always-available vertical resize slider for touch.
    const mcrop = el('div', 'block-mcrop-handle', { title: 'Drag to resize · double-tap to reset' });
    mcrop.innerHTML = MCROP_SVG;
    bindMobileCrop(mcrop, block);

    const plus = el('button', 'block-insert', { type: 'button', title: 'Insert a note below' });
    plus.innerHTML = PLUS_SVG;
    plus.addEventListener('click', (e) => insertNoteAfter(e, block));
    plus.addEventListener('mousedown', (e) => e.stopPropagation());

    block.appendChild(dragH);
    block.appendChild(grip);
    block.appendChild(edge);
    block.appendChild(edgeBottom);
    block.appendChild(mcrop);
    block.appendChild(plus);
  }

  /* ── PHONE CROP — always-available vertical resize slider ──────
     Desktop keeps its hover edge-handles; phones can't hover and the
     bottom strip was hidden, so cropping was impossible there. This
     pull tab is visible on every widget under 880px. Heights live in a
     SEPARATE store (STORAGE_MHEIGHTS) so a phone crop never disturbs the
     desktop layout (which reflows differently at full width) and vice
     versa. Drag up to crop, drag past the natural height (or double-tap)
     to un-crop. Uses Pointer Events so one handler covers touch + mouse. */
  function loadMHeights() {
    try { return JSON.parse(localStorage.getItem(STORAGE_MHEIGHTS) || '{}') || {}; }
    catch (_) { return {}; }
  }
  function saveMobileHeight(id, h) {
    const m = loadMHeights();
    if (h && h >= MIN_HEIGHT) m[id] = Math.round(h);
    else delete m[id];
    try { localStorage.setItem(STORAGE_MHEIGHTS, JSON.stringify(m)); } catch (_) {}
  }

  /* ── PER-TAB HEIGHTS (agenda) ──────────────────────────────
     The agenda's views (This Week, Tomorrow, Schedule, Month, Events,
     Habits) each remember their OWN height, so switching tabs resizes
     the widget to whatever you set for that view — e.g. a tall box for
     the Month calendar — without re-cropping every time. cardTab() only
     returns a tab for the agenda, so every other widget is untouched. */
  function cardTab(block) {
    if (!block || block.dataset.cardId !== 'agenda') return null;
    try {
      const t = window.dash && dash.currentTabFor && dash.currentTabFor('agenda');
      return t || null;
    } catch (_) { return null; }
  }
  function tabHKey(block) {
    const t = cardTab(block);
    return t ? block.dataset.cardId + '::' + t : null;
  }
  function loadTabH() {
    try { return JSON.parse(localStorage.getItem(STORAGE_TABH) || '{}') || {}; }
    catch (_) { return {}; }
  }
  function saveTabHeight(key, dim, h) {     // dim: 'd' desktop | 'm' phone
    if (!key) return;
    const o = loadTabH();
    o[key] = o[key] || {};
    if (h && h >= MIN_HEIGHT) o[key][dim] = Math.round(h);
    else delete o[key][dim];
    if (o[key].d == null && o[key].m == null) delete o[key];
    try { localStorage.setItem(STORAGE_TABH, JSON.stringify(o)); } catch (_) {}
  }
  // Phone crop height: routed to the per-tab store for the agenda, the plain
  // mheights store for everything else.
  function savePhoneHeight(block, h) {
    const key = tabHKey(block);
    if (key) saveTabHeight(key, 'm', h);
    else saveMobileHeight(block.dataset.cardId, h);
  }
  function loadedPhoneHeight(block) {
    const key = tabHKey(block);
    if (key) { const o = loadTabH(); return o[key] ? o[key].m : undefined; }
    return loadMHeights()[block.dataset.cardId];
  }

  // Re-apply the height that belongs to a tabbed card's CURRENT tab. Called
  // after a tab switch (via dashboard's refreshTabbedBg) and once on boot.
  function applyTabHeight(cardId) {
    if (!container) return;
    const block = container.querySelector('.block[data-card-id="' + cardId + '"]');
    if (!block) return;
    if (!isDesktop()) {
      const t = loadedPhoneHeight(block);
      if (t && t >= MIN_HEIGHT) applyScale(block, t);
      else clearScale(block);
      return;
    }
    const it = itemOf(cardId);
    if (it) { tabHeightInto(block, it); relayout({ animate: true }); saveLayout(); }
  }
  /* ── PHONE RESIZE (scale-to-fit) ──────────────────────────
     The wrapper holds the widget's content; scaling it shrinks the whole
     widget — text, charts, every button — to fit the chosen height. Nothing
     is clipped or lost. The chrome (handles + pull tab) lives outside the
     wrapper, so it stays full size and reachable. */
  function contentWrap(block) {
    return block.querySelector(':scope > .block-scale');
  }
  function ensureScaleWrap(block) {
    let wrap = contentWrap(block);
    if (wrap) return wrap;
    wrap = el('div', 'block-scale');
    // Move the widget's CONTENT into the wrapper, but leave the background-
    // image system's own layers as direct children of the card so they stay
    // behind (and unscaled) — they're managed independently of the content.
    const keepOut = '.card-bg-layer, .card-bg-popover, .card-bg-btn';
    [...block.childNodes].forEach((n) => {
      if (n.nodeType === 1 && n.matches && n.matches(keepOut)) return;
      wrap.appendChild(n);
    });
    block.appendChild(wrap);
    return wrap;
  }
  // Natural height of a block with no scale applied. Measured synchronously
  // (class + transform momentarily cleared), so there's no visible flash.
  function naturalBlockHeight(block) {
    const wrap = contentWrap(block);
    const hadClass = block.classList.contains('block--mscale');
    const prevT = wrap ? wrap.style.transform : '';
    if (wrap) wrap.style.transform = 'none';
    if (hadClass) block.classList.remove('block--mscale');
    const h = block.getBoundingClientRect().height;
    if (hadClass) block.classList.add('block--mscale');
    if (wrap) wrap.style.transform = prevT;
    return h;
  }
  // Scale factor that makes a block of natural height `nat` (incl. padding
  // `padV`) render at total height `target`.
  function scaleFor(target, nat, padV) {
    const contentNat = Math.max(1, nat - padV);
    let k = (target - padV) / contentNat;
    return Math.max(0.2, Math.min(1, k));
  }
  function applyScale(block, target) {
    const wrap = contentWrap(block);
    if (!wrap) return;
    const nat = naturalBlockHeight(block);
    if (!target || target >= nat - 2) { clearScale(block); return; }
    const t = Math.max(MIN_HEIGHT, Math.round(target));
    // CROP, don't scale: pin the widget's height and let overflow:hidden clip
    // the bottom edge. Content keeps its designed size — nothing zooms or
    // shrinks. --bh-nat keeps the background photo anchored at full height so
    // it never re-zooms as the box gets shorter.
    block.style.setProperty('--bh-m', t + 'px');
    block.style.setProperty('--bh-nat', Math.round(nat) + 'px');
    wrap.style.transform = '';
    block.classList.add('block--mscale');
  }
  function clearScale(block) {
    const wrap = contentWrap(block);
    if (wrap) wrap.style.transform = '';
    block.style.removeProperty('--bh-m');
    block.style.removeProperty('--bh-nat');
    block.classList.remove('block--mscale', 'is-mcropping');
  }

  function applyMScale() {
    if (!container) return;
    const phone = !window.matchMedia('(min-width: 881px)').matches;
    container.querySelectorAll('.block').forEach((b) => {
      const target = loadedPhoneHeight(b);
      if (phone && target && target >= MIN_HEIGHT) applyScale(b, target);
      else clearScale(b);   // desktop layout is never touched
    });
  }

  function bindMobileCrop(handle, block) {
    // `active` is per-handle; `moved` distinguishes a real drag from a tap so
    // a stray tap or a browser-initiated pointercancel can NEVER reset the
    // widget (that was the old snap-back bug). naturalH + padV are captured
    // once on begin so the live drag doesn't thrash layout re-measuring.
    let active = false, moved = false, startY = 0, startH = 0,
        naturalH = 0, padV = 0, lastTap = 0, badge = null;

    const isPhone = () => !window.matchMedia('(min-width: 881px)').matches;
    const wrap = () => contentWrap(block);

    const showBadge = (y, h) => {
      if (!badge) { badge = el('div', 'block-resize-badge'); document.body.appendChild(badge); }
      const r = block.getBoundingClientRect();
      badge.style.left = (r.left + r.width / 2) + 'px';
      badge.style.top  = Math.max(40, y) + 'px';
      badge.textContent = Math.round(h) + 'px';
    };

    function liveScale(target) {
      const t = Math.max(MIN_HEIGHT, Math.round(target));
      // Live crop: just move the bottom boundary. Content stays full size.
      block.style.setProperty('--bh-m', t + 'px');
      block.style.setProperty('--bh-nat', Math.round(naturalH) + 'px');
    }

    function begin(clientY) {
      // Double-tap (two quick taps) → restore full size.
      const now = Date.now();
      if (now - lastTap < 320) {
        clearScale(block); savePhoneHeight(block, null);
        lastTap = 0; active = false; return false;
      }
      lastTap = now;

      active = true;
      moved  = false;
      naturalH = naturalBlockHeight(block);
      const cs = getComputedStyle(block);
      padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      startH = block.getBoundingClientRect().height;
      startY = clientY;
      block.classList.add('block--mscale', 'is-mcropping');
      liveScale(startH);
      showBadge(clientY, startH);
      return true;
    }

    function moveTo(clientY) {
      if (!active) return;
      if (Math.abs(clientY - startY) > 3) moved = true;
      const target = Math.max(MIN_HEIGHT, Math.round(startH + (clientY - startY)));
      liveScale(target);
      showBadge(clientY, target);
    }

    function finish() {
      if (!active) return;
      active = false;
      block.classList.remove('is-mcropping');
      if (badge) { badge.remove(); badge = null; }

      // A tap with no real drag must not alter anything: restore whatever was
      // saved before. Crucially, we never reset on a tap or a cancel.
      if (!moved) {
        const saved = loadedPhoneHeight(block);
        if (saved && saved >= MIN_HEIGHT) applyScale(block, saved);
        else clearScale(block);
        return;
      }

      const set = parseFloat(block.style.getPropertyValue('--bh-m')) || 0;
      // Dragged down to/past full height → restore natural size.
      if (set >= naturalH - 6) {
        clearScale(block);
        savePhoneHeight(block, null);
      } else {
        savePhoneHeight(block, set);
        applyScale(block, set);   // recompute exact scale from a fresh measure
      }
    }

    /* Pointer Events drive both mouse and touch. touch-action:none on the
       handle (see CSS) stops the browser hijacking the drag as a page scroll,
       and pointer capture keeps move/up firing even when the finger slides
       off the small tab. */
    handle.addEventListener('pointerdown', (e) => {
      if (!isPhone()) return;
      if (dragState || resizeState) return;
      e.preventDefault();
      e.stopPropagation();
      if (begin(e.clientY)) {
        try { handle.setPointerCapture(e.pointerId); } catch (_) {}
      }
    });
    handle.addEventListener('pointermove', (e) => {
      if (!active) return;
      e.preventDefault();
      moveTo(e.clientY);
    });
    handle.addEventListener('pointerup', (e) => {
      if (!active) return;
      try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
      finish();
    });
    // On cancel we still COMMIT the current size — never silently reset.
    handle.addEventListener('pointercancel', (e) => {
      if (!active) return;
      try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
      finish();
    });
  }

  /* ── GUIDES: the 12 columns, with the ones the active card covers lit up ── */
  function paintGuides() {
    const s = dragState || resizeState;
    if (!s) return;
    let layer = container.querySelector(':scope > .block-grid-guides');
    if (!layer) {
      layer = el('div', 'block-grid-guides');
      for (let i = 0; i < COLS; i++) layer.appendChild(el('div', 'grid-col'));
      container.appendChild(layer);
    }
    const g = colGeom();
    const it = s.item;
    [...layer.children].forEach((c, i) => {
      c.style.left = (i * g.step) + 'px';
      c.style.width = g.colW + 'px';
      c.classList.toggle('on', it && i >= it.x && i < it.x + it.w);
    });
  }
  function removeGuides() { container.querySelectorAll(':scope > .block-grid-guides').forEach((n) => n.remove()); }

  /* ── DRAG ───────────────────────────────────────────────── */
  function startDrag(e, block) {
    if (e.button !== 0 || !isDesktop()) return;
    e.preventDefault();
    e.stopPropagation();
    if (resizeState) return;
    const item = itemOf(block.dataset.cardId);
    if (!item) return;

    const z = zoomFactor();
    const rect = block.getBoundingClientRect();
    const ghost = block.cloneNode(true);
    ghost.classList.add('block-ghost');
    ghost.classList.remove('is-dragging', 'fade-in', 's1', 's2', 's3', 's4', 's5', 's6', 's7');
    ghost.removeAttribute('id');
    ghost.style.cssText = '';
    ghost.style.width  = (rect.width / z) + 'px';
    ghost.style.height = (rect.height / z) + 'px';
    ghost.style.left   = (rect.left / z) + 'px';
    ghost.style.top    = (rect.top / z) + 'px';
    ghost.querySelectorAll('.block-handle, .block-resize-grip, .block-edge-resize, .block-edge-resize-bottom, .block-insert, .x-chrome')
      .forEach((n) => n.remove());
    document.body.appendChild(ghost);

    dragState = {
      block, item, ghost, z,
      snapshot: JSON.stringify(items),
      offX: (e.clientX - rect.left) / z,
      offY: (e.clientY - rect.top) / z,
      lastX: e.clientX, lastY: e.clientY,
      moved: false,
    };
    block.classList.add('is-dragging');
    document.body.classList.add('blocks-dragging');
    updateDragVisuals(e.clientX, e.clientY);
    startAutoScroll();
  }

  function updateDragVisuals(x, y) {
    const s = dragState;
    if (!s) return;
    const z = s.z;
    s.ghost.style.left = (x / z - s.offX) + 'px';
    s.ghost.style.top  = (y / z - s.offY) + 'px';

    // Which cell is the top-left corner of the card hovering over?
    const g = colGeom();
    const cRect = container.getBoundingClientRect();
    const px = (x - cRect.left) / z - s.offX;
    const py = (y - cRect.top) / z - s.offY;
    const it = s.item;
    const nx = Math.max(0, Math.min(COLS - it.w, Math.round(px / g.step)));
    const maxY = items.reduce((m, i) => (i.vis ? Math.max(m, i.y + i.h) : m), 0);
    const ny = Math.max(0, Math.min(maxY, Math.round(py / UNIT)));
    if (nx === it.x && ny === it.y && s.moved) { paintGuides(); return; }
    s.moved = true;
    it.x = nx; it.y = ny;
    relayout({ animate: true, priorityId: it.id });
  }

  function finishDrag() {
    const s = dragState;
    if (!s) return;
    s.ghost.remove();
    removeGuides();
    s.block.classList.remove('is-dragging');
    document.body.classList.remove('blocks-dragging');
    dragState = null;
    stopAutoScroll();
    relayout({ animate: true });
    saveLayout();
  }

  /* ── RESIZE ─────────────────────────────────────────────── */
  // mode: 'edge'   → width only (right edge)
  //       'bottom' → height only (bottom edge)
  //       'corner' → both (bottom-right grip)
  function startResize(e, block, mode) {
    if (e.button !== 0 || !isDesktop()) return;
    if (dragState) return;
    e.preventDefault();
    e.stopPropagation();
    const item = itemOf(block.dataset.cardId);
    if (!item) return;

    const z = zoomFactor();
    const badge = el('div', 'block-resize-badge');
    document.body.appendChild(badge);
    resizeState = {
      block, item, mode, badge, z,
      start: { w: item.w, h: item.h, f: item.f },
      grew: false,
    };
    block.classList.add('is-resizing');
    document.body.classList.add('blocks-resizing');
    if (mode === 'corner') document.body.classList.add('blocks-resizing-corner');
    if (mode === 'bottom') document.body.classList.add('blocks-resizing-bottom');
    updateResize(e.clientX, e.clientY);
  }

  function updateResize(x, y) {
    const s = resizeState;
    if (!s) return;
    const g = colGeom();
    const cRect = container.getBoundingClientRect();
    const px = (x - cRect.left) / s.z;
    const py = (y - cRect.top) / s.z;
    const it = s.item;
    let changed = false;
    if (s.mode === 'edge' || s.mode === 'corner') {
      const w = Math.max(MIN_W, Math.min(COLS - it.x, Math.round((px - it.x * g.step + GAP) / g.step)));
      if (w !== it.w) { it.w = w; changed = true; }
    }
    if (s.mode === 'bottom' || s.mode === 'corner') {
      const h = Math.max(MIN_H, Math.round((py - it.y * UNIT + GAP) / UNIT));
      if (h !== it.h || !it.f) { it.h = h; it.f = true; changed = true; }
    }
    if (changed) relayout({ animate: false, priorityId: it.id });
    else paintGuides();
    paintGuides();
    s.badge.style.left = (x / s.z) + 'px';
    s.badge.style.top  = (y / s.z) + 'px';
    const hpx = it.h * UNIT - GAP;
    if (s.mode === 'edge') s.badge.textContent = it.w + ' of 12 columns';
    else if (s.mode === 'bottom') s.badge.textContent = hpx + 'px tall';
    else s.badge.textContent = it.w + ' of 12 · ' + hpx + 'px';
  }

  function finishResize() {
    const s = resizeState;
    if (!s) return;
    const phone = !isDesktop();
    if (!phone && (s.mode === 'bottom' || s.mode === 'corner')) {
      const key = tabHKey(s.block);
      if (key) saveTabHeight(key, 'd', s.item.h * UNIT - GAP);
    }
    s.badge.remove();
    removeGuides();
    s.block.classList.remove('is-resizing');
    document.body.classList.remove('blocks-resizing', 'blocks-resizing-corner', 'blocks-resizing-bottom');
    resizeState = null;
    relayout({ animate: true });
    saveLayout();
  }

  // Double-click the bottom edge: let the card size itself to its content again.
  function resetHeight(block) {
    const it = itemOf(block.dataset.cardId);
    if (!it) return;
    const key = tabHKey(block);
    if (key) saveTabHeight(key, 'd', null);
    it.f = false;
    relayout({ animate: true });
    saveLayout();
  }

  /* ── INSERT (+) — a note directly below this card ── */
  let noteSeq = 0;
  function insertNoteAfter(e, anchor) {
    e.preventDefault();
    const id = 'note-' + Date.now().toString(36) + '-' + (noteSeq++).toString(36);
    const note = buildNote(id, '');
    container.appendChild(note);
    const a = itemOf(anchor.dataset.cardId) || { x: 0, w: COLS, y: 0, h: 0 };
    items.push({ id, x: a.x, y: a.y + a.h - 0.5, w: a.w, h: null, f: false });
    injectHandles(note); ro.observe(note);
    if (window.dash && window.dash.injectCardBgButtons) window.dash.injectCardBgButtons();
    relayout({ animate: true });
    saveLayout();
    saveNotes();
    requestAnimationFrame(() => {
      const body = note.querySelector('.note-body');
      if (body) body.focus();
    });
  }

  function buildNote(id, content, title) {
    const div = document.createElement('div');
    div.className = 'card block block-note';
    div.dataset.cardId = id;
    div.dataset.defaultSpan = '2';
    div.style.setProperty('--frac', '1');
    div.dataset.type = 'note';
    div.dataset.screenLabel = 'Note';
    div.innerHTML = `
      <div class="note-head">
        ${NOTE_SVG}
        <span class="note-title" contenteditable="true" spellcheck="false" data-placeholder="Note"></span>
        <button class="note-del" type="button" title="Delete note">${CLOSE_SVG}</button>
      </div>
      <div class="note-body" contenteditable="true" data-placeholder="Type something\u2026"></div>`;
    if (content) div.querySelector('.note-body').textContent = content;
    if (title)   div.querySelector('.note-title').textContent = title;

    const body = div.querySelector('.note-body');
    body.addEventListener('input', saveNotes);
    body.addEventListener('blur',  saveNotes);

    const titleEl = div.querySelector('.note-title');
    titleEl.addEventListener('input', saveNotes);
    titleEl.addEventListener('blur',  saveNotes);
    // Enter commits the title instead of inserting a line break.
    titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
    });

    div.querySelector('.note-del').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeBlock(div);
      saveNotes();
    });
    return div;
  }

  /* ── CUSTOM WIDGETS (photo / hours / spotify) ─────────────
     extras.js builds these cards. A new card goes into the emptiest stretch of the page:
     it is tried at three column positions and lands where the page is currently shortest. */
  function addBlock(node, opts) {
    if (!container) return false;
    opts = opts || {};
    const w = opts.w || 4;
    container.appendChild(node);
    const id = node.dataset.cardId;
    let best = 0, bestY = Infinity;
    for (let x = 0; x + w <= COLS; x += w) {
      const y = bottomOf(x, x + w);
      if (y < bestY) { bestY = y; best = x; }
    }
    items = items.filter((i) => i.id !== id);
    items.push({ id, x: best, y: Math.max(0, bestY) - 0.5, w, h: null, f: false });
    injectHandles(node); ro.observe(node);
    if (window.dash && window.dash.injectCardBgButtons) { window.dash.injectCardBgButtons(); window.dash.applyAllCardBgs(); }
    relayout({ animate: false });
    saveLayout();
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }
  // Replace the whole arrangement: list is [{ id, x, y, w, h? }]. Used by "Arrange cards neatly".
  function applyGrid(list) {
    if (!container) return;
    items = reconcile((list || []).map(cleanItem).filter(Boolean));
    items.forEach((it) => { it.f = !!it.h; });
    container.querySelectorAll('.block').forEach((b) => { b.style.removeProperty('--bh'); b.classList.remove('block--fixed', 'block--compact'); injectHandles(b); ro.observe(b); });
    items.forEach((it) => { const b = blockOf(it.id); if (b) tabHeightInto(b, it); });
    if (window.dash && window.dash.injectCardBgButtons) { window.dash.injectCardBgButtons(); window.dash.applyAllCardBgs(); }
    relayout({ animate: false });
    syncDomOrder();
    saveLayout();
  }
  function removeBlock(node) {
    items = items.filter((i) => i.id !== node.dataset.cardId);
    ro.unobserve(node);
    node.remove();
    relayout({ animate: true });
    saveLayout();
  }
  // Read-only snapshot of where everything is, for the default-layout planner.
  function geometry() {
    return items.map((i) => ({ id: i.id, x: i.x, y: i.y, w: i.w, h: i.h, vis: !!i.vis }));
  }

  /* ── AUTO-SCROLL during drag ────────────────────────────── */
  function startAutoScroll() {
    const EDGE   = 90;
    const MAX_DY = 22;
    const tick = () => {
      if (!dragState) return;
      const y  = dragState.lastY;
      const vh = window.innerHeight;
      let dy = 0;
      if (y < EDGE)            dy = -Math.ceil(((EDGE - y) / EDGE) * MAX_DY);
      else if (y > vh - EDGE)  dy =  Math.ceil(((y - (vh - EDGE)) / EDGE) * MAX_DY);
      if (dy !== 0) {
        const before = window.scrollY;
        window.scrollBy(0, dy);
        if (window.scrollY - before !== 0) updateDragVisuals(dragState.lastX, dragState.lastY);
      }
      scrollRAF = requestAnimationFrame(tick);
    };
    scrollRAF = requestAnimationFrame(tick);
  }
  function stopAutoScroll() {
    if (scrollRAF) cancelAnimationFrame(scrollRAF);
    scrollRAF = null;
  }

  /* ── GLOBAL POINTER HANDLERS ────────────────────────────── */
  function onMouseMove(e) {
    if (dragState) {
      dragState.lastX = e.clientX;
      dragState.lastY = e.clientY;
      updateDragVisuals(e.clientX, e.clientY);
    } else if (resizeState) {
      updateResize(e.clientX, e.clientY);
    }
  }
  function onMouseUp() {
    if (dragState)   finishDrag();
    if (resizeState) finishResize();
  }
  function cancelInteractions() {
    if (dragState) {
      const s = dragState;
      s.ghost.remove();
      removeGuides();
      s.block.classList.remove('is-dragging');
      document.body.classList.remove('blocks-dragging');
      try { items = JSON.parse(s.snapshot); } catch (_) {}
      dragState = null;
      stopAutoScroll();
      relayout({ animate: true });
    }
    if (resizeState) {
      const s = resizeState;
      s.item.w = s.start.w; s.item.h = s.start.h; s.item.f = s.start.f;
      s.badge.remove();
      removeGuides();
      s.block.classList.remove('is-resizing');
      document.body.classList.remove('blocks-resizing', 'blocks-resizing-corner', 'blocks-resizing-bottom');
      resizeState = null;
      relayout({ animate: true });
    }
  }

  /* ── TOUCH BRIDGE (basic, single-finger) ────────────────── */
  function bindTouch() {
    const proxy = (evtName) => (e) => {
      const t = e.touches[0] || e.changedTouches[0];
      if (!t) return;
      const fake = { button: 0, clientX: t.clientX, clientY: t.clientY,
                     preventDefault: () => e.preventDefault(),
                     stopPropagation: () => e.stopPropagation() };
      if (evtName === 'mousemove') onMouseMove(fake);
      if (evtName === 'mouseup')   onMouseUp();
    };
    document.addEventListener('touchmove', (e) => {
      if (dragState || resizeState) e.preventDefault();
      proxy('mousemove')(e);
    }, { passive: false });
    document.addEventListener('touchend',    proxy('mouseup'));
    document.addEventListener('touchcancel', proxy('mouseup'));

    container?.addEventListener('touchstart', (e) => {
      const t = e.touches[0]; if (!t) return;
      const target = e.target.closest(
        '.block-handle, .block-resize-grip, .block-edge-resize, .block-edge-resize-bottom'
      );
      if (!target) return;
      const block = target.closest('.block');
      const fake = { button: 0, clientX: t.clientX, clientY: t.clientY,
                     preventDefault: () => e.preventDefault(),
                     stopPropagation: () => e.stopPropagation() };
      if (target.classList.contains('block-handle')) startDrag(fake, block);
      else if (target.classList.contains('block-resize-grip')) startResize(fake, block, 'corner');
      else if (target.classList.contains('block-edge-resize-bottom')) startResize(fake, block, 'bottom');
      else startResize(fake, block, 'edge');
    }, { passive: false });
  }

  /* ── PERSISTENCE (notes) ────────────────────────────────── */
  function saveNotes() {
    const notes = [...container.querySelectorAll('.block-note')].map((n) => ({
      id: n.dataset.cardId,
      title: n.querySelector('.note-title')?.innerText.trim() || '',
      content: n.querySelector('.note-body')?.innerText || '',
    }));
    try { localStorage.setItem(STORAGE_NOTES, JSON.stringify(notes)); } catch (_) {}
  }
  function restoreNotes() {
    let notes = null;
    try { notes = JSON.parse(localStorage.getItem(STORAGE_NOTES) || 'null'); } catch (_) {}
    if (!notes || !Array.isArray(notes)) return;
    notes.forEach((n) => {
      const node = buildNote(n.id, n.content || '', n.title || '');
      container.appendChild(node); // buildStructure will place it per the saved layout
    });
  }

  /* ── UTILS ──────────────────────────────────────────────── */
  function clampFrac(f) { return Math.max(MIN_FRAC, Math.min(MAX_FRAC, Number(f) || 1)); }
  function round4(n)    { return Number.isFinite(n) ? Number(n.toFixed(4)) : null; }

  function el(tag, cls, attrs) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  /* ── EXPORT ─────────────────────────────────────────────── */
  window.blocks = {
    boot,
    save: saveLayout,
    addBlock, addShortest: addBlock, applyGrid, removeBlock,
    relayout: () => relayout({ animate: true }),
    geometry,
    applyTabHeight,
    reset() {
      try {
        localStorage.removeItem(STORAGE_LAYOUT_V4);
        localStorage.removeItem(STORAGE_LAYOUT_V3);
        localStorage.removeItem(STORAGE_LAYOUT_V2);
        localStorage.removeItem(STORAGE_LAYOUT_V1);
        localStorage.removeItem(STORAGE_NOTES);
      } catch (_) {}
      location.reload();
    },
  };
})();
