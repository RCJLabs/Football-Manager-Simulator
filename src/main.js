import { load, getState, subscribe, update, saveError, notify } from './store.js';
import { route, startRouter, navigate, currentRoute } from './router.js';
import { PLAYERS, PLAYERS_BY_ID } from './data/db.js';
import { registerPlayers } from './engine/season.js';
import { applyNameMode } from './data/names.js';
import { applyOverrides } from './data/tuning.js';
import { leaguePool, leagueIndex } from './engine/rookies.js';
import { applyCareers, careerIndex } from './engine/careers.js';
import { toast } from './ui/components.js';
import { esc } from './util.js';
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
const saveWarnEl = document.getElementById('savewarn');
const moreEl = document.getElementById('navMore');
const menuEl = document.getElementById('navMenu');
const tabEl = document.getElementById('tabbar');

/**
 * Glyphs for the bottom bar. Inline, stroked, on a 24 grid — the same way the
 * win-probability and drive charts are drawn, so there is still nothing to
 * fetch and they take the colour of the text around them.
 */
const ICONS = {
  home: 'M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z',
  season: 'M4 6h16v14H4zM8 3v4M16 3v4M4 10h16',
  draft: 'M4 6h16M4 12h16M4 18h10M18 16l2 2 3-4',
  team: 'M12 3l7 3v6c0 4.4-3 7.3-7 8.4C8 19.3 5 16.4 5 12V6z',
  moves: 'M7 7h12l-3-3M17 17H5l3 3',
  awards: 'M7 4h10v5a5 5 0 01-10 0zM9 20h6M12 14v6M7 6H4v1a3 3 0 003 3M17 6h3v1a3 3 0 01-3 3',
  live: 'M8 5v14l11-7z',
  players: 'M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3.3 2.7-5 6-5s6 1.7 6 5M17.5 11a2.5 2.5 0 100-5M17 15.5c2.8 0 5 1.6 5 4.5',
  settings: 'M4 7h16M4 12h16M4 17h16M9 5v4M16 10v4M12 15v4',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name] || ICONS.more}"/></svg>`;

/** How many destinations a phone gets before the rest fold into More. */
const MAX_TABS = 5;
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
  getState, update, navigate, toast, notify,
  get players() { return currentPool().players; },
  get byId() { return currentPool().byId; },
};

let cleanup = null;
let booted = false;
let activeView = null;
let activeParams = null;

