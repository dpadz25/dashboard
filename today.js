/* ═══════════════════════════════════════════════════════════════
   TODAY / WEEKLY REVIEW — condensed overlay view

   Two tabs on one full-screen page, opened from the header:
   - Today: today's tasks (+ overdue), today's events, today's
     habit checklist, and current goal progress — a thin summary,
     while the full customized board stays exactly as it is.
   - This Week: what got done this week (from the completion log
     dashboard.js keeps in `taskCompletionLog`), what's carrying
     over (still open, due this week or earlier), and a per-habit
     weekly completion trend.

   Reads the same localStorage keys the main dashboard widgets use
   and calls back into window.dash for actions (toggle a task,
   check a habit, bump a goal) so state never drifts out of sync.
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';
const { $, esc, load, todayStr } = window.dashUtil;

let activeView = 'today';
// Customize layout is stored in `todayLayout`: { order: [sectionId], hidden: [sectionId], density: 'cozy'|'compact' }.
// Section ids are the .td-o* keys below; order is the phone order and the order inside each desktop column.
const DEFAULT_ORDER = ['focus', 'due', 'rhythm', 'habits', 'dailies', 'events', 'people', 'goals'];
const ALL_IDS = ['strip'].concat(DEFAULT_ORDER);
let sheetOpen = false, compact = false;
let hidden = new Set(), order = DEFAULT_ORDER.slice();
function loadLayout() {
  const L = load('todayLayout', null) || {};
  const o = (Array.isArray(L.order) ? L.order : []).filter((id, i, a) => DEFAULT_ORDER.includes(id) && a.indexOf(id) === i);
  order = o.concat(DEFAULT_ORDER.filter(id => !o.includes(id)));
  hidden = new Set((Array.isArray(L.hidden) ? L.hidden : []).filter(id => ALL_IDS.includes(id)));
  compact = L.density === 'compact';
}
function persistLayout() {
  window.dashUtil.save('todayLayout', { order: order.slice(), hidden: Array.from(hidden), density: compact ? 'compact' : 'cozy' });
}

function getWeekDates() {
  const today = new Date(); today.setHours(0,0,0,0);
  const start = new Date(today); start.setDate(today.getDate() - today.getDay());
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
}
function dateKey(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }

function getCategory(type) {
  if (!type) return 'default';
  const t = type.toLowerCase();
  if (t === 'priority') return 'priority';
  if (['exam','quiz','test'].includes(t)) return 'exam';
  if (['essay','project'].includes(t)) return 'essay';
  if (['meeting','interview'].includes(t)) return 'meeting';
  return 'school';
}

function classFor(id) {
  if (!id) return null;
  return (load('schoolClasses', []) || []).find(c => c.id === id) || null;
}

/* ── OPEN / CLOSE ────────────────────────────────────────────── */
function open() {
  const page = $('todayPage');
  if (!page) return;
  render();
  page.classList.add('open');
  document.body.classList.add('library-open'); // reuses the same body-lock rule as Library
}
function close() {
  const page = $('todayPage');
  if (page) page.classList.remove('open');
  document.body.classList.remove('library-open');
}
function switchView(v) { activeView = v; render(); }

