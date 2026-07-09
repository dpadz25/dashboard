/* ═══════════════════════════════════════════════════════════════
   SERVICE WORKER — web push only.

   Deliberately does NO caching: GitHub Pages serves the site fresh
   and a caching worker would risk pinning stale files. This worker
   exists solely so the installed (home-screen) app can receive push
   notifications for tasks due today.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  const title = data.title || 'Dashboard';
  const options = {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: data.tag || 'dashboard-tasks',   // replaces an earlier unread one
    data: { url: data.url || './' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) return w.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
