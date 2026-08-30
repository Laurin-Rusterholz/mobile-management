/* ============================================================================
   Quantus Mobile — Service Worker
   Offline-App-Shell (cache-first für statische Assets, Network-first für
   Navigation). Backend-/API-Aufrufe werden NIE gecacht (die App verwaltet
   ihren eigenen Offline-Cache im localStorage über die Sync-Engine).
   ========================================================================== */
const VERSION = 'quantus-mobile-v20-ideen-home';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './css/apps.css',
  './js/main.js',
  './js/shell.js',
  './js/config.js',
  './js/util.js',
  './js/store.js',
  './js/notes.js',
  './js/note-ui.js',
  './js/theme.js',
  './js/router.js',
  './js/actions.js',
  './js/focus.js',
  './js/new.js',
  './js/search.js',
  './js/pwa.js',
  './js/springboard.js',
  './js/auth.js',
  './js/views/common.js',
  './js/views/home.js',
  './js/views/planen.js',
  './js/views/fokus.js',
  './js/views/polaris.js',
  './js/views/mehr.js',
  './js/views/noteflow.js',
  './js/views/gewohnheiten.js',
  './js/views/briefing.js',
  './js/views/pinnboard.js',
  './js/views/career.js',
  './js/views/flashcards.js',
  './js/views/budget.js',
  './js/views/gmail.js',
  './js/views/meetings.js',
  './js/views/ideen.js',
  './js/views/inbox.js',
  './js/views/einstellungen.js',
  './js/views/integrationen.js',
  './js/views/leseplan.js',
  './js/views/readinghub.js',
  './js/views/uebersicht.js',
  './js/views/mail.js',
  './js/views/kalender.js',
  './js/views/googlecalendar.js',
  './js/views/statistik.js',
  './js/views/journal.js',
  './js/views/flowertech.js',
  './js/views/collection.js',
  './icons/icon.svg',
];

// niemals cachen (Backend/Daten/APIs)
function isApi(url) {
  return url.includes('/.netlify/functions/') || url.includes('/webhook/') ||
         url.includes('firebasestorage') || url.includes('googleapis');
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // nur GET; PUT/POST an Backend durchreichen
  if (isApi(req.url)) return;                        // Daten/API nie cachen

  // Navigation → Network-first, Fallback auf App-Shell (offline)
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }

  const sameOrigin = new URL(req.url).origin === self.location.origin;
  if (sameOrigin) {
    // statische Assets: cache-first mit Hintergrund-Update
    e.respondWith(caches.match(req).then(cached => {
      const net = fetch(req).then(res => {
        if (res && res.status === 200) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || net;
    }));
  } else {
    // Cross-Origin (z.B. Firebase-SDK CDN): stale-while-revalidate, opportunistisch
    e.respondWith(caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res && res.status === 200) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => cached)));
  }
});
