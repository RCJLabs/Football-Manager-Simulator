// Service worker: precache the app shell, network-first for HTML so deploys
// show up, cache-first for everything else. Bump CACHE on each release.
const CACHE = 'gridiron-eras-v4';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './src/styles.css', './src/main.js',
  './src/router.js', './src/store.js', './src/util.js',
  './src/data/positions.js', './src/data/players.js', './src/data/teams.js', './src/data/db.js',
  './src/engine/rng.js', './src/engine/ratings.js', './src/engine/playcall.js', './src/engine/game.js',
  './src/engine/stats.js', './src/engine/draft.js', './src/engine/season.js', './src/engine/auction.js',
  './src/ui/components.js', './src/ui/views/home.js', './src/ui/views/setup.js', './src/ui/views/draft.js',
  './src/ui/views/team.js', './src/ui/views/season.js', './src/ui/views/game.js', './src/ui/views/boxscore.js',
  './src/ui/views/players.js', './src/ui/views/settings.js', './src/ui/views/auction.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const isHtml = req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html');
  if (isHtml) {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return res; }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })));
});
