/* ═══════════════════════════════════════════════════════════════
   GLOBAL SEARCH — one box across every widget's data

   Opened from the header (or the "/" shortcut). Reads straight from
   localStorage (same keys the widgets use) rather than keeping its
   own copy, so results are always current. Selecting a result closes
   the search and scrolls/flashes the widget that holds it — most of
   this data isn't independently addressable (a single task inside
   the Planner card, say), so "jump to the card it lives in" is the
   deepest link that makes sense without a much bigger rewrite.
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';
const { $, esc, load, scrollToCard } = window.dashUtil;

let query = '';

function open() {
  const modal = $('searchModal');
  if (!modal) return;
  modal.classList.add('open');
  render();
  const inp = $('searchInput');
  if (inp) { inp.value = query; requestAnimationFrame(() => inp.focus()); }
}
function close() {
  const modal = $('searchModal');
  if (modal) modal.classList.remove('open');
}
function setQuery(q) { query = q; render(); }

function matches(text) {
  return query && (text || '').toLowerCase().includes(query.toLowerCase());
}

// Every source is {type, cardId, text(s) to match, jump()}.
function collectResults() {
  const q = query.trim();
  if (!q) return [];
  const out = [];

  load('plannerTasks', []).forEach(t => {
    if (matches(t.text)) out.push({ type: 'Task', cardId: 'planner', label: t.text, sub: t.dueDate || '' });
  });
  load('agendaEvents', []).forEach(e => {
    if (matches(e.label)) out.push({ type: 'Event', cardId: 'agenda', label: e.label, sub: e.date || '' });
  });
  load('importantDates', []).forEach(e => {
    if (matches(e.label)) out.push({ type: 'Important Date', cardId: 'dates', label: e.label, sub: e.date || '' });
  });
  const goals = load('goals', { year: [], quarter: [], week: [] });
  ['year','quarter','week'].forEach(scope => (goals[scope] || []).forEach(g => {
    if (matches(g.text)) out.push({ type: 'Goal', cardId: 'goals', label: g.text, sub: `${g.pct}%` });
  }));
  load('lifeItems', []).forEach(i => {
    if (matches(i.text)) out.push({ type: 'Life', cardId: 'life', label: i.text, sub: i.done ? 'done' : '' });
  });
  load('shoppingItems', []).forEach(i => {
    if (matches(i.text)) out.push({ type: 'Shopping', cardId: 'shopping', label: i.text, sub: i.done ? 'checked' : '' });
  });
  load('people', []).forEach(p => {
    if (matches(p.name)) out.push({ type: 'Person', cardId: 'people', label: p.name, sub: '' });
  });
  const cur = load('currently', { reading: [], watching: [], playing: [] });
  ['reading','watching','playing'].forEach(kind => (cur[kind] || []).forEach(e => {
    if (matches(e.title) || matches(e.sub)) out.push({ type: 'Currently', cardId: 'currently', label: e.title || '(untitled)', sub: kind });
  }));
  load('currentlyArchive', []).forEach(e => {
    if (matches(e.title) || matches(e.sub)) out.push({ type: 'Currently (finished)', cardId: 'currently', label: e.title || '(untitled)', sub: e.kind || '' });
  });
  load('dashboard.blocks.notes.v1', []).forEach(n => {
    if (matches(n.title) || matches(n.content)) out.push({ type: 'Note', cardId: n.id, label: n.title || '(untitled note)', sub: (n.content || '').slice(0, 60) });
  });

  return out.slice(0, 60);
}

function render() {
  const list = $('searchResults');
  if (!list) return;
  const results = collectResults();
  if (!query.trim()) {
    list.innerHTML = `<div class="empty">Start typing to search tasks, events, goals, notes, and more.</div>`;
    return;
  }
  if (!results.length) {
    list.innerHTML = `<div class="empty">No matches for "${esc(query)}".</div>`;
    return;
  }
  list.innerHTML = results.map((r, i) => `
    <button class="search-result" onclick="window.dashSearch.go(${i})">
      <span class="search-result-type">${esc(r.type)}</span>
      <span class="search-result-label">${esc(r.label)}</span>
      ${r.sub ? `<span class="search-result-sub">${esc(r.sub)}</span>` : ''}
    </button>`).join('');
  render._results = results;
}

function go(i) {
  const r = render._results && render._results[i];
  if (!r) return;
  close();
  setTimeout(() => scrollToCard(r.cardId), 80); // let the modal close/animate out first
}

document.addEventListener('keydown', e => {
  const modal = $('searchModal');
  const open_ = modal && modal.classList.contains('open');
  if (e.key === 'Escape' && open_) { close(); return; }
  // "/" opens search, unless the user is typing in a field.
  if (!open_ && e.key === '/' && !/^(INPUT|TEXTAREA)$/.test((document.activeElement || {}).tagName) && !(document.activeElement && document.activeElement.isContentEditable)) {
    e.preventDefault();
    open();
  }
});

window.dashSearch = { open, close, setQuery, go };
})();
