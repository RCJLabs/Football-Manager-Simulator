// Service worker: precache the app shell, network-first for HTML so deploys
// show up, cache-first for everything else. Bump CACHE on each release.
const CACHE = 'gridiron-eras-v47';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './src/styles.css', './src/main.js',
  './src/router.js', './src/store.js', './src/util.js',
  './src/data/positions.js', './src/data/players.js', './src/data/teams.js', './src/data/pro.js', './src/data/db.js',
  './src/engine/rng.js', './src/engine/ratings.js', './src/engine/playcall.js', './src/engine/game.js',
  './src/engine/game/picks.js', './src/engine/game/plays.js', './src/engine/stats.js', './src/engine/draft.js', './src/engine/season.js', './src/engine/auction.js', './src/engine/transactions.js', './src/engine/tradeblock.js', './src/engine/draftpicks.js', './src/engine/market.js', './src/ui/pick-trade.js', './src/engine/injuries.js', './src/engine/offseason.js', './src/engine/penalties.js', './src/engine/winprob.js', './src/engine/clinch.js', './src/ui/charts.js', './src/engine/awards.js', './src/ui/views/awards.js', './src/engine/gm.js', './src/engine/result.js', './src/engine/rookies.js', './src/engine/autosim.js', './src/engine/careers.js', './src/engine/chemistry.js', './src/engine/scouting.js', './src/engine/jobs.js', './src/engine/difficulty.js', './src/engine/pulse.js', './src/data/rookie-names.js', './src/slots.js', './src/engine/share.js', './src/ui/share-card.js', './src/data/names.js', './src/data/tuning.js',
  './src/ui/components.js', './src/ui/views/home.js', './src/ui/views/setup.js', './src/ui/views/draft.js',
  './src/ui/views/team.js', './src/ui/views/season.js', './src/ui/views/game.js', './src/ui/views/boxscore.js',
  './src/ui/views/players.js', './src/ui/views/settings.js', './src/ui/views/career.js', './src/ui/views/guide.js', './src/ui/value-panel.js', './src/ui/views/auction.js', './src/ui/views/moves.js', './src/ui/views/offseason.js',
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
