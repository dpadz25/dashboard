# CLAUDE.md — dashboard

## What this is
Delan's personal dashboard, hosted on GitHub Pages at
https://dpadz25.github.io/dashboard. GitHub repo: dpadz25/dashboard.
Plain HTML/CSS/JS, no build step.

## Key facts
- This folder (`E:\dashboard-hosted`) is the real location. It's linked
  into `E:\dev\dashboard` as a junction for workspace convenience — edits
  here and edits through the junction are the same files.
- `firebase-sync.js` exists only in this hosted repo, never in design
  exports. Never overwrite or drop it when merging new exports.
- Data syncs via Firestore, keyed by localStorage keys. Any new feature
  that adds a localStorage key must add that key to `SYNCED_KEYS` in
  `firebase-sync.js`, or it won't sync. Images are the exception: they
  live in IndexedDB (`window.dashStore`) and stay device-local because
  they blow Firestore's 1MB doc limit.
- List-shaped keys (tasks, events, dates, goals, lists, people, classes,
  habits, currently, the completion log) sync via a per-item merge in
  `firebase-sync.js`, not whole-array overwrite — see the "Per-item merge"
  block at the top of that file. If a new key holds an array of
  `{id, ...}` items (or a goals/currently-style bucket object), add it to
  `ID_ARRAY_KEYS` (or `BUCKET_KEYS`) there too, or it'll fall back to
  last-write-wins and can silently drop another device's edit.
- The remote sometimes has commits pushed from another machine (Delan's
  Mac). Always fetch and compare before pushing.
- New design exports land in Downloads (e.g. `Downloads\dashboard (1)`).
  The newest HTML version becomes `index.html` when merging an export in.
- Bump the `?v=` query param in `index.html` for every JS/CSS file you
  change, or GitHub Pages serves the stale cached copy.

## Modules (script files)
- `dashboard.js` — core widgets (planner, agenda, dates, goals, habits,
  currently, health, people), per-card background system, image utils
  (`window.dashImg`), shared utils (`window.dashUtil`).
- `blocks.js` — drag/resize card grid. Wraps every card's content in a
  `.block-scale` div (matters for CSS flex chains). Notes live here.
- `tweaks.js` — settings panel (themes, fonts, backgrounds, module
  toggles, stickers UI, notification UI).
- `stickers.js` — scrapbook PNG overlays (free or pinned to card corners).
- `library.js` — full-page Reading/Watching/Playing database view.
- `daystrip.js` — 7-day carousel card + day view modal.
- `today.js` — full-page "Today" / "This Week" overlay (condensed daily
  summary + weekly review), opened from the header. Reuses `.library-page`
  for the overlay chrome.
- `search.js` — global search modal (header icon or `/`), searches across
  tasks/events/dates/goals/lists/people/currently/notes and jumps to the
  card that holds a result via `window.dashUtil.scrollToCard`.
- `notify.js` + `sw.js` — PWA push notifications (see below).
- `firebase-sync.js` — cloud sync. Never overwrite.

## localStorage data model (all synced unless noted)
- `plannerTasks` — [{id, text, dueDate, type, classId, done, status,
  repeat?}] where `repeat` is `''`/`'daily'`/`'weekdays'`/`'weekly'`.
  Completing a repeating task advances its own `dueDate` forward instead
  of deleting it (see `nextRepeatDate` in dashboard.js).
- `taskCompletionLog` — [{id, taskId, text, classId, type, completedAt}],
  one entry per task completion (repeating or not), age-pruned at 90 days.
  Feeds the "Done This Week" list in today.js — completed one-off tasks
  are otherwise deleted outright, so this is the only record of them.
- `schoolClasses` — [{id, name, color, slots:[{day, start, end, room}]}]
- `agendaEvents` / `importantDates` — [{id, label, date, start?, end?}]
  (no `start` = all-day; times are 'HH:MM' 24h)
