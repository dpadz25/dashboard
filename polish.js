/* ═══════════════════════════════════════════════════════════════
   POLISH - readability + layout pass (Oct 2026). Styles live in polish.css.

   - Widget menu: one ⋯ button per card (size, look, add note, hide, delete).
     It drives the existing x-chrome buttons from extras.js, so hide / delete /
     card look keep working exactly as before.
   - Page width: Centered or Wide (saved in extrasPrefs.pageWide, synced).
   - Header: pixel character standing beside the name + a live clock.
     The separate Clock card is hidden once (can be shown again from Add widget).
   - Dailies: three progress dots in the header (one per time of day).

   Loaded after extras.js and blocks.js.
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';
const { load, save } = window.dashUtil;
const PREFS_KEY = 'extrasPrefs';
const LAYOUT_KEY = 'dashboard.blocks.layout.v4';
const COLS = 12;
const SIZES = { S: 4, M: 8, L: 12 };

const ICON = {
  more: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  look: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  hide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.9 17.9A10.1 10.1 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M1 1l22 22"/></svg>',
  del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/></svg>',
};

const getPrefs = () => Object.assign({}, load(PREFS_KEY, {}));
const setPref = (k, v) => { const p = getPrefs(); p[k] = v; save(PREFS_KEY, p); };

/* ── WIDGET MENU ───────────────────────────────────────────── */
let menu = null, menuFor = null;

function layoutItems() {
  if (window.blocks && window.blocks.save) window.blocks.save();
  try { const o = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}'); return Array.isArray(o.items) ? o.items : []; }
  catch (_) { return []; }
}
function sizeOf(id) {
  const it = layoutItems().find((i) => i.id === id);
  if (!it) return '';
  return it.w <= 4 ? 'S' : it.w <= 8 ? 'M' : 'L';
}
function setSize(id, key) {
  const items = layoutItems();
  const it = items.find((i) => i.id === id);
  if (!it || !window.blocks || !window.blocks.applyGrid) return;
  it.w = SIZES[key];
  it.x = Math.max(0, Math.min(COLS - it.w, it.x || 0));
  window.blocks.applyGrid(items);
}
function chromeClick(block, act) {
  const b = block.querySelector(':scope > .x-chrome [data-a="' + act + '"]');
  if (b) b.click();
}
function closeMenu() {
  if (menu) menu.remove();
  if (menuFor) { const btn = menuFor.querySelector(':scope > .x-more'); if (btn) { btn.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } }
  menu = null; menuFor = null;
}
function openMenu(block, btn) {
  if (menuFor === block) { closeMenu(); return; }
  closeMenu();
  const id = block.dataset.cardId;
  const isHeader = id === 'header' || id === 'daystrip';
  const cur = sizeOf(id);
  const hasNote = !!block.querySelector(':scope > .x-chrome [data-a="add"]');
  menu = document.createElement('div');
  menu.className = 'x-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML =
    (isHeader ? '' : `<div class="xm-label">Size</div><div class="xm-sizes">${Object.keys(SIZES).map((k) => `<button type="button" data-size="${k}" class="${k === cur ? 'on' : ''}" aria-pressed="${k === cur}">${k}</button>`).join('')}</div><div class="xm-hr"></div>`) +
    `<button type="button" class="xm-item" role="menuitem" data-a="bg">${ICON.look}Color and photo</button>` +
    (hasNote ? `<button type="button" class="xm-item" role="menuitem" data-a="add">${ICON.note}Add a note below</button>` : '') +
    `<button type="button" class="xm-item" role="menuitem" data-a="hide">${ICON.hide}Hide</button>` +
    `<div class="xm-hr"></div><button type="button" class="xm-item del" role="menuitem" data-a="del">${ICON.del}Delete widget</button>`;
  document.body.appendChild(menu);
  menuFor = block;
  btn.classList.add('open');
  btn.setAttribute('aria-expanded', 'true');
  // place under the button, kept on screen
  const r = btn.getBoundingClientRect();
  const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const mw = 220, mh = menu.offsetHeight;
  let left = r.right / z - mw, top = r.bottom / z + 6;
  const vw = window.innerWidth / z, vh = window.innerHeight / z;
  if (left < 8) left = 8;
  if (left + mw > vw - 8) left = vw - mw - 8;
  if (top + mh > vh - 8) top = Math.max(8, r.top / z - mh - 6);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.addEventListener('mousedown', (e) => e.stopPropagation());
  menu.addEventListener('click', (e) => {
    const s = e.target.closest('[data-size]');
    if (s) { e.stopPropagation(); setSize(id, s.dataset.size); closeMenu(); return; }
    const a = e.target.closest('[data-a]');
    if (!a) return;
    e.stopPropagation();
    const act = a.dataset.a;
    closeMenu();
    chromeClick(block, act);
  });
  const first = menu.querySelector('button'); if (first) first.focus({ preventScroll: true });
}
function decorateMenus() {
  document.querySelectorAll('#blocks > .block[data-card-id]').forEach((b) => {
    if (b.querySelector(':scope > .x-more')) return;
    if (!b.querySelector(':scope > .x-chrome')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'x-more';
    btn.setAttribute('aria-label', 'Widget options');
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.title = 'Widget options';
    btn.innerHTML = ICON.more;
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => { e.stopPropagation(); openMenu(b, btn); });
    b.appendChild(btn);
  });
}
document.addEventListener('mousedown', (e) => { if (menu && !e.target.closest('.x-menu, .x-more')) closeMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu) closeMenu(); });
window.addEventListener('scroll', () => { if (menu) closeMenu(); }, { passive: true });
window.addEventListener('resize', () => { if (menu) closeMenu(); });

