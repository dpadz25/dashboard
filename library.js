/* ═══════════════════════════════════════════════════════════════
   LIBRARY — full-page database view for Reading / Watching / Playing

   Opens as a full-screen overlay from the Currently widget. Works on
   the SAME data the widget uses:
   - `currently`        → { reading:[], watching:[], playing:[] }
                          each entry may carry status 'current'|'queued'
                          (missing status = 'current', the old behavior)
   - `currentlyArchive` → finished entries (status 'finished' here)
   Both keys already sync through Firebase; cover images stay
   device-local (firebase-sync strips them), same as before.
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';
const { $, uid, esc, load, save } = window.dashUtil;

const KINDS = {
  reading:  { label: 'Reading',  icon: 'book',    subPh: 'Author' },
  watching: { label: 'Watching', icon: 'film',    subPh: 'Studio / showrunner' },
  playing:  { label: 'Playing',  icon: 'gamepad', subPh: 'Studio / dev' },
};
const STATUSES = {
  current:  { label: 'Current',  cls: 'current' },
  queued:   { label: 'Queued',   cls: 'queued' },
  finished: { label: 'Finished', cls: 'finished' },
};

let libKind = 'reading';
let libStatus = 'all';
let libQuery = '';

function getCurrently() { return load('currently', { reading: [], watching: [], playing: [] }); }
function saveCurrently(c) { save('currently', c); }
function getArchive()  { return load('currentlyArchive', []); }
function saveArchive(a) { save('currentlyArchive', a); }

function entryStatus(e) { return e.status === 'queued' ? 'queued' : 'current'; }

// All entries for the active kind: live ones + finished ones from the archive.
function entriesFor(kind) {
  const live = (getCurrently()[kind] || []).map(e => ({ ...e, _status: entryStatus(e), _src: 'live' }));
  const done = getArchive().filter(a => a.kind === kind).map(e => ({ ...e, _status: 'finished', _src: 'archive' }));
  return [...live, ...done];
}

/* ── OPEN / CLOSE ────────────────────────────────────────────── */
function open() {
  const page = $('libraryPage');
  if (!page) return;
  render();
  page.classList.add('open');
  document.body.classList.add('library-open');
}
function close() {
  const page = $('libraryPage');
  if (page) page.classList.remove('open');
  document.body.classList.remove('library-open');
  // The widget shows the same data — refresh it on the way out.
  if (window.dash && window.dash.renderCurrently) window.dash.renderCurrently();
}

/* ── RENDER ──────────────────────────────────────────────────── */
function render() {
  const page = $('libraryPage');
  if (!page) return;
  const ICONS = window.ICONS || {};
  const meta = KINDS[libKind];

  let items = entriesFor(libKind);
  if (libStatus !== 'all') items = items.filter(e => e._status === libStatus);
  if (libQuery) {
    const q = libQuery.toLowerCase();
    items = items.filter(e => (e.title || '').toLowerCase().includes(q) || (e.sub || '').toLowerCase().includes(q));
  }
  // Current first, then queued, then finished (newest finish first).
  const order = { current: 0, queued: 1, finished: 2 };
  items.sort((a, b) => (order[a._status] - order[b._status]) || ((b.finishedAt || b.startedAt || 0) - (a.finishedAt || a.startedAt || 0)));

  const counts = { all: entriesFor(libKind).length };
  Object.keys(STATUSES).forEach(s => { counts[s] = entriesFor(libKind).filter(e => e._status === s).length; });

  page.innerHTML = `
    <div class="library-inner">
      <div class="library-head">
        <button class="icon-btn library-back" onclick="window.library.close()" title="Back to dashboard">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div class="library-title">Library</div>
        <input class="t-input library-search" placeholder="Search titles…" value="${esc(libQuery)}"
               oninput="window.library.setQuery(this.value)"/>
        <button class="btn-add" onclick="window.library.addEntry()">+ Add ${meta.label.toLowerCase()}</button>
      </div>

      <div class="library-tabs-row">
        <div class="tabs library-kind-tabs">
          ${Object.entries(KINDS).map(([k, m]) => `
            <button class="tab ${libKind === k ? 'active' : ''}" onclick="window.library.setKind('${k}')">
              <span class="cur-tab-icon">${ICONS[m.icon] || ''}</span><span>${m.label}</span>
            </button>`).join('')}
        </div>
        <div class="library-status-chips">
          <button class="lib-chip ${libStatus === 'all' ? 'active' : ''}" onclick="window.library.setStatus('all')">All · ${counts.all}</button>
          ${Object.entries(STATUSES).map(([s, m]) => `
            <button class="lib-chip ${m.cls} ${libStatus === s ? 'active' : ''}" onclick="window.library.setStatus('${s}')">${m.label} · ${counts[s]}</button>`).join('')}
        </div>
      </div>

      ${items.length ? `
        <div class="library-grid">
          ${items.map(e => entryCard(e, meta)).join('')}
        </div>` : `
        <div class="library-empty">
          ${ICONS[meta.icon] || ''}
          <div>nothing here${libQuery ? ' for that search' : ''}.<br>${libQuery ? '' : `tap "+ Add ${meta.label.toLowerCase()}" to start.`}</div>
        </div>`}
    </div>`;
}

