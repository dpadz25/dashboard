/* ═══════════════════════════════════════════════════════════════
   DAY STRIP — 7-day carousel at the top of the dashboard + day view

   The strip shows today plus the next six calendar days with dots for
   what's on each day. Tapping a day opens a modal with:
   - an all-day shelf (all-day events + tasks due that day)
   - an hour-by-hour timeline of timed events and that weekday's class
     meeting slots (same minute→pixel math as the agenda's Schedule tab)

   Reads the same synced localStorage keys the agenda uses; renders are
   triggered from dash.renderAgenda() so it stays current automatically.
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';
const { $, esc, load, fmtTime } = window.dashUtil;

const DAY_LBLS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const DAY_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const SLOT_DAYS = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5 };

let openDate = null; // 'YYYY-MM-DD' while the modal is open

function localKey(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function calendarItems() {
  return [
    ...load('agendaEvents', []).map(e => ({ ...e, _kind: 'agenda' })),
    ...load('importantDates', []).map(e => ({ ...e, _kind: 'starred' })),
  ];
}

function classSlotsFor(weekday) {  // weekday: 0-6 (Sun-Sat)
  const out = [];
  load('schoolClasses', []).forEach(c => {
    (c.slots || []).forEach(s => {
      if (SLOT_DAYS[s.day] === weekday && s.start && s.end) out.push({ ...s, _class: c });
    });
  });
  return out;
}

/* ── STRIP ───────────────────────────────────────────────────── */
function render() {
  const el = $('daystrip');
  if (!el) return;
  const items = calendarItems();
  const tasks = load('plannerTasks', []).filter(t => !t.done && t.dueDate);
  const today = new Date(); today.setHours(0,0,0,0);

  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(today); d.setDate(today.getDate() + i);
    const key = localKey(d);
    const evCount   = items.filter(e => e.date === key).length;
    const taskCount = tasks.filter(t => t.dueDate === key).length;
    const clsCount  = classSlotsFor(d.getDay()).length;
    const isToday = i === 0;
    const showMonth = i === 0 || d.getDate() === 1;
    const dots =
      (evCount   ? `<span class="ds-dot ev"   title="${evCount} event${evCount > 1 ? 's' : ''}"></span>`   : '') +
      (taskCount ? `<span class="ds-dot task" title="${taskCount} task${taskCount > 1 ? 's' : ''} due"></span>` : '') +
      (clsCount  ? `<span class="ds-dot cls"  title="${clsCount} class${clsCount > 1 ? 'es' : ''}"></span>`  : '');
    html += `
      <button class="ds-day${isToday ? ' today' : ''}" onclick="window.daystrip.openDay('${key}')" title="Open ${DAY_FULL[d.getDay()]}">
        <span class="ds-lbl">${isToday ? 'TODAY' : DAY_LBLS[d.getDay()]}</span>
        <span class="ds-num">${d.getDate()}</span>
        <span class="ds-month">${showMonth ? MONTHS[d.getMonth()] : '&nbsp;'}</span>
        <span class="ds-dots">${dots || '<span class="ds-dot none"></span>'}</span>
      </button>`;
  }
  el.innerHTML = html;

  if (openDate) renderDayModal(openDate); // keep an open modal current
}

/* ── DAY VIEW MODAL ──────────────────────────────────────────── */
function ensureModal() {
  let overlay = $('dayViewModal');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'modal-overlay day-view-overlay';
  overlay.id = 'dayViewModal';
  overlay.onclick = e => { if (e.target === overlay) closeDay(); };
  overlay.innerHTML = `<div class="modal day-view-modal" id="dayViewBody"></div>`;
  document.body.appendChild(overlay);
  return overlay;
}

function openDay(dateStr) {
  openDate = dateStr;
  renderDayModal(dateStr);
  ensureModal().classList.add('open');
}

function closeDay() {
  openDate = null;
  const m = $('dayViewModal');
  if (m) m.classList.remove('open');
}

