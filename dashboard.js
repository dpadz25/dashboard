/* ═══════════════════════════════════════════════════════════════
   DASHBOARD — modules + state (v3)
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';
const ICONS = window.ICONS;
const ICON_KEYS = window.ICON_KEYS;

// ─── UTILS ────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);
function uid()  { return Math.random().toString(36).slice(2,10); }
function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function load(k, fb) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? fb; } catch { return fb; } }
function save(k, v)  { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('Storage error', e); } }
function todayStr()  { return new Date().toISOString().slice(0,10); }
window.dashUtil = { $, $$, uid, esc, load, save, todayStr };

/* ─── IMAGE STORE (IndexedDB) ──────────────────────────────────
   Big background photos are far too large for localStorage's ~5 MB
   quota — once a couple of high-res images are saved, every further
   save silently fails (that's why "some images don't upload").
   IndexedDB gives us hundreds of MB, so photos save reliably and can
   be much higher resolution. We keep a synchronous in-memory cache so
   the existing render code stays simple: preload everything at boot,
   then read with getCached() and write with set()/del() (async, but
   the cache updates immediately). Small metadata stays in localStorage. */
const dashStore = (function () {
  const DB = 'dashUserImages', STORE = 'img', VER = 1;
  const cache = new Map();
  let dbp = null;
  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      let r;
      try { r = indexedDB.open(DB, VER); }
      catch (e) { return rej(e); }
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  function rawSet(key, val) {
    return openDB().then(db => new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    }));
  }
  function rawDel(key) {
    return openDB().then(db => new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    }));
  }
  function rawGetAll() {
    return openDB().then(db => new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const os = tx.objectStore(STORE);
      const keysReq = os.getAllKeys();
      const valsReq = os.getAll();
      tx.oncomplete = () => {
        const ks = keysReq.result || [], vs = valsReq.result || [];
        const m = new Map();
        ks.forEach((k, i) => m.set(k, vs[i]));
        res(m);
      };
      tx.onerror = () => rej(tx.error);
    }));
  }
  function getCached(key) { return cache.has(key) ? cache.get(key) : null; }
  async function set(key, val) {
    cache.set(key, val);
    // Nudge other same-origin frames (e.g. the phone preview) to reload,
    // since IndexedDB writes don't fire 'storage' events the way localStorage does.
    try { localStorage.setItem('imgRev', String(Date.now())); } catch (e) {}
    try { await rawSet(key, val); } catch (e) { console.warn('image store set failed', e); }
  }
  async function del(key) {
    cache.delete(key);
    try { localStorage.setItem('imgRev', String(Date.now())); } catch (e) {}
    try { await rawDel(key); } catch (e) { /* ignore */ }
  }
  async function clearAll() {
    cache.clear();
    try {
      const db = await openDB();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    } catch (e) { /* ignore */ }
  }
  async function migrateLegacy() {
    if (localStorage.getItem('imgMigrated_v2')) return;
    const readLS = k => { try { const v = JSON.parse(localStorage.getItem(k)); return (typeof v === 'string' && v.startsWith('data:')) ? v : null; } catch { return null; } };
    // page + rail backgrounds
    for (const k of ['pageBg', 'sideRailBg']) {
      const v = readLS(k);
      if (v) { await set(k, v); localStorage.removeItem(k); }
    }
    // legacy single headerBg → per-card system
    const legacyHeader = readLS('headerBg');
    if (legacyHeader && !cache.has('cardimg:cardBg::header') && !localStorage.getItem('cardBg::header')) {
      await set('cardimg:cardBg::header', legacyHeader);
      save('cardBg::header', { hasImg: true, intensity: 70, posX: 50, posY: 50, zoom: 100 });
      localStorage.removeItem('headerBg');
    }
    // per-card backgrounds: pull embedded .img out into IndexedDB
    Object.keys(localStorage).filter(k => k.startsWith('cardBg::')).forEach(k => {
      let cfg; try { cfg = JSON.parse(localStorage.getItem(k)); } catch { return; }
      if (cfg && cfg.img) {
        const img = cfg.img;
        delete cfg.img;
        cfg.hasImg = true;
        // queue (sync localStorage now; IDB set below)
        save(k, cfg);
        cache.set('cardimg:' + k, img);
        rawSet('cardimg:' + k, img).catch(() => {});
      }
    });
    localStorage.setItem('imgMigrated_v2', '1');
  }
  const ready = (async () => {
    if (!('indexedDB' in window)) return;
    try {
      const m = await rawGetAll();
      m.forEach((v, k) => cache.set(k, v));
    } catch (e) { console.warn('image store load failed', e); }
    try { await migrateLegacy(); } catch (e) { console.warn('image migration failed', e); }
  })();
  return { ready, getCached, set, del, clearAll };
})();
window.dashStore = dashStore;

// ─── Custom icons (uploaded data URLs) ──────────────────────
function getCustomIcons() { return load('customIcons', {}); }
function saveCustomIcons(c) { save('customIcons', c); }
function iconRender(key) {
  if (!key) return ICONS.star;
  if (key.startsWith('custom:')) {
    const cid = key.slice(7);
    const custom = getCustomIcons()[cid];
    if (custom) return `<img src="${custom}" alt="" class="custom-icon-img"/>`;
    return ICONS.star;
  }
  return ICONS[key] || ICONS.star;
}
window.dashIcons = { iconRender, getCustomIcons, saveCustomIcons };

// ─── HEADER ───────────────────────────────────────────────────
const QUOTES = [
  "small steps, every day.",
  "do what you can, with what you have.",
  "the days are long, but the years are short.",
  "you are the average of the five things you repeat.",
  "tend to the garden — it is yours.",
  "show up, even when it's quiet.",
  "what you do today, you become tomorrow.",
  "this is your one wild and precious life.",
];

function initHeader() {
  const now  = new Date();
  const h    = now.getHours();
  const tone = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Hey night owl';
  const name = (load('tweaksState', {}) || {}).name || 'Delan';
  $('greeting').innerHTML = `${tone}, <em>${esc(name)}</em>.`;
  const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  $('dateLine').innerHTML =
    `<span>${DAYS[now.getDay()]}</span><span class="dot">·</span>` +
    `<span>${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}</span>`;
  const seed = Math.floor((+now - new Date(now.getFullYear(),0,1)) / 86400000);
  $('quoteLine').textContent = QUOTES[seed % QUOTES.length];

  const wb = $('weekNum');
  if (wb) wb.textContent = 'Week ' + isoWeekNum(now);
}

// ISO-8601 week number (weeks start Monday; week 1 contains the year's first Thursday)
function isoWeekNum(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (date.getUTCDay() + 6) % 7;      // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - day + 3); // nearest Thursday
  const firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDay = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDay + 3);
  return 1 + Math.round((date - firstThu) / (7 * 86400000));
}

// Header "Week N" button → jump to the agenda's This Week view
function jumpToWeek() {
  const tab = document.querySelector('.agenda-tab');
  if (tab) switchAgendaView('week', tab);
  const agenda = document.querySelector('[data-card-id="agenda"]');
  if (agenda) {
    const y = agenda.getBoundingClientRect().top + window.pageYOffset - 12;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }
}

// ─── WEATHER ──────────────────────────────────────────────────
const WMO = {
  0:'Clear', 1:'Mainly clear', 2:'Partly cloudy', 3:'Overcast',
  45:'Foggy', 48:'Foggy', 51:'Drizzle', 53:'Drizzle', 55:'Drizzle',
  61:'Rain', 63:'Rain', 65:'Heavy rain', 71:'Snow', 73:'Snow', 75:'Snow',
  80:'Showers', 81:'Showers', 82:'Showers', 95:'Storm', 96:'Storm', 99:'Storm'
};