/* ── SMALL TEMPLATE HELPERS (look only) ──────────────────────── */
const IC = {
  back: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  check: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  star: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2.5 2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z"/></svg>',
  cal: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 10h18M8 2.5v4M16 2.5v4"/></svg>',
  grip: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  sliders: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
  plus: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  dots: '<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
};

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
}
function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function shortDate(k) { return parseKey(k).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

// Every section is one of these: grip + serif title on the left, optional
// count pill and options button on the right. Grip and options are visual only
// in this phase, so they are hidden from assistive tech and not focusable.
function card(id, title, body, opts) {
  opts = opts || {};
  return `
    <section class="td-card${opts.cls ? ' ' + opts.cls : ''}" data-sec="${id}" aria-labelledby="tdt-${id}">
      <header class="td-card-head">
        <span class="td-grip">${IC.grip}</span>
        <h2 class="td-card-title" id="tdt-${id}">${title}</h2>
        ${opts.pill ? `<span class="td-pill">${opts.pill}</span>` : ''}
        <span class="td-opts">${IC.dots}</span>
      </header>
      ${body}
    </section>`;
}
function bar(pct, cls) {
  const p = Math.max(0, Math.min(100, Math.round(+pct || 0)));
  return `<div class="td-bar ${cls || ''}" role="img" aria-label="${p} percent complete"><div class="td-bar-fill" style="width:${p}%"></div></div>`;
}
function empty(text) { return `<div class="td-empty">${text}</div>`; }

/* ── RENDER ──────────────────────────────────────────────────── */
function render() {
  const page = $('todayPage');
  if (!page) return;
  loadLayout();
  const now = new Date();
  const sub = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) + ' · Week ' + isoWeek(now);
  page.innerHTML = `
    <div class="today-inner">
      <header class="td-top">
        <button class="td-back" onclick="window.today.close()" title="Back to dashboard" aria-label="Back to dashboard">${IC.back}</button>
        <div class="td-top-title">
          <h1 class="td-h1">${activeView === 'today' ? 'Today' : 'This Week'}</h1>
          <div class="td-sub">${esc(sub)}</div>
        </div>
        <button class="td-custom" onclick="window.today.openSheet()" aria-label="Customize Today">${IC.sliders}<span>Customize</span></button>
        <div class="td-seg" role="group" aria-label="View">
          <button class="td-seg-btn${activeView === 'today' ? ' on' : ''}" aria-pressed="${activeView === 'today'}" onclick="window.today.switchView('today')">Today</button>
          <button class="td-seg-btn${activeView === 'week' ? ' on' : ''}" aria-pressed="${activeView === 'week'}" onclick="window.today.switchView('week')">This Week</button>
        </div>
      </header>
      <div id="todayBody">${activeView === 'today' ? renderTodayView() : renderWeekView()}</div>
    </div>${sheetOpen ? sheetHtml() : ''}`;
  page.classList.toggle('compact', compact);
  if (sheetOpen) { const d = page.querySelector('.td-sheet-done'); if (d) d.focus(); }
}

/* ── TODAY TAB ───────────────────────────────────────────────── */
function weekStrip(allTasks) {
  const base = new Date(); base.setHours(0, 0, 0, 0);
  const tiles = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base); d.setDate(base.getDate() + i);
    const k = dateKey(d);
    const n = allTasks.filter(t => t.dueDate === k).length;
    const wd = i === 0 ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'short' });
    return `<div class="td-day${i === 0 ? ' now' : ''}">
      <span class="td-day-lbl">${wd}</span>
      <span class="td-day-num">${d.getDate()}</span>
      <span class="td-day-count"><i class="td-day-dot${n ? ' has' : ''}"></i>${n ? n + ' due' : 'Free'}</span>
    </div>`;
  }).join('');
  return `<section class="td-card td-strip" aria-label="Next seven days"><div class="td-days">${tiles}</div></section>`;
}

function ring(done, total, label, cls) {
  const R = 39, C = 2 * Math.PI * R;
  const frac = total ? done / total : 0;
  return `
    <div class="td-ring ${cls}" role="img" aria-label="${label}: ${done} of ${total} done">
      <svg aria-hidden="true" viewBox="0 0 96 96" width="96" height="96">
        <circle class="td-ring-track" cx="48" cy="48" r="${R}" fill="none" stroke-width="9"/>
        <circle class="td-ring-fill" cx="48" cy="48" r="${R}" fill="none" stroke-width="9" stroke-linecap="round"
          stroke-dasharray="${(C * frac).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 48 48)"/>
      </svg>
      <span class="td-ring-num">${done}<small>/${total}</small></span>
      <span class="td-ring-lbl">${label}</span>
    </div>`;
}

// Calm one-liner from simple rules: counts, the first undone names, a gentle close.
function rhythmSentence(done, total, undone) {
  if (!total) return '';
  const h = new Date().getHours();
  const close = h >= 17 ? 'Take it easy tonight.' : h >= 12 ? 'Keep it gentle this afternoon.' : 'A calm start is plenty.';
  if (!undone.length) return `<b>${done} of ${total} done.</b> Everything is checked off. Enjoy the rest of your day.`;
  const names = undone.slice(0, 2).map((l, i) => esc(i ? l.charAt(0).toLowerCase() + l.slice(1) : l));
  const list = names.length === 2 ? names[0] + ' and ' + names[1] : names[0];
  return `<b>${done} of ${total} done.</b> ${list} ${names.length === 2 ? 'are' : 'is'} next. ${close}`;
}