/** Two mounts are the same screen when the view and its route params match. */
function sameScreen(view, params) {
  if (view !== activeView) return false;
  const a = params || {}, b = activeParams || {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (String(a[k]) !== String(b[k])) return false;
  return true;
}

function mount(view, params) {
  // Every state change re-renders the open view through the same path a route
  // change takes, so scrolling to the top unconditionally meant that moving one
  // player down the depth chart threw you back to the top of a page four and a
  // half screens long. A new screen starts at the top; the same screen redrawn
  // stays where the player left it.
  const stayPut = sameScreen(view, params);
  const y = stayPut ? window.scrollY : 0;
  // Whether focus is somewhere the player put it, or somewhere a redraw left
  // it. This runs on every state change and not just on navigation, so moving
  // focus unconditionally would snatch it away each time a depth-chart arrow
  // was pressed — worse than never moving it at all.
  const movedScreen = !stayPut && booted;
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  activeView = view; activeParams = params;
  try {
    cleanup = view.view(app, params, ctx) || null;
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="card"><h2>Something broke</h2><p class="muted">${String(e.message || e)}</p><a class="btn" href="#/">Home</a></div>`;
  }
  renderNav();
  renderSaveWarning();
  // The redrawn page can be shorter than the old scroll position, so let the
  // browser lay it out first and clamp to what is actually there.
  if (stayPut && y) requestAnimationFrame(() => window.scrollTo(0, Math.min(y, document.documentElement.scrollHeight - window.innerHeight)));
  else window.scrollTo(0, 0);
  // A single-page app changes the whole screen without the browser doing any of
  // the things that normally tell a screen reader so. Moving focus to the new
  // view is what stands in for that: the reader starts reading here rather than
  // leaving the cursor on a link that no longer describes where you are. Not on
  // the first mount, which would interrupt the page the player just opened.
  if (movedScreen) app.focus({ preventScroll: true });
  booted = true;
}

/**
 * The one message the player has to see whatever screen they are on: the
 * browser has stopped accepting saves. It sits above the view rather than in a
 * toast because a toast that disappears is exactly wrong here — every move made
 * after this point is being lost, and they need the notice to still be there
 * when they decide what to do about it. Exporting still works when storage is
 * full, since it reads the league out of memory, so that is what it offers.
 */
const skipEl = document.getElementById('skipnav');
if (skipEl) skipEl.addEventListener('click', () => app.focus({ preventScroll: false }));

function renderSaveWarning() {
  if (!saveWarnEl) return;
  const err = saveError();
  // A migration that quietly rewrote somebody's contracts is a migration that
  // looks like a bug the next time they open the keeper screen. It is said in
  // the same place a save problem is said, and it stays until it is read:
  // clearing it here would fire `update`, which re-renders this banner, so the
  // message would appear and vanish inside one tick.
  const note = getState().league?.migrationNote;
  if (!err && note) {
    saveWarnEl.innerHTML = `<strong>This league was brought up to date.</strong> ${esc(note)} `
      + '<button class="btn sm ghost" data-clearnote>Got it</button>';
    saveWarnEl.hidden = false;
    return;
  }
  if (!err) { saveWarnEl.hidden = true; saveWarnEl.innerHTML = ''; return; }
  const why = err.quota
    ? 'This browser is out of storage room, so nothing since then has been written down.'
    : `The browser refused the write (${esc(err.message)}), so nothing since then has been written down.`;
  saveWarnEl.innerHTML = `<strong>Your progress is not being saved.</strong> ${why} `
    + 'Export this league to a file now — that still works — then delete a league you have finished with to free up room. '
    + '<a href="#/settings">Settings</a> · <a href="#/">Your leagues</a>';
  saveWarnEl.hidden = false;
}

/**
 * Every destination, in the order the top bar lists them. `tab` is how it ranks
 * for the phone's bottom bar, which only has room for five: a game in progress
 * is the thing you are in the middle of and jumps the queue there without
 * moving in the bar above.
 */
function navItems() {
  const s = getState();
  const items = [{ href: '#/', label: 'Home', match: '/', icon: 'home', tab: 0, owns: ['/guide', '/new'] }];
  if (s.league) {
    if (s.league.phase === 'draft') {
      const auctionLeague = s.league.draftType === 'auction';
      items.push({ href: auctionLeague ? '#/auction' : '#/draft', label: auctionLeague ? 'Auction' : 'Draft', match: auctionLeague ? '/auction' : '/draft', icon: 'draft', tab: 2 });
    }
    else if (s.league.phase === 'offseason') items.push({ href: '#/offseason', label: 'Offseason', match: '/offseason', icon: 'season', tab: 2, owns: ['/box', '/career'] });
    else items.push({ href: '#/season', label: 'Season', match: '/season', icon: 'season', tab: 2, owns: ['/box', '/career'] });
    const u = s.league.teams.findIndex((t) => t.isUser);
    items.push({ href: `#/team/${u}`, label: 'My Team', match: `/team/${u}`, icon: 'team', tab: 3 });
    if (s.league.phase === 'season' || s.league.phase === 'playoffs') items.push({ href: '#/moves', label: 'Moves', match: '/moves', icon: 'moves', tab: 4 });
    if (s.league.phase !== 'draft') items.push({ href: '#/awards', label: 'Awards', match: '/awards', icon: 'awards', tab: 6 });
    if (s.game && !s.game.g.final) items.push({ href: '#/game', label: 'Live Game', match: '/game', icon: 'live', tab: 1 });
  }
  items.push({ href: '#/players', label: 'Players', match: '/players', icon: 'players', tab: 7 });
  items.push({ href: '#/settings', label: 'Settings', match: '/settings', icon: 'settings', tab: 8 });
  return items;
}

function renderNav() {
  const path = currentRoute()?.path || '/';
  const items = navItems();
  // A box score, the guide, your coaching career: reached from a destination
  // rather than being one. They light the tab they were opened from, so the bar
  // always says where you are instead of going dark on every sub-screen.
  const isActive = (i) => path === i.match
    || (i.match !== '/' && path.startsWith(i.match))
    || (i.owns || []).some((p) => path.startsWith(p));
  // `aria-current="page"` as well as the class: the highlight tells a sighted
  // reader where they are and told a screen reader nothing at all.
  navEl.innerHTML = items.map((i) => `<a href="${i.href}" class="${isActive(i) ? 'active' : ''}"${isActive(i) ? ' aria-current="page"' : ''}>${i.label}</a>`).join('');
  renderTabs(items, isActive);
  fitNav();
}

/**
 * The bottom bar: five destinations within reach of a thumb, which is where a
 * phone wants them and where an app installed from a store puts them. The top
 * strip stays for wide screens, where a row of pills along the top is right and
 * a bar pinned to the bottom of a monitor is not.
 *
 * The same rule as the top bar applies — whatever does not fit is in More, and
 * the screen you are on is never the thing hidden. Here that is stronger: if
 * the active screen would have been folded away it takes the last slot, so the
 * bar always has a lit tab and never looks like it has lost you.
 */
function renderTabs(items, isActive) {
  if (!tabEl) return;
  const ranked = items.slice().sort((a, b) => a.tab - b.tab);
  let shown = ranked, spilled = [];
  if (ranked.length > MAX_TABS) {
    shown = ranked.slice(0, MAX_TABS - 1);
    spilled = ranked.slice(MAX_TABS - 1);
    const active = spilled.find(isActive);
    if (active) {
      spilled = spilled.filter((i) => i !== active);
      spilled.unshift(shown.pop());
      shown.push(active);
    }
  }
  const tab = (i) => `<a href="${i.href}" class="tabitem ${isActive(i) ? 'active' : ''}"${isActive(i) ? ' aria-current="page"' : ''}>${icon(i.icon)}<span>${i.label}</span></a>`;
  tabEl.innerHTML = shown.map(tab).join('')
    + (spilled.length ? `<button type="button" class="tabitem" id="tabMore" aria-haspopup="true" aria-expanded="false">${icon('more')}<span>More</span></button>` : '');
  // One menu serves both bars; the bottom one opens it against the bottom bar.
  tabEl.querySelector('#tabMore')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = tabEl.querySelector('#tabMore');
    const open = menuEl.hidden;
    if (!open) { closeNavMenu(); return; }
    menuEl.innerHTML = spilled.map((i) => `<a href="${i.href}" role="menuitem" class="${isActive(i) ? 'active' : ''}"${isActive(i) ? ' aria-current="page"' : ''}>${i.label}</a>`).join('');
    placeNavMenu(btn, true);
    btn.setAttribute('aria-expanded', 'true');
  });
}