function initWeather() {
  if (!navigator.geolocation) { $('wText').textContent = 'Weather unavailable'; return; }
  const cached = load('weatherCache', null);
  if (cached && Date.now() - cached.t < 30*60*1000) { $('wText').textContent = cached.text; return; }
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lon } = pos.coords;
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current_weather=true&temperature_unit=fahrenheit`)
      .then(r => r.json())
      .then(d => {
        const { temperature, weathercode } = d.current_weather;
        const text = `${WMO[weathercode] ?? 'Weather'} · ${Math.round(temperature)}°F`;
        $('wText').textContent = text;
        save('weatherCache', { t: Date.now(), text });
      })
      .catch(() => { $('wText').textContent = 'Unavailable'; });
  }, () => { $('wText').textContent = 'Allow location'; });
}

// ─── SIDE RAIL (Quick Links) ──────────────────────────────────
const DEFAULT_QLINKS = [
  { id:'obsidian', label:'Obsidian', url:'obsidian://open', icon:'obsidian', kbd:'O' },
  { id:'notion',   label:'Notion',   url:'https://www.notion.so/394fbd098667463d8714324f21d44eba?pvs=1', icon:'notion', kbd:'N' },
  { id:'gcal',     label:'Calendar', url:'https://calendar.google.com', icon:'gcal', kbd:'C' },
  { id:'gmail',    label:'Gmail',    url:'https://mail.google.com/mail/u/0/#inbox', icon:'gmail', kbd:'M' },
  { id:'spotify',  label:'Spotify',  url:'https://open.spotify.com',    icon:'spotify', kbd:'S' },
];

let qlinkEditMode = false;

function getQlinks() { return load('qlinks', DEFAULT_QLINKS); }
function saveQlinks(v) { save('qlinks', v); }

function openLink(url) {
  // Force open via top-level navigation when running inside an iframe (avoids
  // Gmail / OAuth providers refusing to load in an iframe context).
  if (url.startsWith('obsidian://')) { window.location.href = url; return; }
  try {
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) (window.top || window.parent || window).location.href = url;
  } catch { window.location.href = url; }
}

function renderQlinks() {
  const wrap = $('sideRailInner');
  if (!wrap) return;
  const links = getQlinks();
  const rail = $('sideRail');
  rail.classList.toggle('editing', qlinkEditMode);
  const userName = (load('tweaksState', {}) || {}).name || 'D';
  const brandMark = (userName.trim()[0] || 'D').toUpperCase();

  wrap.innerHTML = `
    <div class="side-rail-brand">
      <div class="side-rail-brand-mark">${esc(brandMark)}</div>
      <div class="side-rail-brand-text">Dashboard</div>
    </div>`;

  links.forEach(l => {
    const useCustom = l.customIcon && l.customIcon.startsWith('custom:');
    const iconHTML = useCustom
      ? iconRender(l.customIcon)
      : (l.label || '?').slice(0,1).toUpperCase();
    const a = document.createElement('a');
    a.className = 'rail-link';
    a.href = l.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.onclick = e => { e.preventDefault(); openLink(l.url); };
    a.innerHTML = `
      <span class="rail-link-icon ${l.icon || ''}${useCustom?' has-custom':''}">${iconHTML}</span>
      <span class="rail-link-text">
        <span>${esc(l.label)}</span>
        ${l.kbd ? `<span class="rail-kbd">⌥${esc(l.kbd)}</span>` : ''}
      </span>
      <button class="rail-link-edit" onclick="event.preventDefault();event.stopPropagation();window.dash.editQlinkIcon('${l.id}')" title="Custom icon">${ICONS.image}</button>
      <button class="rail-link-del" onclick="event.preventDefault();event.stopPropagation();window.dash.deleteQlink('${l.id}')" title="Delete">×</button>`;
    wrap.appendChild(a);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'rail-add';
  addBtn.innerHTML = `<span class="rail-add-icon">${ICONS.plus}</span><span class="rail-link-text">Add link</span>`;
  addBtn.onclick = openQlinkModal;
  wrap.appendChild(addBtn);

  const editToggle = document.createElement('button');
  editToggle.className = 'rail-edit-toggle';
  editToggle.innerHTML = `<span class="rail-edit-toggle-icon">${qlinkEditMode ? ICONS.check : ICONS.edit}</span><span class="rail-link-text">${qlinkEditMode ? 'Done' : 'Edit links'}</span>`;
  editToggle.onclick = () => { qlinkEditMode = !qlinkEditMode; renderQlinks(); };
  wrap.appendChild(editToggle);
}

function deleteQlink(id) {
  saveQlinks(getQlinks().filter(l => l.id !== id));
  renderQlinks();
}

function editQlinkIcon(id) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    compressImage(file, 128, dataUrl => {
      const customs = getCustomIcons();
      const cid = uid();
      customs[cid] = dataUrl;
      saveCustomIcons(customs);
      const links = getQlinks();
      const l = links.find(x => x.id === id);
      if (l) { l.customIcon = 'custom:' + cid; saveQlinks(links); renderQlinks(); }
    });
  };
  input.click();
}

function openQlinkModal() {
  ['qlmLabel','qlmUrl','qlmIcon','qlmKbd'].forEach(id => $(id).value = '');
  $('qlinkModal').classList.add('open');
  setTimeout(()=>$('qlmLabel').focus(), 100);
}
function closeQlinkModal() { $('qlinkModal').classList.remove('open'); }

function submitQlink() {
  const label = $('qlmLabel').value.trim();
  const url = $('qlmUrl').value.trim();
  if (!label || !url) return;
  const links = getQlinks();
  links.push({
    id: uid(), label, url,
    icon: $('qlmIcon').value.trim().toLowerCase() || '',
    kbd: $('qlmKbd').value.trim().toUpperCase().slice(0,1) || ''
  });
  saveQlinks(links);
  closeQlinkModal();
  renderQlinks();
}

function toggleMobileLinks() {
  $('sideRail').classList.toggle('mobile-open');
}

function pickSideRailBg(done) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*,.heic,.heif,.avif';
  input.onchange = e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    // Side rail spans full viewport height — needs a high-res source so
    // it stays sharp when scaled to cover the column and zoomed in.
    compressImage(file, 4200, dataUrl => {
      window.dashStore.set('sideRailBg', dataUrl);
      applySideRailBg();
      if (typeof done === 'function') done();
    });
  };
  input.click();
}
function clearSideRailBg() { window.dashStore.del('sideRailBg'); applySideRailBg(); }
function applySideRailBg() {
  const rail = $('sideRail'); if (!rail) return;
  const url = window.dashStore.getCached('sideRailBg');
  if (url) { rail.style.setProperty('--rail-bg', `url("${url}")`); rail.setAttribute('data-has-bg','1'); }
  else { rail.style.removeProperty('--rail-bg'); rail.removeAttribute('data-has-bg'); }
}

document.addEventListener('click', e => {
  // Close mobile rail when clicking outside
  if (window.innerWidth <= 720 && !e.target.closest('.side-rail') && !e.target.closest('.qlinks-fab')) {
    $('sideRail').classList.remove('mobile-open');
  }
  // Close card bg popovers when clicking outside
  if (!e.target.closest('.card-bg-popover') && !e.target.closest('.card-bg-btn')) {
    $$('.card-bg-popover.open').forEach(p => p.classList.remove('open'));
  }
});

// Keyboard shortcuts (Alt+Letter)
document.addEventListener('keydown', e => {
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
    const k = e.key.toUpperCase();
    const link = getQlinks().find(l => l.kbd === k);
    if (link) { e.preventDefault(); openLink(link.url); }
  }
});

// ─── HABITS ───────────────────────────────────────────────────
const DEFAULT_HABITS = [
  { id:'gym',      label:'Gym',      icon:'dumbbell'  },
  { id:'cook',     label:'Cook',     icon:'utensils'  },
  { id:'jo',       label:'Jo Time',  icon:'heart'     },
  { id:'sleep',    label:'Sleep 8h', icon:'moon'      },
  { id:'read',     label:'Read',     icon:'book'      },
  { id:'learn',    label:'Learn',    icon:'lightbulb' },
  { id:'meditate', label:'Meditate', icon:'leaf'      },
];

const CIRCUM = 2 * Math.PI * 17;

function getHabits()         { return load('habitsConfig', DEFAULT_HABITS); }
function saveHabitsConfig(h) { save('habitsConfig', h); }
function getHabitHistory()   { return load('habitHistory', {}); }
function saveHabitHistory(h) { save('habitHistory', h); }
function getTodayHabitState(){ return getHabitHistory()[todayStr()] || {}; }
function setHabitToday(id, done) {
  const hist = getHabitHistory();
  const k = todayStr();
  if (!hist[k]) hist[k] = {};
  hist[k][id] = done;
  saveHabitHistory(hist);
}

// streak = consecutive completed days, counting back from today (or yesterday
// if today isn't done yet — so an unchecked morning doesn't kill yesterday's run).
function habitStreak(habitId) {
  const hist = getHabitHistory();
  let streak = 0;
  const d = new Date(); d.setHours(0,0,0,0);
  const todayKey = d.toISOString().slice(0,10);
  if (!(hist[todayKey] && hist[todayKey][habitId])) {
    d.setDate(d.getDate() - 1);
  }
  for (let i = 0; i < 365; i++) {
    const k = d.toISOString().slice(0,10);
    if (hist[k] && hist[k][habitId]) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

function renderHabits() {
  const habits = getHabits();
  const state  = getTodayHabitState();
  const grid   = $('habitsGrid');
  grid.innerHTML = '';
  habits.forEach(h => {
    const done = !!state[h.id];
    const streak = habitStreak(h.id);
    const el   = document.createElement('div');
    el.className = `habit-item${done ? ' done' : ''}`;
    el.innerHTML = `
      <div class="hcheck"></div>
      <div class="habit-icon">${iconRender(h.icon)}</div>
      <div class="habit-label">${esc(h.label)}</div>
      ${streak >= 2 ? `<div class="habit-streak" title="${streak}-day streak">\uD83D\uDD25 ${streak}</div>` : ''}`;
    el.onclick = () => { setHabitToday(h.id, !state[h.id]); renderHabits(); renderHabitHeat(); };
    grid.appendChild(el);
  });
  const doneCount = habits.filter(h => !!state[h.id]).length;
  const total = habits.length;
  const pct = total ? Math.round(doneCount / total * 100) : 0;
  if ($('habitRing')) $('habitRing').style.strokeDashoffset = total ? CIRCUM - (doneCount / total) * CIRCUM : CIRCUM;
  if ($('habitPct')) $('habitPct').textContent = pct + '%';
}

let habitEditOpen = false;
function toggleHabitEdit() {
  habitEditOpen = !habitEditOpen;
  $('habitEditPanel').classList.toggle('open', habitEditOpen);
  $('editHabitBtn').classList.toggle('active', habitEditOpen);
  if (habitEditOpen) renderHabitEditRows();
}

function renderHabitEditRows() {
  const habits = getHabits();
  const rows   = $('habitEditRows');
  rows.innerHTML = '';
  habits.forEach(h => {
    const row = document.createElement('div');
    row.className = 'habit-edit-row';
    row.innerHTML = `
      <div class="habit-edit-icon-wrap" id="wrap-${h.id}">
        <div class="habit-edit-icon-btn" onclick="window.dash.toggleIconPicker('${h.id}')">${iconRender(h.icon)}</div>
        <div class="icon-picker-grid" id="grid-${h.id}">
          ${ICON_KEYS.map(k=>`<div class="icon-option${k===h.icon?' selected':''}" onclick="window.dash.selectIcon('${h.id}','${k}')" title="${k}">${ICONS[k]}</div>`).join('')}
          <div class="icon-option upload-icon-option" onclick="window.dash.uploadHabitIcon('${h.id}')" title="Upload custom">${ICONS.upload}</div>
        </div>
      </div>
      <input class="t-input" style="flex:1" value="${esc(h.label)}" onchange="window.dash.updateHabitLabel('${h.id}',this.value)"/>
      <button class="del-btn" style="opacity:1;padding:4px 8px" onclick="window.dash.deleteHabit('${h.id}')">${ICONS.trash}</button>`;
    rows.appendChild(row);
  });
}

function uploadHabitIcon(habitId) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    compressImage(file, 128, dataUrl => {
      const customs = getCustomIcons();
      const cid = uid();
      customs[cid] = dataUrl;
      saveCustomIcons(customs);
      const habits = getHabits();
      const h = habits.find(x => x.id === habitId);
      if (h) { h.icon = 'custom:' + cid; saveHabitsConfig(habits); }
      $(`grid-${habitId}`).classList.remove('open');
      renderHabits(); renderHabitEditRows(); renderHabitHeat();
    });
  };
  input.click();
}

function toggleIconPicker(id) {
  $$('.icon-picker-grid').forEach(g => { if (g.id !== `grid-${id}`) g.classList.remove('open'); });
  $(`grid-${id}`).classList.toggle('open');
}
function selectIcon(habitId, iconKey) {
  const habits = getHabits();
  const h = habits.find(h => h.id === habitId);
  if (h) { h.icon = iconKey; saveHabitsConfig(habits); renderHabits(); renderHabitEditRows(); renderHabitHeat(); }
  $(`grid-${habitId}`).classList.remove('open');
}
function updateHabitLabel(id, label) {
  const habits = getHabits();
  const h = habits.find(h => h.id === id);
  if (h) { h.label = label.trim() || h.label; saveHabitsConfig(habits); renderHabits(); renderHabitHeat(); }
}
function deleteHabit(id) {
  saveHabitsConfig(getHabits().filter(h => h.id !== id));
  renderHabits(); renderHabitEditRows(); renderHabitHeat();
}
function addHabit() {
  const inp = $('newHabitLabel');
  const label = inp.value.trim();
  if (!label) return;
  const habits = getHabits();
  habits.push({ id: uid(), label, icon: 'star' });
  saveHabitsConfig(habits);
  inp.value = '';
  renderHabits(); renderHabitEditRows(); renderHabitHeat();
}

document.addEventListener('click', e => {
  if (!e.target.closest('.habit-edit-icon-wrap'))
    $$('.icon-picker-grid').forEach(g => g.classList.remove('open'));
});

// ─── SCHOOL CLASSES ───────────────────────────────────────────
const DEFAULT_CLASSES = [];

function getClasses() { return load('schoolClasses', DEFAULT_CLASSES); }
function saveClasses(c) { save('schoolClasses', c); }
function getClass(id) { return getClasses().find(c => c.id === id); }

function openClassesModal() {
  $('classesModal').classList.add('open');
  renderClassesEdit();
}
function closeClassesModal() { $('classesModal').classList.remove('open'); }

function renderClassesEdit() {
  const el = $('classesEditList');
  const classes = getClasses();
  if (!classes.length) {
    el.innerHTML = `<div class="empty" style="padding:0.5rem 0">No classes yet. Add one below.</div>`;
    return;
  }
  el.innerHTML = classes.map(c => {
    const slots = c.slots || [];
    const slotRows = slots.map((s, i) => `
      <div class="sched-slot-row">
        <select class="t-select sched-slot-day" onchange="window.dash.updateScheduleBlock('${c.id}',${i},'day',this.value)">
          ${['mon','tue','wed','thu','fri'].map(d => `<option value="${d}"${s.day===d?' selected':''}>${d.toUpperCase()}</option>`).join('')}
        </select>
        <input class="t-input" type="time" value="${s.start || ''}" onchange="window.dash.updateScheduleBlock('${c.id}',${i},'start',this.value)"/>
        <span class="sched-slot-dash">–</span>
        <input class="t-input" type="time" value="${s.end || ''}" onchange="window.dash.updateScheduleBlock('${c.id}',${i},'end',this.value)"/>
        <input class="t-input" placeholder="Room" value="${esc(s.room || '')}" onchange="window.dash.updateScheduleBlock('${c.id}',${i},'room',this.value)"/>
        <button class="del-btn" style="opacity:1" onclick="window.dash.delScheduleBlock('${c.id}',${i})">${ICONS.trash}</button>
      </div>
    `).join('');
    return `
      <div class="class-edit-card">
        <div class="class-edit-row">
          <input type="color" class="class-edit-swatch" value="${c.color}" onchange="window.dash.updateClass('${c.id}','color',this.value)"/>
          <input class="t-input" style="flex:1" value="${esc(c.name)}" onchange="window.dash.updateClass('${c.id}','name',this.value)"/>
          <button class="del-btn" style="opacity:1;padding:4px 8px" onclick="window.dash.deleteClass('${c.id}')">${ICONS.trash}</button>
        </div>
        <div class="sched-slots">
          ${slots.length ? slotRows : `<div class="sched-slots-empty">No meeting times set.</div>`}
          <button class="sched-slot-add" onclick="window.dash.addScheduleBlock('${c.id}')">+ Add time slot</button>
        </div>
      </div>
    `;
  }).join('');
}

function addClass() {
  const name = $('classNewName').value.trim();
  const color = $('classNewColor').value;
  if (!name) return;
  const classes = getClasses();
  classes.push({ id: uid(), name, color });
  saveClasses(classes);
  $('classNewName').value = '';
  renderClassesEdit();
  renderPlannerTabs();
  renderPlanner();
  renderTaskClassSelect();
}

function updateClass(id, field, value) {
  const classes = getClasses();
  const c = classes.find(x => x.id === id);
  if (c) { c[field] = value; saveClasses(classes); renderPlannerTabs(); renderPlanner(); renderTaskClassSelect(); }
}

function deleteClass(id) {
  saveClasses(getClasses().filter(c => c.id !== id));
  // unlink from tasks
  const tasks = getTasks();
  tasks.forEach(t => { if (t.classId === id) t.classId = null; });
  saveTasks(tasks);
  renderClassesEdit();
  renderPlannerTabs();
  renderPlanner();
  renderTaskClassSelect();
}

function renderPlannerTabs() {
  const tabsEl = $('plannerTabs');
  const classes = getClasses();
  // Build: All + class tabs + Priority
  tabsEl.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.className = 'tab planner-tab' + (activeTab === 'all' ? ' active' : '');
  allBtn.textContent = 'All';
  allBtn.onclick = e => switchTab('all', e.currentTarget);
  tabsEl.appendChild(allBtn);

  classes.forEach(c => {
    const b = document.createElement('button');
    b.className = 'tab planner-tab class-tab' + (activeTab === 'class:'+c.id ? ' active' : '');
    b.style.setProperty('--class-color', c.color);
    b.textContent = c.name;
    b.onclick = e => switchTab('class:'+c.id, e.currentTarget);
    tabsEl.appendChild(b);
  });

  const priBtn = document.createElement('button');
  priBtn.className = 'tab planner-tab' + (activeTab === 'priority' ? ' active' : '');
  priBtn.textContent = 'Priority';
  priBtn.onclick = e => switchTab('priority', e.currentTarget);
  tabsEl.appendChild(priBtn);
}

function renderTaskClassSelect() {
  const sel = $('taskClass');
  const classes = getClasses();
  // Default class based on active tab
  let preferred = '';
  if (activeTab.startsWith('class:')) preferred = activeTab.slice(6);
  sel.innerHTML = `<option value="">No class</option>` + classes.map(c =>
    `<option value="${c.id}"${preferred===c.id?' selected':''}>${esc(c.name)}</option>`
  ).join('');
  if (preferred) sel.value = preferred;
}

// ─── PLANNER / TASKS ──────────────────────────────────────────
let activeTab = 'all';

const PRIORITY_TYPES = ['priority'];

function getCategory(type) {
  if (!type) return 'default';
  const t = type.toLowerCase();
  if (PRIORITY_TYPES.includes(t))          return 'priority';
  if (['exam','quiz','test'].includes(t))  return 'exam';
  if (['essay','project'].includes(t))     return 'essay';
  if (['meeting','interview'].includes(t)) return 'meeting';
  return 'school';
}

function getDaysPill(dueDate) {
  if (!dueDate) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  const due   = new Date(dueDate + 'T00:00:00');
  const diff  = Math.round((due - today) / 86400000);
  if (diff === 0) return { cls:'today',  label:'Today' };
  if (diff < 0)   return { cls:'past',   label:`${Math.abs(diff)}d ago` };
  if (diff === 1) return { cls:'urgent', label:'Tomorrow' };
  if (diff <= 3)  return { cls:'urgent', label:`${diff}d` };
  if (diff <= 7)  return { cls:'soon',   label:`${diff}d` };
  return { cls:'far', label:`${diff}d` };
}

function getTasks() { return load('plannerTasks', []); }
function saveTasks(t) { save('plannerTasks', t); }

function renderPlanner() {
  const el = $('plannerList');
  let tasks = getTasks();

  if (activeTab === 'priority') tasks = tasks.filter(t => PRIORITY_TYPES.includes((t.type||'').toLowerCase()));
  else if (activeTab.startsWith('class:')) {
    const cid = activeTab.slice(6);
    tasks = tasks.filter(t => t.classId === cid);
  }

  tasks.sort((a,b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  if (!tasks.length) { el.innerHTML = `<div class="empty">Nothing here yet — add your first task above.</div>`; return; }
  el.innerHTML = '';

  tasks.forEach(t => {
    const cat  = getCategory(t.type);
    const pill = getDaysPill(t.dueDate);
    const cls  = t.classId ? getClass(t.classId) : null;
    const st   = taskStatus(t);
    const done = st === 'done';
    const div  = document.createElement('div');
    div.className = `task-item st-${st}${done ? ' completed' : ''}`;
    div.dataset.id = t.id;
    const classBadge = cls
      ? `<span class="class-badge" style="background:${cls.color}22;color:${cls.color};border:1px solid ${cls.color}44">${esc(cls.name.split(' ')[0])}</span>`
      : '';
    const meta = STATUS_META[st];
    div.innerHTML = `
      <div class="tcheck${done ? ' checked' : ''}" onclick="window.dash.toggleTask('${t.id}')" title="${done ? 'Tap to clear from list' : 'Tap to mark complete'}"></div>
      <span class="task-txt" onclick="window.dash.toggleTask('${t.id}')">${esc(t.text)}</span>
      <button class="status-pill st-${st}" onclick="window.dash.openStatusMenu('${t.id}',event)" title="Change status">
        <span class="status-dot"></span>
        <span class="status-lbl">${meta.label}</span>
        <svg class="status-caret" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      ${classBadge}
      ${t.type ? `<span class="type-badge ${cat}">${esc(t.type)}</span>` : ''}
      ${pill ? `<span class="days-pill ${pill.cls}">${pill.label}</span>` : ''}
      <button class="del-btn" onclick="window.dash.delTask('${t.id}')">×</button>`;
    el.appendChild(div);
  });
}

// ── Task status: not started → in progress → completed ──────────
const STATUS_META = {
  todo:  { label: 'Not started' },
  doing: { label: 'In progress' },
  done:  { label: 'Completed' },
};
function taskStatus(t) { return t.status || (t.done ? 'done' : 'todo'); }

function openStatusMenu(id, ev) {
  if (ev) { ev.stopPropagation(); }
  const tasks = getTasks();
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  const cur = taskStatus(t);
  closeStatusMenu();
  const menu = document.createElement('div');
  menu.className = 'status-menu';
  menu.id = 'statusMenu';
  const opts = [
    ['todo',  'Not started'],
    ['doing', 'In progress'],
    ['done',  'Completed'],
  ];
  menu.innerHTML = opts.map(([val, lbl]) =>
    `<button class="status-opt st-${val}${val === cur ? ' active' : ''}" onclick="window.dash.setTaskStatus('${id}','${val}')">
       <span class="status-dot"></span><span>${lbl}</span>
       ${val === cur ? '<svg class="status-check" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>' : ''}
     </button>`).join('');
  document.body.appendChild(menu);

  // Anchor below the pill that was clicked
  const pill = ev && ev.currentTarget ? ev.currentTarget
    : document.querySelector(`#plannerList .task-item[data-id="${id}"] .status-pill`);
  const r = pill.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = r.left;
  if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = r.top - mh - 6; // flip up if no room
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top  = Math.max(8, top) + 'px';
  requestAnimationFrame(() => menu.classList.add('open'));

  setTimeout(() => document.addEventListener('click', closeStatusMenu, { once: true }), 0);
}

