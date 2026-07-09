/* ──────────────────────────────────────────────────────────────
   BLOCKS — Notion-style column grid: drag-to-stack, edge-resize, + insert
   ────────────────────────────────────────────────────────────────
   LAYOUT MODEL (nested):
     #blocks .blocks            → vertical flex of rows
        .brow                   → horizontal flex of columns
           .bcol  (--col-frac)  → vertical STACK of widgets
              .card.block       → a widget (width 100% of its column)

   Because each column is its own vertical stack, widgets can sit flush
   above/beneath one another in the same column. Columns live side-by-side
   in a row and never overlap (flexbox). Dragging reveals faint grid guides
   and a bold snap indicator; on drop the widget snaps to a grid slot.
   ────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const STORAGE_LAYOUT_V3 = 'dashboard.blocks.layout.v3';   // nested rows/cols
  const STORAGE_LAYOUT_V2 = 'dashboard.blocks.layout.v2';   // legacy flat fracs
  const STORAGE_LAYOUT_V1 = 'dashboard.blocks.layout.v1';   // legacy span 1|2
  const STORAGE_NOTES     = 'dashboard.blocks.notes.v1';
  const STORAGE_MHEIGHTS  = 'dashboard.blocks.mheights.v1'; // phone-only crop heights, kept apart from desktop --bh
  const STORAGE_TABH      = 'dashboard.blocks.tabheights.v1'; // per-tab heights for tabbed cards (agenda): { "id::tab": {d,m} }

  const MIN_FRAC   = 0.12;  // smallest column width (~12% of row)
  const MAX_FRAC   = 1;
  const MIN_HEIGHT = 40;    // px — free vertical resize floor
  const COMPACT_H  = 92;    // px — below this, trim padding so widgets can go truly compact
  const GAP        = 16;    // matches CSS gap: 1rem
  const EDGE_ZONE  = 0.30;  // outer 30% of a column → "make a new column"
  const MIN_COL_W  = 120;

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

    // Seed default fraction from data-default-span (only if not already set)
    container.querySelectorAll('.block').forEach((b) => {
      if (!b.style.getPropertyValue('--frac')) {
        const def = b.dataset.defaultSpan === '1' ? 0.5 : 1;
        b.style.setProperty('--frac', String(def));
      }
    });

    restoreNotes();                 // recreate user-inserted note blocks first
    buildStructure(loadLayout());   // wrap blocks into rows/columns

    container.querySelectorAll('.block').forEach((b) => { injectHandles(b); syncFixed(b); });

    // Notes are recreated HERE, after dash.boot() already injected the
    // background buttons into the built-in cards — run it again so notes
    // get the same photo controls (and their saved backgrounds re-apply).
    if (window.dash && window.dash.injectCardBgButtons) {
      window.dash.injectCardBgButtons();
      window.dash.applyAllCardBgs();
    }

    applyMScale();                  // restore any phone-only resize scales
    applyTabHeight('agenda');       // restore the agenda's per-tab height (desktop + phone)

    // Re-fit on viewport changes: widths (and thus natural heights) shift
    // between phone/desktop and on rotation, so recompute the scales.
    let _mscaleRaf = null;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(_mscaleRaf);
      _mscaleRaf = requestAnimationFrame(applyMScale);
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


  /* ── LAYOUT LOAD / MIGRATION ────────────────────────────── */
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

  /* ── BUILD DOM STRUCTURE ────────────────────────────────── */
  function buildStructure(layout) {
    const byId = {};
    container.querySelectorAll('.block').forEach((b) => { byId[b.dataset.cardId] = b; });
    if (!layout) layout = defaultLayout();

    // Detach every block, then clear any existing rows.
    Object.values(byId).forEach((b) => b.remove());
    container.querySelectorAll('.brow').forEach((r) => r.remove());

    const used = new Set();

    layout.forEach((row) => {
      const cols = (row.cols || []).filter((c) => c && (c.items || []).some((it) => byId[it.id]));
      if (!cols.length) return;
      const rowEl = el('div', 'brow');
      cols.forEach((col) => {
        const items = (col.items || []).filter((it) => byId[it.id]);
        if (!items.length) return;
        const colEl = el('div', 'bcol');
        colEl.style.setProperty('--col-frac', String(clampFrac(col.frac || 1)));
        items.forEach((it) => {
          const b = byId[it.id];
          if (it.h && it.h >= MIN_HEIGHT) b.style.setProperty('--bh', it.h + 'px');
          colEl.appendChild(b);
          used.add(it.id);
        });
        rowEl.appendChild(colEl);
      });
      if (rowEl.children.length) container.appendChild(rowEl);
    });

    // Any block not covered by the saved layout (new card / new note) → own row.
    Object.keys(byId).forEach((id) => {
      if (used.has(id)) return;
      const b = byId[id];
      const f = parseFloat(b.style.getPropertyValue('--frac')) || 1;
      const rowEl = el('div', 'brow');
      const colEl = el('div', 'bcol');
      colEl.style.setProperty('--col-frac', String(clampFrac(f)));
      colEl.appendChild(b);
      rowEl.appendChild(colEl);
      container.appendChild(rowEl);
    });
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

    const dragH = el('button', 'block-handle', { type: 'button', title: 'Drag to move / stack' });
    dragH.innerHTML = HANDLE_SVG;
    dragH.addEventListener('mousedown', (e) => startDrag(e, block));

    const grip = el('div', 'block-resize-grip', { title: 'Drag to resize' });
    grip.innerHTML = GRIP_SVG;
    grip.addEventListener('mousedown', (e) => startResize(e, block, 'corner'));

    const edge = el('div', 'block-edge-resize', { title: 'Drag to change column width' });
    edge.addEventListener('mousedown', (e) => startResize(e, block, 'edge'));

    const edgeBottom = el('div', 'block-edge-resize-bottom', { title: 'Drag to change height' });
    edgeBottom.addEventListener('mousedown', (e) => startResize(e, block, 'bottom'));

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
    const phone = !window.matchMedia('(min-width: 881px)').matches;
    if (phone) {
      const t = loadedPhoneHeight(block);
      if (t && t >= MIN_HEIGHT) applyScale(block, t);
      else clearScale(block);
    } else {
      const key = tabHKey(block);
      const o = loadTabH();
      const h = key && o[key] ? o[key].d : null;
      if (h && h >= MIN_HEIGHT) block.style.setProperty('--bh', Math.round(h) + 'px');
      else block.style.removeProperty('--bh');
      syncFixed(block);
    }
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

  /* ── DRAG ───────────────────────────────────────────────── */
  function startDrag(e, block) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (resizeState) return;

    const rect = block.getBoundingClientRect();

    const ghost = block.cloneNode(true);
    ghost.classList.add('block-ghost');
    ghost.classList.remove('is-dragging', 'fade-in', 's1', 's2', 's3', 's4', 's5', 's6', 's7');
    ghost.removeAttribute('id');
    ghost.style.width  = rect.width  + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.style.left   = rect.left   + 'px';
    ghost.style.top    = rect.top    + 'px';
    ghost.querySelectorAll('.block-handle, .block-resize-grip, .block-edge-resize, .block-edge-resize-bottom, .block-insert')
      .forEach((n) => n.remove());
    document.body.appendChild(ghost);

    const indicator = el('div', 'block-drop-line');
    container.appendChild(indicator);

    dragState = {
      block, ghost, indicator,
      guides:  null,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      lastX:   e.clientX,
      lastY:   e.clientY,
      target:  null,
    };

    block.classList.add('is-dragging');
    document.body.classList.add('blocks-dragging');
    buildGuides();
    updateDragVisuals(e.clientX, e.clientY);
    startAutoScroll();
  }

  function updateDragVisuals(x, y) {
    const s = dragState;
    if (!s) return;
    s.ghost.style.left = (x - s.offsetX) + 'px';
    s.ghost.style.top  = (y - s.offsetY) + 'px';

    const t = computeTarget(x, y);
    s.target = t;
    paintIndicator(t);
  }

  // ── Geometry of the live grid (excludes nothing; flags the dragged block) ──
  function rowsGeom() {
    return [...container.querySelectorAll(':scope > .brow')].map((rowEl) => {
      const cols = [...rowEl.querySelectorAll(':scope > .bcol')].map((colEl) => {
        const blocks = [...colEl.querySelectorAll(':scope > .block')].map((b) => ({
          el: b, rect: b.getBoundingClientRect(), dragged: dragState && b === dragState.block,
        }));
        return { el: colEl, rect: colEl.getBoundingClientRect(), blocks };
      });
      return { el: rowEl, rect: rowEl.getBoundingClientRect(), cols };
    });
  }

  // Decide where a drop would land. Returns a descriptor used for both
  // painting the snap indicator and committing the move.
  function computeTarget(x, y) {
    const rows = rowsGeom();
    const cRect = container.getBoundingClientRect();
    if (!rows.length) return { type: 'empty' };

    // Above the first row → new row at top.
    if (y < rows[0].rect.top) {
      return { type: 'newRow', index: 0, lineTop: rows[0].rect.top - cRect.top - GAP / 2 };
    }
    // Below the last row → new row at end.
    const lastR = rows[rows.length - 1];
    if (y > lastR.rect.bottom) {
      return { type: 'newRow', index: rows.length, lineTop: lastR.rect.bottom - cRect.top + GAP / 2 };
    }

    // Find the row that contains y, or detect a gap between rows.
    let ri = -1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].rect;
      if (y >= r.top && y <= r.bottom) { ri = i; break; }
      if (y < r.top) {
        const prevBottom = rows[i - 1].rect.bottom;
        return { type: 'newRow', index: i, lineTop: (prevBottom + r.top) / 2 - cRect.top };
      }
    }
    if (ri < 0) ri = rows.length - 1;
    const row = rows[ri];

    // Nearest column by x (prefer the one that contains x).
    let col = row.cols.find((c) => x >= c.rect.left && x <= c.rect.right) || null;
    if (!col) {
      let bd = Infinity;
      for (const c of row.cols) {
        const cx = (c.rect.left + c.rect.right) / 2;
        const d = Math.abs(cx - x);
        if (d < bd) { bd = d; col = c; }
      }
    }
    if (!col) return { type: 'newRow', index: ri, lineTop: row.rect.top - cRect.top - GAP / 2 };

    const colIdx = row.cols.indexOf(col);
    const fx = (x - col.rect.left) / Math.max(1, col.rect.width);

    // Near the left/right edge of the column → split off a NEW column.
    if (fx < EDGE_ZONE) {
      return {
        type: 'col', rowEl: row.el, beforeCol: col.el,
        lineLeft: col.rect.left - cRect.left - GAP / 2,
        lineTop:  row.rect.top - cRect.top,
        lineHeight: row.rect.height,
      };
    }
    if (fx > 1 - EDGE_ZONE) {
      const nextCol = row.cols[colIdx + 1];
      return {
        type: 'col', rowEl: row.el, beforeCol: nextCol ? nextCol.el : null,
        lineLeft: col.rect.right - cRect.left + GAP / 2,
        lineTop:  row.rect.top - cRect.top,
        lineHeight: row.rect.height,
      };
    }

    // Otherwise STACK inside this column (the vertical-stacking case).
    const cand = col.blocks.filter((b) => !b.dragged);
    if (!cand.length) {
      return {
        type: 'stack', colEl: col.el, beforeBlock: null,
        lineLeft: col.rect.left - cRect.left, lineWidth: col.rect.width,
        lineTop: col.rect.top - cRect.top + 4,
      };
    }
    let before = null;
    let lineY = null;
    for (let i = 0; i < cand.length; i++) {
      const b = cand[i];
      const mid = b.rect.top + b.rect.height / 2;
      if (y < mid) {
        before = b.el;
        lineY = (i === 0) ? b.rect.top - GAP / 2 : (cand[i - 1].rect.bottom + b.rect.top) / 2;
        break;
      }
    }
    if (before === null) {
      const lastB = cand[cand.length - 1];
      lineY = lastB.rect.bottom + GAP / 2;
    }
    return {
      type: 'stack', colEl: col.el, beforeBlock: before,
      lineLeft: col.rect.left - cRect.left, lineWidth: col.rect.width,
      lineTop: lineY - cRect.top,
    };
  }

  function paintIndicator(t) {
    const ind = dragState && dragState.indicator;
    if (!ind || !t) return;

    if (t.type === 'col') {
      ind.classList.add('vertical');
      ind.style.left   = t.lineLeft + 'px';
      ind.style.top    = t.lineTop + 'px';
      ind.style.height = t.lineHeight + 'px';
      ind.style.width  = '';
    } else if (t.type === 'stack') {
      ind.classList.remove('vertical');
      ind.style.left   = t.lineLeft + 'px';
      ind.style.top    = t.lineTop + 'px';
      ind.style.width  = t.lineWidth + 'px';
      ind.style.height = '';
    } else if (t.type === 'newRow') {
      ind.classList.remove('vertical');
      ind.style.left   = '0px';
      ind.style.top    = t.lineTop + 'px';
      ind.style.width  = container.clientWidth + 'px';
      ind.style.height = '';
    } else {
      ind.style.width = ind.style.height = '0px';
    }
  }

  // Faint dashed grid lines (column + row boundaries) shown during a drag.
  function buildGuides() {
    removeGuides();
    const layer = el('div', 'block-grid-guides');
    const cRect = container.getBoundingClientRect();
    const rows = [...container.querySelectorAll(':scope > .brow')];

    rows.forEach((rowEl, i) => {
      const rRect = rowEl.getBoundingClientRect();
      // Row boundary (top of each row).
      addLine(layer, 'h', 0, rRect.top - cRect.top - GAP / 2, container.clientWidth);
      // Column boundaries inside the row (right edge of each column except the last).
      const cols = [...rowEl.querySelectorAll(':scope > .bcol')];
      cols.forEach((colEl, ci) => {
        if (ci === cols.length - 1) return;
        const cr = colEl.getBoundingClientRect();
        addLine(layer, 'v', cr.right - cRect.left + GAP / 2, rRect.top - cRect.top, rRect.height);
      });
      // Bottom boundary after the final row.
      if (i === rows.length - 1) {
        addLine(layer, 'h', 0, rRect.bottom - cRect.top + GAP / 2, container.clientWidth);
      }
    });

    container.appendChild(layer);
    if (dragState) dragState.guides = layer;
  }

  function addLine(layer, dir, left, top, span) {
    const d = el('div', 'grid-guide ' + dir);
    d.style.left = left + 'px';
    d.style.top  = top + 'px';
    if (dir === 'v') d.style.height = span + 'px';
    else             d.style.width  = span + 'px';
    layer.appendChild(d);
  }

  function removeGuides() {
    if (dragState && dragState.guides) { dragState.guides.remove(); dragState.guides = null; }
    container.querySelectorAll('.block-grid-guides').forEach((g) => g.remove());
  }

  function finishDrag() {
    const s = dragState;
    if (!s) return;
    applyDrop(s.target, s.block);

    s.ghost.remove();
    s.indicator.remove();
    removeGuides();
    s.block.classList.remove('is-dragging');
    document.body.classList.remove('blocks-dragging');
    dragState = null;
    stopAutoScroll();
    saveLayout();
  }

  function applyDrop(t, block) {
    if (!t || t.type === 'empty') return;

    const oldCol = block.parentElement;                       // .bcol
    const oldRow = oldCol ? oldCol.parentElement : null;      // .brow

    if (t.type === 'newRow') {
      const rowEl = el('div', 'brow');
      const colEl = el('div', 'bcol');
      colEl.style.setProperty('--col-frac', String(clampFrac(blockFrac(block, 1))));
      block.remove();
      colEl.appendChild(block);
      rowEl.appendChild(colEl);
      const rows = [...container.querySelectorAll(':scope > .brow')];
      container.insertBefore(rowEl, rows[t.index] || null);
    } else if (t.type === 'col') {
      const colEl = el('div', 'bcol');
      colEl.style.setProperty('--col-frac', String(clampFrac(blockFrac(block, 0.5))));
      block.remove();
      colEl.appendChild(block);
      t.rowEl.insertBefore(colEl, t.beforeCol || null);
    } else if (t.type === 'stack') {
      if (t.beforeBlock === block) return;
      block.remove();
      t.colEl.insertBefore(block, t.beforeBlock || null);
    }

    cleanupEmpties(oldCol, oldRow);
  }

  // A reasonable width fraction to give a block that becomes its own column.
  function blockFrac(block, fallback) {
    const parentFrac = block.parentElement && block.parentElement.classList.contains('bcol')
      ? parseFloat(block.parentElement.style.getPropertyValue('--col-frac'))
      : NaN;
    const own = parseFloat(block.style.getPropertyValue('--frac'));
    return clampFrac(own || parentFrac || fallback);
  }

  function cleanupEmpties(oldCol, oldRow) {
    if (oldCol && oldCol.isConnected && !oldCol.querySelector(':scope > .block')) oldCol.remove();
    if (oldRow && oldRow.isConnected && !oldRow.querySelector(':scope > .bcol')) oldRow.remove();
  }

  /* ── RESIZE ─────────────────────────────────────────────── */
  // mode: 'edge'   → column width only (right edge drag)
  //       'bottom' → block height only (bottom edge drag)
  //       'corner' → both (bottom-right corner grip)
  function startResize(e, block, mode) {
    if (e.button !== 0) return;
    if (dragState) return;
    e.preventDefault();
    e.stopPropagation();

    const col   = block.parentElement;                 // .bcol
    const row   = col ? col.parentElement : container;  // .brow

    // A lone column can't trade width with a neighbour, so width resize is a
    // no-op (the card's flex-grow re-expands it to fill the row). Ignore the
    // right edge entirely and make the corner grip resize height only.
    const soloCol = row && row.querySelectorAll(':scope > .bcol').length === 1;
    if (soloCol) {
      if (mode === 'edge')   return;
      if (mode === 'corner') mode = 'bottom';
    }

    const cRect = (row || container).getBoundingClientRect();
    const bRect = block.getBoundingClientRect();
    const colRect = (col || block).getBoundingClientRect();

    const vGuide = (mode === 'edge' || mode === 'corner') ? el('div', 'block-resize-guide') : null;
    const hGuide = (mode === 'bottom' || mode === 'corner') ? el('div', 'block-resize-guide horizontal') : null;
    if (vGuide) container.appendChild(vGuide);
    if (hGuide) container.appendChild(hGuide);

    const badge = el('div', 'block-resize-badge');
    document.body.appendChild(badge);

    const startFrac = parseFloat(col && col.style.getPropertyValue('--col-frac')) ||
                      (colRect.width + GAP) / (cRect.width + GAP);
    const startBhStr = block.style.getPropertyValue('--bh');
    const startBh = startBhStr ? parseFloat(startBhStr) : bRect.height;

    // Switch to fixed-height immediately so the resize visibly shrinks content.
    if (mode === 'bottom' || mode === 'corner') {
      block.style.setProperty('--bh', Math.round(startBh) + 'px');
      syncFixed(block);
    }

    resizeState = {
      block, col, row, mode, vGuide, hGuide, badge,
      rowRect: cRect,
      startColLeft: colRect.left,
      startBlockTop: bRect.top,
      startFrac, startBh,
      currentFrac: startFrac,
      currentBh:   startBh,
      hadBh: !!startBhStr,
    };

    block.classList.add('is-resizing');
    document.body.classList.add('blocks-resizing');
    if (mode === 'corner') document.body.classList.add('blocks-resizing-corner');
    updateResize(e.clientX, e.clientY);
  }

  function updateResize(x, y) {
    const s = resizeState;
    if (!s) return;
    const rowRect = s.rowRect;

    // ── COLUMN WIDTH (edge or corner) ──────────────────────
    if (s.mode === 'edge' || s.mode === 'corner') {
      const desiredW = Math.max(MIN_COL_W, x - s.startColLeft);
      let frac = (desiredW + GAP) / (rowRect.width + GAP);
      frac = clampFrac(frac);
      s.currentFrac = frac;
      if (s.col) s.col.style.setProperty('--col-frac', frac.toFixed(4));
    }

    // ── BLOCK HEIGHT (bottom or corner) ────────────────────
    if (s.mode === 'bottom' || s.mode === 'corner') {
      const desiredH = Math.max(MIN_HEIGHT, y - s.startBlockTop);
      s.currentBh = desiredH;
      s.block.style.setProperty('--bh', Math.round(desiredH) + 'px');
      syncFixed(s.block);
    }

    // Place guides on the block's current edges (after the layout reflowed).
    const cRect = container.getBoundingClientRect();
    const bRect = s.block.getBoundingClientRect();
    if (s.vGuide) {
      s.vGuide.style.left   = (bRect.right - cRect.left - 1) + 'px';
      s.vGuide.style.top    = (bRect.top - cRect.top - 4) + 'px';
      s.vGuide.style.height = (bRect.height + 8) + 'px';
    }
    if (s.hGuide) {
      s.hGuide.style.top    = (bRect.bottom - cRect.top - 1) + 'px';
      s.hGuide.style.left   = (bRect.left - cRect.left - 4) + 'px';
      s.hGuide.style.width  = (bRect.width + 8) + 'px';
    }

    s.badge.style.left = x + 'px';
    s.badge.style.top  = y + 'px';
    const pct = Math.round(s.currentFrac * 100);
    if (s.mode === 'edge')      s.badge.textContent = pct + '% wide';
    else if (s.mode === 'bottom') s.badge.textContent = Math.round(s.currentBh) + 'px tall';
    else                        s.badge.textContent = pct + '% · ' + Math.round(s.currentBh) + 'px';
  }

  function finishResize() {
    const s = resizeState;
    if (!s) return;
    saveLayout();
    // Tabbed cards (the agenda) remember their height PER TAB on desktop, so
    // each view (This Week, Month, …) keeps its own size.
    const phone = !window.matchMedia('(min-width: 881px)').matches;
    if (!phone && (s.mode === 'bottom' || s.mode === 'corner')) {
      const key = tabHKey(s.block);
      if (key) saveTabHeight(key, 'd', s.currentBh);
    }
    if (s.vGuide) s.vGuide.remove();
    if (s.hGuide) s.hGuide.remove();
    s.badge.remove();
    s.block.classList.remove('is-resizing');
    document.body.classList.remove('blocks-resizing');
    document.body.classList.remove('blocks-resizing-corner');
    resizeState = null;
  }

  /* ── INSERT (+) — stacks a note directly below in the same column ── */
  let noteSeq = 0;
  function insertNoteAfter(e, anchor) {
    e.preventDefault();
    const id = 'note-' + Date.now().toString(36) + '-' + (noteSeq++).toString(36);
    const note = buildNote(id, '');
    const col = anchor.parentElement && anchor.parentElement.classList.contains('bcol')
      ? anchor.parentElement : null;
    if (col) {
      col.insertBefore(note, anchor.nextElementSibling || null);
    } else {
      const rowEl = el('div', 'brow');
      const colEl = el('div', 'bcol');
      colEl.style.setProperty('--col-frac', '1');
      colEl.appendChild(note);
      rowEl.appendChild(colEl);
      container.appendChild(rowEl);
    }
    injectHandles(note);
    if (window.dash && window.dash.injectCardBgButtons) window.dash.injectCardBgButtons();
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
      const col = div.parentElement;
      const row = col ? col.parentElement : null;
      div.remove();
      cleanupEmpties(col, row);
      saveLayout();
      saveNotes();
    });
    return div;
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
        if (window.scrollY - before !== 0) {
          buildGuides();
          updateDragVisuals(dragState.lastX, dragState.lastY);
        }
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
      dragState.ghost.remove();
      dragState.indicator.remove();
      removeGuides();
      dragState.block.classList.remove('is-dragging');
      document.body.classList.remove('blocks-dragging');
      dragState = null;
      stopAutoScroll();
    }
    if (resizeState) {
      const s = resizeState;
      if (s.col) s.col.style.setProperty('--col-frac', String(s.startFrac));
      if (s.hadBh) {
        s.block.style.setProperty('--bh', Math.round(s.startBh) + 'px');
        syncFixed(s.block);
      } else {
        s.block.style.removeProperty('--bh');
        s.block.classList.remove('block--fixed', 'block--compact');
      }
      if (s.vGuide) s.vGuide.remove();
      if (s.hGuide) s.hGuide.remove();
      s.badge.remove();
      s.block.classList.remove('is-resizing');
      document.body.classList.remove('blocks-resizing');
      document.body.classList.remove('blocks-resizing-corner');
      resizeState = null;
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

  /* ── PERSISTENCE ────────────────────────────────────────── */
  function saveLayout() {
    const rows = [...container.querySelectorAll(':scope > .brow')].map((rowEl) => ({
      cols: [...rowEl.querySelectorAll(':scope > .bcol')].map((colEl) => ({
        frac: round4(parseFloat(colEl.style.getPropertyValue('--col-frac')) || 1),
        items: [...colEl.querySelectorAll(':scope > .block')].map((b) => {
          const bhStr = b.style.getPropertyValue('--bh');
          // Tabbed cards (agenda) manage their height per-tab, so don't bake
          // the current tab's height into the structural layout.
          const h = (!tabHKey(b) && bhStr) ? Math.round(parseFloat(bhStr)) : null;
          return { id: b.dataset.cardId, h };
        }),
      })),
    }));
    try { localStorage.setItem(STORAGE_LAYOUT_V3, JSON.stringify({ rows })); } catch (_) {}
  }

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
    applyTabHeight,
    reset() {
      try {
        localStorage.removeItem(STORAGE_LAYOUT_V3);
        localStorage.removeItem(STORAGE_LAYOUT_V2);
        localStorage.removeItem(STORAGE_LAYOUT_V1);
        localStorage.removeItem(STORAGE_NOTES);
      } catch (_) {}
      location.reload();
    },
  };
})();
