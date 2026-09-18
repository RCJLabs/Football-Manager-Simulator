import { load, getState, subscribe, update } from './store.js';
import { route, startRouter, navigate, currentRoute } from './router.js';
import { PLAYERS, PLAYERS_BY_ID } from './data/db.js';
import { toast } from './ui/components.js';
import * as home from './ui/views/home.js';
import * as setup from './ui/views/setup.js';
import * as draft from './ui/views/draft.js';
import * as auction from './ui/views/auction.js';
import * as team from './ui/views/team.js';
import * as season from './ui/views/season.js';
import * as game from './ui/views/game.js';
import * as boxscore from './ui/views/boxscore.js';
import * as players from './ui/views/players.js';
import * as settings from './ui/views/settings.js';

const app = document.getElementById('app');
const navEl = document.getElementById('nav');
const ctx = { getState, update, navigate, byId: PLAYERS_BY_ID, players: PLAYERS, toast };

let cleanup = null;
let activeView = null;
let activeParams = null;

function mount(view, params) {
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  activeView = view; activeParams = params;
  try {
    cleanup = view.view(app, params, ctx) || null;
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="card"><h2>Something broke</h2><p class="muted">${String(e.message || e)}</p><a class="btn" href="#/">Home</a></div>`;
  }
  renderNav();
  window.scrollTo(0, 0);
}

function renderNav() {
  const s = getState();
  const path = currentRoute()?.path || '/';
  const items = [{ href: '#/', label: 'Home', match: '/' }];
  if (s.league) {
    if (s.league.phase === 'draft') {
      const auctionLeague = s.league.draftType === 'auction';
      items.push({ href: auctionLeague ? '#/auction' : '#/draft', label: auctionLeague ? 'Auction' : 'Draft', match: auctionLeague ? '/auction' : '/draft' });
    }
    else items.push({ href: '#/season', label: 'Season', match: '/season' });
    const u = s.league.teams.findIndex((t) => t.isUser);
    items.push({ href: `#/team/${u}`, label: 'My Team', match: `/team/${u}` });
    if (s.game && !s.game.g.final) items.push({ href: '#/game', label: 'Live Game', match: '/game' });
  }
  items.push({ href: '#/players', label: 'Players', match: '/players' });
  items.push({ href: '#/settings', label: 'Settings', match: '/settings' });
  navEl.innerHTML = items.map((i) => `<a href="${i.href}" class="${path === i.match || (i.match !== '/' && path.startsWith(i.match)) ? 'active' : ''}">${i.label}</a>`).join('');
}

route('/', () => mount(home));
route('/new', () => mount(setup));
route('/draft', () => mount(draft));
route('/auction', () => mount(auction));
route('/team/:idx', (p) => mount(team, p));
route('/season', () => mount(season));
route('/game', () => mount(game));
route('/box/:kind/:a/:b', (p) => mount(boxscore, p));
route('/box/:kind', (p) => mount(boxscore, p));
route('/players', () => mount(players));
route('/settings', () => mount(settings));

load();
subscribe(() => { if (activeView && !activeView.selfRendering) mount(activeView, activeParams); else renderNav(); });
startRouter();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e)));
}