function closeStatusMenu() {
  const m = document.getElementById('statusMenu');
  if (m) m.remove();
}

function setTaskStatus(id, status) {
  closeStatusMenu();
  const tasks = getTasks();
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  t.status = status;
  t.done = (status === 'done');
  saveTasks(tasks);
  renderPlanner(); renderAgenda();
}

function addTask() {
  const name = $('taskName').value.trim();
  if (!name) return;
  const tasks = getTasks();
  // Default class = currently filtered class if user is on a class tab
  let classId = $('taskClass').value || null;
  if (!classId && activeTab.startsWith('class:')) classId = activeTab.slice(6);
  tasks.unshift({
    id: uid(),
    text: name,
    dueDate: $('taskDue').value || null,
    type: $('taskType').value,
    classId,
    done: false,
    status: 'todo',
    createdAt: Date.now()
  });
  saveTasks(tasks);
  $('taskName').value = '';
  renderPlanner(); renderAgenda();
}

function toggleTask(id) {
  const tasks = getTasks();
  const t = tasks.find(t => t.id === id);
  if (!t) return;
  if (taskStatus(t) !== 'done') {
    // First tap: mark complete. It stays in the list, highlighted green.
    t.status = 'done';
    t.done = true;
    saveTasks(tasks);
    renderPlanner(); renderAgenda();
  } else {
    // Already completed: this tap clears it from the list.
    saveTasks(tasks);
    const node = document.querySelector(`#plannerList .task-item[data-id="${id}"]`);
    if (node) {
      node.classList.add('finishing');
      setTimeout(() => {
        saveTasks(getTasks().filter(x => x.id !== id));
        renderPlanner(); renderAgenda();
      }, 480);
    } else {
      saveTasks(getTasks().filter(x => x.id !== id));
      renderPlanner(); renderAgenda();
    }
  }
}

function delTask(id) {
  saveTasks(getTasks().filter(t => t.id !== id));
  renderPlanner(); renderAgenda();
}