function chip(label, on, minor, handler) {
  return `<button class="td-chip${on ? ' done' : ''}" aria-pressed="${on ? 'true' : 'false'}" onclick="${handler}">${on ? IC.check : ''}<span>${esc(label)}${minor ? ' (min)' : ''}</span></button>`;
}

function renderTodayView() {
  const key = todayStr();
  const allTasks = load('plannerTasks', []).filter(t => !t.done);
  const overdue = allTasks.filter(t => t.dueDate && t.dueDate < key).sort((a,b) => a.dueDate.localeCompare(b.dueDate));
  const dueToday = allTasks.filter(t => t.dueDate === key);

  const events = [
    ...load('agendaEvents', []).map(e => ({ ...e, _star: false })),
    ...load('importantDates', []).map(e => ({ ...e, _star: true })),
  ].filter(e => e.date === key).sort((a,b) => (a.start||'').localeCompare(b.start||''));

  const habits = window.dash.getHabits ? window.dash.getHabits() : load('habitsConfig', []);
  const habitState = (load('habitHistory', {})[key]) || {};

  const goals = load('goals', { year: [], quarter: [], week: [] });
  const SC = { week: 'Wk', quarter: 'Qtr', year: 'Yr' };
  const review = window.dash.getGoalReview ? window.dash.getGoalReview() : [];
  const pctOf = {}; review.forEach(r => { pctOf[r.id] = r.pct; });
  const goalRows = ['week', 'quarter', 'year'].flatMap(sc => (goals[sc] || []).map(g => ({ ...g, scope: SC[sc], pct: pctOf[g.id] != null ? pctOf[g.id] : (+g.pct || 0) })));
  const focus = window.dash.getFocusGoal ? window.dash.getFocusGoal() : null;

  const dailies = window.dash.getDailies ? window.dash.getDailies() : [];
  const dailyState = (load('dailiesHistory', {})[key]) || {};
  const groups = [['morning', 'Morning'], ['afternoon', 'Afternoon'], ['evening', 'Evening']];

  const peopleDue = window.dash.getPeopleDue ? window.dash.getPeopleDue() : [];

  const habitsDone = habits.filter(h => habitState[h.id]).length;
  const dailiesDone = dailies.filter(d => dailyState[d.id]).length;

  /* Focus goal (hidden when nothing is starred) */
  const focusCard = focus ? `
    <section class="td-focus" data-sec="focus" aria-labelledby="tdt-focus">
      <div class="td-label td-focus-label"><span class="td-focus-star">${IC.star}</span><span id="tdt-focus">Focus goal · ${esc(SC[focus.scope] || '')}</span></div>
      <div class="td-focus-row">
        <div class="td-focus-title">${esc(focus.text)}</div>
        <div class="td-focus-pct">${focus.pct}%</div>
      </div>
      ${bar(focus.pct, 'lg')}
      <div class="td-next">
        <div class="td-next-main">
          <div class="td-label">Next step</div>
          <div class="td-next-text${focus.next ? '' : ' none'}">${focus.next ? esc(focus.next) : 'No next step yet. Add one in the Goals card.'}</div>
        </div>
        ${focus.pct < 100 ? `<button class="td-iconbtn solid" onclick="window.today.bumpGoal('${focus.id}')" aria-label="Log a step of progress on the focus goal" title="Log progress">${IC.check}</button>` : ''}
      </div>
    </section>` : '';

  /* Due today + overdue, one card */
  const openCount = overdue.length + dueToday.length;
  const dueBody = `
    ${overdue.length ? `<div class="td-sublabel rose">Overdue</div><div class="td-list">${overdue.map(t => taskRow(t, true)).join('')}</div>`
      : `<div class="td-banner">${IC.check}<span>Nothing overdue. Nicely done.</span></div>`}
    ${overdue.length ? `<div class="td-sublabel">Due today</div>` : ''}
    ${dueToday.length ? `<div class="td-list">${dueToday.map(t => taskRow(t, false)).join('')}</div>`
      : empty('Nothing due today.')}`;
  const dueCard = card('due', 'Due today', dueBody, { pill: openCount ? openCount + ' open' : '' });

  /* Today's events */
  const eventsBody = events.length ? `<div class="td-list">${events.map(e => `
      <div class="today-event-row td-row td-event">
        <span class="td-event-time">${e.start ? window.dashUtil.fmtTime(e.start) + (e.end ? `<small>${window.dashUtil.fmtTime(e.end)}</small>` : '') : 'All day'}</span>
        <span class="td-event-title">${e._star ? `<span class="td-event-star" title="Important date">${IC.star}</span>` : ''}${esc(e.label)}</span>
      </div>`).join('')}</div>`
    : `<div class="td-empty-state"><span class="td-empty-ic">${IC.cal}</span>${empty('Nothing on the calendar today.')}<button class="td-outbtn" onclick="window.today.jumpTo('agenda')">${IC.plus}<span>Add an event</span></button></div>`;
  const eventsCard = card('events', 'Today’s events', eventsBody, { pill: events.length ? String(events.length) : '' });

  /* Non-negotiables and dailies */
  const habitsCard = card('habits', 'Non-negotiables',
    habits.length ? `<div class="td-chips">${habits.map(h => chip(h.label, habitState[h.id], habitState[h.id] === 'min', `window.today.toggleHabit('${h.id}')`)).join('')}</div>` : empty('No habits set up yet.'),
    { pill: habits.length ? `${habitsDone} of ${habits.length}` : '' });

  const dailiesBody = dailies.length ? `<div class="td-groups">${groups.map(([gk, gl]) => {
    const items = dailies.filter(d => d.group === gk);
    if (!items.length) return '';
    const n = items.filter(d => dailyState[d.id]).length;
    return `<div class="today-daily-group td-group"><div class="td-group-head"><span class="td-label">${gl}</span><span class="td-group-count">${n} of ${items.length}</span></div>
      <div class="td-chips">${items.map(d => chip(d.label, dailyState[d.id], dailyState[d.id] === 'min', `window.today.toggleDaily('${d.id}')`)).join('')}</div></div>`;
  }).join('')}</div>` : empty('No dailies set up yet.');
  const dailiesCard = card('dailies', 'Dailies', dailiesBody, { pill: dailies.length ? `${dailiesDone} of ${dailies.length}` : '' });

  /* Today's rhythm (read only) */
  const undone = [...habits.filter(h => !habitState[h.id]), ...dailies.filter(d => !dailyState[d.id])].map(x => x.label);
  const rhythmCard = (habits.length || dailies.length) ? card('rhythm', 'Today’s rhythm', `
    <div class="td-rings">
      ${habits.length ? ring(habitsDone, habits.length, 'Non-negotiables', 'a') : ''}
      ${dailies.length ? ring(dailiesDone, dailies.length, 'Dailies', 'b') : ''}
    </div>
    <p class="td-rhythm-text">${rhythmSentence(habitsDone + dailiesDone, habits.length + dailies.length, undone)}</p>`) : '';

  /* People */
  const peopleCard = card('people', 'People to reach out to',
    peopleDue.length ? `<div class="td-list">${peopleDue.slice(0, 8).map(p => `
      <div class="today-person-row td-row td-person">
        <span class="td-avatar" aria-hidden="true">${esc((p.name || '?').trim().charAt(0).toUpperCase())}</span>
        <div class="td-person-main">
          <div class="td-person-name">${esc(p.name)}</div>
          <div class="td-person-note">${p.notes ? esc(p.notes) : 'Time to check in'}</div>
        </div>
        <button class="td-iconbtn" onclick="window.today.reachOut('${p.id}')" aria-label="I reached out to ${esc(p.name)}" title="I reached out">${IC.check}</button>
      </div>`).join('')}</div>` : empty('Nobody is due. Nice.'),
    { pill: peopleDue.length ? String(peopleDue.length) : '' });

  /* Goal progress */
  const goalsCard = card('goals', 'Goal progress',
    (goalRows.length ? `<div class="td-list">${goalRows.map(g => `
      <div class="today-goal-row td-row td-goal">
        <div class="td-goal-top">
          <span class="td-scope">${g.scope}</span>
          <span class="td-goal-text">${esc(g.text)}</span>
          <button class="td-pctbtn" onclick="window.today.bumpGoal('${g.id}')" aria-label="${esc(g.text)}: ${g.pct} percent. Tap to add progress" title="Click to increment">${g.pct}%</button>
        </div>
        ${bar(g.pct)}
      </div>`).join('')}</div>` : empty('No goals set yet.')) + `<button class="td-dashed" onclick="window.today.jumpTo('goals','goalInput')">${IC.plus}<span>Add a goal</span></button>`);

  const sh = (id, html) => hidden.has(id) ? '' : html;
  const o = id => order.indexOf(id) + 1;
  return `
    ${sh('strip', weekStrip(allTasks))}
    <div class="td-grid">
      <div class="td-col td-col-l">
        <div style="order:${o('focus')}">${sh('focus', focusCard)}</div>
        <div style="order:${o('due')}">${sh('due', dueCard)}</div>
        <div style="order:${o('dailies')}">${sh('dailies', dailiesCard)}</div>
        <div style="order:${o('goals')}">${sh('goals', goalsCard)}</div>
      </div>
      <div class="td-col td-col-r">
        <div style="order:${o('rhythm')}">${sh('rhythm', rhythmCard)}</div>
        <div style="order:${o('habits')}">${sh('habits', habitsCard)}</div>
        <div style="order:${o('events')}">${sh('events', eventsCard)}</div>
        <div style="order:${o('people')}">${sh('people', peopleCard)}</div>
      </div>
    </div>`;
}

