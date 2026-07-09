/* ═══════════════════════════════════════════════════════════════
   STICKERS — scrapbook-style PNG overlays

   Two homes for a sticker:
   - free : floats over the page background, position stored as a
            percentage of the dashboard area
   - card : attached to a corner of a specific widget, with a pixel
            offset from that corner — it follows the widget when the
            layout moves and can overhang the card edge like real
            scrapbook tape (cards clip their own children, which is
            why stickers live in an overlay layer inside .dash).

   Metadata lives in the device-local `stickers` localStorage key;
   the PNGs themselves live in IndexedDB (dashStore, `sticker:<id>`).
   Deliberately NOT synced: images are far too large for Firestore
   docs, and metadata without its image is a broken sticker.
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';
const { $, $$, uid, esc, load, save } = window.dashUtil;

const KEY = 'stickers';
const DEFAULTS = { size: 140, opacity: 100, rot: 0, layer: 'above' };
const ANCHORS = ['tl', 'tr', 'bl', 'br'];

let layerAbove = null;   // overlay above the cards
let layerBehind = null;  // decorative layer behind the cards
let arranging = false;
let repositionRaf = null;

function getStickers()  { return load(KEY, []); }
function saveStickers(s){ save(KEY, s); }
function stickerImg(id) { return window.dashStore.getCached('sticker:' + id); }

/* ── LAYERS ──────────────────────────────────────────────────── */
function ensureLayers() {
  const dash = document.querySelector('.dash');
  if (!dash) return false;
  if (!layerBehind) {
    layerBehind = document.createElement('div');
    layerBehind.className = 'sticker-layer behind';
    layerBehind.id = 'stickerLayerBehind';
    dash.appendChild(layerBehind);
  }
  if (!layerAbove) {
    layerAbove = document.createElement('div');
    layerAbove.className = 'sticker-layer above';
    layerAbove.id = 'stickerLayer';
    dash.appendChild(layerAbove);
  }
  return true;
}

/* ── POSITIONING ─────────────────────────────────────────────── */
function layerRect() { return layerAbove.getBoundingClientRect(); }

function cornerPoint(rect, anchor) {
  return {
    x: anchor === 'tl' || anchor === 'bl' ? rect.left : rect.right,
    y: anchor === 'tl' || anchor === 'tr' ? rect.top  : rect.bottom,
  };
}

function positionSticker(el, st) {
  const lr = layerRect();
  if (st.mode === 'card') {
    const card = document.querySelector(`.block[data-card-id="${st.cardId}"]`);
    if (!card || card.offsetParent === null) { el.style.display = 'none'; return; }
    el.style.display = '';
    const p = cornerPoint(card.getBoundingClientRect(), st.anchor || 'tl');
    el.style.left = (p.x - lr.left + (st.ox || 0)) + 'px';
    el.style.top  = (p.y - lr.top  + (st.oy || 0)) + 'px';
  } else {
    el.style.display = '';
    el.style.left = (st.x ?? 50) + '%';
    el.style.top  = (st.y ?? 20) + '%';
  }
}

function repositionAll() {
  if (!layerAbove) return;
  const items = getStickers();
  items.forEach(st => {
    const el = document.querySelector(`.sticker[data-id="${st.id}"]`);
    if (el) positionSticker(el, st);
  });
}

function scheduleReposition() {
  cancelAnimationFrame(repositionRaf);
  repositionRaf = requestAnimationFrame(repositionAll);
}

/* ── RENDER ──────────────────────────────────────────────────── */
function render() {
  if (!ensureLayers()) return;
  layerAbove.innerHTML = '';
  layerBehind.innerHTML = '';
  layerAbove.classList.toggle('arranging', arranging);
  layerBehind.classList.toggle('arranging', arranging);
  document.body.classList.toggle('stickers-arranging', arranging);

  getStickers().forEach(st => {
    const src = stickerImg(st.id);
    if (!src) return; // image lives on another device
    const el = document.createElement('img');
    el.className = 'sticker';
    el.dataset.id = st.id;
    el.src = src;
    el.alt = '';
    el.draggable = false;
    el.style.width = (st.size ?? DEFAULTS.size) + 'px';
    el.style.opacity = String((st.opacity ?? DEFAULTS.opacity) / 100);
    el.style.transform = `translate(-50%,-50%) rotate(${st.rot || 0}deg)`;
    ((st.layer === 'behind') ? layerBehind : layerAbove).appendChild(el);
    positionSticker(el, st);
    if (arranging) bindDrag(el, st.id);
  });
}