function switchTab(tab, el) {
  activeTab = tab;
  $$('.planner-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  renderPlanner();
  renderTaskClassSelect();
  refreshTabbedBg('planner');
}

// ─── LIFE CHECKLIST ───────────────────────────────────────────
function getLife() { return load('lifeItems', []); }
function saveLife(l) { save('lifeItems', l); }

function renderLife() {
  const el = $('lifeList');
  const items = getLife();
  if (!items.length) {
    el.innerHTML = `<div class="life-empty">empty list — quiet day.</div>`;
    return;
  }
  const sorted = [...items].sort((a,b) => (a.done?1:0) - (b.done?1:0));
  el.innerHTML = '';
  sorted.forEach(item => {
    const div = document.createElement('div');
    div.className = 'life-item' + (item.done ? ' done' : '');
    div.dataset.id = item.id;
    div.innerHTML = `
      <div class="life-check${item.done?' checked':''}" onclick="window.dash.toggleLife('${item.id}')"></div>
      <input class="life-txt" value="${esc(item.text)}" onchange="window.dash.updateLife('${item.id}',this.value)" onkeydown="if(event.key==='Enter')this.blur()"/>
      <button class="del-btn" onclick="window.dash.delLife('${item.id}')">×</button>`;
    el.appendChild(div);
  });
}

function addLife() {
  const inp = $('lifeInput');
  const text = inp.value.trim();
  if (!text) return;
  const items = getLife();
  items.unshift({ id: uid(), text, done: false, t: Date.now() });
  saveLife(items);
  inp.value = '';
  renderLife();
}

function toggleLife(id) {
  const items = getLife();
  const i = items.find(x => x.id === id);
  if (!i) return;
  if (!i.done) {
    i.done = true;
    saveLife(items);
    renderLife();
    const node = document.querySelector(`#lifeList .life-item[data-id="${id}"]`);
    if (node) node.classList.add('finishing');
    setTimeout(() => {
      saveLife(getLife().filter(x => x.id !== id));
      renderLife();
    }, 520);
  } else {
    saveLife(items.filter(x => x.id !== id));
    renderLife();
  }
}

function updateLife(id, text) {
  const items = getLife();
  const i = items.find(x => x.id === id);
  if (i) { i.text = text.trim() || i.text; saveLife(items); renderLife(); }
}

function delLife(id) {
  saveLife(getLife().filter(x => x.id !== id));
  renderLife();
}

function clearDoneLife() {
  // (Auto-delete on check is on; this clears any leftovers and is a no-op normally)
  const done = getLife().filter(i => i.done).length;
  if (!done) return;
  if (!confirm(`Clear ${done} completed item${done>1?'s':''}?`)) return;
  saveLife(getLife().filter(i => !i.done));
  renderLife();
}

// ─── AGENDA ───────────────────────────────────────────────────
let agendaView = 'week';
let calYear, calMonth;

function switchAgendaView(view, el) {
  agendaView = view;
  $$('.agenda-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  centerTab(el);
  renderAgenda();
  refreshTabbedBg('agenda');
}

// Smoothly bring a tab into view within its scrollable strip
function centerTab(el) {
  const strip = el && el.closest('.agenda-tabs');
  if (!strip) return;
  const target = el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2;
  const max = strip.scrollWidth - strip.clientWidth;
  strip.scrollTo({ left: Math.max(0, Math.min(max, target)), behavior: 'smooth' });
}

// ─── DRAGGABLE TAB CAROUSEL ───────────────────────────────────
// Lets the agenda (and other) tab strips be scrubbed left↔right by
// dragging with a mouse/finger, with soft fade hints at the edges
// to signal there's more to scan. Touch already scrolls natively;
// this adds pointer-drag for the desktop phone-preview.
function initTabCarousel() {
  document.querySelectorAll('.agenda-tabs, .tabs, #currentlyTabs').forEach(setupDragScroll);
}

function setupDragScroll(el) {
  if (!el || el.__dragInit) return;
  el.__dragInit = true;

  const updateEdges = () => {
    const max = el.scrollWidth - el.clientWidth;
    el.classList.toggle('can-left',  el.scrollLeft > 2);
    el.classList.toggle('can-right', el.scrollLeft < max - 2);
  };

  let down = false, startX = 0, startScroll = 0, moved = false, captured = false, pid = null;

  el.addEventListener('pointerdown', (e) => {
    // ignore non-primary buttons
    if (e.button && e.button !== 0) return;
    // Touch (and pen) scroll the strip natively via overflow-x — leave them
    // alone so a tap reliably reaches the tab button underneath. Only mouse
    // gets the click-drag-to-scroll affordance.
    if (e.pointerType && e.pointerType !== 'mouse') return;
    down = true; moved = false; captured = false; pid = e.pointerId;
    startX = e.clientX; startScroll = el.scrollLeft;
  });

  el.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - startX;
    // Only start an actual drag (and capture the pointer) once the cursor
    // has moved past a small threshold — a stationary press stays a click.
    if (!moved && Math.abs(dx) > 4) {
      moved = true;
      el.classList.add('dragging');
      try { el.setPointerCapture(pid); captured = true; } catch (_) {}
    }
    if (moved) {
      el.scrollLeft = startScroll - dx;
      updateEdges();
    }
  });

  const end = (e) => {
    if (!down) return;
    down = false;
    el.classList.remove('dragging');
    if (captured) { try { el.releasePointerCapture(pid); } catch (_) {} }
    captured = false;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  // Swallow the click that ends a drag so we don't accidentally switch tabs.
  el.addEventListener('click', (e) => {
    if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; }
  }, true);

  el.addEventListener('scroll', updateEdges, { passive: true });
  window.addEventListener('resize', updateEdges);
  updateEdges();
}

function renderAgenda() {
  if (agendaView === 'week')     renderWeekView();
  if (agendaView === 'tomorrow') renderTomorrow();
  if (agendaView === 'schedule') renderClassSchedule();
  if (agendaView === 'month')    renderMonthView();
  if (agendaView === 'events')   renderEventsView();
  if (agendaView === 'habits')   renderHabitHeat();
  $$('.agenda-body > div').forEach(d => d.style.display = 'none');
  const body = $(`agenda-${agendaView}`);
  if (body) body.style.display = '';
}

// ─── SCHEDULE (Mon–Fri timetable) ────────────────────────────
function addScheduleBlock(classId) {
  const classes = getClasses();
  const c = classes.find(x => x.id === classId);
  if (!c) return;
  c.slots = c.slots || [];
  c.slots.push({ day: 'mon', start: '09:00', end: '10:15', room: '' });
  saveClasses(classes);
  renderClassesEdit();
  if (agendaView === 'schedule') renderClassSchedule();
}

function delScheduleBlock(classId, idx) {
  const classes = getClasses();
  const c = classes.find(x => x.id === classId);
  if (!c || !c.slots) return;
  c.slots.splice(idx, 1);
  saveClasses(classes);
  renderClassesEdit();
  if (agendaView === 'schedule') renderClassSchedule();
}

function updateScheduleBlock(classId, idx, field, value) {
  const classes = getClasses();
  const c = classes.find(x => x.id === classId);
  if (!c || !c.slots || !c.slots[idx]) return;
  c.slots[idx][field] = value;
  saveClasses(classes);
  if (agendaView === 'schedule') renderClassSchedule();
}

