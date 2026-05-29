/* ═══════════════════════════════════════════════════════════════
   WIDGETS — Clock + Pomodoro
   Self-contained module. Reuses dashUtil (load/save/$) from dashboard.js.
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';

const { $, load, save } = window.dashUtil;
const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/* ─── CLOCK ──────────────────────────────────────────────────── */
let clock24 = load('clockFormat24', false);

function tickClock() {
  const t = $('clockTime'); if (!t) return;
  const now = new Date();
  let h = now.getHours();
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (!clock24) { h = h % 12 || 12; }
  const hh = clock24 ? String(h).padStart(2, '0') : String(h);

  t.innerHTML =
    `${hh}<span class="clock-colon">:</span>${m}` +
    `<span class="clock-secs">${s}</span>` +
    (clock24 ? '' : `<span class="clock-ampm">${ampm}</span>`);

  const dEl = $('clockDate');
  if (dEl) dEl.textContent = `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;
}

function toggleClockFormat() {
  clock24 = !clock24;
  save('clockFormat24', clock24);
  const btn = $('clockFormatBtn');
  if (btn) btn.textContent = clock24 ? '24h' : '12h';
  tickClock();
}

function bootClock() {
  const btn = $('clockFormatBtn');
  if (btn) btn.textContent = clock24 ? '24h' : '12h';
  tickClock();
  setInterval(tickClock, 1000);
}

/* ─── POMODORO ───────────────────────────────────────────────── */
const POMO_RING_R = 70;                       // matches svg r in markup
const POMO_CIRC   = 2 * Math.PI * POMO_RING_R;
const DEFAULT_DUR = { focus: 25, short: 5, long: 15 };

function pomoState() {
  return load('pomoState', {
    mode: 'focus',
    remaining: DEFAULT_DUR.focus * 60,   // seconds left (when paused)
    running: false,
    endAt: null,                          // epoch ms when current run ends
    sessions: 0,                          // completed focus sessions today
    sessionDate: window.dashUtil.todayStr(),
    dur: { ...DEFAULT_DUR },
  });
}
function savePomo(s) { save('pomoState', s); }

let pomoInterval = null;

function pomoDurSec(s, mode) { return (s.dur[mode] || DEFAULT_DUR[mode]) * 60; }

// Live remaining seconds — derived from endAt while running so a refresh
// keeps counting accurately.
function pomoRemaining(s) {
  if (s.running && s.endAt) return Math.max(0, Math.round((s.endAt - Date.now()) / 1000));
  return s.remaining;
}

function fmtMMSS(sec) {
  const m = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function renderPomo() {
  const card = $('pomoCard'); if (!card) return;
  let s = pomoState();

  // Reset the daily session counter at midnight.
  const today = window.dashUtil.todayStr();
  if (s.sessionDate !== today) { s.sessions = 0; s.sessionDate = today; savePomo(s); }

  const total = pomoDurSec(s, s.mode);
  const rem = pomoRemaining(s);

  card.setAttribute('data-mode', s.mode);
  card.classList.toggle('running', s.running);

  $('pomoTime').textContent = fmtMMSS(rem);
  $('pomoModeLbl').textContent = s.mode === 'focus' ? 'Focus' : s.mode === 'short' ? 'Short Break' : 'Long Break';

  const ring = $('pomoRing');
  const elapsed = total ? (total - rem) / total : 0;
  ring.style.strokeDasharray = POMO_CIRC;
  ring.style.strokeDashoffset = POMO_CIRC * elapsed;

  $('pomoStart').textContent = s.running ? 'Pause' : (rem < total ? 'Resume' : 'Start');

  // mode tabs reflect active mode
  document.querySelectorAll('.pomo-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === s.mode));

  // session dots (4 per long-break cycle) + count
  const ses = $('pomoSessions');
  const inCycle = s.sessions % 4;
  let dots = '';
  for (let i = 0; i < 4; i++) dots += `<span class="pomo-dot${i < (inCycle === 0 && s.sessions > 0 ? 4 : inCycle) ? ' filled' : ''}"></span>`;
  ses.innerHTML = dots + `<span class="pomo-sessions-count">${s.sessions} today</span>`;
}

function pomoTick() {
  const s = pomoState();
  if (!s.running) return;
  const rem = pomoRemaining(s);
  if (rem <= 0) { pomoComplete(); return; }
  renderPomo();
}

function startInterval() {
  if (pomoInterval) clearInterval(pomoInterval);
  pomoInterval = setInterval(pomoTick, 250);
}
function stopInterval() {
  if (pomoInterval) { clearInterval(pomoInterval); pomoInterval = null; }
}

function pomoToggle() {
  const s = pomoState();
  if (s.running) {
    // pause — freeze remaining
    s.remaining = pomoRemaining(s);
    s.running = false;
    s.endAt = null;
    stopInterval();
  } else {
    // start / resume
    let rem = s.remaining;
    if (rem <= 0) rem = pomoDurSec(s, s.mode);
    s.endAt = Date.now() + rem * 1000;
    s.running = true;
    startInterval();
  }
  savePomo(s);
  renderPomo();
}

function pomoComplete() {
  stopInterval();
  const s = pomoState();
  const finishedMode = s.mode;
  beep(finishedMode === 'focus');

  let next;
  if (finishedMode === 'focus') {
    s.sessions += 1;
    next = (s.sessions % 4 === 0) ? 'long' : 'short';
  } else {
    next = 'focus';
  }
  s.mode = next;
  s.running = false;
  s.endAt = null;
  s.remaining = pomoDurSec(s, next);
  s.sessionDate = window.dashUtil.todayStr();
  savePomo(s);
  renderPomo();
  notify(finishedMode);
}

function setPomoMode(mode) {
  const s = pomoState();
  if (s.mode === mode && !s.running) return;
  stopInterval();
  s.mode = mode;
  s.running = false;
  s.endAt = null;
  s.remaining = pomoDurSec(s, mode);
  savePomo(s);
  renderPomo();
}

function pomoReset() {
  const s = pomoState();
  stopInterval();
  s.running = false;
  s.endAt = null;
  s.remaining = pomoDurSec(s, s.mode);
  savePomo(s);
  renderPomo();
}

let pomoEditOpen = false;
function pomoToggleEdit() {
  pomoEditOpen = !pomoEditOpen;
  $('pomoEdit').classList.toggle('open', pomoEditOpen);
  $('pomoEditBtn').classList.toggle('active', pomoEditOpen);
  if (pomoEditOpen) {
    const s = pomoState();
    $('pomoDurFocus').value = s.dur.focus;
    $('pomoDurShort').value = s.dur.short;
    $('pomoDurLong').value  = s.dur.long;
  }
}

function updatePomoDur(which, val) {
  const n = Math.max(1, Math.min(180, Math.round(+val || DEFAULT_DUR[which])));
  const s = pomoState();
  s.dur[which] = n;
  // if editing the current, idle mode, reflect new length immediately
  if (s.mode === which && !s.running) s.remaining = n * 60;
  savePomo(s);
  renderPomo();
}

// soft two-tone chime via WebAudio (no asset needed)
function beep(isFocusEnd) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = isFocusEnd ? [880, 660, 440] : [523, 784];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.18, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t0); osc.stop(t0 + 0.42);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch (_) {}
}

function notify(finishedMode) {
  try {
    if (!('Notification' in window)) return;
    const body = finishedMode === 'focus' ? 'Focus block done — take a break.' : 'Break over — back to it.';
    if (Notification.permission === 'granted') new Notification('Pomodoro', { body });
    else if (Notification.permission !== 'denied') Notification.requestPermission();
  } catch (_) {}
}

function bootPomo() {
  const s = pomoState();
  // If a run was in progress and already elapsed while away, settle it.
  if (s.running && s.endAt && pomoRemaining(s) <= 0) { pomoComplete(); }
  else { if (s.running) startInterval(); renderPomo(); }
}

// keep the timer honest when the tab regains focus
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    const s = pomoState();
    if (s.running && s.endAt && pomoRemaining(s) <= 0) pomoComplete();
    else renderPomo();
  }
});

/* ─── EXPORT + BOOT ──────────────────────────────────────────── */
window.widgets = {
  toggleClockFormat,
  pomoToggle, setPomoMode, pomoReset, pomoToggleEdit, updatePomoDur,
  boot() { bootClock(); bootPomo(); },
};

})();
