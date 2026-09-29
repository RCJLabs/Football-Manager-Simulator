// Era cards: a player as a card dressed in the decade he played in.
//
// One markup for every card; the decade is a class and each decade's look is
// CSS alone (src/eracards.css), so a card draws at any size, in either theme,
// with no picture in it. No faces: the players are real people, so the art is
// his position, set in his decade's type.
//
// Full cards go where a card is the moment (the man on the auction block, your
// pick as the room carries on, a season's honours); the player card gets only
// a restrained header, `houseHead`, because it is a page to read rather than a
// thing to look at. DESIGN.md "Era cards".
//
// Every figure on a card comes through the scouting fog: a rookie nobody has
// seen play reads as a range, with his attributes to the nearest five, exactly
// as `ovrBadge` and `attrList` show him.
import { POSITIONS, eraOf, weightsFor } from '../data/positions.js';
import { overall } from '../engine/ratings.js';
import { scoutReport, coarseAttrs } from '../engine/scouting.js';
import { getState } from '../store.js';
import { esc } from '../util.js';

/** The decades there is a frame for. Later seasons (rookie classes) wear the last. */
export const DECADES = [1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];
export const decadeOf = (season) => Math.max(DECADES[0], Math.min(DECADES[DECADES.length - 1], Math.floor(season / 10) * 10));

/** Attribute names short enough for a card. */
export const SHORT = {
  spd: 'Speed', awr: 'Awareness', thp: 'Arm', tha: 'Accuracy', mob: 'Mobility', elu: 'Elusiveness', pow: 'Power', rec: 'Hands',
  car: 'Ball care', cth: 'Catching', rte: 'Routes', rac: 'After catch', blk: 'Blocking', pbk: 'Pass block', rbk: 'Run block',
  prs: 'Pass rush', rsd: 'Run stop', tck: 'Tackling', cov: 'Coverage', bal: 'Ball skills', kpw: 'Leg', kac: 'Accuracy', ppw: 'Leg', pac: 'Placement',
};

/** Whose eyes, as `scoutView` in components.js reads them: the store's league and the human's club. */
function storeView() {
  const lg = getState().league;
  return lg ? { league: lg, observer: lg.teams.findIndex((t) => t.isUser) } : null;
}

/**
 * What a card shows of a player. `view` is `{ league, observer }`, null for no
 * fog at all, or left out to read the store. `attrs` come heaviest first by the
 * weights his rating is taken on, read off the figures shown rather than the
 * true ones, so even the order cannot say more than the scouts can.
 */
export function cardFacts(p, view = storeView()) {
  const rep = view ? scoutReport(view.league, p, view.observer) : null;
  const known = !rep || rep.known;
  const shown = view ? coarseAttrs(view.league, p, view.observer) : POSITIONS[p.pos].attrs.map((a) => ({ attr: a, value: p.r[a], exact: true }));
  const w = weightsFor(p.pos, Object.fromEntries(shown.map((x) => [x.attr, x.value])));
  const attrs = shown.slice().sort((a, b) => (w[b.attr] || 0) - (w[a.attr] || 0));
  return { known, rating: known ? String(overall(p)) : `${rep.low}–${rep.high}`, attrs, decade: decadeOf(p.season) };
}

/**
 * The rating as it is said aloud: "94 overall", or for a rookie the scouts
 * have only projected, "scouted at 72 to 84". The auction's line for a screen
 * reader read the true overall, which in a rookie auction said aloud the very
 * number the card on the block shows as a range.
 */
export function spokenRating(p, view) {
  const f = cardFacts(p, view);
  return f.known ? `${f.rating} overall` : `scouted at ${f.rating.replace('–', ' to ')}`;
}

/**
 * A card. Portrait by default, four attributes; `wide` lays it on its side and
 * lists them all. `tap` makes the name open the player card (the view must
 * handle `[data-show]`, as every player list already does).
 */
export function eraCard(p, { view, wide = false, tap = false, cls = '' } = {}) {
  const f = cardFacts(p, view);
  const pos = POSITIONS[p.pos];
  const rows = (wide ? f.attrs : f.attrs.slice(0, 4)).map(({ attr, value, exact }) =>
    `<li><span class="ec-l">${SHORT[attr] || attr}</span><span class="ec-bar" aria-hidden="true"><i style="width:${value}%"></i></span><b>${exact ? '' : '~'}${value}</b></li>`).join('');
  const when = p.generated ? `Class of ${p.season}` : `${p.season} ${esc(p.team)}`;
  const name = tap ? `<button type="button" class="tap" data-show="${esc(p.id)}">${esc(p.name)}</button>` : esc(p.name);
  const classes = ['ec', `ec-${f.decade}`, wide && 'ec-wide', !f.known && 'ec-range', p.generated && 'ec-rookie', cls].filter(Boolean).join(' ');
  return `<article class="${classes}" data-card="${esc(p.id)}">
  <div class="ec-in">
    <div class="ec-head"><span class="ec-ovr"><span class="sr-only">${f.known ? 'Overall' : 'Scouted at'} </span>${f.rating}</span><span class="ec-tag">${when}</span></div>
    <div class="ec-art" aria-hidden="true"><span class="ec-big">${p.pos}</span>${p.generated ? '<span class="ec-rk">Rookie</span>' : ''}</div>
    <div class="ec-plate"><div class="ec-name">${name}</div><div class="ec-sub">${pos.name} · ${p.generated ? 'draft class' : eraOf(p.season)}</div></div>
    <ul class="ec-attrs" aria-label="${wide ? 'Ratings' : 'Key ratings'}">${rows}</ul>
  </div>
</article>`;
}