function taskRow(t, isOverdue) {
  const cls = classFor(t.classId);
  const dot = cls ? `<i class="td-dot" style="background:${cls.color}"></i>${esc(cls.name)}` : '';
  const when = isOverdue && t.dueDate ? `<span class="td-when">Due ${esc(shortDate(t.dueDate))}</span>` : '';
  const sub = [dot ? `<span class="td-class">${dot}</span>` : '', when].filter(Boolean).join('');
  const tags = [
    (t.status === 'doing') ? '<span class="td-status">In progress</span>' : '',
    t.type ? `<span class="td-type ${getCategory(t.type)}">${esc(t.type)}</span>` : '',
  ].filter(Boolean).join('');
  return `
    <div class="today-task-row td-row td-task${isOverdue ? ' overdue' : ''}">
      <button class="td-check" onclick="window.today.completeTask('${t.id}')" aria-label="Complete: ${esc(t.text)}" title="Complete"><span class="td-box"></span></button>
      <div class="td-task-main">
        <div class="td-task-title task-txt">${esc(t.text)}</div>
        ${sub ? `<div class="td-task-sub">${sub}</div>` : ''}
      </div>
      ${tags ? `<div class="td-task-tags">${tags}</div>` : ''}
    </div>`;
}

const SECTION_NAMES = { strip: 'Week strip', focus: 'Focus goal', due: 'Due today', rhythm: 'Today\u2019s rhythm', habits: 'Non-negotiables', dailies: 'Dailies', events: 'Today\u2019s events', people: 'People to reach out to', goals: 'Goal progress' };
function sheetHtml() {
  return `
    <div class="td-sheet-wrap" onclick="if(event.target===this)window.today.closeSheet()">
      <div class="td-sheet" role="dialog" aria-modal="true" aria-labelledby="tdSheetTitle">
        <div class="td-grabber" aria-hidden="true"></div>
        <div class="td-sheet-head">
          <h2 id="tdSheetTitle" class="td-card-title">Customize Today</h2>
          <button class="td-sheet-done" onclick="window.today.closeSheet()">Done</button>
        </div>
        <p class="td-hint">Show or hide sections, and drag the handle to reorder. Saved and synced across your devices.</p>
        <div class="td-sheet-rows">${['strip'].concat(order).map(id => {
          const name = SECTION_NAMES[id];
          return `
          <div class="td-sheet-row" ${id === 'strip' ? '' : `data-id="${id}"`}>
            ${id === 'strip' ? `<span class="td-grip td-grip-fixed">${IC.grip}</span>` : `<button class="td-handle" data-id="${id}" aria-label="Reorder ${name}. Use the up and down arrow keys." onpointerdown="window.today.dragStart(event,'${id}')" onkeydown="window.today.handleKey(event,'${id}')">${IC.grip}</button>`}
            <span class="td-sheet-name">${name}</span>
            <button class="td-switch${hidden.has(id) ? '' : ' on'}" role="switch" aria-checked="${!hidden.has(id)}" aria-label="Show ${name}" onclick="window.today.toggleSection('${id}')"><i></i></button>
          </div>`;
        }).join('')}</div>
        <div class="td-seg td-density" role="group" aria-label="Spacing">
          <button class="td-seg-btn${compact ? '' : ' on'}" aria-pressed="${!compact}" onclick="window.today.setCompact(false)">Cozy</button>
          <button class="td-seg-btn${compact ? ' on' : ''}" aria-pressed="${compact}" onclick="window.today.setCompact(true)">Compact</button>
        </div>
        <button class="td-reset" onclick="window.today.resetSheet()">Reset to default order</button>
      </div>
    </div>`;
}
function openSheet() { sheetOpen = true; render(); }
function closeSheet() { sheetOpen = false; render(); const b = document.querySelector('#todayPage .td-custom'); if (b) b.focus(); }
function toggleSection(id) { hidden.has(id) ? hidden.delete(id) : hidden.add(id); persistLayout(); render(); }
function setCompact(v) { compact = !!v; persistLayout(); render(); }
function resetSheet() { hidden = new Set(); order = DEFAULT_ORDER.slice(); compact = false; persistLayout(); render(); }
function moveSection(id, dir) {
  const i = order.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  persistLayout(); render();
  const h = document.querySelector('#todayPage .td-handle[data-id="' + id + '"]');
  if (h) h.focus();
}
function handleKey(e, id) {
  if (e.key === 'ArrowUp') { e.preventDefault(); moveSection(id, -1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); moveSection(id, 1); }
}
// Pointer drag: rows swap live in the DOM while dragging, order is saved on release.
function dragStart(e, id) {
  e.preventDefault();
  const row = e.currentTarget.closest('.td-sheet-row'), wrap = row.parentNode;
  row.classList.add('dragging');
  const move = ev => {
    for (const r of wrap.querySelectorAll('.td-sheet-row[data-id]')) {
      if (r === row) continue;
      const b = r.getBoundingClientRect(), mid = b.top + b.height / 2;
      const before = row.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_PRECEDING;
      if (ev.clientY > b.top && ev.clientY < b.bottom) {
        if (before && ev.clientY < mid) wrap.insertBefore(row, r);
        else if (!before && ev.clientY > mid) wrap.insertBefore(row, r.nextSibling);
      }
    }
  };
  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', up);
    row.classList.remove('dragging');
    order = Array.from(wrap.querySelectorAll('.td-sheet-row[data-id]')).map(r => r.dataset.id);
    persistLayout(); render();
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
}
// "Add" buttons reuse the cards already on the dashboard: close the overlay,
// scroll to the card, and focus its input when it has one.
function jumpTo(cardId, inputId) {
  close();
  setTimeout(() => {
    window.dashUtil.scrollToCard(cardId);
    const i = inputId && document.getElementById(inputId);
    if (i) setTimeout(() => i.focus({ preventScroll: true }), 450);
  }, 280);
}

