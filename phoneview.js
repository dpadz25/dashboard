/* ──────────────────────────────────────────────────────────────
   PHONE PREVIEW — a desktop tool to see the live mobile layout.

   Opens the SAME html file inside a 390px-wide device frame via an
   iframe. Because the iframe has its own 390px viewport, the real
   mobile media queries fire — so you see exactly what your phone
   shows. Same origin ⇒ same localStorage ⇒ same data ("the same
   sync"): anything you change on desktop appears in the phone frame,
   and edits made in the phone frame persist back to desktop.

   When the page is loaded *inside* the preview (?preview=1) we add a
   body class so the desktop-only floating tools hide, and we auto-
   reload on cross-frame data changes to stay in sync.
   ────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);

  /* ── Running INSIDE the phone-preview iframe ─────────────── */
  if (params.has('preview')) {
    const mark = () => {
      document.documentElement.classList.add('in-phone-preview');
      document.body.classList.add('in-phone-preview');
    };
    if (document.body) mark();
    else document.addEventListener('DOMContentLoaded', mark);

    // Reflect desktop edits live. localStorage 'storage' events fire in
    // OTHER documents of the same origin, so a change made on the desktop
    // tab reaches this iframe. Debounced reload keeps data in sync without
    // thrashing during drag/resize bursts.
    let t = null;
    window.addEventListener('storage', () => {
      clearTimeout(t);
      t = setTimeout(() => location.reload(), 400);
    });
    return; // do NOT build the launcher inside the preview itself
  }

  /* ── Running on the DESKTOP page: build launcher + overlay ── */
  const PHONE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2.5"/><path d="M11 18h2"/></svg>';
  const RELOAD_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.36 2.64L3 8"/><path d="M3 3v5h5"/></svg>';
  const CLOSE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  function init() {
    const btn = document.createElement('button');
    btn.className = 'phone-preview-fab';
    btn.type = 'button';
    btn.title = 'Preview the phone layout';
    btn.setAttribute('aria-label', 'Preview the phone layout');
    btn.innerHTML = PHONE_SVG;
    document.body.appendChild(btn);

    const overlay = document.createElement('div');
    overlay.className = 'phone-preview-overlay';
    overlay.innerHTML =
      '<div class="ppv-backdrop"></div>' +
      '<div class="ppv-stage">' +
        '<div class="ppv-toolbar">' +
          '<span class="ppv-title">Phone preview</span>' +
          '<div class="ppv-actions">' +
            '<button class="ppv-btn" data-act="reload" type="button">' + RELOAD_SVG + 'Reload</button>' +
            '<button class="ppv-btn primary" data-act="close" type="button">' + CLOSE_SVG + 'Close</button>' +
          '</div>' +
        '</div>' +
        '<div class="ppv-device-wrap" id="ppvWrap">' +
          '<div class="ppv-device" id="ppvDevice">' +
            '<div class="ppv-notch"></div>' +
            '<iframe class="ppv-frame" id="ppvFrame" title="Phone preview"></iframe>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    const frame  = overlay.querySelector('#ppvFrame');
    const device = overlay.querySelector('#ppvDevice');
    const wrap   = overlay.querySelector('#ppvWrap');

    function previewUrl() {
      const u = new URL(location.href);
      u.searchParams.set('preview', '1');
      u.hash = '';
      return u.toString();
    }

    const DEV_W = 390 + 24;   // device width incl. bezel padding
    const DEV_H = 800 + 24;   // device height incl. bezel padding

    function fitDevice() {
      // Scale to fit the viewport height, leaving room for the toolbar.
      const avail = window.innerHeight - 120;
      const scale = Math.min(1, avail / DEV_H);
      device.style.transform = 'scale(' + scale + ')';
      // The wrapper occupies the SCALED footprint so flexbox centres it
      // correctly (transform alone doesn't shrink the layout box).
      wrap.style.width  = (DEV_W * scale) + 'px';
      wrap.style.height = (DEV_H * scale) + 'px';
    }

    function open() {
      frame.src = previewUrl();
      overlay.classList.add('open');
      fitDevice();
    }
    function close() {
      overlay.classList.remove('open');
      frame.src = 'about:blank';
    }
    function reload() {
      try { frame.contentWindow.location.reload(); }
      catch (_) { frame.src = previewUrl(); }
    }

    btn.addEventListener('click', open);
    window.addEventListener('resize', () => {
      if (overlay.classList.contains('open')) fitDevice();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target.classList.contains('ppv-backdrop')) { close(); return; }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'close')  close();
      if (act.dataset.act === 'reload') reload();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('open')) close();
    });
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
