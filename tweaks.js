/* ═══════════════════════════════════════════════════════════════
   TWEAKS PANEL — theme + fonts + modules + backgrounds (v3)
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';
const $ = window.dashUtil.$;
const compressImage = window.dashImg ? window.dashImg.compressImage : null;

const DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "amber",
  "fontPreset": "modern",
  "showQuicklinks": true,
  "showDaystrip": true,
  "showLife": true,
  "showCurrently": true,
  "showGoals": true,
  "showHealth": true,
  "showPeople": true,
  "density": "comfy",
  "name": "Delan",
  "pageBgOverlay": 55,
  "pageBgZoom": 100,
  "pageBgPosX": 50,
  "pageBgPosY": 50,
  "headerBgIntensity": 70,
  "railBgIntensity": 55,
  "railBgOverlay": 35,
  "railBgZoom": 100,
  "railBgPosX": 50,
  "railBgPosY": 50,
  "panelOpacity": 86
}/*EDITMODE-END*/;

let state = { ...DEFAULTS, ...(window.dashUtil.load('tweaksState', {})) };
let pageBg = null; // loaded from the image store once it's ready (see window load handler)

let panelOpen = false;

// ─── FONT PRESETS ────────────────────────────────────────────
// Each preset overrides --font-d (display), --font-b (body), --font-s (serif accents)
const FONT_PRESETS = {
  modern: {
    name: 'Modern',
    note: 'Bricolage + Inter (default)',
    d: `'Bricolage Grotesque', -apple-system, sans-serif`,
    b: `'Inter', -apple-system, sans-serif`,
    s: `'Instrument Serif', Georgia, serif`,
    google: 'Bricolage+Grotesque:opsz,wght@12..96,300;12..96,400;12..96,700;12..96,800&family=Inter:wght@300;400;500;600;700&family=Instrument+Serif:ital@0;1',
  },
  editorial: {
    name: 'Editorial',
    note: 'Playfair + Source Serif',
    d: `'Playfair Display', Georgia, serif`,
    b: `'Source Serif Pro', 'Source Serif 4', Georgia, serif`,
    s: `'Playfair Display', Georgia, serif`,
    google: 'Playfair+Display:ital,wght@0,500;0,700;0,800;1,500&family=Source+Serif+Pro:ital,wght@0,300;0,400;0,600;1,400',
  },
  georgia: {
    name: 'Georgia',
    note: 'Classic on-device serif',
    d: `Georgia, 'Times New Roman', serif`,
    b: `Georgia, 'Times New Roman', serif`,
    s: `Georgia, 'Times New Roman', serif`,
    google: '',
  },
  times: {
    name: 'Times',
    note: 'Times New Roman everywhere',
    d: `'Times New Roman', Times, serif`,
    b: `'Times New Roman', Times, serif`,
    s: `'Times New Roman', Times, serif`,
    google: '',
  },
  garamond: {
    name: 'Garamond',
    note: 'EB Garamond — bookish & warm',
    d: `'EB Garamond', Garamond, Georgia, serif`,
    b: `'EB Garamond', Garamond, Georgia, serif`,
    s: `'EB Garamond', Garamond, Georgia, serif`,
    google: 'EB+Garamond:ital,wght@0,400;0,500;0,700;1,400',
  },
  mono: {
    name: 'Mono',
    note: 'IBM Plex Mono — terminal vibes',
    d: `'IBM Plex Mono', ui-monospace, monospace`,
    b: `'IBM Plex Mono', ui-monospace, monospace`,
    s: `'IBM Plex Mono', ui-monospace, monospace`,
    google: 'IBM+Plex+Mono:ital,wght@0,300;0,400;0,500;0,600;1,400',
  },
  sans: {
    name: 'Clean Sans',
    note: 'System sans only — fast & crisp',
    d: `-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif`,
    b: `-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif`,
    s: `Georgia, 'Times New Roman', serif`,
    google: '',
  },
};