function renderClassSchedule() {
  const el = $('scheduleBody'); if (!el) return;
  const classes  = getClasses();
  const DAYS     = ['mon','tue','wed','thu','fri'];
  const DAY_LBLS = ['Mon','Tue','Wed','Thu','Fri'];

  // Collect all slots so we can compute the visible time window.
  const allSlots = [];
  classes.forEach(c => (c.slots || []).forEach(s => allSlots.push({ ...s, _class: c })));

  if (!allSlots.length) {
    el.innerHTML = `
      <div class="sched-empty">
        <div class="sched-empty-title">No class times set yet.</div>
        <div class="sched-empty-sub">Open <button class="btn-ghost" onclick="window.dash.openClassesModal()">Manage classes</button> and add a meeting time to each class.</div>
      </div>`;
    return;
  }

  const toMin = t => { const [h,m] = (t||'00:00').split(':').map(Number); return h*60 + (m||0); };
  const fmt   = t => {
    const [h,m] = (t||'00:00').split(':').map(Number);
    const ampm = h >= 12 ? 'p' : 'a';
    const hh = (h % 12) || 12;
    return m ? `${hh}:${String(m).padStart(2,'0')}${ampm}` : `${hh}${ampm}`;
  };

  let minMin =  9 * 60, maxMin = 17 * 60;
  allSlots.forEach(s => { minMin = Math.min(minMin, toMin(s.start)); maxMin = Math.max(maxMin, toMin(s.end)); });
  // pad and snap to whole hours
  const startHour = Math.max(0, Math.floor((minMin - 30) / 60));
  const endHour   = Math.min(24, Math.ceil ((maxMin + 30) / 60));
  const HOUR_PX   = 44;
  const totalPx   = (endHour - startHour) * HOUR_PX;
  const mToY      = m => (m - startHour * 60) / 60 * HOUR_PX;

  const now = new Date();
  const todayDayIdx = now.getDay() - 1; // mon=0
  const isWeekday   = todayDayIdx >= 0 && todayDayIdx <= 4;
  const nowMin      = now.getHours() * 60 + now.getMinutes();
  const nowInRange  = nowMin >= startHour*60 && nowMin <= endHour*60;

  // Time labels
  let hourLabels = '';
  let hourLines  = '';
  for (let h = startHour; h <= endHour; h++) {
    const y = (h - startHour) * HOUR_PX;
    const lbl = ((h % 12) || 12) + (h < 12 || h === 24 ? 'a' : 'p');
    hourLabels += `<div class="sched-hour-lbl" style="top:${y}px">${lbl}</div>`;
    if (h > startHour) hourLines += `<div class="sched-hour-line" style="top:${y}px"></div>`;
  }

  const cols = DAYS.map((day, i) => {
    const slots = allSlots.filter(s => s.day === day)
      .sort((a,b) => toMin(a.start) - toMin(b.start));
    const blocks = slots.map(s => {
      const top    = mToY(toMin(s.start));
      const height = Math.max(26, mToY(toMin(s.end)) - top);
      const c      = s._class;
      const name   = c.name.split(/[—–-]/)[0].trim();
      return `<div class="sched-block"
        style="top:${top}px;height:${height}px;background:${c.color}1a;border-left:3px solid ${c.color};color:${c.color}"
        title="${esc(c.name)} · ${s.start}–${s.end}${s.room?' · '+esc(s.room):''}">
        <div class="sched-block-name">${esc(name)}</div>
        <div class="sched-block-time">${fmt(s.start)}–${fmt(s.end)}${s.room?` · ${esc(s.room)}`:''}</div>
      </div>`;
    }).join('');
    const isToday = i === todayDayIdx;
    const nowLine = (isToday && nowInRange) ? `<div class="sched-now-line" style="top:${mToY(nowMin)}px"></div>` : '';
    return `<div class="sched-col${isToday?' today':''}">
      <div class="sched-col-head">${DAY_LBLS[i]}</div>
      <div class="sched-col-body" style="height:${totalPx}px">
        ${hourLines}
        ${nowLine}
        ${blocks}
      </div>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="sched-grid">
      <div class="sched-time-col">
        <div class="sched-col-head">&nbsp;</div>
        <div class="sched-time-body" style="height:${totalPx}px">${hourLabels}</div>
      </div>
      ${cols}
    </div>
    <div class="sched-foot">
      <button class="btn-ghost" onclick="window.dash.openClassesModal()">Edit class times →</button>
    </div>
  `;
}

// ─── TOMORROW (evening tee-up) ───────────────────────
function tomorrowKey() {
  const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0,10);
}

function renderTomorrow() {
  const el = $('tomorrowBody'); if (!el) return;
  const tKey = tomorrowKey();
  const t    = new Date(tKey + 'T00:00:00');
  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const tasks  = getTasks().filter(x => !x.done && x.dueDate === tKey);
  const events = getAllCalendarItems().filter(e => e.date === tKey);
  const habits = getHabits();
  const now    = new Date();
  const eveningHint = now.getHours() >= 17;
  const classes = getClasses();
  const classSel = `<option value="">No class</option>` + classes.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');

  el.innerHTML = `
    <div class="tomorrow-head">
      <div>
        <div class="tomorrow-eyebrow">${eveningHint ? 'EVENING TEE\u2011UP' : 'PLANNING AHEAD'}</div>
        <div class="tomorrow-title">${DAYS[t.getDay()]}, ${MONTHS[t.getMonth()]} ${t.getDate()}</div>
      </div>
      <div class="tomorrow-counts">
        <span><strong>${tasks.length}</strong> tasks</span>
        <span><strong>${events.length}</strong> events</span>
      </div>
    </div>

    <div class="tomorrow-grid">
      <div class="tomorrow-col">
        <div class="tomorrow-col-label">Tasks due tomorrow</div>
        ${tasks.length ? tasks.map(x => {
          const cls = x.classId ? getClass(x.classId) : null;
          const classBadge = cls ? `<span class="class-badge" style="background:${cls.color}22;color:${cls.color};border:1px solid ${cls.color}44">${esc(cls.name.split(' ')[0])}</span>` : '';
          return `<div class="tomorrow-row task">
            <div class="tcheck" onclick="window.dash.toggleTask('${x.id}')"></div>
            <span class="task-txt" style="flex:1">${esc(x.text)}</span>
            ${classBadge}
            ${x.type ? `<span class="type-badge ${getCategory(x.type)}">${esc(x.type)}</span>` : ''}
            <button class="del-btn" style="opacity:1" onclick="window.dash.delTask('${x.id}')">×</button>
          </div>`;
        }).join('') : `<div class="tomorrow-empty">No tasks yet. Tee one up below.</div>`}
        <div class="tomorrow-add">
          <input class="t-input" id="tmrTaskName" placeholder="Task for tomorrow…" onkeydown="if(event.key==='Enter')window.dash.addTomorrowTask()"/>
          <select class="t-select" id="tmrTaskClass">${classSel}</select>
          <button class="btn-add" onclick="window.dash.addTomorrowTask()">Add</button>
        </div>
      </div>

      <div class="tomorrow-col">
        <div class="tomorrow-col-label">Events</div>
        ${events.length ? events.map(e => `
          <div class="tomorrow-row event">
            <span class="tomorrow-event-dot ${e._kind==='starred'?'starred':''}"></span>
            <span style="flex:1">${e._kind==='starred'?'★ ':''}${esc(e.label)}</span>
            ${e._kind==='agenda' ? `<button class="del-btn" style="opacity:1" onclick="window.dash.delAgendaEvent('${e.id}')">×</button>` : ''}
          </div>
        `).join('') : `<div class="tomorrow-empty">Nothing on the calendar.</div>`}
        <div class="tomorrow-add">
          <input class="t-input" id="tmrEventName" placeholder="Event for tomorrow…" onkeydown="if(event.key==='Enter')window.dash.addTomorrowEvent()"/>
          <button class="btn-add" onclick="window.dash.addTomorrowEvent()">Add</button>
        </div>
      </div>
    </div>

    <div class="tomorrow-foot">
      <div class="tomorrow-foot-label">Non-negotiables for tomorrow</div>
      <div class="tomorrow-habits-row">
        ${habits.length ? habits.map(h => `
          <span class="tomorrow-habit-chip" title="${esc(h.label)}">
            <span class="tomorrow-habit-icon">${iconRender(h.icon)}</span>
            <span>${esc(h.label)}</span>
          </span>
        `).join('') : `<span class="tomorrow-empty" style="display:inline">No habits set up.</span>`}
      </div>
    </div>
  `;
}

function addTomorrowTask() {
  const name = ($('tmrTaskName').value || '').trim();
  if (!name) return;
  const tasks = getTasks();
  tasks.unshift({
    id: uid(),
    text: name,
    dueDate: tomorrowKey(),
    type: 'assignment',
    classId: $('tmrTaskClass').value || null,
    done: false,
    createdAt: Date.now(),
  });
  saveTasks(tasks);
  $('tmrTaskName').value = '';
  renderTomorrow(); renderPlanner();
}

function addTomorrowEvent() {
  const name = ($('tmrEventName').value || '').trim();
  if (!name) return;
  const evs = getAgendaEvents();
  evs.push({ id: uid(), label: name, date: tomorrowKey() });
  saveAgendaEvents(evs);
  $('tmrEventName').value = '';
  renderTomorrow();
}

function copyHabitsToTomorrow() { /* placeholder — reserved for future */ }

function openTomorrow()  { agendaView = 'tomorrow'; $$('.agenda-tab').forEach(t => t.classList.remove('active')); document.querySelectorAll('.agenda-tab').forEach(b => { if ((b.textContent || '').trim() === 'Tomorrow') b.classList.add('active'); }); renderAgenda(); }
function closeTomorrow() { /* placeholder */ }

function getWeekDates() {
  const today = new Date(); today.setHours(0,0,0,0);
  const start = new Date(today); start.setDate(today.getDate() - today.getDay());
  return Array.from({length:7}, (_,i) => { const d = new Date(start); d.setDate(start.getDate()+i); return d; });
}

/* Agenda has its OWN events (not stockpiled into "Important Dates"). 
   Important Dates are starred milestones. Agenda events are regular calendar items. */
function getAgendaEvents() { return load('agendaEvents', []); }
function saveAgendaEvents(e) { save('agendaEvents', e); }
function getStarredDates() { return load('importantDates', []); }
function getAllCalendarItems() {
  return [
    ...getAgendaEvents().map(e => ({ ...e, _kind: 'agenda' })),
    ...getStarredDates().map(e => ({ ...e, _kind: 'starred' })),
  ];
}

function quickAddAgendaEvent() {
  const label = ($('agendaQuickLabel').value || '').trim();
  const date  = $('agendaQuickDate').value;
  if (!label || !date) return;
  const evs = getAgendaEvents();
  evs.push({ id: uid(), label, date });
  saveAgendaEvents(evs);
  $('agendaQuickLabel').value = '';
  $('agendaQuickDate').value  = '';
  renderAgenda();
}

function delAgendaEvent(id) {
  saveAgendaEvents(getAgendaEvents().filter(e => e.id !== id));
  renderAgenda();
}

function renderWeekView() {
  const strip = $('weekStrip'); if (!strip) return;
  const tasks = getTasks().filter(t => !t.done && t.dueDate);
  const items = getAllCalendarItems();
  const today = new Date(); today.setHours(0,0,0,0);
  const DAYS  = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  strip.innerHTML = '';
  getWeekDates().forEach((d, i) => {
    const dStr = d.toISOString().slice(0,10);
    const isToday = d.getTime() === today.getTime();
    const isPast  = d < today;
    const dayTasks  = tasks.filter(t => t.dueDate === dStr);
    const dayEvents = items.filter(e => e.date === dStr);
    const div = document.createElement('div');
    div.className = `week-day${isToday?' today':''}${isPast?' past':''}`;
    div.innerHTML = `
      <div class="week-day-head">
        <span class="week-day-lbl">${DAYS[i]}</span>
        <span class="week-day-num">${d.getDate()}</span>
      </div>
      <div class="week-day-items">
        ${dayTasks.slice(0,4).map(t => `<div class="week-chip ${getCategory(t.type)}" title="${esc(t.text)}">${esc(t.text)}</div>`).join('')}
        ${dayEvents.slice(0,2).map(e => `<div class="week-chip ${e._kind==='starred'?'event':'agenda-event'}" title="${esc(e.label)}">${e._kind==='starred'?'★ ':''}${esc(e.label)}</div>`).join('')}
      </div>`;
    strip.appendChild(div);
  });
}

function ensureCalDate() {
  if (calYear == null) { const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth(); }
}

function calNavMonth(dir) {
  ensureCalDate();
  calMonth += dir;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  renderMonthView();
}

function renderMonthView() {
  ensureCalDate();
  const titleEl = $('monthTitle'); if (!titleEl) return;
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  titleEl.textContent = `${MONTHS[calMonth]} ${calYear}`;
  const tasks = getTasks().filter(t => t.dueDate && !t.done);
  const items = getAllCalendarItems();
  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay  = new Date(calYear, calMonth+1, 0);
  const today    = new Date(); today.setHours(0,0,0,0);
  const grid = $('calGrid'); grid.innerHTML = '';
  for (let i = 0; i < firstDay.getDay(); i++) {
    const prev = new Date(calYear, calMonth, -firstDay.getDay()+i+1);
    const c = document.createElement('div');
    c.className = 'cal-cell other-month';
    c.innerHTML = `<div class="cal-cell-num">${prev.getDate()}</div>`;
    grid.appendChild(c);
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const thisDate = new Date(calYear, calMonth, d);
    const dStr = thisDate.toISOString().slice(0,10);
    const isToday = thisDate.getTime() === today.getTime();
    const dayTasks = tasks.filter(t => t.dueDate === dStr);
    const dayEvents = items.filter(e => e.date === dStr);
    const c = document.createElement('div');
    c.className = `cal-cell${isToday?' today':''}`;
    c.dataset.date = dStr;
    c.onclick = () => quickAddToDay(dStr);
    let chips = '';
    dayTasks.slice(0,3).forEach(t => { chips += `<div class="cal-task-chip ${getCategory(t.type)}">${esc(t.text)}</div>`; });
    dayEvents.slice(0,1).forEach(e => { chips += `<div class="cal-task-chip ${e._kind==='starred'?'event':'agenda-event'}">${e._kind==='starred'?'★ ':''}${esc(e.label)}</div>`; });
    if (dayTasks.length > 3) chips += `<div class="cal-task-chip default">+${dayTasks.length-3} more</div>`;
    c.innerHTML = `<div class="cal-cell-num">${d}</div><div class="cal-cell-tasks">${chips}</div>`;
    grid.appendChild(c);
  }
  const total = firstDay.getDay() + lastDay.getDate();
  const trailing = (7 - (total % 7)) % 7;
  for (let i = 1; i <= trailing; i++) {
    const c = document.createElement('div');
    c.className = 'cal-cell other-month';
    c.innerHTML = `<div class="cal-cell-num">${i}</div>`;
    grid.appendChild(c);
  }
}

function quickAddToDay(dateStr) {
  const label = prompt(`New event for ${dateStr}:`);
  if (!label || !label.trim()) return;
  const evs = getAgendaEvents();
  evs.push({ id: uid(), label: label.trim(), date: dateStr });
  saveAgendaEvents(evs);
  renderAgenda();
}

function renderEventsView() {
  const el = $('eventsBody'); if (!el) return;
  const items = getAllCalendarItems()
    .map(d => ({ ...d, _t: new Date(d.date+'T00:00:00').getTime() }))
    .sort((a,b) => a._t - b._t);
  const today = new Date(); today.setHours(0,0,0,0);
  const upcoming = items.filter(e => new Date(e.date+'T00:00:00') >= today);
  if (!upcoming.length) { el.innerHTML = `<div class="empty">No upcoming events. Click a day in Month view to add one.</div>`; return; }
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  el.innerHTML = upcoming.map(e => {
    const diff = Math.round((new Date(e.date+'T00:00:00') - today) / 86400000);
    let cls, label;
    if (diff === 0)      { cls='today'; label='Today'; }
    else if (diff === 1) { cls='soon';  label='Tomorrow'; }
    else if (diff <= 30) { cls='soon';  label=`In ${diff}d`; }
    else                 { cls='far';   label=`${Math.round(diff/30)} mo`; }
    const dt = new Date(e.date+'T00:00:00');
    const delAction = e._kind === 'agenda'
      ? `<button class="del-btn" style="opacity:1" onclick="window.dash.delAgendaEvent('${e.id}')">×</button>`
      : `<span class="agenda-event-source" title="From Important Dates">★</span>`;
    return `<div class="date-item">
      <span class="dbadge ${cls}">${label}</span>
      <span class="date-lbl">${esc(e.label)}</span>
      <span style="font-size:0.7rem;color:var(--muted)">${MONTHS[dt.getMonth()]} ${dt.getDate()}</span>
      ${delAction}
    </div>`;
  }).join('');
}

function renderHabitHeat() {
  const el = $('habitsBody'); if (!el) return;
  const habits = getHabits();
  const hist = getHabitHistory();
  const today = new Date(); today.setHours(0,0,0,0);
  const todayStrV = todayStr();
  const DAY_LBLS = ['S','M','T','W','T','F','S'];
  const weekDates = getWeekDates();
  if (!habits.length) { el.innerHTML = `<div class="empty">Add some habits to track them here.</div>`; return; }
  el.innerHTML = habits.map(h => {
    const cells = weekDates.map(d => {
      const ds = d.toISOString().slice(0,10);
      const done = hist[ds] && hist[ds][h.id];
      const isFuture = d > today;
      const isToday = ds === todayStrV;
      return `<div class="habit-cell${done?' done':''}${isToday?' today':''}${isFuture?' future':''}" title="${ds}">
        <span class="d">${DAY_LBLS[d.getDay()]}</span>
      </div>`;
    }).join('');
    const streak = habitStreak(h.id);
    return `<div class="habit-heat-row">
      <div class="habit-heat-name">${iconRender(h.icon)} <span>${esc(h.label)}</span>${streak >= 2 ? `<span class="habit-heat-streak">\uD83D\uDD25 ${streak}</span>` : ''}</div>
      <div class="habit-heat-cells">${cells}</div>
    </div>`;
  }).join('');
}

// ─── IMPORTANT DATES ──────────────────────────────────────────
function renderDates() {
  const el = $('datesList');
  const dates = load('importantDates', []);
  if (!dates.length) { el.innerHTML = `<div class="empty">No starred dates yet — birthdays, exams, trips.</div>`; return; }
  const today = new Date(); today.setHours(0,0,0,0);
  el.innerHTML = '';
  [...dates]
    .map(d => ({ ...d, _t: new Date(d.date+'T00:00:00').getTime() }))
    .sort((a,b) => a._t - b._t)
    .forEach(d => {
      const diff = Math.round((new Date(d.date+'T00:00:00') - today) / 86400000);
      let cls, label;
      if (diff === 0)      { cls='today'; label='Today'; }
      else if (diff < 0)   { cls='past';  label=`${Math.abs(diff)}d ago`; }
      else if (diff === 1) { cls='soon';  label='Tomorrow'; }
      else if (diff <= 30) { cls='soon';  label=`${diff}d`; }
      else                 { cls='far';   label=`${diff}d`; }
      const div = document.createElement('div');
      div.className = 'date-item';
      div.innerHTML = `
        <span class="dbadge ${cls}">${label}</span>
        <span class="date-lbl">${esc(d.label)}</span>
        <button class="del-btn" onclick="window.dash.delDate('${d.id}')">×</button>`;
      el.appendChild(div);
    });
}

function addDate() {
  const label = $('dateLabel').value.trim();
  const date  = $('dateDate').value;
  if (!label || !date) return;
  const dates = load('importantDates', []);
  dates.push({ id: uid(), label, date });
  save('importantDates', dates);
  $('dateLabel').value = ''; $('dateDate').value = '';
  renderDates(); renderAgenda();
}
function delDate(id) {
  save('importantDates', load('importantDates', []).filter(d => d.id !== id));
  renderDates(); renderAgenda();
}

// ─── GOALS ────────────────────────────────────────────────────
let goalScope = 'year';
function getGoals() { return load('goals', { year: [], quarter: [], week: [] }); }
function saveGoals(g) { save('goals', g); }

function switchGoalScope(scope, el) {
  goalScope = scope;
  $$('.goals-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  renderGoals();
  refreshTabbedBg('goals');
}

function renderGoals() {
  const goals = getGoals()[goalScope] || [];
  const el = $('goalsList');
  if (!goals.length) { el.innerHTML = `<div class="empty">No ${goalScope==='year'?'yearly':goalScope+'ly'} goals yet.</div>`; return; }
  el.innerHTML = goals.map(g => {
    const pct = +(g.pct || 0);
    const full = pct >= 100;
    return `<div class="goal-item">
      <div class="goal-pct${full?' full':''}" onclick="window.dash.cycleGoal('${g.id}')" title="Click to increment">${pct}%</div>
      <div class="goal-body">
        <div class="goal-txt">${esc(g.text)}</div>
        <div class="goal-bar"><div class="goal-bar-fill${full?' full':''}" style="width:${Math.min(100,pct)}%"></div></div>
      </div>
      <button class="del-btn" onclick="window.dash.delGoal('${g.id}')">×</button>
    </div>`;
  }).join('');
}

function cycleGoal(id) {
  const all = getGoals();
  const g = all[goalScope].find(x => x.id === id);
  if (!g) return;
  g.pct = ((+g.pct || 0) + 25) % 125;
  saveGoals(all);
  renderGoals();
}
function addGoal() {
  const text = $('goalInput').value.trim();
  if (!text) return;
  const all = getGoals();
  if (!all[goalScope]) all[goalScope] = [];
  all[goalScope].push({ id: uid(), text, pct: 0 });
  saveGoals(all);
  $('goalInput').value = '';
  renderGoals();
}
function delGoal(id) {
  const all = getGoals();
  all[goalScope] = all[goalScope].filter(x => x.id !== id);
  saveGoals(all);
  renderGoals();
}

// ─── CURRENTLY CAROUSEL ───────────────────────────────────────
const CUR_KINDS = {
  reading:  { tag:'NOW READING',  icon:'book',    label:'Reading',  placeholder:'Add a book' },
  watching: { tag:'NOW WATCHING', icon:'film',    label:'Watching', placeholder:'Add a show' },
  playing:  { tag:'NOW PLAYING',  icon:'gamepad', label:'Playing',  placeholder:'Add a game' },
};

let curKind = 'reading';
let curIdx = 0;

function renderCurrentlyTabs() {
  const tabs = $('currentlyTabs');
  if (!tabs) return;
  tabs.innerHTML = '';
  Object.entries(CUR_KINDS).forEach(([key, meta]) => {
    const b = document.createElement('button');
    b.className = 'tab cur-tab' + (curKind === key ? ' active' : '');
    b.innerHTML = `<span class="cur-tab-icon">${ICONS[meta.icon]}</span><span>${meta.label}</span>`;
    b.onclick = e => switchCurKind(key, e.currentTarget);
    tabs.appendChild(b);
  });
}

function getCurrentlyAll() {
  const raw = load('currently', null);
  if (raw && !Array.isArray(raw.reading)) {
    const migrated = { reading: [], watching: [], playing: [] };
    ['reading','watching','playing'].forEach(k => {
      if (raw[k]) migrated[k].push(raw[k]);
    });
    save('currently', migrated);
    return migrated;
  }
  return raw || { reading: [], watching: [], playing: [] };
}
function saveCurrentlyAll(c) { save('currently', c); }

function switchCurKind(kind, el) {
  curKind = kind;
  curIdx = 0;
  $$('.cur-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  renderCurrently();
  refreshTabbedBg('currently');
}

function renderCurrently() {
  const all = getCurrentlyAll();
  const items = all[curKind] || [];
  const meta = CUR_KINDS[curKind];
  const wrap = $('currentlyCarousel');
  if (!items.length) {
    wrap.innerHTML = `<div class="cur-empty">${ICONS[meta.icon]}<div>nothing in your ${curKind} queue.<br>tap "+ Add" to start.</div></div>`;
    renderCurDots(0, 0);
    $('curPrev').disabled = true;
    $('curNext').disabled = true;
    return;
  }
  if (curIdx >= items.length) curIdx = items.length - 1;
  if (curIdx < 0) curIdx = 0;
  const item = items[curIdx];

  wrap.innerHTML = `
    <div class="cur-card">
      <div class="cur-img-wrap" onclick="window.dash.pickCurImage()">
        ${item.img
          ? `<img src="${item.img}" alt="">`
          : `<div class="cur-img-empty">${ICONS.image}<span>tap to upload</span></div>`}
      </div>
      <div class="cur-body">
        <div class="cur-tag">${meta.tag}</div>
        <input class="cur-title" value="${esc(item.title||'')}" placeholder="Title"
               oninput="window.dash.updateCur('title',this.value)"/>
        <input class="cur-sub" value="${esc(item.sub||'')}" placeholder="${curKind==='reading'?'Author':curKind==='watching'?'Studio / showrunner':'Studio / dev'}"
               oninput="window.dash.updateCur('sub',this.value)"/>
        ${item.progress != null ? `<div class="cur-progress-bar"><div class="cur-progress-fill" style="width:${item.progress}%"></div></div>` : ''}
        <div class="cur-actions">
          <button class="cur-action" onclick="window.dash.cycleCurProgress()">${item.progress != null ? `${item.progress}%` : 'Track progress'}</button>
          <button class="cur-action danger" onclick="window.dash.finishCur()">Finish</button>
        </div>
      </div>
    </div>`;

  renderCurDots(curIdx, items.length);
  $('curPrev').disabled = items.length <= 1;
  $('curNext').disabled = items.length <= 1;
}

function renderCurDots(active, total) {
  const dots = $('curDots');
  if (!total) { dots.innerHTML = ''; return; }
  dots.innerHTML = Array.from({length: total}, (_, i) =>
    `<button class="carousel-dot${i===active?' active':''}" onclick="window.dash.curGoTo(${i})" aria-label="Item ${i+1}"></button>`
  ).join('');
}

function curPrev() {
  const all = getCurrentlyAll();
  const items = all[curKind] || [];
  if (items.length <= 1) return;
  curIdx = (curIdx - 1 + items.length) % items.length;
  renderCurrently();
}
function curNext() {
  const all = getCurrentlyAll();
  const items = all[curKind] || [];
  if (items.length <= 1) return;
  curIdx = (curIdx + 1) % items.length;
  renderCurrently();
}
function curGoTo(i) { curIdx = i; renderCurrently(); }

function curAdd() {
  const meta = CUR_KINDS[curKind];
  const title = prompt(meta.placeholder);
  if (!title) return;
  const all = getCurrentlyAll();
  all[curKind] = all[curKind] || [];
  all[curKind].unshift({ id: uid(), title: title.trim(), sub: '', img: null, progress: null, startedAt: Date.now() });
  saveCurrentlyAll(all);
  curIdx = 0;
  renderCurrently();
}

function updateCur(field, value) {
  const all = getCurrentlyAll();
  if (!all[curKind] || !all[curKind][curIdx]) return;
  all[curKind][curIdx][field] = value;
  saveCurrentlyAll(all);
}

function cycleCurProgress() {
  const all = getCurrentlyAll();
  const item = all[curKind] && all[curKind][curIdx];
  if (!item) return;
  const cur = item.progress;
  if (cur == null) item.progress = 25;
  else if (cur < 100) item.progress = Math.min(100, cur + 25);
  else item.progress = null;
  saveCurrentlyAll(all);
  renderCurrently();
}

function finishCur() {
  const all = getCurrentlyAll();
  const item = all[curKind] && all[curKind][curIdx];
  if (!item) return;
  if (!confirm(`Mark "${item.title}" as finished?`)) return;
  const archive = load('currentlyArchive', []);
  archive.unshift({ ...item, kind: curKind, finishedAt: Date.now() });
  save('currentlyArchive', archive.slice(0, 80));
  all[curKind].splice(curIdx, 1);
  saveCurrentlyAll(all);
  if (curIdx >= all[curKind].length) curIdx = Math.max(0, all[curKind].length - 1);
  renderCurrently();
}

function pickCurImage() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.heic,.heif,.avif';
  input.onchange = e => {
    const file = e.target.files && e.target.files[0];
    if (file) compressImage(file, 1400, dataUrl => {
      const all = getCurrentlyAll();
      if (!all[curKind] || !all[curKind][curIdx]) return;
      all[curKind][curIdx].img = dataUrl;
      saveCurrentlyAll(all);
      renderCurrently();
    });
  };
  input.click();
}

// ─── IMAGE UTILITIES ──────────────────────────────────────────
function compressImage(file, maxDim, cb) {
  // Animated GIFs (and anything we can't redraw) pass through untouched.
  if (file.type === 'image/gif') {
    const r = new FileReader();
    r.onload = e => cb(e.target.result);
    r.readAsDataURL(file);
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const raw = e.target.result;
    const img = new Image();
    // If the browser can't decode the format (e.g. some HEIC), keep the
    // original data URL so the upload still "takes" rather than silently failing.
    img.onerror = () => cb(raw);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        // Only downscale; if the source is smaller than maxDim, keep it sharp.
        const ratio = Math.min(1, maxDim / Math.max(w, h));
        w = Math.round(w * ratio); h = Math.round(h * ratio);
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        // PNG keeps every pixel sharp when the source is reasonably small;
        // for bigger images we use high-quality JPEG (IndexedDB has the room).
        const area = w * h;
        const useJpeg = area > 1000 * 1000;
        cb(useJpeg ? canvas.toDataURL('image/jpeg', 0.95) : canvas.toDataURL('image/png'));
      } catch (err) {
        cb(raw);
      }
    };
    img.src = raw;
  };
  reader.readAsDataURL(file);
}
window.dashImg = { compressImage };

