/* ──────────────────────────────────────────────────────────────
   DRAG-TO-SCROLL — grab any list/box and pull it up or down.

   Every list widget (and any cropped widget in phone view) already
   scrolls its overflow. This adds click-and-drag panning on top of
   the wheel/scrollbar, so a box that's been cropped short can still
   be dragged to the very bottom — handy in the phone preview where
   there's no touch scroll and no visible scrollbar.

   CHAINED scrolling: a grab collects the WHOLE stack of scrollable
   boxes from the grabbed node up to the page (e.g. a list inside a
   cropped widget inside the page). The drag delta flows into the
   innermost box first; whatever it can't absorb spills to the next
   box out, and finally to the page. That's why Life / Important
   Dates / Goals — which are lists nested inside cropped cards — can
   now be dragged all the way through instead of dead-ending.

   • Mouse only. Real touchscreens already scroll natively on drag,
     and hijacking touch would block taps — so we leave touch alone.
   • Engages only after a small movement threshold, so ordinary
     clicks (checkboxes, buttons, links) still register.
   • Skips form fields and the widget's own drag/resize handles.
   ────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var THRESH = 5;                 // px of movement before we treat it as a drag
  var chainY = [];                // vertical scroll boxes, innermost → page
  var chainX = null;              // first horizontal scroll box (tab strips etc.)
  var lastY = 0, lastX = 0;
  var startY = 0, startX = 0;
  var dragging = false;

  // Should drag also pan the whole PAGE? Yes in the phone preview and
  // at phone widths — there's no visible scrollbar there, so a grab on a
  // card body or the background needs to move the page. On a roomy
  // desktop we leave the page alone so ordinary click-drag text
  // selection on empty areas still works.
  function pageDragAllowed() {
    return document.documentElement.classList.contains('in-phone-preview') ||
           window.innerWidth <= 720;
  }

  function canScrollY(el) {
    var oy = getComputedStyle(el).overflowY;
    return (oy === 'auto' || oy === 'scroll') && el.scrollHeight - el.clientHeight > 2;
  }
  function canScrollX(el) {
    var ox = getComputedStyle(el).overflowX;
    return (ox === 'auto' || ox === 'scroll') && el.scrollWidth - el.clientWidth > 2;
  }

  // Collect every scrollable box from the grabbed node up to the page,
  // innermost first. The page (document scroller) is appended last in
  // phone contexts so the drag can always continue once the widgets are
  // exhausted.
  function buildChains(node) {
    var ys = [], xs = null;
    while (node && node !== document.body && node.nodeType === 1) {
      if (canScrollY(node)) ys.push(node);
      if (!xs && canScrollX(node)) xs = node;
      node = node.parentNode;
    }
    if (pageDragAllowed()) {
      var pg = document.scrollingElement || document.documentElement;
      if (pg && pg.scrollHeight - pg.clientHeight > 2) ys.push(pg);
    }
    return { ys: ys, xs: xs };
  }

  // Apply a vertical delta across the chain: innermost box takes what it
  // can, the remainder spills outward. `dy > 0` scrolls content downward.
  function applyY(dy) {
    for (var i = 0; i < chainY.length && dy !== 0; i++) {
      var el = chainY[i];
      var max = el.scrollHeight - el.clientHeight;
      var cur = el.scrollTop;
      var next = Math.max(0, Math.min(max, cur + dy));
      var applied = next - cur;
      if (applied !== 0) { el.scrollTop = next; dy -= applied; }
    }
  }

  // Don't start a drag from controls the user means to operate.
  function isInteractive(node) {
    return !!(node.closest &&
      node.closest('input, textarea, select, [contenteditable=""], ' +
        '[contenteditable="true"], .block-handle, .block-resize-grip, ' +
        '.block-mcrop-handle, .block-edge-resize, .block-edge-resize-bottom, ' +
        '.tabs, .agenda-tabs'));
  }

  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (isInteractive(e.target)) return;
    var chains = buildChains(e.target);
    if (!chains.ys.length && !chains.xs) return;
    chainY = chains.ys;
    chainX = chains.xs;
    startY = lastY = e.clientY;
    startX = lastX = e.clientX;
    dragging = false;
  });

  document.addEventListener('pointermove', function (e) {
    if (!chainY.length && !chainX) return;
    if (!dragging) {
      if (Math.abs(e.clientY - startY) < THRESH &&
          Math.abs(e.clientX - startX) < THRESH) return;
      dragging = true;
      document.documentElement.classList.add('is-grab-scrolling');
      document.body.style.userSelect = 'none';
    }
    // Drag UP (clientY decreases) ⇒ reveal content below ⇒ scroll down.
    applyY(lastY - e.clientY);
    if (chainX) {
      var max = chainX.scrollWidth - chainX.clientWidth;
      chainX.scrollLeft = Math.max(0, Math.min(max, chainX.scrollLeft + (lastX - e.clientX)));
    }
    lastY = e.clientY;
    lastX = e.clientX;
    if (e.cancelable) e.preventDefault();
  });

  function end() {
    if (!chainY.length && !chainX) return;
    var wasDragging = dragging;
    chainY = [];
    chainX = null;
    dragging = false;
    document.documentElement.classList.remove('is-grab-scrolling');
    document.body.style.userSelect = '';
    if (wasDragging) {
      // Swallow the click that fires right after a drag release so we
      // don't accidentally toggle a task / open a link.
      var swallow = function (ev) {
        ev.stopPropagation();
        ev.preventDefault();
        window.removeEventListener('click', swallow, true);
      };
      window.addEventListener('click', swallow, true);
      setTimeout(function () { window.removeEventListener('click', swallow, true); }, 50);
    }
  }

  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
})();
