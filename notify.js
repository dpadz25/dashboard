/* ═══════════════════════════════════════════════════════════════
   NOTIFY — iPhone push notifications for tasks due today.

   How the pieces fit:
   - This file (client): registers sw.js, asks for notification
     permission, subscribes to web push, and stores the subscription
     plus the two preferred times in Firestore.
   - sw.js: shows the notification when a push arrives.
   - .github/workflows/notify.yml + scripts/send-notifications.mjs:
     a scheduled GitHub Action that reads tasks due today from
     Firestore and sends the push at the configured times.

   iOS requirements (16.4+): the dashboard must be added to the home
   screen via Safari's Share menu — a plain Safari tab cannot receive
   push. Enabling must happen from a tap (user gesture), which the
   Tweaks button provides.

   Settings live in the `notifySettings` localStorage key (synced via
   firebase-sync so the GitHub Action can read the times):
     { enabled, time1: 'HH:MM', time2: 'HH:MM', tz: IANA zone }
   Subscriptions are per-device, written straight to the Firestore
   doc users/<uid>/dashboard/pushSubs as { [deviceId]: {...} }.
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';
const { load, save, uid } = window.dashUtil;

// Public half of the VAPID pair — safe to publish. The private half
// lives only in the repo's GitHub Actions secrets.
const VAPID_PUBLIC_KEY = 'BNEtjDDcEa8zLNY5LzpHdp-tu8GPV2LrRis9VZIenZ4sTN220r0HV5Engul9L91xURshxYoFPbTn_z5VdpkrFnU';

const DEFAULTS = { enabled: false, time1: '08:00', time2: '20:00', tz: '' };

function getSettings() { return { ...DEFAULTS, ...load('notifySettings', {}) }; }
function saveSettings(s) { save('notifySettings', s); }

// Stable per-device id so re-subscribing replaces this device's slot
// instead of piling up duplicates.
function deviceId() {
  let id = null;
  try { id = localStorage.getItem('notifyDeviceId'); } catch (_) {}
  if (!id) {
    id = uid();
    try { localStorage.setItem('notifyDeviceId', id); } catch (_) {}
  }
  return id;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/* ── CAPABILITY / STATE CHECKS ───────────────────────────────── */
function supportInfo() {
  const hasSW = 'serviceWorker' in navigator;
  const hasPush = hasSW && 'PushManager' in window;
  const standalone = window.matchMedia('(display-mode: standalone)').matches ||
                     window.navigator.standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const signedIn = !!(window.firebase && firebase.auth && firebase.auth().currentUser);
  return { hasSW, hasPush, standalone, isIOS, signedIn };
}

function fbUser() {
  try { return firebase.auth().currentUser; } catch (_) { return null; }
}

function subsDoc() {
  const user = fbUser();
  if (!user) return null;
  return firebase.firestore().collection('users').doc(user.uid).collection('dashboard').doc('pushSubs');
}

/* ── SERVICE WORKER ──────────────────────────────────────────── */
let swReg = null;
async function ensureSW() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    await navigator.serviceWorker.register('./sw.js');
    // Wait until the worker is fully ACTIVE — subscribing against a
    // still-installing registration is why first-time enables failed.
    swReg = await navigator.serviceWorker.ready;
    return swReg;
  } catch (e) {
    console.warn('[notify] service worker registration failed', e);
    return null;
  }
}