/**
 * The player card's header: his decade as a band with the year set in it,
 * then the name and what he is. `rating` and `actions` are the caller's own
 * markup (the overall the rating editor rewrites in place, the compare and
 * close buttons), so this stays out of the modal's business.
 */
export function houseHead(p, { rating = '', actions = '' } = {}) {
  const pos = POSITIONS[p.pos];
  const y = String(p.season);
  return `<header class="hc hc-${decadeOf(p.season)}">
  <div class="hc-band" aria-hidden="true"><span class="hc-year">${y.slice(0, 2)}<b>${y.slice(2)}</b></span></div>
  <div class="hc-body">
    <div class="hc-top">${rating}<span class="badge pos">${p.pos}</span>${actions ? `<span class="hc-actions">${actions}</span>` : ''}</div>
    <h2 class="hc-name">${esc(p.name)}</h2>
    <p class="hc-sub">${pos.name} · ${p.generated ? `generated rookie, class of ${p.season}` : `${p.season} ${esc(p.team)} · ${eraOf(p.season)}`}</p>
  </div>
</header>`;
}

/**
 * A season's honours as cards: MVP, offensive and defensive player, one card a
 * man with every honour he took on it (a quarterback is often both MVP and
 * the best on offence). `awards` is `seasonAwards` or a season's stored copy.
 */
export function honourCards(awards, byId, teams, { view } = {}) {
  const got = [];
  for (const [label, e] of [['Most valuable player', awards?.mvp], ['Offensive player', awards?.offensive], ['Defensive player', awards?.defensive]]) {
    if (!e || !byId.get(e.id)) continue;
    const same = got.find((g) => g.e.id === e.id);
    if (same) same.labels.push(label);
    else got.push({ e, labels: [label] });
  }
  if (!got.length) return '';
  return `<div class="ec-strip"><ul>${got.map(({ e, labels }) => {
    const club = teams?.[e.team];
    return `<li><span class="ec-cap">${labels.join(' · ')}</span>${eraCard(byId.get(e.id), { view, tap: true })}<span class="ec-line">${club ? `${esc(club.abbr)} · ` : ''}${esc(e.line || '')}</span></li>`;
  }).join('')}</ul></div>`;
}

/**
 * The card as a picture, for sharing. The browser draws it from the card's own
 * markup and stylesheet: the card goes into an SVG's foreignObject and the SVG
 * onto a canvas. Painting nine decades onto a canvas by hand would be a second
 * renderer to keep in step with the CSS, and it would drift with the first
 * change; this cannot. The system fonts the cards are limited to are the ones
 * an SVG drawn as an image is allowed to use.
 *
 * `px` is the card's font-size in the picture: 36 gives a card about 600
 * pixels wide, with room round it for its shadow.
 */
export async function cardCanvas(p, { px = 36, view } = {}) {
  const host = document.createElement('div');
  host.innerHTML = eraCard(p, { view });
  const card = host.firstElementChild;
  // Words only a screen reader was meant to hear would be printed on it.
  for (const n of card.querySelectorAll('.sr-only')) n.remove();
  card.style.fontSize = `${px}px`;
  const pad = 2 * px;
  const W = Math.round(16.5 * px) + 2 * pad, H = Math.round(16.5 * px * 7 / 5) + 2 * pad;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="padding:${pad}px"><style><![CDATA[${await cardStyles()}]]></style>${new XMLSerializer().serializeToString(card)}</div></foreignObject></svg>`;
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvas;
}

/**
 * Whether this browser will let a card picture out. Not every browser lets a
 * canvas that has drawn a foreignObject be read back (Safari has refused), so
 * the share button is offered only once a two-pixel trial has been. Asked
 * once a session.
 */
let supported = null;
export function cardImageSupported() {
  supported ??= (async () => {
    try {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><foreignObject width="2" height="2"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>';
      const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      const c = document.createElement('canvas');
      c.width = 2; c.height = 2;
      c.getContext('2d').drawImage(img, 0, 0);
      c.toDataURL('image/png');
      return true;
    } catch {
      return false;
    }
  })();
  return supported;
}

/** A file name for a card: "lawrence-taylor-1986.png". */
export const cardFileName = (p) => `${`${p.name}-${p.season}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.png`;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not draw the card'));
    img.src = src;
  });
}

/** The cards' stylesheet as text, read from the page that already loaded it. */
let styles = null;
async function cardStyles() {
  if (styles) return styles;
  try {
    const sheet = [...document.styleSheets].find((s) => s.href && s.href.endsWith('/eracards.css'));
    if (sheet) styles = [...sheet.cssRules].map((r) => r.cssText).join('\n');
  } catch { /* a sheet the page may not read: fetch it instead */ }
  styles ||= await (await fetch(new URL('../eracards.css', import.meta.url))).text();
  return styles;
}