/* ── PAGE WIDTH ────────────────────────────────────────────── */
const isWide = () => !!getPrefs().pageWide;
function applyWide() {
  document.body.classList.toggle('x-wide', isWide());
  if (window.blocks && window.blocks.relayout) setTimeout(() => window.blocks.relayout(), 30);
  placeChar();
}
function setWide(on) {
  setPref('pageWide', !!on);
  applyWide();
  if (window.tweaks && window.tweaks.refresh) window.tweaks.refresh();
}

/* ── HEADER: CHARACTER + CLOCK ─────────────────────────────── */
function nextLine() {
  const open = (load('plannerTasks', []) || []).filter((t) => (t.status || (t.done ? 'done' : 'todo')) !== 'done');
  open.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const t = open[0];
  if (!t) return 'All clear. Nice work!';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = t.dueDate ? Math.round((new Date(t.dueDate + 'T00:00:00') - today) / 86400000) : null;
  const when = d === null ? '' : d < 0 ? ' (overdue)' : d === 0 ? ' today' : d === 1 ? ' tomorrow' : ' in ' + d + ' days';
  return 'Next up: ' + t.text + when;
}
function buildChar() {
  const card = document.getElementById('headerCard');
  if (!card || card.querySelector('.hdr-char')) return;
  const c = document.createElement('div');
  c.className = 'hdr-char';
  c.setAttribute('aria-hidden', 'true');
  c.innerHTML = '<span class="hdr-char-pool"></span><span class="hdr-char-shwrap"><span class="hdr-char-shadow"></span></span>' +
    '<span class="hdr-char-body"><img src="assets/character.png" alt="" width="140" height="127" decoding="async"></span>' +
    '<span class="hdr-char-say" role="status" aria-live="polite"></span>';
  card.appendChild(c);
  // Click (or tap) him: he jumps and tells you what's next.
  const body = c.querySelector('.hdr-char-body');
  body.setAttribute('role', 'button');
  body.setAttribute('tabindex', '0');
  body.setAttribute('aria-label', 'Your character. Click to see what is up next.');
  const poke = () => {
    c.classList.remove('jump'); void c.offsetWidth; c.classList.add('jump');
    const say = c.querySelector('.hdr-char-say');
    say.textContent = nextLine();
    c.classList.add('talk');
    clearTimeout(c._t); c._t = setTimeout(() => c.classList.remove('talk'), 3600);
  };
  body.addEventListener('click', poke);
  body.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); poke(); } });
  c.addEventListener('animationend', (e) => { if (e.animationName === 'x-jump') c.classList.remove('jump'); });
  placeChar();
}
// Stand him in the gap between the name/quote and the stats. If that gap is
// too narrow, he moves in front of the name instead and the text shifts over,
// so he always shows on desktop. Rects come back in zoomed (visual) px while
// left/width are CSS px, so divide by the page zoom.
function placeChar() {
  const card = document.getElementById('headerCard');
  const c = card && card.querySelector('.hdr-char');
  if (!c) return;
  const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  if (window.innerWidth <= 860) { c.classList.remove('ready'); card.classList.remove('x-char-lead'); return; }
  const cardH = card.getBoundingClientRect().height / z;
  const fit = Math.max(0.6, Math.min(1, (cardH - 8) / 134));   // never taller than the banner
  // He always stands at the left edge, feet on the bottom of the banner, and the
  // name slides over. (Beside the stats he looked like he was floating.)
  const size = Math.min(fit, 0.85);
  c.style.setProperty('--char-s', size.toFixed(3));
  card.style.setProperty('--char-w', Math.round(140 * size) + 'px');
  card.classList.add('x-char-lead');
  c.style.left = '10px';
  c.classList.add('ready');
}
function buildClock() {
  const when = document.querySelector('#headerCard .hdr-grp-when');
  if (!when || when.querySelector('.hdr-clock')) return;
  const el = document.createElement('div');
  el.className = 'hdr-clock';
  el.innerHTML = '<b id="hdrClockTime"></b>';
  when.prepend(el);
  tickClock();
  setInterval(tickClock, 15000);
}
function tickClock() {
  const t = document.getElementById('hdrClockTime');
  if (!t) return;
  const d = new Date(), h24 = load('clockFormat24', false);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  if (h24) { t.textContent = String(h).padStart(2, '0') + ':' + m; return; }
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  t.innerHTML = h + ':' + m + '<small>' + ap + '</small>';
}
// The clock lives in the header now: hide the separate Clock card once.
function retireClockCard() {
  const p = getPrefs();
  if (p.clockInHeader) return;
  p.clockInHeader = true;
  p.hidden = Array.isArray(p.hidden) ? p.hidden : [];
  if (!p.hidden.includes('clock')) p.hidden.push('clock');
  save(PREFS_KEY, p);
  const b = document.querySelector('.block[data-card-id="clock"]');
  if (b) b.classList.add('x-hidden');
  if (window.blocks && window.blocks.relayout) window.blocks.relayout();
}

