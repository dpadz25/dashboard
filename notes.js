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
   Notes defaults to plain white (light mode) or black (dark mode), set
   by the tokens on #notesPage in styles.css. If a custom page photo is
   set in Customize it shows here too, using the --user-bg / --bg-*
   vars tweaks.js sets on <body>. Fonts follow Customize automatically. */
function syncBackdrop() {
  const page = $('notesPage');
  if (!page) return;
  // Colors come from the black/white tokens in styles.css (#notesPage); only the photo is copied.
  page.classList.toggle('has-bg', document.body.getAttribute('data-has-bg') === '1');
}
function watchBackdrop() {
  const run = () => { if (document.body.classList.contains('notes-open')) { syncBackdrop(); setTimeout(syncBackdrop, 350); } };
  const mo = new MutationObserver(run);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
  mo.observe(document.body, { attributes: true, attributeFilter: ['data-has-bg', 'style'] });
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
  syncBackdrop();
  page.classList.add('open');
  document.body.classList.add('library-open', 'notes-open');
  page.classList.toggle('show-editor', !!id);
}
function close() {
  flush();
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
        <button class="icon-btn notes-custom" type="button" data-act="custom" title="Customize (themes, fonts, background)" aria-label="Customize">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>
        </button>
        <button class="btn-add notes-new" type="button" data-act="new">+ New note</button>
      </div>
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
  clearTimeout(saveTimer); saveTimer = null;
  api().remove(n.id);
  const rest = all();
  activeId = (rest[0] && rest[0].id) || null;
  renderList();
  loadEditor();
  if (!activeId) $('notesPage').classList.remove('show-editor');
}

/* ── AUTOSAVE ────────────────────────────────────────────────── */
function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}
function flush() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const ed = $('notesEditor'), ti = $('notesTitle');
  if (!ed || !ti || !activeId || !api()) return;
  api().update(activeId, { title: ti.value.trim(), content: window.noteEditor.getText(ed) });
  renderList();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('notes-open')) close();
});
window.addEventListener('pagehide', flush);

watchBackdrop();
window.notes = { open, close };
})();
