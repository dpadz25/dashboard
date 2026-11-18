/* ═══════════════════════════════════════════════════════════════
   NOTES — full-page Apple Notes style view (opened from the side rail)

   Opens as a full-screen overlay (same chrome as Library / Today).
   Left: list of notes with search. Right: title + smart-list editor
   (noteeditor.js). On a phone it shows the list first, then the editor.

   Data is the SAME set of notes the grid cards use. All reads and
   writes go through window.blocks.notes, so the cards and this page
   can never disagree, and the existing sync / search keep working.
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';
const { $, esc } = window.dashUtil;

let activeId = null;
let query = '';
let saveTimer = null;

const api = () => (window.blocks && window.blocks.notes) || null;
const all = () => (api() ? api().list().slice().reverse() : []);   // newest first

function matches(n) {
  const q = query.trim().toLowerCase();
  return !q || (n.title || '').toLowerCase().includes(q) || (n.content || '').toLowerCase().includes(q);
}
function preview(n) {
  const line = (n.content || '').split('\n').map((l) => l.replace(/^\s*(• |☐ |☑ |\d+\. )/, '').trim()).find(Boolean);
  return line || 'No additional text';
}

/* ── BACKDROP ────────────────────────────────────────────────────
   Notes is white (light mode) or black (dark mode) by default, from the
   tokens on #notesPage in styles.css. It can have its OWN photo, separate
   from the dashboard's page photo: the image lives in the image store
   under 'notesBg' (device-local, like all photos) and its settings in
   localStorage 'notesBgSettings' (device-local on purpose, not synced). */
const BG_KEY = 'notesBg', SET_KEY = 'notesBgSettings';
const BG_DEFAULTS = { strength: 60, zoom: 100, x: 50, y: 50 };
function bgSettings() {
  let v = null; try { v = JSON.parse(localStorage.getItem(SET_KEY) || 'null'); } catch (_) {}
  return Object.assign({}, BG_DEFAULTS, v || {});
}
function saveBgSettings(v) { try { localStorage.setItem(SET_KEY, JSON.stringify(v)); } catch (_) {} }

function syncBackdrop() {
  const page = $('notesPage');
  if (!page) return;
  const data = window.dashStore && window.dashStore.getCached(BG_KEY);
  const st = bgSettings();
  if (data) {
    const url = window.dashImg && window.dashImg.cssUrl ? window.dashImg.cssUrl(BG_KEY, data) : data;
    page.style.setProperty('--nbg-url', 'url("' + url + '")');
    page.style.setProperty('--nbg-alpha', (1 - st.strength / 100).toFixed(2));
    page.style.setProperty('--nbg-zoom', (st.zoom / 100).toFixed(3));
    page.style.setProperty('--nbg-x', st.x + '%');
    page.style.setProperty('--nbg-y', st.y + '%');
  } else {
    ['--nbg-url', '--nbg-alpha', '--nbg-zoom', '--nbg-x', '--nbg-y'].forEach((k) => page.style.removeProperty(k));
  }
  page.classList.toggle('has-bg', !!data);
}

function pickPhoto() {
  if (!window.dashImg || !window.dashImg.compressImage) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.heic,.heif,.avif';
  input.onchange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    window.dashImg.compressImage(file, 4200, (dataUrl) => {
      window.dashStore.set(BG_KEY, dataUrl);
      syncBackdrop(); renderBgPanel(true);
    });
  };
  input.click();
}
function removePhoto() {
  window.dashStore.del(BG_KEY);
  if (window.dashImg && window.dashImg.cssUrl) window.dashImg.cssUrl(BG_KEY, null);
  syncBackdrop(); renderBgPanel(true);
}
function setBg(key, val) {
  const st = bgSettings(); st[key] = +val; saveBgSettings(st); syncBackdrop();
}
function resetBgPosition() {
  const st = bgSettings(); st.zoom = BG_DEFAULTS.zoom; st.x = BG_DEFAULTS.x; st.y = BG_DEFAULTS.y;
  saveBgSettings(st); syncBackdrop(); renderBgPanel(true);
}