// ─── PER-CARD BACKGROUNDS ─────────────────────────────────────
/* Each .card with [data-card-id] gets its own optional bg image,
   stored as cardBg::<id>:  { img, intensity, posX, posY, zoom }
   - intensity: 10-100  (opacity of the image layer behind the scrim)
   - posX/posY: 0-100   (object-position percentages)
   - zoom:     100-400  (scale of the image — 100 = cover) */

const CARD_BG_DEFAULTS = { intensity: 60, posX: 50, posY: 50, zoom: 100 };

/* Some cards have sub-tabs (Currently → reading/watching/playing, Planner →
   class filter, Agenda → view, Goals → scope). We let users save a DIFFERENT
   background per sub-tab — the storage key becomes `cardBg::<id>::<tab>` when
   a tab is active, otherwise plain `cardBg::<id>`. */

function currentTabFor(id) {
  if (id === 'currently') return curKind;            // reading | watching | playing
  if (id === 'planner')   return activeTab;          // all | class:xxx | priority
  if (id === 'agenda')    return agendaView;         // week | tomorrow | schedule | month | events | habits
  if (id === 'goals')     return goalScope;          // year | quarter | week
  return null;
}

function tabLabelFor(id, tab) {
  if (!tab) return '';
  if (id === 'currently') return ({reading:'Reading',watching:'Watching',playing:'Playing'})[tab] || tab;
  if (id === 'planner') {
    if (tab === 'all') return 'All tasks';
    if (tab === 'priority') return 'Priority';
    if (tab.startsWith('class:')) {
      const c = getClass(tab.slice(6));
      return c ? c.name.split(/[—–-]/)[0].trim() : 'Class';
    }
    return tab;
  }
  if (id === 'agenda') return ({week:'This Week',tomorrow:'Tomorrow',schedule:'Schedule',month:'Month',events:'Events',habits:'Habits'})[tab] || tab;
  if (id === 'goals')  return ({year:'Year',quarter:'Quarter',week:'Week'})[tab] || tab;
  return tab;
}

