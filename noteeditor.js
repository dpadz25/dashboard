/* ═══════════════════════════════════════════════════════════════
   NOTE EDITOR — Apple Notes style smart lists for a contenteditable

   noteEditor.attach(el) makes `el` behave like a quick-notes doc:
   - "- " or "* " at the start of a line becomes a bullet "• "
   - "[] " becomes a checkbox "☐ " (click it to tick it: "☑ ")
   - "1. " starts a numbered list
   - Enter continues the list, Enter on an empty item leaves the list
     (or outdents when the item is indented)
   - Backspace right after a marker removes the marker
   - Tab / Shift+Tab indent and outdent a list line (two spaces)

   Content stays PLAIN TEXT (markers are just characters), so storage,
   search and Firestore sync of notes are unchanged. Edits go through
   document.execCommand('insertText') so undo/redo keeps working and the
   normal `input` event still fires for the host's autosave.
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';

const MARK = /^(\s*)(• |☐ |☑ |(\d+)\. )/;      // list prefix at line start
const BARE = /^(\s*)(• |☐ |☑ |\d+\. )$/;        // a line that is ONLY a prefix
const INDENT = '  ';

function supportsPlain(el) {
  try {
    const prev = el.getAttribute('contenteditable');
    el.contentEditable = 'plaintext-only';
    const ok = el.contentEditable === 'plaintext-only';
    if (prev !== null) el.setAttribute('contenteditable', prev);
    return ok;
  } catch (_) { return false; }
}

function text(el) { return el.textContent || ''; }

// Plain-text value of an editor (what gets saved).
function getText(el) {
  return (el.textContent || '').replace(/ /g, ' ').replace(/\n$/, '');
}
function setText(el, value) { el.textContent = value || ''; }

function caretOffset(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !el.contains(sel.anchorNode)) return null;
  const r = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}
function selectionCollapsed() {
  const sel = window.getSelection();
  return sel.rangeCount && sel.getRangeAt(0).collapsed;
}

// Select the character range [start, end) of el's text.
function setRange(el, start, end) {
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let pos = 0, node, s = null, e = null;
  while ((node = walker.nextNode())) {
    const len = node.nodeValue.length;
    if (s === null && start <= pos + len) s = [node, start - pos];
    if (e === null && end <= pos + len) { e = [node, end - pos]; break; }
    pos += len;
  }
  if (!s || !e) {   // empty editor or offset past the end: park at the end
    range.selectNodeContents(el); range.collapse(false);
  } else {
    range.setStart(s[0], s[1]); range.setEnd(e[0], e[1]);
  }
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
}

function replace(el, start, end, str) {
  if (start === end && str === '') return;
  setRange(el, start, end);
  const ok = str === ''
    ? document.execCommand('delete')
    : document.execCommand('insertText', false, str);
  if (!ok) {
    // execCommand refused (rare): fall back to a direct edit.
    const t = text(el);
    setText(el, t.slice(0, start) + str + t.slice(end));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const caret = start + str.length;     // execCommand can leave the caret at 0 after a deletion
  setRange(el, caret, caret);
}

function lineBounds(t, off) {
  const start = t.lastIndexOf('\n', off - 1) + 1;
  let end = t.indexOf('\n', off);
  if (end === -1) end = t.length;
  return { start, end };
}

function onKeydown(el, e) {
  if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
  const off = caretOffset(el);
  if (off === null || !selectionCollapsed()) return;
  const t = text(el);
  const { start, end } = lineBounds(t, off);
  const line = t.slice(start, end);
  const m = MARK.exec(line);

  if (e.key === 'Enter' && !e.shiftKey) {
    if (!m) return;                               // plain line: normal Enter
    const prefixLen = m[0].length;
    if (off < start + prefixLen) return;          // caret inside the marker
    e.preventDefault();
    if (line.length === prefixLen) {              // empty item
      if (m[1].length >= INDENT.length) {         // indented: step out one level
        replace(el, start, end, m[1].slice(INDENT.length) + m[2]);
      } else {
        replace(el, start, end, '');              // top level: leave the list
      }
      return;
    }
    let next = m[2];
    if (m[3]) next = (parseInt(m[3], 10) + 1) + '. ';
    else if (next === '☑ ') next = '☐ ';
    setRange(el, off, off);
    if (document.execCommand('insertLineBreak')) document.execCommand('insertText', false, m[1] + next);
    else replace(el, off, off, '\n' + m[1] + next);
    return;
  }

  if (e.key === 'Backspace' && !e.shiftKey) {
    const before = t.slice(start, off);
    if (BARE.test(before) && before.length === line.length) {
      e.preventDefault();
      replace(el, start, off, '');
    }
    return;
  }

  if (e.key === 'Tab' && m) {
    e.preventDefault();
    if (e.shiftKey) {
      const lead = m[1].length >= INDENT.length ? INDENT.length : m[1].length;
      if (!lead) return;
      replace(el, start, start + lead, '');
      setRange(el, off - lead, off - lead);
    } else {
      replace(el, start, start, INDENT);
      setRange(el, off + INDENT.length, off + INDENT.length);
    }
  }
}

// "- " / "* " / "[] " typed at the start of a line becomes a real marker.
function onInput(el, e) {
  if (e.inputType !== 'insertText' || e.data !== ' ') return;
  const off = caretOffset(el);
  if (off === null) return;
  const t = text(el);
  const { start } = lineBounds(t, off);
  const before = t.slice(start, off);
  const m = /^(\s*)(-|\*|\[\]|\[ \]) $/.exec(before);
  if (!m) return;
  const marker = (m[2] === '-' || m[2] === '*') ? '• ' : '☐ ';
  replace(el, start, off, m[1] + marker);
}

// Click a checkbox glyph to tick / untick it.
function onClick(el) {
  if (!selectionCollapsed()) return;
  const off = caretOffset(el);
  if (off === null) return;
  const t = text(el);
  const { start, end } = lineBounds(t, off);
  const m = /^(\s*)(☐|☑) /.exec(t.slice(start, end));
  if (!m) return;
  const g = start + m[1].length;
  if (off < g || off > g + 1) return;
  replace(el, g, g + 1, m[2] === '☐' ? '☑' : '☐');
  setRange(el, g + 2, g + 2);
}

function attach(el) {
  if (!el || el._noteEditor) return el;
  el._noteEditor = true;
  if (supportsPlain(el)) el.setAttribute('contenteditable', 'plaintext-only');
  el.style.whiteSpace = 'pre-wrap';
  el.addEventListener('keydown', (e) => onKeydown(el, e));
  el.addEventListener('input', (e) => onInput(el, e));
  el.addEventListener('click', () => onClick(el));
  return el;
}

// Caret helpers so a remote update can replace the text without the cursor jumping.
function getCaret(el) { return caretOffset(el); }
function setCaret(el, n) { setRange(el, n, n); }

window.noteEditor = { attach, getText, setText, getCaret, setCaret };
})();