// Small panel under the header: this page's own photo and its sliders.
function renderBgPanel(forceOpen) {
  const panel = $('notesBgPanel');
  if (!panel) return;
  if (forceOpen !== true) panel.hidden = !panel.hidden;
  else panel.hidden = false;
  if (panel.hidden) return;
  const has = !!(window.dashStore && window.dashStore.getCached(BG_KEY));
  const st = bgSettings();
  const slider = (key, label, min, max, step) => `
    <label class="notes-bg-row"><span>${label}</span><span class="notes-bg-val" data-v="${key}">${st[key]}%</span>
      <input type="range" min="${min}" max="${max}" step="${step || 1}" value="${st[key]}" data-bg="${key}"/></label>`;
  panel.innerHTML = `
    <div class="notes-bg-head"><b>Notes background</b><span>Separate from your dashboard photo</span></div>
    <div class="notes-bg-btns">
      <button type="button" class="notes-bg-btn" data-bgact="upload">${has ? 'Replace photo' : 'Upload photo'}</button>
      ${has ? '<button type="button" class="notes-bg-btn" data-bgact="remove">Remove</button>' : ''}
    </div>
    ${has ? slider('strength', 'Photo strength', 0, 95) + slider('zoom', 'Zoom', 100, 400, 5) + slider('x', 'Position X', 0, 100) + slider('y', 'Position Y', 0, 100)
        + '<button type="button" class="notes-bg-btn" data-bgact="reset">Reset position</button>' : '<div class="notes-bg-hint">Without a photo this page is plain white in light mode and black in dark mode.</div>'}`;
  panel.oninput = (e) => {
    const r = e.target.closest('[data-bg]'); if (!r) return;
    setBg(r.dataset.bg, r.value);
    const v = panel.querySelector('[data-v="' + r.dataset.bg + '"]'); if (v) v.textContent = r.value + '%';
  };
  panel.onclick = (e) => {
    const b = e.target.closest('[data-bgact]'); if (!b) return;
    ({ upload: pickPhoto, remove: removePhoto, reset: resetBgPosition })[b.dataset.bgact]();
  };
}

/* The browser's status bar / toolbar color follows <meta name="theme-color">. Match Notes while it is open. */
let prevBar = null;
function setBarColor(on) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  if (on) {
    if (prevBar === null) prevBar = meta.getAttribute('content');
    const dark = document.documentElement.classList.contains('x-dark') || /^(amber|dusk)$/.test(document.documentElement.getAttribute('data-theme') || '');
    meta.setAttribute('content', dark ? '#000000' : '#ffffff');
  } else if (prevBar !== null) {
    meta.setAttribute('content', prevBar); prevBar = null;
  }
}

/* ── OPEN / CLOSE ────────────────────────────────────────────── */
function open(id) {
  const page = $('notesPage');
  if (!page || !api()) return;
  buildShell(page);
  const notes = all();
  activeId = (id && notes.some((n) => n.id === id)) ? id : (notes[0] && notes[0].id) || null;
  renderList();
  loadEditor();
  setBarColor(true);
  syncBackdrop();
  if (window.dashStore && window.dashStore.ready) window.dashStore.ready.then(syncBackdrop, () => {});
  page.classList.add('open');
  document.body.classList.add('library-open', 'notes-open');
  page.classList.toggle('show-editor', !!id);
}
function close() {
  flush();
  setBarColor(false);
  const page = $('notesPage');
  if (page) page.classList.remove('open');
  document.body.classList.remove('library-open', 'notes-open');
}

