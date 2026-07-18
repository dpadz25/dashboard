/* ═══════════════════════════════════════════════════════════════
   FIREBASE SYNC — cross-device storage for Delan's Dashboard

   How it works:
   - Signs you in with Google
   - Saves your dashboard data to Firestore (Google's cloud database)
   - Any device signed into the same Google account shares the same data
   - Falls back to local-only mode if Firebase isn't configured yet
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Firebase Config ─────────────────────────────────────────
     Replace these placeholder values with your own Firebase project config.
     See the README for setup instructions.
     ─────────────────────────────────────────────────────────── */
  const FIREBASE_CONFIG = {
    apiKey:            'AIzaSyBxjP3IEqGSBu6xWQ7QPhKOEUCiurqsa2s',
    authDomain:        'delan-dashboard.firebaseapp.com',
    projectId:         'delan-dashboard',
    storageBucket:     'delan-dashboard.firebasestorage.app',
    messagingSenderId: '516820390811',
    appId:             '1:516820390811:web:90b58f1fee4088c991473e'
  };

  /* ── Which localStorage keys get synced ──────────────────────
     These are your actual data (tasks, habits, etc.).
     Things like background images stay device-local because
     they're too large for Firestore's 1MB document limit.
     ─────────────────────────────────────────────────────────── */
  const SYNCED_KEYS = new Set([
    'plannerTasks', 'schoolClasses', 'importantDates', 'agendaEvents',
    'habitsConfig', 'habitHistory', 'goals', 'currently', 'currentlyArchive',
    'lifeItems', 'shoppingItems', 'people', 'health', 'healthHistory', 'healthLastSync',
    'qlinks', 'tweaksState', 'clockFormat24', 'pomoState', 'notifySettings',
    'dashboard.blocks.layout.v3', 'dashboard.blocks.notes.v1',
    'dashboard.blocks.mheights.v1', 'dashboard.blocks.tabheights.v1',
    'healthCollapsed'
  ]);

  // Keys that contain embedded images (data URLs) which need to be
  // stripped before uploading to Firestore to stay under size limits.
  // Cover art in "Currently Reading/Watching/Playing" stays on-device only.
  const IMAGE_KEYS = new Set(['currently', 'currentlyArchive']);

  /* ── Per-item merge ──────────────────────────────────────────
     List-type keys used to be overwritten whole ("last device
     wins"), which silently lost the other device's edits — the
     reason phone edits kept disappearing. They are now merged
     item by item:
     - every item edit gets a modified timestamp (m), stamped
       automatically in the setItem interceptor below
     - deletions are remembered as tombstones (ids are never
       reused, so a tombstoned id can safely never come back)
     - on conflict, the newer edit wins; items only one side
       has are kept
     ─────────────────────────────────────────────────────────── */
  const ID_ARRAY_KEYS = new Set([
    'plannerTasks', 'schoolClasses', 'importantDates', 'agendaEvents',
    'habitsConfig', 'currentlyArchive', 'lifeItems', 'shoppingItems', 'people'
  ]);
  const BUCKET_KEYS = { goals: ['year','quarter','week'], currently: ['reading','watching','playing'] };
  const TOMB_PREFIX  = '__syncTombs::';
  const TOMB_MAX_AGE = 60 * 24 * 60 * 60 * 1000; // keep deletion records 60 days

  function isMergeKey(k) { return ID_ARRAY_KEYS.has(k) || !!BUCKET_KEYS[k] || k === 'habitHistory'; }
  function parseJSON(raw) { try { return raw == null ? null : JSON.parse(raw); } catch (_) { return null; } }

  // Order-independent stringify so two devices agree on "same content"
  // even if their JSON property order differs.
  function stableStr(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) { var a = '['; for (var i = 0; i < v.length; i++) { if (i) a += ','; a += stableStr(v[i]); } return a + ']'; }
    var keys = Object.keys(v).sort();
    var s = '{'; for (var j = 0; j < keys.length; j++) { if (j) s += ','; s += JSON.stringify(keys[j]) + ':' + stableStr(v[keys[j]]); }
    return s + '}';
  }
  // Item fingerprint for change detection: ignore the m stamp itself and
  // device-local cover images.
  function itemSig(i) {
    if (!i || typeof i !== 'object') return stableStr(i);
    var c = Object.assign({}, i); delete c.m; delete c.img;
    return stableStr(c);
  }
  function daySig(dayObj) { var c = Object.assign({}, dayObj); delete c._m; return stableStr(c); }

  function getTombs(key) { return parseJSON(_getItem(TOMB_PREFIX + key)) || []; }
  function setTombs(key, tombs) {
    var cut = Date.now() - TOMB_MAX_AGE;
    tombs = tombs.filter(function (t) { return t && t.id && t.t > cut; }).slice(-500);
    if (tombs.length) _setItem(TOMB_PREFIX + key, JSON.stringify(tombs));
    else _removeItem(TOMB_PREFIX + key);
    return tombs;
  }
  function mergeTombs(a, b) {
    var seen = {}, out = [];
    (a || []).concat(b || []).forEach(function (t) {
      if (t && t.id && !seen[t.id]) { seen[t.id] = 1; out.push(t); }
    });
    return out;
  }

  // The arrays of items inside a key's value (goals/currently keep
  // several; habitHistory is handled separately).
  function listArrays(key, parsed) {
    if (key === 'habitHistory') return null;
    if (BUCKET_KEYS[key]) return BUCKET_KEYS[key].map(function (b) { return (parsed && Array.isArray(parsed[b])) ? parsed[b] : []; });
    return [Array.isArray(parsed) ? parsed : []];
  }

  // Called from the setItem interceptor before storing: carry forward the
  // m stamp of unchanged items, stamp changed/new ones, and tombstone ids
  // that just disappeared (that's a local deletion).
  function stampAndTrack(key, prevRaw, nextRaw) {
    try {
      var prev = parseJSON(prevRaw), next = parseJSON(nextRaw);
      if (key === 'habitHistory') {
        if (!next || typeof next !== 'object') return nextRaw;
        var p = (prev && typeof prev === 'object') ? prev : {};
        Object.keys(next).forEach(function (d) {
          var pb = p[d], nb = next[d];
          if (!nb || typeof nb !== 'object') return;
          if (pb && daySig(pb) === daySig(nb)) { if (pb._m) nb._m = pb._m; }
          else nb._m = Date.now();
        });
        return JSON.stringify(next);
      }
      var nextLists = listArrays(key, next);
      if (!nextLists) return nextRaw;
      var prevById = {};
      listArrays(key, prev).forEach(function (arr) { arr.forEach(function (i) { if (i && i.id) prevById[i.id] = i; }); });
      var nextIds = {};
      nextLists.forEach(function (arr) { arr.forEach(function (i) {
        if (!i || !i.id) return;
        nextIds[i.id] = 1;
        var pi = prevById[i.id];
        if (pi && itemSig(pi) === itemSig(i)) { if (pi.m) i.m = pi.m; }
        else i.m = Date.now();
      }); });
      var tombs = getTombs(key), changed = false, now = Date.now();
      Object.keys(prevById).forEach(function (id) {
        if (!nextIds[id]) { tombs.push({ id: id, t: now }); changed = true; }
      });
      if (changed) setTombs(key, tombs);
      return JSON.stringify(next);
    } catch (e) { console.warn('[sync] stamp failed', key, e); return nextRaw; }
  }

  function mergeIdArrays(localArr, remoteArr, dead) {
    localArr  = Array.isArray(localArr)  ? localArr  : [];
    remoteArr = Array.isArray(remoteArr) ? remoteArr : [];
    var remoteById = {}, out = [], seen = {};
    remoteArr.forEach(function (i) { if (i && i.id) remoteById[i.id] = i; });
    localArr.forEach(function (li) {
      if (!li || !li.id) { out.push(li); return; }
      if (dead[li.id]) return;
      seen[li.id] = 1;
      var ri = remoteById[li.id];
      if (!ri) { out.push(li); return; }                       // only local has it → keep
      if (itemSig(li) === itemSig(ri)) { out.push(li); return; } // same content → keep local (may carry img)
      var lm = li.m || 0, rm = ri.m || 0;
      // Newer edit wins; exact-timestamp ties break on content so both
      // devices deterministically pick the same one.
      if (rm > lm || (rm === lm && itemSig(ri) > itemSig(li))) {
        if (li.img && !ri.img) { ri = Object.assign({}, ri); ri.img = li.img; }
        out.push(ri);
      } else out.push(li);
    });
    remoteArr.forEach(function (ri) {
      if (!ri || !ri.id || seen[ri.id] || dead[ri.id]) return;  // remote-only addition
      out.push(ri);
    });
    return out;
  }

  function mergeHabitHistory(local, remote) {
    local  = (local  && typeof local  === 'object') ? local  : {};
    remote = (remote && typeof remote === 'object') ? remote : {};
    var out = {}, dates = {};
    Object.keys(local).forEach(function (d) { dates[d] = 1; });
    Object.keys(remote).forEach(function (d) { dates[d] = 1; });
    Object.keys(dates).forEach(function (d) {
      var l = local[d], r = remote[d];
      if (!l) { out[d] = r; return; }
      if (!r) { out[d] = l; return; }
      if (daySig(l) === daySig(r)) { out[d] = l; return; }
      var lm = l._m || 0, rm = r._m || 0;
      out[d] = (rm > lm || (rm === lm && daySig(r) > daySig(l))) ? r : l;
    });
    return out;
  }

  function mergeKey(key, localRaw, remoteRaw, remoteTombs) {
    var tombs = setTombs(key, mergeTombs(getTombs(key), remoteTombs));
    var dead = {}; tombs.forEach(function (t) { dead[t.id] = 1; });
    var local = parseJSON(localRaw), remote = parseJSON(remoteRaw), merged;
    if (key === 'habitHistory') merged = mergeHabitHistory(local, remote);
    else if (BUCKET_KEYS[key]) {
      merged = {};
      BUCKET_KEYS[key].forEach(function (b) {
        merged[b] = mergeIdArrays(local && local[b], remote && remote[b], dead);
      });
    } else merged = mergeIdArrays(local, remote, dead);
    return JSON.stringify(merged);
  }

  /* ── Internal state ──────────────────────────────────────────*/
  let db        = null;   // Firestore instance
  let user      = null;   // currently signed-in user (or null)
  let unsub     = null;   // real-time listener unsubscribe function
  let ready     = false;  // true after initial pull is done

  // Track keys we just wrote so we can ignore our own echoes
  // coming back from the real-time listener.
  const recentWrites = new Set();

  // Writes that happened before the initial cloud pull finished.
  // Previously these were silently dropped (and then overwritten by the
  // pull) — e.g. adding a task on the phone right after opening the page.
  // Now we queue them and push once the pull completes.
  const pendingWrites = new Map();

  // Keep references to the original localStorage methods
  // before we wrap them with sync behavior.
  const _setItem    = localStorage.setItem.bind(localStorage);
  const _removeItem = localStorage.removeItem.bind(localStorage);
  const _getItem    = localStorage.getItem.bind(localStorage);

  /* ══════════════════════════════════════════════════════════════
     INIT
     ══════════════════════════════════════════════════════════════ */
  function init() {
    if (FIREBASE_CONFIG.apiKey === 'PASTE_YOUR_API_KEY') {
      console.log('[sync] Firebase not configured. Dashboard runs in local-only mode.');
      renderSyncUI();
      return;
    }
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();

    // Offline persistence: writes made while the connection is flaky (or
    // while iOS Safari suspends the tab) are stored on-device and sent
    // automatically next time the page is online — instead of being lost.
    // This is the main fix for phone edits never reaching other devices.
    try {
      db.enablePersistence({ synchronizeTabs: true }).catch(function (e) {
        console.warn('[sync] persistence unavailable (still works online):', e && e.code);
      });
    } catch (e) { /* very old browser — sync still works online */ }

    // Watch for sign-in / sign-out
    firebase.auth().onAuthStateChanged(onAuth);
  }

  function onAuth(u) {
    user = u;
    renderSyncUI();
    if (u) {
      pull();       // signed in: download cloud data
    } else {
      if (unsub) { unsub(); unsub = null; }
      ready = false;
    }
  }

  /* ══════════════════════════════════════════════════════════════
     AUTH (Google sign-in)
     ══════════════════════════════════════════════════════════════ */
  function signIn() {
    if (!db) { alert('Firebase is not configured yet. See the setup instructions.'); return; }
    var provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(provider).catch(function (err) {
      // If popup was blocked (common on mobile), fall back to redirect
      if (err.code === 'auth/popup-blocked' || err.code === 'auth/popup-closed-by-user') {
        firebase.auth().signInWithRedirect(provider);
      }
    });
  }

  function signOut() {
    if (confirm('Sign out? Your data stays on this device but stops syncing.')) {
      firebase.auth().signOut();
    }
  }

  /* ══════════════════════════════════════════════════════════════
     PULL  (Firestore → localStorage)
     Download all cloud data when you sign in.
     ══════════════════════════════════════════════════════════════ */
  function pull() {
    userCol().get().then(function (snap) {
      if (snap.empty) {
        // First time signing in: push your existing local data to the cloud
        pushAll();
      } else {
        // Cloud has data: merge it into localStorage. Keys the user edited
        // on THIS device while the page was loading get merged too (the
        // old code skipped them and then pushed the stale local copy up,
        // clobbering the other device's edits — the main reason phone
        // edits kept vanishing).
        snap.forEach(function (doc) {
          var data = doc.data();
          applyRemote(doc.id, data.d, parseJSON(data.x));
        });
        rerender();
      }
      ready = true;
      flushPending(); // send any edits made while the pull was in flight
      listen();       // start real-time listener
    }).catch(function (e) { console.error('[sync] pull failed', e); });
  }

  // Push queued early writes now that sync is ready. Push the CURRENT
  // local value, not the queued raw — the pull may have merged cloud
  // items into it since, and pushing the stale copy would drop them.
  function flushPending() {
    pendingWrites.forEach(function (raw, key) {
      var cur = _getItem(key);
      if (cur !== null) pushOne(key, cur);
    });
    pendingWrites.clear();
  }

  // Write a remote value into localStorage. List-type keys are merged
  // item by item; other keys are taken as-is (with local cover images
  // preserved for the stripped-image keys). Returns true if the local
  // value changed (so the caller knows whether to re-render).
  function applyRemote(key, val, remoteTombs) {
    if (val === undefined || val === null) return false;
    if (isMergeKey(key)) {
      var localRaw = _getItem(key);
      if (localRaw === null) {
        // Nothing on this device yet: take the cloud copy as-is (but
        // still record its tombstones for future merges).
        setTombs(key, mergeTombs(getTombs(key), remoteTombs));
        _setItem(key, val);
        return true;
      }
      var merged = mergeKey(key, localRaw, val, remoteTombs);
      var changedLocal = stableStr(parseJSON(merged)) !== stableStr(parseJSON(localRaw));
      if (changedLocal) _setItem(key, merged);
      // If the merge kept anything the cloud copy doesn't have, send the
      // merged version back up so all devices converge.
      if (stableStr(parseJSON(stripImages(key, merged))) !== stableStr(parseJSON(val))) {
        pushOne(key, merged);
      }
      return changedLocal;
    }
    if (IMAGE_KEYS.has(key)) {
      val = mergeImages(key, _getItem(key), val);
    }
    _setItem(key, val);
    return true;
  }

  // For "currently" and "currentlyArchive", the cloud version has no
  // cover images (we strip them to save space). This function copies
  // any locally-stored images back into the remote data so you don't
  // lose cover art you already uploaded on this device.
  function mergeImages(key, localRaw, remoteRaw) {
    if (!localRaw) return remoteRaw;
    try {
      var local  = JSON.parse(localRaw);
      var remote = JSON.parse(remoteRaw);

      if (key === 'currently' && remote && typeof remote === 'object') {
        ['reading', 'watching', 'playing'].forEach(function (k) {
          if (!Array.isArray(remote[k])) return;
          var li = Array.isArray(local[k]) ? local[k] : [];
          remote[k] = remote[k].map(function (ri) {
            if (ri.img) return ri;                       // remote already has an image
            var match = li.find(function (l) { return l.id === ri.id; });
            if (match && match.img) ri.img = match.img;  // restore local image
            return ri;
          });
        });
        return JSON.stringify(remote);
      }

      if (key === 'currentlyArchive' && Array.isArray(remote)) {
        var localArr = Array.isArray(local) ? local : [];
        return JSON.stringify(remote.map(function (ri) {
          if (ri.img) return ri;
          var match = localArr.find(function (l) { return l.id === ri.id; });
          if (match && match.img) ri.img = match.img;
          return ri;
        }));
      }
    } catch (_) {}
    return remoteRaw;
  }

  /* ══════════════════════════════════════════════════════════════
     PUSH  (localStorage → Firestore)
     ══════════════════════════════════════════════════════════════ */

  // Push ALL synced keys (used on first sign-in when cloud is empty)
  function pushAll() {
    if (!db || !user) return;
    var batch = db.batch();
    var c = userCol();
    SYNCED_KEYS.forEach(function (key) {
      var raw = _getItem(key);
      if (raw !== null) {
        batch.set(c.doc(key), docPayload(key, raw));
      }
    });
    batch.commit().catch(function (e) { console.error('[sync] pushAll failed', e); });
  }

  // Push a single key (called every time localStorage.setItem is used)
  function pushOne(key, raw) {
    if (!SYNCED_KEYS.has(key)) return;
    // Not ready yet (page still loading / pull in flight): remember the
    // write so it gets pushed as soon as sync is ready.
    if (!ready) { pendingWrites.set(key, raw); return; }
    if (!db || !user) return;

    // Mark this key so we skip our own echo from the real-time listener
    recentWrites.add(key);
    setTimeout(function () { recentWrites.delete(key); }, 3000);

    userCol().doc(key).set(docPayload(key, raw))
      .catch(function (e) { console.error('[sync] push failed', key, e); });
  }

  // The Firestore doc for a key: data + timestamp, plus deletion
  // tombstones (x) for merged keys so deletes propagate across devices.
  function docPayload(key, raw) {
    var payload = {
      d: stripImages(key, raw),
      t: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (isMergeKey(key)) {
      var tombs = getTombs(key);
      if (tombs.length) payload.x = JSON.stringify(tombs);
    }
    return payload;
  }

  // Remove embedded image data URLs before uploading to Firestore.
  // This keeps documents well under the 1MB Firestore limit.
  // Cover images stay in localStorage on each device.
  function stripImages(key, raw) {
    if (!IMAGE_KEYS.has(key)) return raw;
    try {
      var parsed = JSON.parse(raw);
      if (key === 'currently' && parsed && typeof parsed === 'object') {
        var out = {};
        Object.keys(parsed).forEach(function (k) {
          var items = parsed[k];
          out[k] = Array.isArray(items)
            ? items.map(function (i) { var c = Object.assign({}, i); delete c.img; return c; })
            : items;
        });
        return JSON.stringify(out);
      }
      if (key === 'currentlyArchive' && Array.isArray(parsed)) {
        return JSON.stringify(parsed.map(function (i) {
          var c = Object.assign({}, i); delete c.img; return c;
        }));
      }
    } catch (_) {}
    return raw;
  }

  /* ══════════════════════════════════════════════════════════════
     REAL-TIME LISTENER
     Watches Firestore for changes from other devices and updates
     localStorage + re-renders the dashboard automatically.
     ══════════════════════════════════════════════════════════════ */
  function listen() {
    if (unsub) unsub();
    unsub = userCol().onSnapshot(function (snap) {
      if (!ready) return;
      var changed = false;
      snap.docChanges().forEach(function (ch) {
        if (ch.type === 'removed') return;
        var key = ch.doc.id;
        // Skip echoes of our own writes (within 3 seconds). Merged keys
        // don't need this guard — re-merging identical data is a no-op —
        // and skipping them could swallow a genuine edit from another
        // device that lands inside the window.
        if (!isMergeKey(key) && recentWrites.has(key)) return;
        var data = ch.doc.data();
        if (data.d === undefined) return;
        if (applyRemote(key, data.d, parseJSON(data.x))) changed = true;
      });
      if (changed) rerender();
    }, function (err) { console.error('[sync] listen error', err); });
  }

  /* ══════════════════════════════════════════════════════════════
     INTERCEPT localStorage
     Wraps setItem and removeItem so every save automatically
     syncs to Firestore. The rest of the dashboard code doesn't
     need to know about Firebase at all.
     ══════════════════════════════════════════════════════════════ */
  localStorage.setItem = function (key, value) {
    // For merged keys: stamp modified times on changed items and record
    // tombstones for items that just got deleted, before storing.
    if (isMergeKey(key)) value = stampAndTrack(key, _getItem(key), value);
    _setItem(key, value);      // save locally as normal
    pushOne(key, value);       // also push to cloud
  };

  localStorage.removeItem = function (key) {
    _removeItem(key);          // remove locally as normal
    if (isMergeKey(key)) _removeItem(TOMB_PREFIX + key);
    // Also remove from cloud
    if (db && user && SYNCED_KEYS.has(key)) {
      userCol().doc(key).delete().catch(function () {});
    }
  };

  /* ══════════════════════════════════════════════════════════════
     HELPERS
     ══════════════════════════════════════════════════════════════ */
  function userCol() {
    return db.collection('users').doc(user.uid).collection('dashboard');
  }

  // Re-render every section of the dashboard after receiving
  // new data from the cloud.
  function rerender() {
    var d = window.dash;
    if (!d) return;
    // Each section re-renders independently so one hiccup can't stop the rest.
    [
      'initHeader', 'renderQlinks', 'applySideRailBg', 'renderHabits',
      'renderPlannerTabs', 'renderTaskClassSelect', 'renderPlanner',
      'renderLife', 'renderShopping', 'renderCurrentlyTabs', 'renderAgenda',
      'renderDates', 'renderGoals', 'renderCurrently', 'renderHealth',
      'renderPeople', 'applyAllCardBgs'
    ].forEach(function (fn) {
      try { if (typeof d[fn] === 'function') d[fn](); }
      catch (e) { console.warn('[sync] rerender error in ' + fn, e); }
    });
  }

  // Update the sync button in the header
  function renderSyncUI() {
    var btn = document.getElementById('syncBtn');
    if (!btn) return;

    if (!db) {
      // Firebase not configured
      btn.innerHTML = '<span class="sync-dot offline"></span> Local only';
      btn.title = 'Firebase not configured yet';
      btn.onclick = function () { alert('Firebase is not configured. See the setup instructions in firebase-sync.js.'); };
      return;
    }

    if (user) {
      btn.innerHTML = '<span class="sync-dot"></span> Synced';
      btn.title = 'Signed in as ' + (user.email || 'Google user') + ' — click to sign out';
      btn.onclick = signOut;
    } else {
      btn.innerHTML = 'Sign in to sync';
      btn.title = 'Sign in with Google to sync across all your devices';
      btn.onclick = signIn;
    }
  }

  /* ── Boot ──────────────────────────────────────────────────── */
  window.firebaseSync = { init: init, signIn: signIn, signOut: signOut };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
