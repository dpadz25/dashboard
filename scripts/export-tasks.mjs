/* ═══════════════════════════════════════════════════════════════
   EXPORT TASKS — runs inside the scheduled "Sync planner" GitHub Action.

   Reads plannerTasks + schoolClasses straight from Firestore (the same
   data the dashboard syncs) and writes data/tasks.json in exactly the
   shape the dashboard's manual "GitHub" button produces (see
   github-sync.js buildTasks). The workflow commits the file only when
   it actually changed.

   This is what keeps data/tasks.json fresh without anyone pressing the
   button, so the scheduled Morning Brief always has current tasks.

   Required env (repo Actions secret, shared with notify.yml):
   - FIREBASE_SERVICE_ACCOUNT : service-account JSON for the project
   Optional env:
   - DASH_UID : Firestore user id to export, if more than one user has
     planner data. Default: the user whose plannerTasks changed last.

   Safety: if Firestore has no plannerTasks doc, or it can't be parsed,
   the script exits non-zero and leaves the existing file untouched. It
   never replaces a good snapshot with an empty one because of an error.
   ═══════════════════════════════════════════════════════════════ */
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const OUT = 'data/tasks.json';

// Must stay identical to buildTasks() in github-sync.js.
export function buildTasks(tasks, classes) {
  const byId = {};
  (classes || []).forEach((c) => { if (c && c.id) byId[c.id] = c.name; });

  return (tasks || []).filter(Boolean).map((t) => {
    const type = (t.type || '').toLowerCase();
    return {
      id:        t.id || null,
      title:     t.text || '',
      dueDate:   t.dueDate || null,
      category:  t.classId && byId[t.classId] ? byId[t.classId] : 'General',
      type:      t.type || '',
      priority:  type === 'priority',
      completed: t.done === true || t.status === 'done',
      repeat:    t.repeat || '',
    };
  }).sort((a, b) => {
    // undated tasks last, otherwise by due date ascending
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
  });
}

function parseDoc(snap) {
  if (!snap.exists) return null;
  const d = snap.data().d;
  if (typeof d !== 'string') return null;
  try { return JSON.parse(d); } catch { return null; }
}

async function main() {
  const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!saRaw) {
    console.log('FIREBASE_SERVICE_ACCOUNT is not configured. Nothing to do.');
    return;
  }

  const { default: admin } = await import('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(saRaw)) });
  const db = admin.firestore();

  // Find the user to export.
  let best = null;
  const wanted = process.env.DASH_UID || '';
  const users = await db.collection('users').listDocuments();
  for (const userRef of users) {
    if (wanted && userRef.id !== wanted) continue;
    const snap = await userRef.collection('dashboard').doc('plannerTasks').get();
    if (!snap.exists) continue;
    const t = snap.data().t;
    const when = t && typeof t.toMillis === 'function' ? t.toMillis() : 0;
    if (!best || when > best.when) best = { userRef, snap, when };
  }
  if (!best) throw new Error('No plannerTasks doc found in Firestore. Leaving ' + OUT + ' untouched.');

  const tasks = parseDoc(best.snap);
  if (!Array.isArray(tasks)) throw new Error('plannerTasks could not be parsed. Leaving ' + OUT + ' untouched.');

  const classes = parseDoc(await best.userRef.collection('dashboard').doc('schoolClasses').get()) || [];
  const payload = buildTasks(tasks, classes);

  mkdirSync('data', { recursive: true });
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Wrote ${payload.length} tasks to ${OUT}.`);

  // Hand the count to the workflow for its commit message.
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `count=${payload.length}\n`, { flag: 'a' });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
}