/* ── SHELL (built once per open, never re-rendered while typing) ── */
function buildShell(page) {
  page.innerHTML = `
    <div class="library-inner notes-inner">
      <div class="library-head">
        <button class="icon-btn library-back" type="button" data-act="close" title="Back to dashboard" aria-label="Back to dashboard">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div class="library-title">Notes</div>
        <input class="t-input library-search" id="notesSearch" type="search" placeholder="Search notes" autocomplete="off"/>
        <button class="icon-btn notes-photo" type="button" data-act="photo" title="Notes background photo" aria-label="Notes background photo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-8 8"/></svg>
        </button>
        <button class="icon-btn notes-custom" type="button" data-act="custom" title="Customize (fonts and more)" aria-label="Customize">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>
        </button>
        <button class="btn-add notes-new" type="button" data-act="new">+ New note</button>
      </div>
      <div class="notes-bg-panel" id="notesBgPanel" hidden></div>
      <div class="notes-layout">
        <div class="notes-list" id="notesList"></div>
        <div class="notes-pane" id="notesPane">
          <div class="notes-pane-top">
            <button class="icon-btn notes-pane-back" type="button" data-act="list" aria-label="Back to notes list">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <input class="notes-title-input" id="notesTitle" placeholder="Title" spellcheck="false" autocomplete="off"/>
            <button class="icon-btn notes-del" type="button" data-act="del" title="Delete note" aria-label="Delete note">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
            </button>
          </div>
          <div class="notes-editor" id="notesEditor" contenteditable="true" spellcheck="true"
               data-placeholder="Start typing. Try “- ” for a bullet, “[] ” for a checkbox, “1. ” for a numbered list."></div>
          <div class="notes-empty" id="notesEmpty">No notes yet. Tap “+ New note” to start one.</div>
        </div>
      </div>
    </div>`;
  const ed = $('notesEditor');
  window.noteEditor.attach(ed);
  ed.addEventListener('input', queueSave);
  $('notesTitle').addEventListener('input', queueSave);
  $('notesTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ed.focus(); } });
  $('notesSearch').addEventListener('input', (e) => { query = e.target.value; renderList(); });
  page.onclick = (e) => {
    const row = e.target.closest('[data-note]');
    if (row) { select(row.dataset.note); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'close') close();
    else if (act === 'new') create();
    else if (act === 'del') remove();
    else if (act === 'list') page.classList.remove('show-editor');
    else if (act === 'custom' && window.tweaks) window.tweaks.open();
    else if (act === 'photo') renderBgPanel();
  };
  query = '';
}

/* ── LIST ────────────────────────────────────────────────────── */
function renderList() {
  const list = $('notesList');
  if (!list) return;
  const notes = all().filter(matches);
  list.innerHTML = notes.length ? notes.map((n) => `
    <button type="button" class="notes-row${n.id === activeId ? ' active' : ''}" data-note="${esc(n.id)}">
      <span class="notes-row-title">${esc(n.title || 'New note')}</span>
      <span class="notes-row-prev">${esc(preview(n))}</span>
    </button>`).join('') : `<div class="notes-list-empty">${query ? 'No matches' : 'Nothing here yet'}</div>`;
}

/* ── EDITOR ──────────────────────────────────────────────────── */
function current() { return all().find((n) => n.id === activeId) || null; }

function loadEditor() {
  const n = current();
  const pane = $('notesPane');
  if (!pane) return;
  pane.classList.toggle('is-empty', !n);
  $('notesTitle').value = n ? n.title : '';
  window.noteEditor.setText($('notesEditor'), n ? n.content : '');
}
function select(id) {
  flush();
  activeId = id;
  renderList();
  loadEditor();
  $('notesPage').classList.add('show-editor');
}
function create() {
  flush();
  activeId = api().create();
  query = ''; const s = $('notesSearch'); if (s) s.value = '';
  renderList();
  loadEditor();
  $('notesPage').classList.add('show-editor');
  $('notesTitle').focus();
}
function remove() {
  const n = current();
  if (!n) return;
  if (!confirm('Delete "' + (n.title || 'this note') + '"?')) return;
  clearTimeout(saveTimer); saveTimer = null; dirty = false;
  api().remove(n.id);
  const rest = all();
  activeId = (rest[0] && rest[0].id) || null;
  renderList();
  loadEditor();
  if (!activeId) $('notesPage').classList.remove('show-editor');
}

/* ── AUTOSAVE ────────────────────────────────────────────────── */
let dirty = false;   // true only while this page has typing that is not saved yet
function queueSave() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  // Nothing typed here since the last save: do not write, or old text on screen could overwrite a synced edit.
  if (!dirty) return;
  dirty = false;
  const ed = $('notesEditor'), ti = $('notesTitle');
  if (!ed || !ti || !activeId || !api()) return;
  api().update(activeId, { title: ti.value.trim(), content: window.noteEditor.getText(ed) });
  renderList();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('notes-open')) close();
});
window.addEventListener('pagehide', flush);

// Called after a cloud sync (firebase-sync rerender): re-read the notes and redraw if the page is open.
function refresh() {
  if (!document.body.classList.contains('notes-open') || !api()) return;
  const notes = all();
  if (!notes.some((n) => n.id === activeId)) { activeId = (notes[0] && notes[0].id) || null; renderList(); loadEditor(); return; }
  renderList();
  // Unsaved typing on this page wins until it is saved; otherwise show the synced text, keeping the cursor.
  if (saveTimer) return;
  const n = current(), ed = $('notesEditor'), ti = $('notesTitle');
  if (!n || !ed || !ti) return;
  if (window.noteEditor.getText(ed) !== n.content) {
    const caret = document.activeElement === ed ? window.noteEditor.getCaret(ed) : null;
    window.noteEditor.setText(ed, n.content);
    if (caret !== null) window.noteEditor.setCaret(ed, Math.min(caret, n.content.length));
  }
  if (ti.value !== n.title) {
    const pos = ti.selectionStart;
    ti.value = n.title;
    if (document.activeElement === ti) ti.setSelectionRange(Math.min(pos, n.title.length), Math.min(pos, n.title.length));
  }
}

window.notes = { open, close, refresh };
})();
