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

// A person is due when their own cadence (default 30 days) has run out, they
// were never contacted, or their birthday is within a week. Mirrors
// personStatus() in dashboard.js.
function personDue(p, date, todayMs) {
  const cadence = +p.cadence || 30;
  if (!p.lastCheckin) return true;
  const days = Math.floor((Date.now() - p.lastCheckin) / 86400000);
  if (days >= cadence) return true;
  if (p.bday && /^\d\d-\d\d$/.test(p.bday)) {
    const [m, d] = p.bday.split('-').map(Number);
    const y = +date.slice(0, 4);
    let next = Date.UTC(y, m - 1, d);
    if (next < todayMs) next = Date.UTC(y + 1, m - 1, d);
    if (Math.round((next - todayMs) / 86400000) <= 7) return true;
  }
  return false;
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

  // Extra lines beyond tasks. Morning looks forward (people, focus goal);
  // evening looks back (what is still unchecked today).
  const extras = [];
  if (slot === 'time1') {
    const people = parseDoc(await dash.doc('people').get()) || [];
    const dueMs = new Date(`${date}T00:00:00Z`).getTime();
    const duePeople = people.filter(p => p && p.name && personDue(p, date, dueMs));
    if (duePeople.length) {
      const names = duePeople.slice(0, 3).map(p => p.name);
      extras.push(`Reach out: ${names.join(', ')}${duePeople.length > 3 ? ` +${duePeople.length - 3}` : ''}`);
    }
    const goals = parseDoc(await dash.doc('goals').get()) || {};
    const focus = ['week', 'quarter', 'year'].flatMap(k => goals[k] || []).find(g => g && g.focus);
    if (focus) extras.push(`Focus: ${focus.text}${focus.next ? ` (next: ${focus.next})` : ''}`);
  } else {
    const left = async (cfgKey, histKey) => {
      const cfg = parseDoc(await dash.doc(cfgKey).get()) || [];
      const hist = (parseDoc(await dash.doc(histKey).get()) || {})[date] || {};
      return cfg.filter(i => i && i.id && !hist[i.id]).length;
    };
    const habitsLeft = await left('habitsConfig', 'habitHistory');
    const dailiesLeft = await left('dailiesConfig', 'dailiesHistory');
    if (habitsLeft) extras.push(`${habitsLeft} non-negotiable${habitsLeft > 1 ? 's' : ''} left`);
    if (dailiesLeft) extras.push(`${dailiesLeft} daily${dailiesLeft > 1 ? ' items' : ''} left`);
  }

  if (!due.length && !extras.length) {
    await logRef.set({ [slot]: date }, { merge: true }); // checked; nothing to say
    continue;
  }

  const names = due.map(t => t.text).filter(Boolean);
  const taskLine = names.slice(0, 4).join(' \u00B7 ') + (names.length > 4 ? ` +${names.length - 4} more` : '');
  const title = due.length ? (due.length === 1 ? '1 task due today' : `${due.length} tasks due today`)
                           : (slot === 'time1' ? 'Good morning' : 'Before you wind down');
  const body = [taskLine, ...extras].filter(Boolean).join('\n');
  const payload = JSON.stringify({ title, body, url: 'https://dpadz25.github.io/dashboard/' });

  sent += await sendToSubs(userRef.id, dash, payload);
  await logRef.set({ [slot]: date }, { merge: true });
}

console.log(`Done. ${sent} notification(s) sent.`);