function bgKeyFor(id) {
  const tab = currentTabFor(id);
  return tab ? `cardBg::${id}::${tab}` : `cardBg::${id}`;
}

function getCardBg(id) { return load(bgKeyFor(id), null); }
// The image itself lives in IndexedDB (large quota); the localStorage config
// only carries metadata + a hasImg flag.
function cardImgKey(id) { return 'cardimg:' + bgKeyFor(id); }
function getCardImg(id)  { return window.dashStore.getCached(cardImgKey(id)); }
function cardHasImg(id)  { const c = getCardBg(id); return !!(c && c.hasImg && getCardImg(id)); }
function saveCardBg(id, val) {
  const key = bgKeyFor(id);
  if (val) save(key, val);
  else localStorage.removeItem(key);
}
function applyAllCardBgs() {
  $$('[data-card-id]').forEach(el => applyCardBg(el));
}

/* Re-apply a tabbed card's bg + popover state after the user switches sub-tab,
   so each tab can have its own image. Triggered by switchTab/switchCurKind/etc. */
function refreshTabbedBg(id) {
  const el = document.querySelector(`[data-card-id="${id}"]`);
  if (!el) return;
  applyCardBg(el);
  ensureCardBgUI(id);
}

function applyCardBg(el) {
  const id = el.dataset.cardId;
  const cfg = getCardBg(id);
  const imgSrc = (cfg && cfg.hasImg) ? getCardImg(id) : null;
  let layer = el.querySelector(':scope > .card-bg-layer');
  if (cfg && imgSrc) {
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'card-bg-layer';
      const img = document.createElement('img');
      img.className = 'card-bg-img';
      img.alt = '';
      layer.appendChild(img);
      el.insertBefore(layer, el.firstChild);
    }
    const img = layer.querySelector('img');
    if (img.src !== imgSrc) img.src = imgSrc;
    const intensity = cfg.intensity ?? CARD_BG_DEFAULTS.intensity;
    const posX = cfg.posX ?? CARD_BG_DEFAULTS.posX;
    const posY = cfg.posY ?? CARD_BG_DEFAULTS.posY;
    const zoom = cfg.zoom ?? CARD_BG_DEFAULTS.zoom;
    img.style.objectPosition = `${posX}% ${posY}%`;
    img.style.transform = `scale(${zoom / 100})`;
    img.style.transformOrigin = `${posX}% ${posY}%`;
    layer.style.opacity = String(intensity / 100);
    el.setAttribute('data-has-bg', '1');
  } else {
    if (layer) layer.remove();
    el.removeAttribute('data-has-bg');
  }
}

function pickCardImage(id) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*,.heic,.heif,.avif';
  input.onchange = e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    compressImage(file, 3000, dataUrl => {
      const cur = getCardBg(id) || { ...CARD_BG_DEFAULTS };
      cur.hasImg = true;
      delete cur.img;
      window.dashStore.set(cardImgKey(id), dataUrl);
      saveCardBg(id, cur);
      const el = document.querySelector(`[data-card-id="${id}"]`);
      if (el) applyCardBg(el);
      ensureCardBgUI(id);
    });
  };
  input.click();
}

function setCardBgProp(id, prop, value) {
  const cur = getCardBg(id);
  if (!cur || !cardHasImg(id)) return;
  cur[prop] = +value;
  saveCardBg(id, cur);
  const el = document.querySelector(`[data-card-id="${id}"]`);
  if (el) applyCardBg(el);
  // update value label in popover live
  const pop = document.querySelector(`.card-bg-popover[data-card-id="${id}"]`);
  if (pop) {
    const lbl = pop.querySelector(`[data-prop-label="${prop}"]`);
    if (lbl) lbl.textContent = Math.round(cur[prop]) + (prop === 'zoom' ? '%' : '%');
  }
}

function resetCardBgPosition(id) {
  const cur = getCardBg(id);
  if (!cur || !cardHasImg(id)) return;
  cur.posX = 50; cur.posY = 50; cur.zoom = 100;
  saveCardBg(id, cur);
  const el = document.querySelector(`[data-card-id="${id}"]`);
  if (el) applyCardBg(el);
  ensureCardBgUI(id);
}

function clearCardBg(id) {
  window.dashStore.del(cardImgKey(id));
  saveCardBg(id, null);
  const el = document.querySelector(`[data-card-id="${id}"]`);
  if (el) applyCardBg(el);
  ensureCardBgUI(id);
  // also turn off reposition mode
  if (el) el.classList.remove('reposition-mode');
}

function toggleCardBgPopover(id) {
  $$('.card-bg-popover.open').forEach(p => { if (p.dataset.cardId !== id) p.classList.remove('open'); });
  $$('.card.reposition-mode, .header-card.reposition-mode').forEach(c => {
    if (c.dataset.cardId !== id) c.classList.remove('reposition-mode');
  });
  const pop = document.querySelector(`.card-bg-popover[data-card-id="${id}"]`);
  if (!pop) return;
  const willOpen = !pop.classList.contains('open');
  if (willOpen) {
    ensureCardBgUI(id);          // fill content first so we can measure it
    positionCardBgPopover(id);   // anchor to the button, flipping at edges
    pop.classList.add('open');
  } else {
    pop.classList.remove('open');
  }
  ensureCardBgUI(id);
}

/* Anchor the (body-mounted, fixed) popover just below its card's bg button,
   keeping it fully on-screen no matter how small the card is. */
function positionCardBgPopover(id) {
  const pop = document.querySelector(`.card-bg-popover[data-card-id="${id}"]`);
  const card = document.querySelector(`[data-card-id="${id}"]`);
  if (!pop || !card) return;
  const btn = card.querySelector(':scope > .card-bg-btn');
  const anchor = btn || card;
  const r = anchor.getBoundingClientRect();
  // Measure off-screen-safe: it's display:flex once .open, but we measure pre-open.
  const prevDisp = pop.style.display;
  pop.style.visibility = 'hidden';
  pop.style.display = 'flex';
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.display = prevDisp;
  pop.style.visibility = '';
  const M = 8;
  // Right-align the popover to the button, clamp into the viewport.
  let left = r.right - pw;
  if (left + pw > window.innerWidth - M) left = window.innerWidth - pw - M;
  if (left < M) left = M;
  // Below the button by default; flip above if it would overflow the bottom.
  let top = r.bottom + 6;
  if (top + ph > window.innerHeight - M) {
    const above = r.top - ph - 6;
    top = above >= M ? above : Math.max(M, window.innerHeight - ph - M);
  }
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

function toggleRepositionMode(id) {
  const el = document.querySelector(`[data-card-id="${id}"]`);
  if (!el) return;
  el.classList.toggle('reposition-mode');
  ensureCardBgUI(id);
}

function ensureCardBgUI(id) {
  const pop = document.querySelector(`.card-bg-popover[data-card-id="${id}"]`);
  if (!pop) return;
  const cur = getCardBg(id);
  const has = cardHasImg(id);
  const imgSrc = has ? getCardImg(id) : null;
  const cardEl = document.querySelector(`[data-card-id="${id}"]`);
  const reposActive = cardEl && cardEl.classList.contains('reposition-mode');
  const intensity = (cur && cur.intensity != null) ? cur.intensity : CARD_BG_DEFAULTS.intensity;
  const posX = (cur && cur.posX != null) ? cur.posX : CARD_BG_DEFAULTS.posX;
  const posY = (cur && cur.posY != null) ? cur.posY : CARD_BG_DEFAULTS.posY;
  const zoom = (cur && cur.zoom != null) ? cur.zoom : CARD_BG_DEFAULTS.zoom;

  const tab = currentTabFor(id);
  const tabLabel = tabLabelFor(id, tab);
  const tabChip = tab ? `<span class="card-bg-tab-chip">${esc(tabLabel)}</span>` : '';
  const tabHint = tab ? `<div class="card-bg-popover-hint">Each sub-tab keeps its own background — switch tabs above to set another.</div>` : '';

  pop.innerHTML = `
    <div class="card-bg-popover-title-row">
      <div class="card-bg-popover-title">Card background</div>
      ${tabChip}
    </div>
    ${tabHint}
    ${has ? `<div class="card-bg-preview" style="background-image:url('${imgSrc}')"></div>` : `<div class="card-bg-preview empty">no image</div>`}
    <button class="card-bg-action" onclick="window.dash.pickCardImage('${id}')">${has?'Replace':'Upload'} image</button>

    ${has ? `
      <button class="card-bg-action ${reposActive?'active':''}" onclick="window.dash.toggleRepositionMode('${id}')">
        ${reposActive ? '✓ Done repositioning' : 'Drag to reposition'}
      </button>

      <div class="card-bg-slider-wrap">
        <span class="card-bg-slider-label">Zoom</span>
        <input type="range" min="100" max="400" step="5" value="${zoom}" class="card-bg-slider"
               oninput="window.dash.setCardBgProp('${id}','zoom',this.value)"/>
        <span class="card-bg-slider-val" data-prop-label="zoom">${Math.round(zoom)}%</span>
      </div>

      <div class="card-bg-slider-wrap">
        <span class="card-bg-slider-label">Pos X</span>
        <input type="range" min="0" max="100" value="${posX}" class="card-bg-slider"
               oninput="window.dash.setCardBgProp('${id}','posX',this.value)"/>
        <span class="card-bg-slider-val" data-prop-label="posX">${Math.round(posX)}%</span>
      </div>

      <div class="card-bg-slider-wrap">
        <span class="card-bg-slider-label">Pos Y</span>
        <input type="range" min="0" max="100" value="${posY}" class="card-bg-slider"
               oninput="window.dash.setCardBgProp('${id}','posY',this.value)"/>
        <span class="card-bg-slider-val" data-prop-label="posY">${Math.round(posY)}%</span>
      </div>

      <div class="card-bg-slider-wrap">
        <span class="card-bg-slider-label">Strength</span>
        <input type="range" min="10" max="100" value="${intensity}" class="card-bg-slider"
               oninput="window.dash.setCardBgProp('${id}','intensity',this.value)"/>
        <span class="card-bg-slider-val" data-prop-label="intensity">${Math.round(intensity)}%</span>
      </div>

      <div class="card-bg-actions-row">
        <button class="card-bg-action small" onclick="window.dash.resetCardBgPosition('${id}')">Reset position</button>
        <button class="card-bg-action small danger" onclick="window.dash.clearCardBg('${id}')">Remove</button>
      </div>
    ` : ''}
  `;
  // If it's currently open, content height may have changed (image added/
  // removed) — re-anchor so it stays on-screen.
  if (pop.classList.contains('open')) positionCardBgPopover(id);
}

function injectCardBgButtons() {
  // Keep any open popover anchored to its button as the page scrolls/resizes.
  if (!window.__cardBgReanchorBound) {
    window.__cardBgReanchorBound = true;
    const reanchor = () => {
      const open = document.querySelector('.card-bg-popover.open');
      if (open) positionCardBgPopover(open.dataset.cardId);
    };
    window.addEventListener('scroll', reanchor, true);
    window.addEventListener('resize', reanchor);
  }
  $$('[data-card-id]').forEach(el => {
    if (el.querySelector(':scope > .card-bg-btn')) return;
    const id = el.dataset.cardId;
    const btn = document.createElement('button');
    btn.className = 'card-bg-btn';
    btn.title = 'Customize background';
    btn.innerHTML = ICONS.image;
    btn.onclick = e => { e.stopPropagation(); toggleCardBgPopover(id); };
    el.appendChild(btn);

    const pop = document.createElement('div');
    pop.className = 'card-bg-popover';
    pop.dataset.cardId = id;
    pop.onclick = e => e.stopPropagation();
    // Mounted on <body>, not the card: a small card with overflow:hidden (and
    // the lingering fade-in transform) would otherwise clip the popover. It's
    // anchored to the button via fixed-position math in toggleCardBgPopover().
    document.body.appendChild(pop);
    ensureCardBgUI(id);

    // Drag-to-reposition: when the card has .reposition-mode, mouse-drag on
    // the bg layer adjusts posX/posY.
    let dragging = false, startX = 0, startY = 0, startPosX = 0, startPosY = 0, rect = null;
    el.addEventListener('mousedown', e => {
      if (!el.classList.contains('reposition-mode')) return;
      if (e.target.closest('.card-bg-popover') || e.target.closest('.card-bg-btn')) return;
      const cfg = getCardBg(id);
      if (!cfg || !cardHasImg(id)) return;
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      startPosX = cfg.posX ?? 50;
      startPosY = cfg.posY ?? 50;
      rect = el.getBoundingClientRect();
      el.classList.add('repositioning');
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging || !rect) return;
      // Dragging right moves image right → object-position decreases.
      const dx = (e.clientX - startX) / rect.width  * 100;
      const dy = (e.clientY - startY) / rect.height * 100;
      const newX = Math.max(0, Math.min(100, startPosX - dx));
      const newY = Math.max(0, Math.min(100, startPosY - dy));
      const cur = getCardBg(id) || { ...CARD_BG_DEFAULTS };
      cur.posX = newX; cur.posY = newY;
      saveCardBg(id, cur);
      applyCardBg(el);
    });
    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        el.classList.remove('repositioning');
        ensureCardBgUI(id); // refresh slider values
      }
    });
  });
}