- `habitsConfig` — [{id, label, icon, color?, min?}]; `habitHistory` — {date: {habitId: true|'min'}}.
  `min` is an optional "bare minimum" version; completing it stores `'min'` (still counts as done).
  Streaks use "never miss twice" (`streakFrom` in dashboard.js): one missed day is forgiven.
- `dailiesConfig` — [{id, label, icon, group, min?}]; `dailiesHistory` shares habitHistory's shape
- `goals` — {year: [], quarter: [], week: []}, goal = {id, text, pct, next?, focus?, parentId?, upd}.
  `next` is the next step, `focus` marks the single Today focus goal, `parentId` links a week goal to a
  quarter goal (or quarter to year), `upd` is the last-moved time used for "stuck". Progress is derived:
  tasks with `goalId` (also copied onto `taskCompletionLog` entries), else sub-goal average, else `pct`.
- `people` — [{id, name, lastCheckin, cadence?, bday? ('MM-DD'), notes?, hist?}], cadence in days
  (default 30). Due logic lives in `personStatus` (dashboard.js) and is mirrored in
  `scripts/send-notifications.mjs`, keep the two in step.
- `lifeItems`, `shoppingItems` — simple arrays
- `currently` — {reading: [], watching: [], playing: []}, entries
  {id, title, sub, img, progress, status?} where status 'queued' hides an
  entry from the widget carousel; `currentlyArchive` — finished entries
  (cover `img` is stripped before upload, stays device-local)
- `todayLayout` — {order: [sectionId], hidden: [sectionId], density: 'cozy'|'compact'}, set from the
  Customize sheet in today.js. Section ids: strip, focus, due, rhythm, habits, dailies, events, people,
  goals. Plain object, last-write-wins (not in ID_ARRAY_KEYS/BUCKET_KEYS on purpose).
- `notifySettings` — {enabled, time1, time2, tz} (times 'HH:MM', tz IANA)
- `dashboard.blocks.layout.v3` / `.notes.v1` / `.mheights.v1` /
  `.tabheights.v1` — grid layout, notes {id, title, content}, phone
  heights, per-tab agenda heights
- Device-local (NOT in SYNCED_KEYS, on purpose): `stickers`,
  `notifyDeviceId`, `weatherCache`, `cardBg::*` metadata, `customIcons`, `peopleView` (due-only filter)

## Push notifications (PWA web push)
- Client: `notify.js` (Tweaks → Task Notifications) registers `sw.js`,
  subscribes, and writes the subscription to Firestore doc
  `users/<uid>/dashboard/pushSubs` as `{deviceId: {sub, ua, t}}`.
- Sender: `.github/workflows/notify.yml` runs every 20 min →
  `scripts/send-notifications.mjs` reads `notifySettings`, `plannerTasks`,
  and `pushSubs`, sends a summary at the two configured times (morning: tasks due, people due, focus goal;
  evening: tasks plus unchecked non-negotiables and dailies),
  and records sends in `users/<uid>/dashboard/notifyLog`.
- Repo Actions secrets: `VAPID_PRIVATE_KEY` (set), `FIREBASE_SERVICE_ACCOUNT`
  (service-account JSON from Firebase console). The VAPID public key is
  committed in `notify.js` and `notify.yml` — that's safe by design; the
  private key must never be committed.
- iPhone only receives push as a home-screen app (Safari → Share →
  Add to Home Screen), iOS 16.4+.

## Workflow notes
- Use the `dashboard-update` skill when merging a new design export.
  Design exports know nothing about the hosted-only files
  (`firebase-sync.js`, `stickers.js`, `library.js`, `daystrip.js`,
  `today.js`, `search.js`, `notify.js`, `sw.js`, `manifest.json`, icons,
  `scripts/`, `.github/`) — keep them all when merging.
- Follow the general rules in `E:\dev\CLAUDE.md` (plan first, confirm
  before pushing, no em dashes, etc).