function entryCard(e, meta) {
  const st = STATUSES[e._status];
  const key = `${e._src}:${e.id}`;
  return `
    <div class="lib-card ${e._status}" data-key="${key}">
      <div class="lib-cover" onclick="window.library.pickImage('${key}')" title="Change cover">
        ${e.img ? `<img src="${e.img}" alt=""/>` : `<div class="lib-cover-empty">${(window.ICONS || {}).image || ''}<span>add cover</span></div>`}
        <span class="lib-status-badge ${st.cls}">${st.label}</span>
      </div>
      <div class="lib-body">
        <input class="lib-title" value="${esc(e.title || '')}" placeholder="Title"
               onchange="window.library.updateEntry('${key}','title',this.value)"/>
        <input class="lib-sub" value="${esc(e.sub || '')}" placeholder="${meta.subPh}"
               onchange="window.library.updateEntry('${key}','sub',this.value)"/>
        ${e._status !== 'finished' && e.progress != null ? `
          <div class="cur-progress-bar"><div class="cur-progress-fill" style="width:${e.progress}%"></div></div>` : ''}
        <div class="lib-actions">
          <select class="t-select lib-status-select" onchange="window.library.setEntryStatus('${key}',this.value)">
            ${Object.entries(STATUSES).map(([s, m]) => `<option value="${s}"${e._status === s ? ' selected' : ''}>${m.label}</option>`).join('')}
          </select>
          ${e._status !== 'finished' ? `<button class="cur-action" onclick="window.library.cycleProgress('${key}')">${e.progress != null ? e.progress + '%' : 'Progress'}</button>` : ''}
          <button class="cur-action danger" onclick="window.library.deleteEntry('${key}')" title="Delete">${(window.ICONS || {}).trash || '×'}</button>
        </div>
      </div>
    </div>`;
}

/* ── LOOKUP / MUTATION ───────────────────────────────────────── */
// key = "live:<id>" | "archive:<id>"
function findEntry(key) {
  const [src, id] = key.split(':');
  if (src === 'archive') {
    const arch = getArchive();
    const e = arch.find(x => x.id === id);
    return e ? { src, id, entry: e, arch } : null;
  }
  const all = getCurrently();
  const list = all[libKind] || [];
  const e = list.find(x => x.id === id);
  return e ? { src, id, entry: e, all, list } : null;
}

function commit(found) {
  if (found.src === 'archive') saveArchive(found.arch);
  else saveCurrently(found.all);
  if (window.dash && window.dash.renderCurrently) window.dash.renderCurrently();
}

function updateEntry(key, field, value) {
  const f = findEntry(key);
  if (!f) return;
  f.entry[field] = value;
  commit(f);
}

function setEntryStatus(key, status) {
  const f = findEntry(key);
  if (!f) return;
  if (f.src === 'live' && status === 'finished') {
    // live → archive (same move the widget's Finish button makes)
    const all = f.all;
    all[libKind] = f.list.filter(x => x.id !== f.id);
    const arch = getArchive();
    const copy = { ...f.entry, kind: libKind, finishedAt: Date.now() };
    delete copy.status;
    arch.unshift(copy);
    saveCurrently(all);
    saveArchive(arch.slice(0, 200));
  } else if (f.src === 'archive' && status !== 'finished') {
    // archive → live again
    const arch = f.arch.filter(x => x.id !== f.id);
    const restored = { ...f.entry, status };
    delete restored.kind;
    delete restored.finishedAt;
    const all = getCurrently();
    all[libKind] = all[libKind] || [];
    all[libKind].unshift(restored);
    saveArchive(arch);
    saveCurrently(all);
  } else if (f.src === 'live') {
    f.entry.status = status;
    saveCurrently(f.all);
  }
  if (window.dash && window.dash.renderCurrently) window.dash.renderCurrently();
  render();
}

function cycleProgress(key) {
  const f = findEntry(key);
  if (!f) return;
  const cur = f.entry.progress;
  if (cur == null) f.entry.progress = 25;
  else if (cur < 100) f.entry.progress = Math.min(100, cur + 25);
  else f.entry.progress = null;
  commit(f);
  render();
}

function deleteEntry(key) {
  const f = findEntry(key);
  if (!f) return;
  if (!confirm(`Delete "${f.entry.title || 'this entry'}"?`)) return;
  if (f.src === 'archive') saveArchive(f.arch.filter(x => x.id !== f.id));
  else { f.all[libKind] = f.list.filter(x => x.id !== f.id); saveCurrently(f.all); }
  if (window.dash && window.dash.renderCurrently) window.dash.renderCurrently();
  render();
}

function addEntry() {
  const all = getCurrently();
  all[libKind] = all[libKind] || [];
  all[libKind].unshift({ id: uid(), title: '', sub: '', img: null, progress: null, status: 'current', startedAt: Date.now() });
  saveCurrently(all);
  if (window.dash && window.dash.renderCurrently) window.dash.renderCurrently();
  render();
  const first = document.querySelector('#libraryPage .lib-card .lib-title');
  if (first) first.focus();
}

function pickImage(key) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.heic,.heif,.avif';
  input.onchange = ev => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    window.dashImg.compressImage(file, 1400, dataUrl => {
      const f = findEntry(key);
      if (!f) return;
      f.entry.img = dataUrl;
      commit(f);
      render();
    });
  };
  input.click();
}

/* ── FILTER STATE ────────────────────────────────────────────── */
function setKind(k)   { libKind = k; render(); }
function setStatus(s) { libStatus = s; render(); }
let queryTimer = null;
function setQuery(q) {
  libQuery = q;
  clearTimeout(queryTimer);
  // Debounced so typing doesn't rebuild (and blur) the search box each key.
  queryTimer = setTimeout(() => {
    const inp = document.querySelector('#libraryPage .library-search');
    const hadFocus = document.activeElement === inp;
    const pos = inp ? inp.selectionStart : 0;
    render();
    if (hadFocus) {
      const again = document.querySelector('#libraryPage .library-search');
      if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    }
  }, 180);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.body.classList.contains('library-open')) close();
});

window.library = {
  open, close, render,
  setKind, setStatus, setQuery,
  addEntry, updateEntry, setEntryStatus, cycleProgress, deleteEntry, pickImage,
};
})();