/* ── ENABLE / DISABLE ────────────────────────────────────────── */
async function enable() {
  const info = supportInfo();
  if (!info.hasPush) {
    alert(info.isIOS && !info.standalone
      ? 'On iPhone, push only works once the dashboard is on your home screen:\n\nSafari → Share → Add to Home Screen, then open it from the icon and try again.'
      : 'This browser does not support web push.');
    return;
  }
  if (!info.signedIn) {
    alert('Sign in to sync first (button in the header) — notifications need your cloud data.');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    alert('Notifications were not allowed. You can change this in Settings.');
    refreshUI();
    return;
  }
  const reg = await ensureSW();
  if (!reg) { alert('Could not set up the background worker.'); return; }

  // Reuse an existing subscription if this device already has one.
  let sub = null;
  try { sub = await reg.pushManager.getSubscription(); } catch (_) {}

  if (!sub) {
    const opts = {
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    };
    try {
      sub = await reg.pushManager.subscribe(opts);
    } catch (e1) {
      // One retry after a beat — a just-activated worker sometimes needs it.
      await new Promise(r => setTimeout(r, 1200));
      try {
        sub = await reg.pushManager.subscribe(opts);
      } catch (e2) {
        console.warn('[notify] subscribe failed', e2);
        alert('Could not subscribe to push on this device.\n\nDetails: ' +
          (e2 && e2.name ? e2.name + ' — ' : '') + (e2 && e2.message ? e2.message : e2));
        return;
      }
    }
  }
  const doc = subsDoc();
  if (!doc) return;
  try {
    await doc.set({
      [deviceId()]: {
        sub: JSON.stringify(sub.toJSON()),
        ua: navigator.userAgent.slice(0, 120),
        t: Date.now(),
      },
    }, { merge: true });
  } catch (e) {
    console.error('[notify] saving subscription failed', e);
    alert('Could not save the subscription to the cloud.');
    return;
  }
  const s = getSettings();
  s.enabled = true;
  s.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || s.tz || 'America/New_York';
  saveSettings(s);
  refreshUI();
}

async function disable() {
  const s = getSettings();
  s.enabled = false;
  saveSettings(s);
  try {
    const reg = await ensureSW();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch (_) {}
  const doc = subsDoc();
  if (doc) {
    try {
      await doc.set({ [deviceId()]: firebase.firestore.FieldValue.delete() }, { merge: true });
    } catch (_) {}
  }
  refreshUI();
}

function setTime(which, value) {
  if (!value) return;
  const s = getSettings();
  s[which] = value;
  s.tz = Intl.DateTimeFormat().resolvedOptions().timeZone || s.tz;
  saveSettings(s);
}

/* ── TWEAKS PANEL SECTION ────────────────────────────────────── */
function sectionHTML() {
  const s = getSettings();
  const info = supportInfo();
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
  const active = s.enabled && perm === 'granted';

  let status;
  if (!info.hasPush) {
    status = info.isIOS && !info.standalone
      ? 'iPhone: add this page to your home screen first (Safari → Share → Add to Home Screen), then enable from the installed app.'
      : 'Push is not supported in this browser.';
  } else if (!info.signedIn) {
    status = 'Sign in to sync (header button) to turn notifications on.';
  } else if (active) {
    status = 'On — this device gets a summary of tasks due today at both times.';
  } else if (perm === 'denied') {
    status = 'Notifications are blocked for this app in system settings.';
  } else {
    status = 'Off. Enabling asks for notification permission on this device.';
  }

  return `
      <div class="tweak-section">
        <div class="tweak-section-title">Task Notifications</div>
        <div class="tweak-note" style="margin-top:0">${status}</div>
        <div class="tweak-row" style="margin-top:0.5rem">
          <span class="tweak-label">Push notifications</span>
          <button class="tweak-toggle ${active ? 'on' : ''}" onclick="window.notify.${active ? 'disable' : 'enable'}()"></button>
        </div>
        <div class="tweak-row">
          <span class="tweak-label">Morning</span>
          <input class="t-input" type="time" value="${s.time1}" style="max-width:120px"
                 onchange="window.notify.setTime('time1', this.value)"/>
        </div>
        <div class="tweak-row">
          <span class="tweak-label">Evening</span>
          <input class="t-input" type="time" value="${s.time2}" style="max-width:120px"
                 onchange="window.notify.setTime('time2', this.value)"/>
        </div>
        <div class="tweak-note">Times are checked about every 20 minutes, so delivery lands within ~20 minutes of each time. Only fires when something is actually due that day.</div>
      </div>`;
}

function refreshUI() {
  if (window.tweaks && window.tweaks.refresh) window.tweaks.refresh();
}

/* ── BOOT ────────────────────────────────────────────────────── */
// Register the worker up front when it already exists so an installed
// PWA keeps its subscription alive across visits.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistration().then(reg => { if (reg) swReg = reg; });
  });
}

window.notify = { enable, disable, setTime, sectionHTML, getSettings };
})();