function renderDayModal(dateStr) {
  const body = $('dayViewBody') || ensureModal().querySelector('#dayViewBody');
  const d = new Date(dateStr + 'T00:00:00');
  const todayKey = localKey(new Date());
  const isToday = dateStr === todayKey;

  const events = calendarItems().filter(e => e.date === dateStr);
  const allDay = events.filter(e => !e.start);
  const timed  = events.filter(e => e.start)
    .sort((a, b) => a.start.localeCompare(b.start));
  const tasks  = load('plannerTasks', []).filter(t => !t.done && t.dueDate === dateStr);
  const classes = load('schoolClasses', []);
  const slots  = classSlotsFor(d.getDay());

  const toMin = t => { const [h, m] = (t || '00:00').split(':').map(Number); return h * 60 + (m || 0); };

  /* Visible window: 8a–8p by default, widened to fit whatever exists. */
  let minMin = 8 * 60, maxMin = 20 * 60;
  timed.forEach(e => {
    minMin = Math.min(minMin, toMin(e.start));
    maxMin = Math.max(maxMin, toMin(e.end || e.start) + (e.end ? 0 : 60));
  });
  slots.forEach(s => { minMin = Math.min(minMin, toMin(s.start)); maxMin = Math.max(maxMin, toMin(s.end)); });
  const startHour = Math.max(0, Math.floor((minMin - 20) / 60));
  const endHour   = Math.min(24, Math.ceil((maxMin + 20) / 60));
  const HOUR_PX   = 52;
  const totalPx   = (endHour - startHour) * HOUR_PX;
  const mToY      = m => (m - startHour * 60) / 60 * HOUR_PX;

  let hourLabels = '', hourLines = '';
  for (let h = startHour; h <= endHour; h++) {
    const y = (h - startHour) * HOUR_PX;
    const lbl = ((h % 12) || 12) + (h < 12 || h === 24 ? 'a' : 'p');
    hourLabels += `<div class="dv-hour-lbl" style="top:${y}px">${lbl}</div>`;
    if (h > startHour) hourLines += `<div class="dv-hour-line" style="top:${y}px"></div>`;
  }

  const classBadge = t => {
    const c = t.classId && classes.find(x => x.id === t.classId);
    return c ? `<span class="class-badge" style="background:${c.color}22;color:${c.color};border:1px solid ${c.color}44">${esc(c.name.split(' ')[0])}</span>` : '';
  };

  const timedBlocks = timed.map(e => {
    const s = toMin(e.start);
    const en = e.end ? toMin(e.end) : s + 60;      // no end = 1-hour block
    const top = mToY(s), height = Math.max(30, mToY(en) - top);
    return `<div class="dv-block ${e._kind === 'starred' ? 'starred' : 'agenda'}" style="top:${top}px;height:${height}px"
                 title="${esc(e.label)} · ${fmtTime(e.start)}${e.end ? '–' + fmtTime(e.end) : ''}">
      <div class="dv-block-name">${e._kind === 'starred' ? '★ ' : ''}${esc(e.label)}</div>
      <div class="dv-block-time">${fmtTime(e.start)}${e.end ? '–' + fmtTime(e.end) : ''}</div>
    </div>`;
  }).join('');

  const classBlocks = slots.map(s => {
    const top = mToY(toMin(s.start)), height = Math.max(30, mToY(toMin(s.end)) - top);
    const c = s._class;
    const name = c.name.split(/[—–-]/)[0].trim();
    return `<div class="dv-block cls" style="top:${top}px;height:${height}px;background:${c.color}1a;border-left-color:${c.color};color:${c.color}"
                 title="${esc(c.name)} · ${s.start}–${s.end}${s.room ? ' · ' + esc(s.room) : ''}">
      <div class="dv-block-name">${esc(name)}</div>
      <div class="dv-block-time">${fmtTime(s.start)}–${fmtTime(s.end)}${s.room ? ` · ${esc(s.room)}` : ''}</div>
    </div>`;
  }).join('');

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowLine = (isToday && nowMin >= startHour * 60 && nowMin <= endHour * 60)
    ? `<div class="dv-now-line" style="top:${mToY(nowMin)}px"></div>` : '';

  const hasAllDayShelf = allDay.length || tasks.length;

  body.innerHTML = `
    <div class="modal-header">
      <div>
        <div class="dv-eyebrow">${isToday ? 'TODAY' : DAY_FULL[d.getDay()].toUpperCase()}</div>
        <div class="modal-title dv-title">${DAY_FULL[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}</div>
      </div>
      <button class="modal-close" onclick="window.daystrip.closeDay()">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>

    ${hasAllDayShelf ? `
      <div class="dv-allday">
        ${allDay.map(e => `
          <span class="dv-allday-chip ${e._kind === 'starred' ? 'starred' : ''}">${e._kind === 'starred' ? '★ ' : ''}${esc(e.label)}</span>`).join('')}
        ${tasks.map(t => `
          <span class="dv-allday-chip task" title="Task due">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/></svg>
            ${esc(t.text)} ${classBadge(t)}
          </span>`).join('')}
      </div>` : ''}

    ${(timed.length || slots.length) ? `
      <div class="dv-timeline">
        <div class="dv-time-col" style="height:${totalPx}px">${hourLabels}</div>
        <div class="dv-track" style="height:${totalPx}px">
          ${hourLines}
          ${nowLine}
          ${classBlocks}
          ${timedBlocks}
        </div>
      </div>` : `
      <div class="dv-empty">No time-blocked plans${hasAllDayShelf ? ' — just the all-day items above' : ' for this day'}.</div>`}
  `;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && openDate) closeDay();
});

window.daystrip = { render, openDay, closeDay };
})();
