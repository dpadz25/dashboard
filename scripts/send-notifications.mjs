/* ═══════════════════════════════════════════════════════════════
   SEND NOTIFICATIONS — runs inside the scheduled GitHub Action.

   For every user in Firestore:
   1. Read dashboard/notifySettings (written by the dashboard's sync)
   2. If enabled and one of the two configured times fell inside the
      window since the last cron tick (and wasn't already sent today),
      read dashboard/plannerTasks, collect tasks due today, and push a
      summary to every subscription in dashboard/pushSubs.
   3. Record the send in dashboard/notifyLog so a delayed or doubled
      cron tick can never notify twice. Dead subscriptions (404/410)
      are pruned.

   Required env (from repo Actions secrets):
   - FIREBASE_SERVICE_ACCOUNT : service-account JSON for the project
   - VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY : web-push key pair
   Exits quietly if secrets aren't configured yet.

   TEST MODE: set TEST_MODE=test (the "Run workflow" button's dropdown
   does this) to immediately push a fixed test notification to every
   subscribed device, skipping the enabled/time-window/due-task checks
   and without touching notifyLog. Lets Delan confirm the whole pipeline
   works without waiting for 8am/8pm.
   ═══════════════════════════════════════════════════════════════ */
import admin from 'firebase-admin';
import webpush from 'web-push';

const WINDOW_MIN = 25; // cron runs every 20 min; small buffer for delays
const TEST_MODE = process.env.TEST_MODE === 'test';

const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
const vapidPub = process.env.VAPID_PUBLIC_KEY;
const vapidPriv = process.env.VAPID_PRIVATE_KEY;

if (!saRaw || !vapidPub || !vapidPriv) {
  console.log('Secrets not configured yet (FIREBASE_SERVICE_ACCOUNT / VAPID keys) — nothing to do.');
  process.exit(0);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saRaw)) });
webpush.setVapidDetails('mailto:delanpadz@gmail.com', vapidPub, vapidPriv);
const db = admin.firestore();

// Local wall-clock parts for a user's IANA time zone.
function localParts(tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map(x => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: (+p.hour % 24) * 60 + +p.minute,
  };
}

const toMin = (t) => {
  const [h, m] = String(t || '').split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
};

function parseDoc(snap) {
  if (!snap.exists) return null;
  const d = snap.data().d;
  if (typeof d !== 'string') return null;
  try { return JSON.parse(d); } catch { return null; }
}

// Sends `payload` to every subscription on a user's dashboard doc, pruning
// any that have gone dead (browser unsubscribed / uninstalled). Returns the
// number of devices successfully notified.
async function sendToSubs(userId, dash, payload) {
  const subsSnap = await dash.doc('pushSubs').get();
  const subs = subsSnap.exists ? subsSnap.data() : {};
  const deadDevices = [];
  let ok = 0;

  for (const [devId, rec] of Object.entries(subs)) {
    let sub;
    try { sub = JSON.parse(rec.sub); } catch { deadDevices.push(devId); continue; }
    try {
      await webpush.sendNotification(sub, payload);
      ok++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) deadDevices.push(devId);
      else console.warn(`push failed for ${userId}/${devId}:`, e.statusCode || e.message);
    }
  }

  if (deadDevices.length) {
    const del = {};
    for (const id of deadDevices) del[id] = admin.firestore.FieldValue.delete();
    await dash.doc('pushSubs').set(del, { merge: true });
  }
  return ok;
}

const users = await db.collection('users').listDocuments();
let sent = 0;

if (TEST_MODE) {
  console.log('TEST MODE — sending immediately, ignoring schedule/enabled/due-task checks.');
  const payload = JSON.stringify({
    title: 'Test notification',
    body: 'Push is wired up correctly — real reminders will look like this.',
    url: 'https://dpadz25.github.io/dashboard/',
  });
  for (const userRef of users) {
    const dash = userRef.collection('dashboard');
    const subsSnap = await dash.doc('pushSubs').get();
    if (!subsSnap.exists || !Object.keys(subsSnap.data()).length) continue;
    sent += await sendToSubs(userRef.id, dash, payload);
  }
  console.log(`Done. ${sent} test notification(s) sent.`);
  process.exit(0);
}

for (const userRef of users) {
  const dash = userRef.collection('dashboard');
  const settings = parseDoc(await dash.doc('notifySettings').get());
  if (!settings || !settings.enabled) continue;

  const { date, minutes } = localParts(settings.tz);

  // Which configured slot (if any) is due right now?
  let slot = null;
  for (const key of ['time1', 'time2']) {
    const t = toMin(settings[key]);
    if (t != null && minutes >= t && minutes < t + WINDOW_MIN) { slot = key; break; }
  }
  if (!slot) continue;

  // Already sent this slot today? (guard against overlapping cron ticks)
  const logRef = dash.doc('notifyLog');
  const log = (await logRef.get()).data() || {};
  if (log[slot] === date) continue;

  const tasks = parseDoc(await dash.doc('plannerTasks').get()) || [];
  const due = tasks.filter(t => t && !t.done && t.status !== 'done' && t.dueDate === date);
  if (!due.length) {
    await logRef.set({ [slot]: date }, { merge: true }); // checked; nothing due
    continue;
  }

  const names = due.map(t => t.text).filter(Boolean);
  const title = due.length === 1 ? '1 task due today' : `${due.length} tasks due today`;
  const body = names.slice(0, 4).join(' · ') + (names.length > 4 ? ` +${names.length - 4} more` : '');
  const payload = JSON.stringify({ title, body, url: 'https://dpadz25.github.io/dashboard/' });

  sent += await sendToSubs(userRef.id, dash, payload);
  await logRef.set({ [slot]: date }, { merge: true });
}

console.log(`Done. ${sent} notification(s) sent.`);