/**
 * Put whatever does not fit into a menu instead of behind a sideways scroll.
 *
 * The strip is `overflow-x: auto`, so nothing was ever unreachable — but a nav
 * bar that scrolls sideways does not look like one, and there is no fade or
 * arrow to say so. Measured at 360px with a league open, 340px of items sat in
 * a 309px strip and Settings was simply off the end; in a pro league Awards and
 * Players went with it. So the items that fit stay, the rest move into a "More"
 * menu that is always at the right-hand edge, and on a wide screen where
 * everything fits the button never appears at all.
 */
function fitNav() {
  if (!moreEl || !menuEl) return;
  const links = [...navEl.querySelectorAll('a')];
  for (const a of links) a.hidden = false;
  moreEl.hidden = true;
  closeNavMenu();
  // A scrollWidth over clientWidth is the strip admitting it does not fit.
  if (navEl.scrollWidth <= navEl.clientWidth + 1) { menuEl.innerHTML = ''; return; }

  moreEl.hidden = false;
  for (let i = links.length - 1; i > 0; i--) {
    if (navEl.scrollWidth <= navEl.clientWidth + 1) break;
    links[i].hidden = true;
  }
  // Whatever screen you are on stays on the bar, even if it sorts to the end:
  // a nav that hides the page you are looking at is worse than one that scrolls.
  const active = links.find((a) => a.classList.contains('active'));
  if (active && active.hidden) {
    active.hidden = false;
    for (let i = links.length - 1; i > 0; i--) {
      if (navEl.scrollWidth <= navEl.clientWidth + 1) break;
      if (!links[i].hidden && links[i] !== active) links[i].hidden = true;
    }
  }
  const spilled = links.filter((a) => a.hidden);
  menuEl.innerHTML = spilled.map((a) => `<a href="${a.getAttribute('href')}" role="menuitem" class="${a.className}">${a.textContent}</a>`).join('');
  if (!spilled.length) moreEl.hidden = true;
}

/**
 * Put the menu where its button is: under a top-bar button, above a bottom-bar
 * one, and always inside the screen. Done here rather than in CSS because the
 * two bars sit at opposite ends and the safe area is only known at runtime.
 */
function placeNavMenu(anchor, above) {
  const a = anchor.getBoundingClientRect();
  menuEl.style.visibility = 'hidden';
  menuEl.hidden = false;
  const m = menuEl.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - m.width - 8, a.right - m.width));
  menuEl.style.left = `${Math.round(left)}px`;
  menuEl.style.top = above ? `${Math.round(Math.max(8, a.top - m.height - 6))}px` : `${Math.round(a.bottom + 6)}px`;
  menuEl.style.visibility = '';
}

function closeNavMenu() {
  if (!menuEl) return;
  menuEl.hidden = true;
  moreEl?.setAttribute('aria-expanded', 'false');
  tabEl?.querySelector('#tabMore')?.setAttribute('aria-expanded', 'false');
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
route('/team/:idx/:tab', (p) => mount(team, p));
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
moreEl?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!menuEl.hidden) { closeNavMenu(); return; }
  placeNavMenu(moreEl, false);
  moreEl.setAttribute('aria-expanded', 'true');
});
menuEl?.addEventListener('click', () => closeNavMenu());
document.addEventListener('click', (e) => {
  if (menuEl?.hidden) return;
  if (menuEl.contains(e.target) || e.target === moreEl || e.target.closest?.('#tabMore')) return;
  closeNavMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNavMenu(); });
// The bar has to be refitted when the width changes, or a phone turned sideways
// keeps items in the menu that would now fit on it.
let navFitTimer = null;
window.addEventListener('resize', () => { clearTimeout(navFitTimer); navFitTimer = setTimeout(fitNav, 120); });

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-clearnote]')) return;
  update((st) => { if (st.league) delete st.league.migrationNote; });
});

subscribe(() => { if (activeView && !activeView.selfRendering) mount(activeView, activeParams); else { renderNav(); renderSaveWarning(); } });
startRouter();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e)));
}