function completeTask(id) { window.dash.toggleTask(id); render(); }
function toggleHabit(id) {
  const key = todayStr();
  const cur = (load('habitHistory', {})[key] || {})[id];
  window.dash.setHabitToday(id, !cur);
  if (window.dash.renderHabits) window.dash.renderHabits();
  render();
}
function toggleDaily(id) {
  const cur = (load('dailiesHistory', {})[todayStr()] || {})[id];
  window.dash.setDailyToday(id, !cur);
  if (window.dash.renderDailies) window.dash.renderDailies();
  render();
}
function reachOut(id) { window.dash.checkin(id); render(); }
function bumpGoal(id) { window.dash.cycleGoal(id); if (window.dash.renderGoals) window.dash.renderGoals(); render(); }
function setGoalNext(id, val) { window.dash.setGoalNext(id, val); if (window.dash.renderGoals) window.dash.renderGoals(); render(); }

/* ── THIS WEEK TAB ───────────────────────────────────────────── */
function renderWeekView() {
  const weekDates = getWeekDates();
  const weekKeys = weekDates.map(dateKey);
  const weekStart = weekKeys[0], weekEnd = weekKeys[6];

  const log = (window.dash.getTaskLog ? window.dash.getTaskLog() : []).filter(e => {
    const k = dateKey(new Date(e.completedAt));
    return k >= weekStart && k <= weekEnd;
  });

  const carrying = load('plannerTasks', []).filter(t => !t.done && t.dueDate && t.dueDate <= weekEnd)
    .sort((a,b) => a.dueDate.localeCompare(b.dueDate));

  const habits = window.dash.getHabits ? window.dash.getHabits() : load('habitsConfig', []);
  const habitHistory = load('habitHistory', {});
  const dailies = window.dash.getDailies ? window.dash.getDailies() : [];
  const dailyHistory = load('dailiesHistory', {});
  const today = new Date(); today.setHours(0,0,0,0);
  const review = window.dash.getGoalReview ? window.dash.getGoalReview() : [];
  const moved = review.filter(r => r.moved), quiet = review.filter(r => !r.moved);
  const SC = { week: 'Wk', quarter: 'Qtr', year: 'Yr' };
  const reviewRow = (r) => `
    <div class="today-review-row td-row td-review${r.stuck ? ' stuck' : ''}">
      <div class="td-review-top">
        <span class="td-scope">${SC[r.scope]}</span>
        <span class="td-goal-text">${esc(r.text)}</span>
        <span class="td-review-pct">${r.pct}%${r.stuck ? ` · stuck ${r.stuck}d` : ''}</span>
      </div>
      <input class="td-field today-review-next" aria-label="Next step for ${esc(r.text)}" placeholder="What is the next step?" value="${esc(r.next)}" onchange="window.today.setGoalNext('${r.id}', this.value)"/>
    </div>`;
  const trendRows = (items, hist, streakFn, tone) => items.map(h => {
    const daysSoFar = weekDates.filter(d => d <= today).length;
    const doneCount = weekDates.filter(d => d <= today && hist[dateKey(d)] && hist[dateKey(d)][h.id]).length;
    const pct = daysSoFar ? Math.round(doneCount / daysSoFar * 100) : 0;
    const streak = streakFn ? streakFn(h.id) : 0;
    return `
      <div class="td-trend-row">
        <span class="td-trend-label">${esc(h.label)}</span>
        ${bar(pct, 'trend ' + tone)}
        <span class="td-trend-pct">${doneCount}/${daysSoFar}${streak >= 2 ? ` · ${streak}d streak` : ''}</span>
      </div>`;
  }).join('');

  const reviewBody = review.length ? `
        <p class="td-hint">Two minutes: look at what moved, then give every quiet goal a next step small enough to do this week.</p>
        ${moved.length ? `<div class="td-sublabel">Moved this week</div><div class="td-list">${moved.map(reviewRow).join('')}</div>` : ''}
        ${quiet.length ? `<div class="td-sublabel">Quiet</div><div class="td-list">${quiet.map(reviewRow).join('')}</div>` : ''}`
    : empty('No goals to review yet.');

  const doneBody = log.length ? `<div class="td-list">${log.slice(0, 40).map(e => `
        <div class="today-task-row td-row td-task done-row">
          <span class="td-donemark" aria-hidden="true">${IC.check}</span>
          <div class="td-task-main"><div class="td-task-title task-txt">${esc(e.text)}</div></div>
          ${e.type ? `<div class="td-task-tags"><span class="td-type ${getCategory(e.type)}">${esc(e.type)}</span></div>` : ''}
        </div>`).join('')}</div>` : empty('Nothing logged as done yet this week.');

  return `
    <div class="td-grid">
      <div class="td-col td-col-l">
        <div class="td-o1">${card('review', 'Goal review', reviewBody)}</div>
        <div class="td-o4">${card('trend-h', 'Non-negotiables trend', habits.length ? `<div class="td-list tight">${trendRows(habits, habitHistory, window.dash.habitStreak, 'a')}</div>` : empty('No habits set up yet.'))}</div>
        <div class="td-o5">${card('trend-d', 'Dailies trend', dailies.length ? `<div class="td-list tight">${trendRows(dailies, dailyHistory, window.dash.dailyStreak, 'b')}</div>` : empty('No dailies set up yet.'))}</div>
      </div>
      <div class="td-col td-col-r">
        <div class="td-o2">${card('done', 'Done this week', doneBody, { pill: log.length ? String(log.length) : '' })}</div>
        <div class="td-o3">${card('carry', 'Carrying over', carrying.length ? `<div class="td-list">${carrying.map(t => taskRow(t, t.dueDate < todayStr())).join('')}</div>` : empty('Nothing carrying over. Clean slate.'), { pill: carrying.length ? String(carrying.length) : '' })}</div>
      </div>
    </div>`;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('todayPage') && document.getElementById('todayPage').classList.contains('open')) { if (sheetOpen) closeSheet(); else close(); }
});

window.today = { open, close, switchView, dragStart, handleKey, openSheet, closeSheet, toggleSection, setCompact, resetSheet, jumpTo, completeTask, toggleHabit, toggleDaily, reachOut, bumpGoal, setGoalNext };
})();
