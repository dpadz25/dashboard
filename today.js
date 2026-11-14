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

  return `
    ${focus ? `<div class="today-focus">
      <div class="today-focus-label">Focus goal \u00B7 ${esc(SC[focus.scope] || '')}</div>
      <div class="today-focus-text">${esc(focus.text)}</div>
      ${focus.next ? `<div class="today-focus-next"><b>Next</b> ${esc(focus.next)}</div>` : `<div class="today-focus-next muted">No next step yet. Add one in the Goals card.</div>`}
      <div class="today-focus-pct">${focus.pct}%</div>
    </div>` : ''}
    ${taskSection('Overdue', overdue, true)}
    ${taskSection('Due Today', dueToday, false)}
    <div class="today-section">
      <div class="today-section-title">Today's Events</div>
      ${events.length ? `<div class="today-events">${events.map(e => `
        <div class="today-event-row">${e._star ? '★ ' : ''}${e.start ? `<span class="today-event-time">${window.dashUtil.fmtTime(e.start)}</span>` : ''}<span>${esc(e.label)}</span></div>
      `).join('')}</div>` : `<div class="empty">Nothing on the calendar today.</div>`}
    </div>
    <div class="today-section">
      <div class="today-section-title">Non-Negotiables${habits.length ? ` \u00B7 ${habits.filter(h => habitState[h.id]).length}/${habits.length}` : ''}</div>
      ${habits.length ? `<div class="today-habits">${habits.map(h => `
        <button class="today-habit-chip${habitState[h.id] ? ' done' : ''}" onclick="window.today.toggleHabit('${h.id}')">${esc(h.label)}${habitState[h.id] === 'min' ? ' (min)' : ''}</button>
      `).join('')}</div>` : `<div class="empty">No habits set up yet.</div>`}
    </div>
    <div class="today-section">
      <div class="today-section-title">Dailies${dailies.length ? ` \u00B7 ${dailies.filter(d => dailyState[d.id]).length}/${dailies.length}` : ''}</div>
      ${dailies.length ? groups.map(([gk, gl]) => {
        const items = dailies.filter(d => d.group === gk);
        return items.length ? `<div class="today-daily-group"><span class="today-daily-label">${gl}</span><div class="today-habits">${items.map(d => `
          <button class="today-habit-chip${dailyState[d.id] ? ' done' : ''}" onclick="window.today.toggleDaily('${d.id}')">${esc(d.label)}${dailyState[d.id] === 'min' ? ' (min)' : ''}</button>`).join('')}</div></div>` : '';
      }).join('') : `<div class="empty">No dailies set up yet.</div>`}
    </div>
    <div class="today-section">
      <div class="today-section-title">People to reach out to${peopleDue.length ? ` \u00B7 ${peopleDue.length}` : ''}</div>
      ${peopleDue.length ? `<div class="today-people">${peopleDue.slice(0, 8).map(p => `
        <div class="today-person-row">
          <span class="today-person-name">${esc(p.name)}</span>
          <span class="today-person-note">${p.notes ? esc(p.notes) : ''}</span>
          <span class="person-since ${p.cls}">${esc(p.label)}</span>
          <button class="checkin-btn" onclick="window.today.reachOut('${p.id}')" title="I reached out">\u2713</button>
        </div>`).join('')}</div>` : `<div class="empty">Nobody is due. Nice.</div>`}
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
    <div class="today-review-row${r.stuck ? ' stuck' : ''}">
      <span class="today-goal-scope">${SC[r.scope]}</span>
      <div class="today-review-main">
        <span class="today-goal-text">${esc(r.text)}</span>
        <input class="t-input today-review-next" placeholder="What is the next step?" value="${esc(r.next)}" onchange="window.today.setGoalNext('${r.id}', this.value)"/>
      </div>
      <span class="today-review-pct">${r.pct}%${r.stuck ? ` \u00B7 stuck ${r.stuck}d` : ''}</span>
    </div>`;
  const trendRows = (items, hist, streakFn) => items.map(h => {
    const daysSoFar = weekDates.filter(d => d <= today).length;
    const doneCount = weekDates.filter(d => d <= today && hist[dateKey(d)] && hist[dateKey(d)][h.id]).length;
    const pct = daysSoFar ? Math.round(doneCount / daysSoFar * 100) : 0;
    const streak = streakFn ? streakFn(h.id) : 0;
    return `
      <div class="today-trend-row">
        <span class="today-trend-label">${esc(h.label)}</span>
        <div class="today-trend-bar"><div class="today-trend-fill" style="width:${pct}%"></div></div>
        <span class="today-trend-pct">${doneCount}/${daysSoFar}${streak >= 2 ? ` \u00B7 \uD83D\uDD25${streak}` : ''}</span>
      </div>`;
  }).join('');

  return `
    <div class="today-section">
      <div class="today-section-title">Goal Review</div>
      ${review.length ? `
        <div class="today-review-hint">Two minutes: look at what moved, then give every quiet goal a next step small enough to do this week.</div>
        ${moved.length ? `<div class="today-review-sub">Moved this week</div>${moved.map(reviewRow).join('')}` : ''}
        ${quiet.length ? `<div class="today-review-sub">Quiet</div>${quiet.map(reviewRow).join('')}` : ''}`
      : `<div class="empty">No goals to review yet.</div>`}
    </div>
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
      <div class="today-section-title">Non-Negotiables Trend</div>
      ${habits.length ? `<div class="today-habit-trend">${trendRows(habits, habitHistory, window.dash.habitStreak)}</div>` : `<div class="empty">No habits set up yet.</div>`}
    </div>
    <div class="today-section">
      <div class="today-section-title">Dailies Trend</div>
      ${dailies.length ? `<div class="today-habit-trend">${trendRows(dailies, dailyHistory, window.dash.dailyStreak)}</div>` : `<div class="empty">No dailies set up yet.</div>`}
    </div>`;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('todayPage') && document.getElementById('todayPage').classList.contains('open')) close();
});

window.today = { open, close, switchView, completeTask, toggleHabit, toggleDaily, reachOut, bumpGoal, setGoalNext };
})();