/* ── ADD / UPDATE / DELETE ───────────────────────────────────── */
function addSticker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/webp,image/gif,image/*';
  input.onchange = e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    // 800px cap keeps every sticker under compressImage's PNG threshold,
    // so transparency is always preserved.
    window.dashImg.compressImage(file, 800, dataUrl => {
      const id = uid();
      window.dashStore.set('sticker:' + id, dataUrl);
      const items = getStickers();
      items.push({ id, mode: 'free', x: 50, y: 18, ...DEFAULTS });
      saveStickers(items);
      setArrange(true);   // drop straight into arrange mode to place it
      render();
      if (window.tweaks && window.tweaks.refresh) window.tweaks.refresh();
    });
  };
  input.click();
}

function setStickerProp(id, prop, value) {
  const items = getStickers();
  const st = items.find(x => x.id === id);
  if (!st) return;
  st[prop] = (prop === 'layer') ? value : +value;
  saveStickers(items);
  // Light-touch update: restyle in place, full re-render only on layer swap.
  if (prop === 'layer') { render(); return; }
  const el = document.querySelector(`.sticker[data-id="${id}"]`);
  if (el) {
    el.style.width = (st.size ?? DEFAULTS.size) + 'px';
    el.style.opacity = String((st.opacity ?? DEFAULTS.opacity) / 100);
    el.style.transform = `translate(-50%,-50%) rotate(${st.rot || 0}deg)`;
    positionSticker(el, st);
  }
}

function deleteSticker(id) {
  saveStickers(getStickers().filter(x => x.id !== id));
  window.dashStore.del('sticker:' + id);
  render();
  if (window.tweaks && window.tweaks.refresh) window.tweaks.refresh();
}

/* ── ARRANGE MODE (drag to place / attach) ───────────────────── */
function setArrange(on) {
  arranging = !!on;
  render();
  if (window.tweaks && window.tweaks.refresh) window.tweaks.refresh();
}
function toggleArrange() { setArrange(!arranging); }

function clearCardHighlights() {
  $$('.block.sticker-target').forEach(c => c.classList.remove('sticker-target'));
}

// The card (if any) under a viewport point, looking through the overlay.
function cardAtPoint(x, y) {
  const stack = document.elementsFromPoint(x, y);
  for (const n of stack) {
    if (n.classList && n.classList.contains('block') && n.dataset.cardId) return n;
  }
  return null;
}

function nearestAnchor(rect, x, y) {
  let best = 'tl', bd = Infinity;
  ANCHORS.forEach(a => {
    const p = cornerPoint(rect, a);
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d < bd) { bd = d; best = a; }
  });
  return best;
}

function bindDrag(el, id) {
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    const items = getStickers();
    const st = items.find(x => x.id === id);
    if (!st) return;
    const startX = e.clientX, startY = e.clientY;
    const r = el.getBoundingClientRect();
    const cx0 = r.left + r.width / 2, cy0 = r.top + r.height / 2;
    let moved = false;
    el.classList.add('dragging');
    try { el.setPointerCapture(e.pointerId); } catch (_) {}

    const onMove = ev => {
      moved = true;
      const cx = cx0 + (ev.clientX - startX);
      const cy = cy0 + (ev.clientY - startY);
      const lr = layerRect();
      el.style.left = (cx - lr.left) + 'px';
      el.style.top  = (cy - lr.top) + 'px';
      clearCardHighlights();
      const card = cardAtPoint(ev.clientX, ev.clientY);
      if (card) card.classList.add('sticker-target');
    };
    const onUp = ev => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.classList.remove('dragging');
      clearCardHighlights();
      if (!moved) return;
      const cx = cx0 + (ev.clientX - startX);
      const cy = cy0 + (ev.clientY - startY);
      const card = cardAtPoint(ev.clientX, ev.clientY);
      if (card) {
        // Attach to the nearest corner of the card under the drop point.
        const cr = card.getBoundingClientRect();
        const anchor = nearestAnchor(cr, cx, cy);
        const p = cornerPoint(cr, anchor);
        st.mode = 'card';
        st.cardId = card.dataset.cardId;
        st.anchor = anchor;
        st.ox = Math.round(cx - p.x);
        st.oy = Math.round(cy - p.y);
        delete st.x; delete st.y;
      } else {
        // Free-floating: store as a percentage of the dashboard area.
        const lr = layerRect();
        st.mode = 'free';
        st.x = +((cx - lr.left) / lr.width  * 100).toFixed(2);
        st.y = +((cy - lr.top)  / lr.height * 100).toFixed(2);
        delete st.cardId; delete st.anchor; delete st.ox; delete st.oy;
      }
      saveStickers(getStickers().map(x => x.id === id ? st : x));
      positionSticker(el, st);
      if (window.tweaks && window.tweaks.refresh) window.tweaks.refresh();
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  });
}

/* ── KEEP CARD-ANCHORED STICKERS GLUED ───────────────────────── */
function watchLayout() {
  window.addEventListener('resize', scheduleReposition);
  // Card drags/resizes end on pointer release; heights also change as
  // content renders. A ResizeObserver on the grid + a mouseup fallback
  // covers both without polling.
  const blocksEl = document.getElementById('blocks');
  if (blocksEl && 'ResizeObserver' in window) {
    const ro = new ResizeObserver(scheduleReposition);
    ro.observe(blocksEl);
  }
  document.addEventListener('mouseup', () => setTimeout(scheduleReposition, 50));
  document.addEventListener('touchend', () => setTimeout(scheduleReposition, 50));
}

/* ── EXPORT + BOOT ───────────────────────────────────────────── */
window.stickers = {
  boot() { render(); watchLayout(); },
  render,
  add: addSticker,
  set: setStickerProp,
  del: deleteSticker,
  toggleArrange,
  setArrange,
  isArranging: () => arranging,
  list: getStickers,
  imgFor: stickerImg,
};
})();