// ─── APPLE HEALTH ─────────────────────────────────────────────
function getHealth() { return load('health', { sleep:null, steps:null, energy:null, heart:null }); }
function saveHealth(h) { save('health', h); }
function getHealthHistory() { return load('healthHistory', {}); }
function saveHealthHistory(h) { save('healthHistory', h); }

function renderHealth() {
  const h = getHealth();
  const tiles = [
    { key:'sleep',  name:'Sleep',  unit:'h',    icon:'moon',     val: h.sleep },
    { key:'steps',  name:'Steps',  unit:'',     icon:'activity', val: h.steps },
    { key:'energy', name:'Energy', unit:'kcal', icon:'flame',    val: h.energy },
    { key:'heart',  name:'Resting',unit:'bpm',  icon:'heart',    val: h.heart },
  ];
  const hist = getHealthHistory();
  const dates = getLast7Dates();

  $('healthGrid').innerHTML = tiles.map(t => {
    const sparks = dates.map(d => {
      const day = hist[d] || {};
      return day[t.key] != null ? +day[t.key] : 0;
    });
    const max = Math.max(...sparks, 1);
    const spark = sparks.map(v => {
      const pct = v ? Math.max(8, (v/max)*100) : 0;
      return `<span class="${v ? 'f' : ''}" style="height:${pct}%"></span>`;
    }).join('');
    const fmt = t.val == null
      ? `<div class="health-val empty">—</div>`
      : `<div class="health-val">${t.key === 'steps' ? Math.round(t.val).toLocaleString() : (Math.round(t.val * 10) / 10)}<span class="u">${t.unit}</span></div>`;
    return `<div class="health-tile ${t.key}">
      <div class="health-tile-head">${ICONS[t.icon]} <span>${t.name}</span></div>
      ${fmt}
      <div class="health-spark">${spark}</div>
    </div>`;
  }).join('');

  // Status
  const last = load('healthLastSync', null);
  const statusEl = $('healthStatus');
  if (last) {
    const mins = Math.floor((Date.now() - last) / 60000);
    statusEl.textContent = mins < 1 ? 'Just synced' : mins < 60 ? `${mins}m ago` : `${Math.floor(mins/60)}h ago`;
    statusEl.classList.add('synced');
  } else {
    statusEl.textContent = 'Not synced';
    statusEl.classList.remove('synced');
  }
}

function getLast7Dates() {
  const arr = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i);
    arr.push(d.toISOString().slice(0,10));
  }
  return arr;
}

function openHealthModal() { $('healthModal').classList.add('open'); setTimeout(()=>$('healthJson').focus(), 100); }
function closeHealthModal() { $('healthModal').classList.remove('open'); }

function toggleHealth() {
  const card = $('healthCard'); if (!card) return;
  const collapsed = card.classList.toggle('collapsed');
  save('healthCollapsed', collapsed);
  const btn = $('healthToggle');
  if (btn) btn.setAttribute('aria-expanded', String(!collapsed));
}

function applyHealthCollapsed() {
  const card = $('healthCard'); if (!card) return;
  const collapsed = load('healthCollapsed', false);
  card.classList.toggle('collapsed', !!collapsed);
  const btn = $('healthToggle');
  if (btn) btn.setAttribute('aria-expanded', String(!collapsed));
}

function syncHealth() {
  const raw = $('healthJson').value.trim();
  if (!raw) return;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { alert('Invalid JSON. Make sure it looks like {"sleep":7.5,"steps":8431,"energy":420,"heart":64}'); return; }

  const h = getHealth();
  ['sleep','steps','energy','heart'].forEach(k => {
    if (parsed[k] != null) h[k] = +parsed[k];
  });
  saveHealth(h);

  const hist = getHealthHistory();
  const today = todayStr();
  hist[today] = { ...(hist[today]||{}), ...Object.fromEntries(['sleep','steps','energy','heart'].filter(k => parsed[k] != null).map(k => [k, +parsed[k]])) };
  saveHealthHistory(hist);

  save('healthLastSync', Date.now());
  $('healthJson').value = '';
  closeHealthModal();
  renderHealth();
}

function openManualHealth() {
  closeHealthModal();
  const h = getHealth();
  $('hm_sleep').value  = h.sleep  != null ? h.sleep  : '';
  $('hm_steps').value  = h.steps  != null ? h.steps  : '';
  $('hm_energy').value = h.energy != null ? h.energy : '';
  $('hm_heart').value  = h.heart  != null ? h.heart  : '';
  $('healthManualModal').classList.add('open');
}
function closeManualHealth() { $('healthManualModal').classList.remove('open'); }

function saveManualHealth() {
  const h = getHealth();
  const fields = { sleep: $('hm_sleep').value, steps: $('hm_steps').value, energy: $('hm_energy').value, heart: $('hm_heart').value };
  const hist = getHealthHistory();
  const today = todayStr();
  hist[today] = hist[today] || {};
  Object.entries(fields).forEach(([k,v]) => {
    if (v !== '') {
      const num = +v;
      h[k] = num;
      hist[today][k] = num;
    }
  });
  saveHealth(h);
  saveHealthHistory(hist);
  save('healthLastSync', Date.now());
  closeManualHealth();
  renderHealth();
}

// ─── PEOPLE CHECK-INS ─────────────────────────────────────────
function getPeople() { return load('people', []); }
function savePeople(p) { save('people', p); }

function renderPeople() {
  const list = $('peopleList');
  const people = getPeople();
  if (!people.length) { list.innerHTML = `<div class="empty">Add people you want to keep up with.</div>`; return; }
  list.innerHTML = '';
  [...people]
    .sort((a,b) => (a.lastCheckin || 0) - (b.lastCheckin || 0))
    .forEach(p => {
      const days = p.lastCheckin ? Math.floor((Date.now() - p.lastCheckin) / 86400000) : null;
      let cls = 'fresh', label;
      if (days == null)     { cls='never'; label='Check in!'; }
      else if (days === 0)  { cls='fresh'; label='Today'; }
      else if (days <= 7)   { cls='fresh'; label=`${days}d ago`; }
      else if (days <= 30)  { cls='stale'; label=`${days}d ago`; }
      else                  { cls='cold';  label=`${Math.round(days/30)}mo ago`; }

      const initial = (p.name || '?').trim().split(/\s+/).map(s=>s[0]).join('').slice(0,2).toUpperCase();
      const div = document.createElement('div');
      div.className = 'person-item';
      div.innerHTML = `
        <div class="person-avatar">${initial}</div>
        <span class="person-name">${esc(p.name)}</span>
        <span class="person-since ${cls}">${label}</span>
        <button class="checkin-btn" onclick="window.dash.checkin('${p.id}')" title="Mark as seen">${ICONS.check}</button>
        <button class="del-btn" onclick="window.dash.delPerson('${p.id}')">×</button>`;
      list.appendChild(div);
    });
}

function addPerson() {
  const name = $('personName').value.trim();
  if (!name) return;
  const people = getPeople();
  people.push({ id: uid(), name, lastCheckin: null });
  savePeople(people);
  $('personName').value = '';
  renderPeople();
}

function checkin(id) {
  const people = getPeople();
  const p = people.find(x => x.id === id);
  if (p) p.lastCheckin = Date.now();
  savePeople(people);
  renderPeople();
}

function delPerson(id) {
  savePeople(getPeople().filter(p => p.id !== id));
  renderPeople();
}

// ─── EXPORT ───────────────────────────────────────────────────
window.dash = {
  initHeader, initWeather,
  renderQlinks, deleteQlink, editQlinkIcon, openQlinkModal, closeQlinkModal, submitQlink, toggleMobileLinks,
  pickSideRailBg, clearSideRailBg, applySideRailBg, openLink,
  renderHabits, toggleHabitEdit, addHabit, deleteHabit, toggleIconPicker, selectIcon, updateHabitLabel, uploadHabitIcon,
  renderPlanner, renderPlannerTabs, renderTaskClassSelect, addTask, toggleTask, delTask, switchTab,
  openStatusMenu, closeStatusMenu, setTaskStatus,
  openClassesModal, closeClassesModal, addClass, updateClass, deleteClass,
  renderAgenda, switchAgendaView, calNavMonth, quickAddAgendaEvent, delAgendaEvent,
  jumpToWeek,
  renderDates, addDate, delDate,
  renderLife, addLife, toggleLife, updateLife, delLife, clearDoneLife,
  renderGoals, switchGoalScope, addGoal, delGoal, cycleGoal,
  renderCurrently, renderCurrentlyTabs, switchCurKind, curPrev, curNext, curGoTo, curAdd, updateCur, cycleCurProgress, finishCur, pickCurImage,
  renderHealth, openHealthModal, closeHealthModal, syncHealth, openManualHealth, closeManualHealth, saveManualHealth, toggleHealth,
  renderPeople, addPerson, checkin, delPerson,
  pickCardImage, setCardBgProp, clearCardBg, toggleCardBgPopover, toggleRepositionMode, resetCardBgPosition, applyAllCardBgs, applyCardBg,
  // streaks / schedule / tomorrow
  renderClassSchedule, addScheduleBlock, delScheduleBlock, updateScheduleBlock,
  renderTomorrow, openTomorrow, closeTomorrow, addTomorrowTask, addTomorrowEvent, copyHabitsToTomorrow,
  habitStreak,
};

// ─── BOOT ─────────────────────────────────────────────────────
window.dash.boot = function () {
  initHeader();
  initWeather();
  renderQlinks();
  applySideRailBg();
  renderHabits();
  renderPlannerTabs();
  renderTaskClassSelect();
  renderPlanner();
  renderLife();
  renderCurrentlyTabs();
  renderAgenda();
  renderDates();
  renderGoals();
  renderCurrently();
  renderHealth();
  applyHealthCollapsed();
  renderPeople();
  injectCardBgButtons();
  applyAllCardBgs();
  initTabCarousel();

  const msToMidnight = (() => { const n=new Date(), m=new Date(n); m.setHours(24,0,0,0); return m-n; })();
  setTimeout(() => { initHeader(); renderHabits(); renderAgenda(); renderDates(); renderHealth(); }, msToMidnight + 1000);
};

})();
