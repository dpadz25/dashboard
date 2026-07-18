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

/* ── RENDER ──────────────────────────────────────────────────── */
function render() {
  const page = $('todayPage');
  if (!page) return;
  page.innerHTML = `
    <div class="today-inner">
      <div class="library-head">
        <button class="icon-btn library-back" onclick="window.today.close()" title="Back to dashboard">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div class="library-title">${activeView === 'today' ? 'Today' : 'This Week'}</div>
        <div class="tabs">
          <button class="tab ${activeView === 'today' ? 'active' : ''}" onclick="window.today.switchView('today')">Today</button>
          <button class="tab ${activeView === 'week' ? 'active' : ''}" onclick="window.today.switchView('week')">This Week</button>
        </div>
      </div>
      <div id="todayBody"></div>
    </div>`;
  const body = $('todayBody');
  body.innerHTML = activeView === 'today' ? renderTodayView() : renderWeekView();
}

/* ── TODAY TAB ───────────────────────────────────────────────── */
function renderTodayView() {
  const key = todayStr();
  const tasks = load('plannerTasks', []).filter(t => !t.done);
  const overdue = tasks.filter(t => t.dueDate && t.dueDate < key).sort((a,b) => a.dueDate.localeCompare(b.dueDate));
  const dueToday = tasks.filter(t => t.dueDate === key);

  const events = [
    ...load('agendaEvents', []).map(e => ({ ...e, _star: false })),
    ...load('importantDates', []).map(e => ({ ...e, _star: true })),
  ].filter(e => e.date === key).sort((a,b) => (a.start||'').localeCompare(b.start||''));

  const habits = load('habitsConfig', []);
  const habitState = (load('habitHistory', {})[key]) || {};

  const goals = load('goals', { year: [], quarter: [], week: [] });
  const goalRows = [
    ...(goals.week || []).map(g => ({ ...g, scope: 'Wk' })),
    ...(goals.quarter || []).map(g => ({ ...g, scope: 'Qtr' })),
    ...(goals.year || []).map(g => ({ ...g, scope: 'Yr' })),
  ];

  return `
    ${taskSection('Overdue', overdue, true)}
    ${taskSection('Due Today', dueToday, false)}
    <div class="today-section">
      <div class="today-section-title">Today's Events</div>
      ${events.length ? `<div class="today-events">${events.map(e => `
        <div class="today-event-row">${e._star ? '★ ' : ''}${e.start ? `<span class="today-event-time">${window.dashUtil.fmtTime(e.start)}</span>` : ''}<span>${esc(e.label)}</span></div>
      `).join('')}</div>` : `<div class="empty">Nothing on the calendar today.</div>`}
    </div>
    <div class="today-section">
      <div class="today-section-title">Habits</div>
      ${habits.length ? `<div class="today-habits">${habits.map(h => `
        <button class="today-habit-chip${habitState[h.id] ? ' done' : ''}" onclick="window.today.toggleHabit('${h.id}')">${esc(h.label)}</button>
      `).join('')}</div>` : `<div class="empty">No habits set up yet.</div>`}
    </div>
    <div class="today-section">
      <div class="today-section-title">Goal Progress</div>
      ${goalRows.length ? `<div class="today-goals">${goalRows.map(g => `
        <div class="today-goal-row">
          <span class="today-goal-scope">${g.scope}</span>
          <span class="today-goal-text">${esc(g.text)}</span>
          <button class="goal-pct${g.pct >= 100 ? ' full' : ''}" onclick="window.today.bumpGoal('${g.id}')" title="Click to increment">${g.pct}%</button>
        </div>
      `).join('')}</div>` : `<div class="empty">No goals set yet.</div>`}
    </div>`;
}

function taskSection(title, list, isOverdue) {
  return `
    <div class="today-section">
      <div class="today-section-title">${title}${list.length ? ` · ${list.length}` : ''}</div>
      ${list.length ? `<div class="today-tasks">${list.map(t => taskRow(t, isOverdue)).join('')}</div>` : `<div class="empty">${isOverdue ? 'Nothing overdue.' : 'Nothing due today.'}</div>`}
    </div>`;
}

function taskRow(t, isOverdue) {
  const cls = classFor(t.classId);
  return `
    <div class="today-task-row">
      <div class="tcheck" onclick="window.today.completeTask('${t.id}')" title="Complete"></div>
      <span class="task-txt">${esc(t.text)}</span>
      ${cls ? `<span class="class-badge" style="background:${cls.color}22;color:${cls.color};border:1px solid ${cls.color}44">${esc(cls.name.split(' ')[0])}</span>` : ''}
      ${t.type ? `<span class="type-badge ${getCategory(t.type)}">${esc(t.type)}</span>` : ''}
      ${isOverdue ? `<span class="days-pill past">${esc(t.dueDate)}</span>` : ''}
    </div>`;
}

function completeTask(id) { window.dash.toggleTask(id); render(); }
function toggleHabit(id) {
  const key = todayStr();
  const cur = (load('habitHistory', {})[key] || {})[id];
  window.dash.setHabitToday(id, !cur);
  if (window.dash.renderHabits) window.dash.renderHabits();
  render();
}
function bumpGoal(id) { window.dash.cycleGoal(id); render(); }

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

  const habits = load('habitsConfig', []);
  const habitHistory = load('habitHistory', {});
  const today = new Date(); today.setHours(0,0,0,0);

  return `
    <div class="today-section">
      <div class="today-section-title">Done This Week · ${log.length}</div>
      ${log.length ? `<div class="today-tasks">${log.slice(0, 40).map(e => `
        <div class="today-task-row done-row">
          <span class="task-txt">${esc(e.text)}</span>
          ${e.type ? `<span class="type-badge ${getCategory(e.type)}">${esc(e.type)}</span>` : ''}
        </div>`).join('')}</div>` : `<div class="empty">Nothing logged as done yet this week.</div>`}
    </div>
    <div class="today-section">
      <div class="today-section-title">Carrying Over · ${carrying.length}</div>
      ${carrying.length ? `<div class="today-tasks">${carrying.map(t => taskRow(t, t.dueDate < todayStr())).join('')}</div>` : `<div class="empty">Nothing carrying over — clean slate.</div>`}
    </div>
    <div class="today-section">
      <div class="today-section-title">Habit Trend</div>
      ${habits.length ? `<div class="today-habit-trend">${habits.map(h => {
        const daysSoFar = weekDates.filter(d => d <= today).length;
        const doneCount = weekDates.filter(d => d <= today && habitHistory[dateKey(d)] && habitHistory[dateKey(d)][h.id]).length;
        const pct = daysSoFar ? Math.round(doneCount / daysSoFar * 100) : 0;
        const streak = window.dash.habitStreak ? window.dash.habitStreak(h.id) : 0;
        return `
          <div class="today-trend-row">
            <span class="today-trend-label">${esc(h.label)}</span>
            <div class="today-trend-bar"><div class="today-trend-fill" style="width:${pct}%"></div></div>
            <span class="today-trend-pct">${doneCount}/${daysSoFar}${streak >= 2 ? ` · 🔥${streak}` : ''}</span>
          </div>`;
      }).join('')}</div>` : `<div class="empty">No habits set up yet.</div>`}
    </div>`;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('todayPage') && document.getElementById('todayPage').classList.contains('open')) close();
});

window.today = { open, close, switchView, completeTask, toggleHabit, bumpGoal };
})();