const loadedFontKeys = new Set(['modern']);
function ensureFontLoaded(presetKey) {
  if (loadedFontKeys.has(presetKey)) return;
  const preset = FONT_PRESETS[presetKey];
  if (!preset || !preset.google) { loadedFontKeys.add(presetKey); return; }
  const linkId = 'tweak-font-' + presetKey;
  if (document.getElementById(linkId)) { loadedFontKeys.add(presetKey); return; }
  const link = document.createElement('link');
  link.id = linkId;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${preset.google}&display=swap`;
  document.head.appendChild(link);
  loadedFontKeys.add(presetKey);
}

function applyFontPreset() {
  const key = FONT_PRESETS[state.fontPreset] ? state.fontPreset : 'modern';
  ensureFontLoaded(key);
  const p = FONT_PRESETS[key];
  document.documentElement.style.setProperty('--font-d', p.d);
  document.documentElement.style.setProperty('--font-b', p.b);
  document.documentElement.style.setProperty('--font-s', p.s);
  document.documentElement.setAttribute('data-font', key);
}

function applyState() {
  document.documentElement.setAttribute('data-theme', state.theme);
  applyFontPreset();
  toggleSection('quicklinks', state.showQuicklinks);
  document.body.classList.toggle('no-rail', !state.showQuicklinks);
  const fab = $('qlinksFab');
  if (fab) fab.style.display = state.showQuicklinks ? '' : 'none';
  toggleSection('daystrip', state.showDaystrip);
  toggleSection('life', state.showLife);
  toggleSection('currently', state.showCurrently);
  toggleSection('goals', state.showGoals);
  toggleSection('health', state.showHealth);
  toggleSection('people', state.showPeople);

  if (state.density === 'compact') {
    document.documentElement.style.setProperty('--r', '10px');
    document.body.style.fontSize = '13px';
  } else {
    document.documentElement.style.removeProperty('--r');
    document.body.style.fontSize = '14px';
  }

  if (window.dash && window.dash.initHeader) window.dash.initHeader();
  if (window.dash && window.dash.renderQlinks) window.dash.renderQlinks();

  applyBackgrounds();
}

function applyBackgrounds() {
  const body = document.body;
  // Frosted widget-panel opacity (used by tiles & the Tomorrow tee-up over a
  // card photo). Lower = more of the photo shows through the panels.
  document.documentElement.style.setProperty('--panel-opacity', (state.panelOpacity ?? 86) + '%');
  if (pageBg) {
    // Use a blob: object URL — a multi-MB data URL in a CSS var is silently
    // dropped by the browser (the bug big photos hit). See dashImg.cssUrl.
    const bgUrl = (window.dashImg && window.dashImg.cssUrl) ? window.dashImg.cssUrl('pageBg', pageBg) : pageBg;
    body.style.setProperty('--user-bg', `url("${bgUrl}")`);
    body.style.setProperty('--bg-overlay', (1 - (state.pageBgOverlay / 100)).toFixed(2));
    body.style.setProperty('--bg-zoom', ((state.pageBgZoom ?? 100) / 100).toFixed(3));
    body.style.setProperty('--bg-pos-x', (state.pageBgPosX ?? 50) + '%');
    body.style.setProperty('--bg-pos-y', (state.pageBgPosY ?? 50) + '%');
    body.setAttribute('data-has-bg', '1');
  } else {
    if (window.dashImg && window.dashImg.cssUrl) window.dashImg.cssUrl('pageBg', null);
    body.style.removeProperty('--user-bg');
    body.style.removeProperty('--bg-overlay');
    body.style.removeProperty('--bg-zoom');
    body.style.removeProperty('--bg-pos-x');
    body.style.removeProperty('--bg-pos-y');
    body.removeAttribute('data-has-bg');
  }

  // Side rail background image — mirror the page-bg controls (overlay, zoom, position)
  const rail = $('sideRail');
  if (rail) {
    rail.style.setProperty('--rail-bg-overlay', (1 - ((state.railBgOverlay ?? 35) / 100)).toFixed(2));
    rail.style.setProperty('--rail-bg-zoom', ((state.railBgZoom ?? 100) / 100).toFixed(3));
    rail.style.setProperty('--rail-bg-pos-x', (state.railBgPosX ?? 50) + '%');
    rail.style.setProperty('--rail-bg-pos-y', (state.railBgPosY ?? 50) + '%');
  }
}

function toggleSection(id, show) {
  document.querySelectorAll(`[data-section="${id}"]`).forEach(el => {
    el.style.display = show ? '' : 'none';
  });
}

function persist() {
  window.dashUtil.save('tweaksState', state);
  applyState();
  renderPanel();
}

function setKey(key, value) {
  state[key] = value;
  persist();
  try {
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [key]: value } }, '*');
  } catch (e) {}
}

// Lightweight live update for sliders — applies visual change & persists,
// but skips the full panel re-render so the slider thumb keeps tracking.
// Also updates the value label next to the slider.
function setLive(key, value) {
  state[key] = value;
  window.dashUtil.save('tweaksState', state);
  applyBackgrounds();
  // Update the inline value label, if present.
  const panel = $('tweaksPanel');
  if (!panel) return;
  const labels = panel.querySelectorAll('.tweak-row');
  labels.forEach(row => {
    const next = row.nextElementSibling;
    if (next && next.tagName === 'INPUT' && next.getAttribute('oninput')?.includes(`'${key}'`)) {
      const valEl = row.querySelector('.tweak-slider-value');
      if (valEl) valEl.textContent = value + '%';
    }
  });
}

function uploadPageBg() {
  if (!compressImage) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.heic,.heif,.avif';
  input.onchange = e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    // Generous size so the background stays sharp at full-bleed
    // — and even sharper when the user zooms in via the resize controls.
    compressImage(file, 6000, dataUrl => {
      pageBg = dataUrl;
      window.dashStore.set('pageBg', dataUrl);
      applyBackgrounds();
      renderPanel();
    });
  };
  input.click();
}

function uploadHeaderBg() { /* deprecated — use per-card system */ }
function clearHeaderBg()  { /* deprecated — use per-card system */ }

function clearPageBg() {
  pageBg = null;
  window.dashStore.del('pageBg');
  applyBackgrounds();
  renderPanel();
}

function resetPageBgPosition() {
  state.pageBgZoom = 100;
  state.pageBgPosX = 50;
  state.pageBgPosY = 50;
  persist();
}

function clearHeaderBg2() { /* removed */ }

function uploadRailBg() {
  // Re-render the panel once the new image is saved so the preview updates.
  if (window.dash && window.dash.pickSideRailBg) window.dash.pickSideRailBg(() => { applyBackgrounds(); renderPanel(); });
}
function clearRailBg() {
  if (window.dash && window.dash.clearSideRailBg) window.dash.clearSideRailBg();
  renderPanel();
}
function resetRailBgPosition() {
  state.railBgZoom = 100;
  state.railBgPosX = 50;
  state.railBgPosY = 50;
  persist();
}

function renderPanel() {
  const panel = $('tweaksPanel');
  if (!panel) return;

  const themes = [
    { id:'amber', name:'Warm Amber',   colors:['#0d0b09','#1e1a15','#d4a252','#7caa6a'] },
    { id:'paper', name:'Paper Journal',colors:['#efe7d6','#faf3e3','#b8501e','#4f7a3a'] },
    { id:'dusk',  name:'Dusk Sage',    colors:['#0d1411','#1d2722','#94c08e','#6cb8b0'] },
  ];

  const railBg = window.dashStore.getCached('sideRailBg');
  // Blob URLs for the preview thumbnails — a 9 MB data URL inlined into
  // background-image fails the same way the live background did.
  const _cu = (window.dashImg && window.dashImg.cssUrl) ? window.dashImg.cssUrl : (k, v) => v;
  const pageBgUrl = pageBg ? _cu('pageBg', pageBg) : '';
  const railBgUrl = railBg ? _cu('sideRailBg', railBg) : '';

  panel.innerHTML = `
    <div class="tweaks-head" id="tweaksHead">
      <div class="tweaks-title">Tweaks</div>
      <button class="modal-close" onclick="window.tweaks.close()">${window.ICONS.x}</button>
    </div>
    <div class="tweaks-body">

      <div class="tweak-section">
        <div class="tweak-section-title">Theme</div>
        <div class="theme-grid">
          ${themes.map(t => `
            <button class="theme-swatch ${state.theme === t.id ? 'active' : ''}" onclick="window.tweaks.set('theme','${t.id}')">
              <div class="theme-swatch-preview">${t.colors.map(c=>`<span style="background:${c}"></span>`).join('')}</div>
              <div class="theme-swatch-name">${t.name}</div>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="tweak-section">
        <div class="tweak-section-title">Typeface</div>
        <div class="font-grid">
          ${Object.entries(FONT_PRESETS).map(([key, p]) => `
            <button class="font-swatch ${state.fontPreset === key ? 'active' : ''}" onclick="window.tweaks.set('fontPreset','${key}')" style="font-family:${p.b}">
              <div class="font-swatch-sample">Aa</div>
              <div class="font-swatch-info">
                <div class="font-swatch-name">${p.name}</div>
                <div class="font-swatch-note">${p.note}</div>
              </div>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="tweak-section">
        <div class="tweak-section-title">Page Background</div>
        <div class="tweak-bg-preview ${pageBg?'has-image':''}" style="${pageBg?`background-image:url('${pageBgUrl}')`:''}">
          ${!pageBg ? 'No image' : ''}
          <button class="clear" onclick="window.tweaks.clearPageBg()" title="Remove">×</button>
        </div>
        <div class="tweak-bg-row">
          <button class="tweak-upload-btn" onclick="window.tweaks.uploadPageBg()">${pageBg?'Replace':'Upload'} image</button>
        </div>
        ${pageBg ? `
          <div style="margin-top:0.5rem">
            <div class="tweak-row"><span class="tweak-label">Overlay opacity</span><span class="tweak-slider-value">${state.pageBgOverlay}%</span></div>
            <input class="tweak-slider" type="range" min="0" max="95" value="${state.pageBgOverlay}"
                   oninput="window.tweaks.setLive('pageBgOverlay',+this.value)"
                   onchange="window.tweaks.set('pageBgOverlay',+this.value)"/>
            <div class="tweak-row" style="margin-top:0.55rem"><span class="tweak-label">Zoom</span><span class="tweak-slider-value">${state.pageBgZoom ?? 100}%</span></div>
            <input class="tweak-slider" type="range" min="100" max="400" step="5" value="${state.pageBgZoom ?? 100}"
                   oninput="window.tweaks.setLive('pageBgZoom',+this.value)"
                   onchange="window.tweaks.set('pageBgZoom',+this.value)"/>
            <div class="tweak-row" style="margin-top:0.55rem"><span class="tweak-label">Position X</span><span class="tweak-slider-value">${state.pageBgPosX ?? 50}%</span></div>
            <input class="tweak-slider" type="range" min="0" max="100" value="${state.pageBgPosX ?? 50}"
                   oninput="window.tweaks.setLive('pageBgPosX',+this.value)"
                   onchange="window.tweaks.set('pageBgPosX',+this.value)"/>
            <div class="tweak-row" style="margin-top:0.55rem"><span class="tweak-label">Position Y</span><span class="tweak-slider-value">${state.pageBgPosY ?? 50}%</span></div>
            <input class="tweak-slider" type="range" min="0" max="100" value="${state.pageBgPosY ?? 50}"
                   oninput="window.tweaks.setLive('pageBgPosY',+this.value)"
                   onchange="window.tweaks.set('pageBgPosY',+this.value)"/>
            <button class="tweak-upload-btn" style="margin-top:0.55rem" onclick="window.tweaks.resetPageBgPosition()">Reset zoom & position</button>
          </div>
        ` : ''}
        <div class="tweak-note">Tip: every card has its own image button (top-right) so you can customize backgrounds per module.</div>
        <div class="tweak-row" style="margin-top:0.6rem"><span class="tweak-label">Panel opacity</span><span class="tweak-slider-value">${state.panelOpacity ?? 86}%</span></div>
        <input class="tweak-slider" type="range" min="40" max="100" value="${state.panelOpacity ?? 86}"
               oninput="window.tweaks.setLive('panelOpacity',+this.value)"
               onchange="window.tweaks.set('panelOpacity',+this.value)"/>
        <div class="tweak-note">How see-through the widget panels are when a card has a background photo (e.g. the Tomorrow tee-up).</div>
      </div>

      <div class="tweak-section">
        <div class="tweak-section-title">Side Rail Background</div>
        <div class="tweak-bg-preview ${railBg?'has-image':''}" style="${railBg?`background-image:url('${railBgUrl}')`:''}">
          ${!railBg ? 'No image' : ''}
          <button class="clear" onclick="window.tweaks.clearRailBg()" title="Remove">×</button>
        </div>
        <div class="tweak-bg-row">
          <button class="tweak-upload-btn" onclick="window.tweaks.uploadRailBg()">${railBg?'Replace':'Upload'} image</button>
        </div>
        ${railBg ? `
          <div style="margin-top:0.5rem">
            <div class="tweak-row"><span class="tweak-label">Overlay opacity</span><span class="tweak-slider-value">${state.railBgOverlay ?? 35}%</span></div>
            <input class="tweak-slider" type="range" min="0" max="95" value="${state.railBgOverlay ?? 35}"
                   oninput="window.tweaks.setLive('railBgOverlay',+this.value)"
                   onchange="window.tweaks.set('railBgOverlay',+this.value)"/>
            <div class="tweak-row" style="margin-top:0.55rem"><span class="tweak-label">Zoom</span><span class="tweak-slider-value">${state.railBgZoom ?? 100}%</span></div>
            <input class="tweak-slider" type="range" min="100" max="400" step="5" value="${state.railBgZoom ?? 100}"
                   oninput="window.tweaks.setLive('railBgZoom',+this.value)"
                   onchange="window.tweaks.set('railBgZoom',+this.value)"/>
            <div class="tweak-row" style="margin-top:0.55rem"><span class="tweak-label">Position X</span><span class="tweak-slider-value">${state.railBgPosX ?? 50}%</span></div>
            <input class="tweak-slider" type="range" min="0" max="100" value="${state.railBgPosX ?? 50}"
                   oninput="window.tweaks.setLive('railBgPosX',+this.value)"
                   onchange="window.tweaks.set('railBgPosX',+this.value)"/>
            <div class="tweak-row" style="margin-top:0.55rem"><span class="tweak-label">Position Y</span><span class="tweak-slider-value">${state.railBgPosY ?? 50}%</span></div>
            <input class="tweak-slider" type="range" min="0" max="100" value="${state.railBgPosY ?? 50}"
                   oninput="window.tweaks.setLive('railBgPosY',+this.value)"
                   onchange="window.tweaks.set('railBgPosY',+this.value)"/>
            <button class="tweak-upload-btn" style="margin-top:0.55rem" onclick="window.tweaks.resetRailBgPosition()">Reset zoom &amp; position</button>
          </div>
        ` : ''}
      </div>

      <div class="tweak-section">
        <div class="tweak-section-title">Stickers</div>
        <div class="tweak-note" style="margin-top:0">PNG cutouts you can pin to widget corners or float over the background. Drag them into place in arrange mode. Stored on this device only.</div>
        <div class="tweak-bg-row" style="display:flex;gap:0.4rem;margin-top:0.5rem">
          <button class="tweak-upload-btn" onclick="window.stickers.add()">+ Add sticker</button>
          ${(window.stickers && window.stickers.list().length) ? `
            <button class="tweak-upload-btn ${window.stickers.isArranging() ? 'active' : ''}" onclick="window.stickers.toggleArrange()">
              ${window.stickers.isArranging() ? '✓ Done arranging' : 'Arrange stickers'}
            </button>` : ''}
        </div>
        ${window.stickers ? window.stickers.list().map(st => {
          const img = window.stickers.imgFor(st.id);
          return `
          <div class="sticker-row">
            <div class="sticker-thumb" style="${img ? `background-image:url('${img}')` : ''}"></div>
            <div class="sticker-controls">
              <div class="sticker-ctl"><label>Size</label>
                <input type="range" min="40" max="420" step="5" value="${st.size ?? 140}" class="tweak-slider"
                       oninput="window.stickers.set('${st.id}','size',this.value)"/></div>
              <div class="sticker-ctl"><label>Opacity</label>
                <input type="range" min="10" max="100" value="${st.opacity ?? 100}" class="tweak-slider"
                       oninput="window.stickers.set('${st.id}','opacity',this.value)"/></div>
              <div class="sticker-ctl"><label>Tilt</label>
                <input type="range" min="-180" max="180" value="${st.rot ?? 0}" class="tweak-slider"
                       oninput="window.stickers.set('${st.id}','rot',this.value)"/></div>
              <div class="sticker-layer-toggle">
                <button class="${(st.layer||'above')==='above'?'active':''}" onclick="window.stickers.set('${st.id}','layer','above')">Over widgets</button>
                <button class="${st.layer==='behind'?'active':''}" onclick="window.stickers.set('${st.id}','layer','behind')">Behind widgets</button>
              </div>
            </div>
            <button class="sticker-del" title="Delete sticker" onclick="window.stickers.del('${st.id}')">×</button>
          </div>`;
        }).join('') : ''}
      </div>

      <div class="tweak-section">
        <div class="tweak-section-title">Density</div>
        <div class="tweak-row">
          <span class="tweak-label">Spacing</span>
          <div class="tweak-radio-row">
            <button class="tweak-radio ${state.density==='comfy'?'active':''}" onclick="window.tweaks.set('density','comfy')">Comfy</button>
            <button class="tweak-radio ${state.density==='compact'?'active':''}" onclick="window.tweaks.set('density','compact')">Compact</button>
          </div>
        </div>
      </div>

      <div class="tweak-section">
        <div class="tweak-section-title">Modules</div>
        ${[
          ['showQuicklinks','Side rail (Quick Links)'],
          ['showDaystrip','7-day strip (Week Ahead)'],
          ['showLife','Life Checklist'],
          ['showCurrently','Currently Reading/Watching/Playing'],
          ['showGoals','Goals'],
          ['showHealth','Apple Health'],
          ['showPeople','People I love'],
        ].map(([key,label]) => `
          <div class="tweak-row">
            <span class="tweak-label">${label}</span>
            <button class="tweak-toggle ${state[key]?'on':''}" onclick="window.tweaks.set('${key}',${!state[key]})"></button>
          </div>
        `).join('')}
      </div>

      ${window.notify ? window.notify.sectionHTML() : ''}

      <div class="tweak-section">
        <div class="tweak-section-title">Personal</div>
        <div class="tweak-row">
          <span class="tweak-label">Name</span>
          <input class="t-input" style="max-width:140px;font-size:0.75rem;padding:0.3rem 0.5rem" value="${state.name||''}"
                 onchange="window.tweaks.set('name',this.value)"/>
        </div>
      </div>

      <div class="tweak-section">
        <button class="btn-ghost" style="width:100%" onclick="window.tweaks.resetData()">Reset all data…</button>
      </div>
    </div>
  `;
  makeDraggable($('tweaksHead'), panel);
}

function makeDraggable(handle, target) {
  if (!handle) return;
  let startX=0, startY=0, origLeft=0, origTop=0, dragging=false;
  handle.addEventListener('mousedown', e => {
    if (e.target.closest('button')) return;
    dragging = true;
    const r = target.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    origLeft = r.left; origTop = r.top;
    target.style.right = 'auto'; target.style.bottom = 'auto';
    target.style.left = origLeft + 'px'; target.style.top = origTop + 'px';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    target.style.left = Math.max(0, origLeft + e.clientX - startX) + 'px';
    target.style.top = Math.max(0, origTop + e.clientY - startY) + 'px';
  });
  document.addEventListener('mouseup', () => {
    dragging = false;
    document.body.style.userSelect = '';
  });
}

function open() {
  panelOpen = true;
  $('tweaksPanel').classList.add('open');
  $('tweakFab').classList.add('hidden');
  renderPanel();
}

function close() {
  panelOpen = false;
  $('tweaksPanel').classList.remove('open');
  $('tweakFab').classList.remove('hidden');
  try { window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*'); } catch(e){}
}

function resetData() {
  if (!confirm('This will erase ALL dashboard data (habits, tasks, classes, dates, currently, health, people, backgrounds, etc.). Continue?')) return;
  const keys = ['habitsConfig','habitHistory','plannerTasks','schoolClasses','importantDates','agendaEvents','health','healthHistory','healthLastSync','healthCollapsed','goals','currently','currentlyArchive','lifeItems','shoppingItems','people','qlinks','tweaksState','weatherCache','pageBg','headerBg','sideRailBg','customIcons','pomoState','clockFormat24','stickers','notifySettings','notifyDeviceId','dashboard.blocks.layout.v3','dashboard.blocks.layout.v2','dashboard.blocks.layout.v1','dashboard.blocks.notes.v1','dashboard.blocks.mheights.v1','dashboard.blocks.tabheights.v1'];
  keys.forEach(k => localStorage.removeItem(k));
  // also remove all card backgrounds
  Object.keys(localStorage).filter(k => k.startsWith('cardBg::')).forEach(k => localStorage.removeItem(k));
  localStorage.removeItem('imgMigrated_v2');
  // and every stored image (page / rail / per-card) in IndexedDB
  if (window.dashStore && window.dashStore.clearAll) {
    window.dashStore.clearAll().then(() => location.reload());
    return;
  }
  location.reload();
}

window.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === '__activate_edit_mode') open();
  if (d.type === '__deactivate_edit_mode') close();
});

window.tweaks = { open, close, set: setKey, setLive, resetData, uploadPageBg, uploadHeaderBg, clearPageBg, clearHeaderBg, uploadRailBg, clearRailBg, resetPageBgPosition, resetRailBgPosition, refresh: renderPanel };

window.addEventListener('load', async () => {
  try { await window.dashStore.ready; } catch (e) {}
  pageBg = window.dashStore.getCached('pageBg');
  applyState();
  renderPanel();
  try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch(e){}
});
})();