/* ── DAILIES: three dots in the header ─────────────────────── */
const DG = [['morning', '#D99A2B'], ['afternoon', '#3E8A84'], ['evening', '#7D5CA3']];
function renderDots() {
  const card = document.querySelector('.block[data-card-id="dailies"]');
  if (!card) return;
  const hl = card.querySelector('.habits-header-left');
  if (!hl) return;
  let dots = hl.querySelector('.x-dg-dots');
  if (!dots) { dots = document.createElement('div'); dots.className = 'x-dg-dots'; hl.appendChild(dots); }
  const parts = [];
  const html = DG.map(([k, c]) => {
    const list = document.getElementById('daily-' + k + '-list');
    const all = list ? list.querySelectorAll('.habit-item').length : 0;
    const done = list ? list.querySelectorAll('.habit-item.done').length : 0;
    const full = all > 0 && done === all;
    parts.push(k + ' ' + done + ' of ' + all);
    return `<span class="${full ? 'full' : ''}" style="--c:${c}"></span>`;
  }).join('');
  if (dots.innerHTML !== html) dots.innerHTML = html;
  dots.setAttribute('role', 'img');
  dots.setAttribute('aria-label', parts.join(', '));
}
function watchDailies() {
  DG.forEach(([k]) => {
    const list = document.getElementById('daily-' + k + '-list');
    if (list) new MutationObserver(renderDots).observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  renderDots();
}

/* ── DARK MODE ─────────────────────────────────────────────
   'light' | 'dark' | 'auto' (follow the device). Kept per device on purpose,
   so a phone can follow its own system setting. */
const MODE_KEY = 'polishMode';
const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const getMode = () => { try { return localStorage.getItem(MODE_KEY) || 'light'; } catch (_) { return 'light'; } };
const isDark = () => { const m = getMode(); return m === 'dark' || (m === 'auto' && !!(mq && mq.matches)); };
function applyMode() {
  const dark = isDark();
  document.documentElement.classList.toggle('x-dark', dark);
  const btn = document.getElementById('hdrModeBtn');
  if (btn) { btn.setAttribute('aria-pressed', String(dark)); btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode'; btn.setAttribute('aria-label', btn.title); }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#15131c' : '#0d0b09');
}
function setMode(m) {
  try { localStorage.setItem(MODE_KEY, m); } catch (_) {}
  applyMode();
  if (window.tweaks && window.tweaks.refresh) window.tweaks.refresh();
}
if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (getMode() === 'auto') applyMode(); });
function buildModeBtn() {
  const acts = document.querySelector('#headerCard .hdr-when-actions');
  if (!acts || document.getElementById('hdrModeBtn')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'hdrModeBtn'; b.className = 'icon-btn hdr-mode-btn';
  b.innerHTML = '<svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>' +
    '<svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  b.addEventListener('click', () => setMode(isDark() ? 'light' : 'dark'));
  acts.prepend(b);
  applyMode();
}
applyMode();

/* ── BOOT ──────────────────────────────────────────────────── */
function boot() {
  document.body.classList.toggle('x-wide', isWide());
  buildClock();
  buildModeBtn();
  buildChar();
  watchDailies();
  let tries = 0;
  const wait = setInterval(() => {
    if (document.querySelector('#blocks .x-chrome')) {
      clearInterval(wait);
      decorateMenus();
      retireClockCard();
      applyWide();
      setInterval(decorateMenus, 1500);
    } else if (++tries > 150) clearInterval(wait);
  }, 100);
  window.addEventListener('resize', placeChar);
  if (window.ResizeObserver) {
    const card = document.getElementById('headerCard');
    if (card) new ResizeObserver(placeChar).observe(card);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeChar);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

window.polish = { isWide, setWide, closeMenu, placeChar, getMode, setMode, isDark };
})();
