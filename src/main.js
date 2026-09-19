import { load, getState, subscribe, update } from './store.js';
import { route, startRouter, navigate, currentRoute } from './router.js';
import { PLAYERS, PLAYERS_BY_ID } from './data/db.js';
import { registerPlayers } from './engine/season.js';
import { applyNameMode } from './data/names.js';
import { applyOverrides } from './data/tuning.js';
import { leaguePool, leagueIndex } from './engine/rookies.js';
import { applyCareers, careerIndex } from './engine/careers.js';
import { toast } from './ui/components.js';
import * as home from './ui/views/home.js';
import * as setup from './ui/views/setup.js';
import * as draft from './ui/views/draft.js';
import * as auction from './ui/views/auction.js';
import * as moves from './ui/views/moves.js';
import * as offseason from './ui/views/offseason.js';
import * as awards from './ui/views/awards.js';
import * as team from './ui/views/team.js';
import * as season from './ui/views/season.js';
import * as game from './ui/views/game.js';
import * as boxscore from './ui/views/boxscore.js';
import * as players from './ui/views/players.js';
import * as settings from './ui/views/settings.js';
import * as career from './ui/views/career.js';
import * as guide from './ui/views/guide.js';

const app = document.getElementById('app');
const navEl = document.getElementById('nav');
// The pool the app plays with is the shipped file plus the open league's own
// generated rookies. Rebuilt only when that array is replaced, which the
// rookie and career code both replace their state rather than mutating it.
let poolCache = { rookies: null, dev: null, retired: null, players: PLAYERS, byId: PLAYERS_BY_ID };
function currentPool() {
  const lg = getState().league;
  const rookies = lg?.rookies || null;
  const dev = lg?.dev || null;
  const retired = lg?.retired || null;
  if (poolCache.rookies !== rookies || poolCache.dev !== dev || poolCache.retired !== retired) {
    const view = { rookies, dev, retired };
    poolCache = {
      rookies, dev, retired,
      players: applyCareers(view, leaguePool(view, PLAYERS)),
      byId: careerIndex(view, leagueIndex(view, PLAYERS_BY_ID)),
    };
    registerPlayers(poolCache.byId);
  }
  return poolCache;
}

const ctx = {
  getState, update, navigate, toast,
  get players() { return currentPool().players; },
  get byId() { return currentPool().byId; },
};

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
    else if (s.league.phase === 'offseason') items.push({ href: '#/offseason', label: 'Offseason', match: '/offseason' });
    else items.push({ href: '#/season', label: 'Season', match: '/season' });
    const u = s.league.teams.findIndex((t) => t.isUser);
    items.push({ href: `#/team/${u}`, label: 'My Team', match: `/team/${u}` });
    if (s.league.phase === 'season' || s.league.phase === 'playoffs') items.push({ href: '#/moves', label: 'Moves', match: '/moves' });
    if (s.league.phase !== 'draft') items.push({ href: '#/awards', label: 'Awards', match: '/awards' });
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
route('/moves/:tab', (p) => mount(moves, p));
route('/moves', () => mount(moves));
route('/offseason', () => mount(offseason));
route('/awards/:tab', (p) => mount(awards, p));
route('/awards', () => mount(awards));
route('/team/:idx', (p) => mount(team, p));
route('/season', () => mount(season));
route('/game', () => mount(game));
route('/box/:kind/:a/:b', (p) => mount(boxscore, p));
route('/box/:kind', (p) => mount(boxscore, p));
route('/players', () => mount(players));
route('/career', () => mount(career));
route('/guide', () => mount(guide));
route('/settings', () => mount(settings));

registerPlayers(PLAYERS_BY_ID);
load();
// Preferences that reshape the pool: fictional names and rating edits.
{
  const prefs = getState().prefs || {};
  applyOverrides(PLAYERS, PLAYERS_BY_ID, prefs.ratingOverrides || {});
  applyNameMode(PLAYERS, prefs.nameMode || 'real');
}
subscribe(() => { if (activeView && !activeView.selfRendering) mount(activeView, activeParams); else renderNav(); });
startRouter();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e)));
}
