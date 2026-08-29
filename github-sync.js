/* github-sync.js — one-button export of the planner to data/tasks.json
 *
 * Reads plannerTasks + schoolClasses from localStorage, shapes them into a
 * clean array, and commits it to data/tasks.json in dpadz25/dashboard via the
 * GitHub contents API. The result is publicly readable at
 * https://dpadz25.github.io/dashboard/data/tasks.json so an external service
 * can poll it.
 *
 * The personal access token is asked for on first use and kept in
 * localStorage under 'githubSyncToken'. That key is deliberately NOT in
 * SYNCED_KEYS in firebase-sync.js, so the token stays on this device only.
 */
(function () {
  'use strict';

  var OWNER  = 'dpadz25';
  var REPO   = 'dashboard';
  var BRANCH = 'main';
  var PATH   = 'data/tasks.json';
  var TOKEN_KEY = 'githubSyncToken';

  function load(k, fb) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? fb : v; }
    catch (e) { return fb; }
  }

  // base64 of a UTF-8 string (btoa alone mangles non-ASCII)
  function b64(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }

  function getToken(forcePrompt) {
    var t = localStorage.getItem(TOKEN_KEY);
    if (t && !forcePrompt) return t;
    var entered = window.prompt(
      'GitHub personal access token\n\n' +
      'Needs "Contents: read and write" on dpadz25/dashboard ' +
      '(fine-grained token) or the classic "repo" scope. ' +
      'Stored only on this device.',
      t || ''
    );
    if (entered == null) return null;          // cancelled
    entered = entered.trim();
    if (!entered) return null;
    localStorage.setItem(TOKEN_KEY, entered);
    return entered;
  }

  // Build the clean task array the public file exposes.
  function buildTasks() {
    var classes = load('schoolClasses', []);
    var byId = {};
    classes.forEach(function (c) { byId[c.id] = c.name; });

    var tasks = load('plannerTasks', []);
    return tasks.map(function (t) {
      var type = (t.type || '').toLowerCase();
      return {
        id:        t.id || null,
        title:     t.text || '',
        dueDate:   t.dueDate || null,
        category:  t.classId && byId[t.classId] ? byId[t.classId] : 'General',
        type:      t.type || '',
        priority:  type === 'priority',
        completed: t.done === true || t.status === 'done',
        repeat:    t.repeat || ''
      };
    }).sort(function (a, b) {
      // undated tasks last, otherwise by due date ascending
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
    });
  }

  function api(path, opts, token) {
    opts = opts || {};
    return fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + path, {
      method: opts.method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
  }

  function setBtn(text, disabled) {
    var btn = document.getElementById('ghSyncBtn');
    if (!btn) return;
    if (btn.dataset.label == null) btn.dataset.label = btn.textContent;
    btn.textContent = text;
    btn.disabled = !!disabled;
  }
  function resetBtn(text) {
    var btn = document.getElementById('ghSyncBtn');
    setBtn(text || (btn && btn.dataset.label) || 'Sync to GitHub', false);
    if (text) setTimeout(function () { resetBtn(); }, 3500);
  }

  async function run() {
    var token = getToken(false);
    if (!token) return;

    setBtn('Syncing…', true);

    var payload = buildTasks();
    var content = b64(JSON.stringify(payload, null, 2) + '\n');

    try {
      // Look up the current file SHA (needed to update an existing file).
      var sha = null;
      var head = await api('/contents/' + PATH + '?ref=' + BRANCH, {}, token);
      if (head.status === 200) {
        sha = (await head.json()).sha;
      } else if (head.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        resetBtn('Bad token');
        if (getToken(true)) run();
        return;
      } else if (head.status !== 404) {
        throw new Error('GET ' + PATH + ' -> ' + head.status);
      }

      var put = await api('/contents/' + PATH, {
        method: 'PUT',
        body: {
          message: 'Sync planner -> tasks.json (' + payload.length + ' tasks)',
          content: content,
          branch: BRANCH,
          sha: sha || undefined
        }
      }, token);

      if (put.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        resetBtn('Bad token');
        return;
      }
      if (!put.ok) {
        var msg = '';
        try { msg = (await put.json()).message || ''; } catch (e) {}
        throw new Error('PUT ' + put.status + (msg ? ' — ' + msg : ''));
      }

      resetBtn('Synced ✓ ' + payload.length);
    } catch (err) {
      console.error('[github-sync]', err);
      resetBtn('Sync failed');
      window.alert('Sync to GitHub failed:\n\n' + err.message +
        '\n\nCheck the token has write access to ' + OWNER + '/' + REPO + '.');
    }
  }

  function changeToken() {
    if (getToken(true)) run();
  }

  window.githubSync = { run: run, changeToken: changeToken, buildTasks: buildTasks };
})();
