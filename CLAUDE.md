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
- `notify.js` + `sw.js` — PWA push notifications (see below).
- `firebase-sync.js` — cloud sync. Never overwrite.

## localStorage data model (all synced unless noted)
- `plannerTasks` — [{id, text, dueDate, type, classId, done, status}]
- `schoolClasses` — [{id, name, color, slots:[{day, start, end, room}]}]
- `agendaEvents` / `importantDates` — [{id, label, date, start?, end?}]
  (no `start` = all-day; times are 'HH:MM' 24h)
- `habitsConfig` — [{id, label, icon}]; `habitHistory` — {date: {habitId: bool}}
- `goals` — {year: [], quarter: [], week: []}; `lifeItems`, `shoppingItems`,
  `people` — simple arrays
- `currently` — {reading: [], watching: [], playing: []}, entries
  {id, title, sub, img, progress, status?} where status 'queued' hides an
  entry from the widget carousel; `currentlyArchive` — finished entries
  (cover `img` is stripped before upload, stays device-local)
- `notifySettings` — {enabled, time1, time2, tz} (times 'HH:MM', tz IANA)
- `dashboard.blocks.layout.v3` / `.notes.v1` / `.mheights.v1` /
  `.tabheights.v1` — grid layout, notes {id, title, content}, phone
  heights, per-tab agenda heights
- Device-local (NOT in SYNCED_KEYS, on purpose): `stickers`,
  `notifyDeviceId`, `weatherCache`, `cardBg::*` metadata, `customIcons`

## Push notifications (PWA web push)
- Client: `notify.js` (Tweaks → Task Notifications) registers `sw.js`,
  subscribes, and writes the subscription to Firestore doc
  `users/<uid>/dashboard/pushSubs` as `{deviceId: {sub, ua, t}}`.
- Sender: `.github/workflows/notify.yml` runs every 20 min →
  `scripts/send-notifications.mjs` reads `notifySettings`, `plannerTasks`,
  and `pushSubs`, sends a due-today summary at the two configured times,
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
  `notify.js`, `sw.js`, `manifest.json`, icons, `scripts/`,
  `.github/`) — keep them all when merging.
- Follow the general rules in `E:\dev\CLAUDE.md` (plan first, confirm
  before pushing, no em dashes, etc).
