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
    'lifeItems', 'people', 'health', 'healthHistory', 'healthLastSync',
    'qlinks', 'tweaksState', 'clockFormat24', 'pomoState',
    'dashboard.blocks.layout.v3', 'dashboard.blocks.notes.v1',
    'healthCollapsed'
  ]);

  // Keys that contain embedded images (data URLs) which need to be
  // stripped before uploading to Firestore to stay under size limits.
  // Cover art in "Currently Reading/Watching/Playing" stays on-device only.
  const IMAGE_KEYS = new Set(['currently', 'currentlyArchive']);

  /* ── Internal state ──────────────────────────────────────────*/
  let db        = null;   // Firestore instance
  let user      = null;   // currently signed-in user (or null)
  let unsub     = null;   // real-time listener unsubscribe function
  let ready     = false;  // true after initial pull is done

  // Track keys we just wrote so we can ignore our own echoes
  // coming back from the real-time listener.
  const recentWrites = new Set();

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
        // Cloud has data: write it into localStorage
        snap.forEach(function (doc) {
          applyRemote(doc.id, doc.data().d);
        });
        rerender();
      }
      ready = true;
      listen();   // start real-time listener
    }).catch(function (e) { console.error('[sync] pull failed', e); });
  }

  // Write a remote value into localStorage, preserving local-only
  // image data for keys that had their images stripped.
  function applyRemote(key, val) {
    if (val === undefined || val === null) return;
    if (IMAGE_KEYS.has(key)) {
      val = mergeImages(key, _getItem(key), val);
    }
    _setItem(key, val);
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
        batch.set(c.doc(key), {
          d: stripImages(key, raw),
          t: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
    });
    batch.commit().catch(function (e) { console.error('[sync] pushAll failed', e); });
  }

  // Push a single key (called every time localStorage.setItem is used)
  function pushOne(key, raw) {
    if (!db || !user || !ready) return;
    if (!SYNCED_KEYS.has(key)) return;

    // Mark this key so we skip our own echo from the real-time listener
    recentWrites.add(key);
    setTimeout(function () { recentWrites.delete(key); }, 3000);

    userCol().doc(key).set({
      d: stripImages(key, raw),
      t: firebase.firestore.FieldValue.serverTimestamp()
    }).catch(function (e) { console.error('[sync] push failed', key, e); });
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
        // Skip echoes of our own writes (within 3 seconds)
        if (recentWrites.has(key)) return;
        var val = ch.doc.data().d;
        if (val === undefined) return;
        applyRemote(key, val);
        changed = true;
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
    _setItem(key, value);      // save locally as normal
    pushOne(key, value);       // also push to cloud
  };

  localStorage.removeItem = function (key) {
    _removeItem(key);          // remove locally as normal
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
    try {
      if (window.dash) {
        window.dash.initHeader();
        window.dash.renderQlinks();
        window.dash.applySideRailBg();
        window.dash.renderHabits();
        window.dash.renderPlannerTabs();
        window.dash.renderTaskClassSelect();
        window.dash.renderPlanner();
        window.dash.renderLife();
        window.dash.renderCurrentlyTabs();
        window.dash.renderAgenda();
        window.dash.renderDates();
        window.dash.renderGoals();
        window.dash.renderCurrently();
        window.dash.renderHealth();
        window.dash.renderPeople();
        window.dash.applyAllCardBgs();
      }
    } catch (e) { console.warn('[sync] rerender error', e); }
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
