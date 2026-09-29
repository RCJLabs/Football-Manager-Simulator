// Era cards (ui/eracard.js): which frame a season wears, what a card shows of
// a player through the scouting fog, and the markup each place gets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { POSITIONS, POSITION_ORDER, weightsFor } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { overall } from '../src/engine/ratings.js';
import { createLeague, startSeason, registerPlayers } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { generateRookies } from '../src/engine/rookies.js';
import { scoutReport, coarseAttrs } from '../src/engine/scouting.js';
import { DECADES, SHORT, decadeOf, cardFacts, eraCard, houseHead, honourCards, spokenRating, cardFileName } from '../src/ui/eracard.js';

registerPlayers(PLAYERS_BY_ID);
const CSS = readFileSync(new URL('../src/eracards.css', import.meta.url), 'utf8');

function fogged(seed = 5) {
  const lg = createLeague({ name: 'K', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction', injuries: 'normal' });
  autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), PLAYERS_BY_ID);
  startSeason(lg, PLAYERS_BY_ID);
  lg.settings.scouting = true;
  return { lg, view: { league: lg, observer: lg.teams.findIndex((t) => t.isUser) } };
}
/** The best man at each position in the pool. */
const best = Object.fromEntries(POSITION_ORDER.map((pos) => [pos, PLAYERS.filter((p) => p.pos === pos).sort((a, b) => overall(b) - overall(a))[0]]));
const items = (html) => [...html.matchAll(/<li><span class="ec-l">([^<]+)<\/span>.*?<b>(~?)(\d+)<\/b><\/li>/g)].map((m) => ({ label: m[1], est: m[2] === '~', value: Number(m[3]) }));

test('every season wears a frame there is, and every frame is drawn in both kinds of card', () => {
  assert.equal(decadeOf(1941), 1940);
  assert.equal(decadeOf(1959), 1950);
  assert.equal(decadeOf(2024), 2020);
  // Rookie classes run on past the last decade, and wear it.
  assert.equal(decadeOf(2031), 2020);
  assert.equal(decadeOf(1935), 1940);
  for (const p of PLAYERS) assert.ok(DECADES.includes(decadeOf(p.season)), `${p.id}`);
  for (const d of DECADES) {
    assert.match(CSS, new RegExp(`\\.ec-${d} \\{[^}]*background`), `card frame for the ${d}s`);
    assert.match(CSS, new RegExp(`\\.hc-${d} \\.hc-band \\{[^}]*background`), `header band for the ${d}s`);
  }
  for (const def of Object.values(POSITIONS)) for (const a of def.attrs) assert.ok(SHORT[a], `a short name for ${a}`);
});

test('a real player is shown as he is, heaviest attribute first, fog or no fog', () => {
  const { view } = fogged();
  for (const p of Object.values(best)) {
    for (const v of [null, view]) {
      const f = cardFacts(p, v);
      assert.equal(f.known, true);
      assert.equal(f.rating, String(overall(p)));
      assert.equal(f.decade, decadeOf(p.season));
      assert.deepEqual(f.attrs.map((x) => x.attr).sort(), POSITIONS[p.pos].attrs.slice().sort());
      assert.ok(f.attrs.every((x) => x.exact && x.value === p.r[x.attr]));
      const w = weightsFor(p.pos, p.r);
      for (let i = 1; i < f.attrs.length; i++) assert.ok((w[f.attrs[i - 1].attr] || 0) >= (w[f.attrs[i].attr] || 0), `${p.name}: ${f.attrs.map((x) => x.attr)}`);
    }
    assert.equal(spokenRating(p, view), `${overall(p)} overall`);
  }
});

test('a rookie nobody has seen play shows the scouts\' range and rough figures, and nothing truer', () => {
  const { lg, view } = fogged();
  const rookies = generateRookies(lg, new RNG(9), { size: 80, season: 1 });
  let checked = 0;
  for (const p of rookies) {
    const rep = scoutReport(lg, p, view.observer);
    if (rep.known) continue;
    checked++;
    const f = cardFacts(p, view);
    assert.equal(f.known, false);
    assert.equal(f.rating, `${rep.low}–${rep.high}`);
    const coarse = new Map(coarseAttrs(lg, p, view.observer).map((x) => [x.attr, x.value]));
    for (const x of f.attrs) {
      assert.equal(x.exact, false);
      assert.equal(x.value, coarse.get(x.attr), `${p.name} ${x.attr}`);
    }
    // Even the order is read off what is shown, not off the truth.
    const w = weightsFor(p.pos, Object.fromEntries(coarse));
    for (let i = 1; i < f.attrs.length; i++) assert.ok((w[f.attrs[i - 1].attr] || 0) >= (w[f.attrs[i].attr] || 0));
    const card = eraCard(p, { view, wide: true });
    assert.match(card, /class="ec ec-2020 ec-wide ec-range ec-rookie"/);
    assert.ok(card.includes(`${rep.low}–${rep.high}</span>`), 'the range is the rating');
    assert.ok(card.includes(`Class of ${p.season}`));
    assert.deepEqual(items(card).map((x) => [x.est, x.value]), f.attrs.map((x) => [true, x.value]));
    assert.equal(spokenRating(p, view), `scouted at ${rep.low} to ${rep.high}`);
  }
  assert.ok(checked >= 20, `only ${checked} unscouted rookies to look at`);
  // With scouting off, a rookie is what he is.
  lg.settings.scouting = false;
  const p = rookies[0];
  assert.equal(cardFacts(p, view).rating, String(overall(p)));
  assert.ok(cardFacts(p, view).attrs.every((x) => x.exact));
});

test('a portrait card lists the four he leans on, a wide one lists them all, and a kicker has his two', () => {
  const rb = best.RB, k = best.K;
  const portrait = eraCard(rb, { view: null }), wide = eraCard(rb, { view: null, wide: true });
  const four = cardFacts(rb, null).attrs.slice(0, 4).map((x) => SHORT[x.attr]);
  assert.deepEqual(items(portrait).map((x) => x.label), four);
  assert.equal(items(wide).length, POSITIONS.RB.attrs.length);
  assert.ok(items(wide).every((x) => !x.est && x.value === rb.r[cardFacts(rb, null).attrs.find((a) => SHORT[a.attr] === x.label).attr]));
  assert.equal(items(eraCard(k, { view: null })).length, 2);
  assert.match(portrait, new RegExp(`class="ec ec-${decadeOf(rb.season)}"`));
  assert.ok(portrait.includes(`<span class="ec-tag">${rb.season} ${rb.team}</span>`));
  // The position is the art, and the art is hidden from a screen reader, which reads the sub line instead.
  assert.match(portrait, new RegExp(`<div class="ec-art" aria-hidden="true"><span class="ec-big">${rb.pos}</span></div>`));
  assert.ok(portrait.includes(`<span class="sr-only">Overall </span>${overall(rb)}</span>`));
});

test('a name is escaped, and opens his player card when the place asks for that', () => {
  const p = { ...best.QB, id: 'x"1', name: 'Ed <b>"Too Tall"</b> & Co' };
  const card = eraCard(p, { view: null, tap: true });
  assert.ok(card.includes('Ed &lt;b&gt;&quot;Too Tall&quot;&lt;/b&gt; &amp; Co'));
  assert.ok(!card.includes('<b>"Too Tall"'));
  assert.ok(card.includes('<button type="button" class="tap" data-show="x&quot;1">'));
  assert.ok(!eraCard(p, { view: null }).includes('data-show'));
  assert.ok(houseHead(p).includes('<h2 class="hc-name">Ed &lt;b&gt;'));
});

test('honours: a card a man with every honour he took on it, and nothing for a season without them', () => {
  const qb = best.QB, lb = best.LB;
  const awards = { mvp: { id: qb.id, team: 0, line: '4,100 yds' }, offensive: { id: qb.id, team: 0, line: '4,100 yds' }, defensive: { id: lb.id, team: 1, line: '14 sacks' }, kicker: null };
  const html = honourCards(awards, PLAYERS_BY_ID, [{ abbr: 'AAA' }, { abbr: 'BBB' }], { view: null });
  assert.equal((html.match(/<article /g) || []).length, 2);
  assert.ok(html.includes('<span class="ec-cap">Most valuable player · Offensive player</span>'));
  assert.ok(html.includes('<span class="ec-cap">Defensive player</span>'));
  assert.ok(html.includes('<span class="ec-line">BBB · 14 sacks</span>'));
  assert.ok(html.includes(`data-show="${qb.id}"`), 'the names open the player card');
  assert.equal(honourCards(null, PLAYERS_BY_ID, []), '');
  assert.equal(honourCards({ mvp: { id: 'nobody', team: 0 } }, PLAYERS_BY_ID, []), '');
});

test('the player card header carries his decade and year, and says so when he is a rookie', () => {
  const p = best.LB;
  const h = houseHead(p, { rating: '<span id="ovrNow">94</span>', actions: '<button>x</button>' });
  assert.match(h, new RegExp(`<header class="hc hc-${decadeOf(p.season)}">`));
  const y = String(p.season);
  assert.ok(h.includes(`<span class="hc-year">${y.slice(0, 2)}<b>${y.slice(2)}</b></span>`));
  assert.ok(h.includes('<span id="ovrNow">94</span><span class="badge pos">LB</span><span class="hc-actions"><button>x</button></span>'));
  assert.ok(h.includes(`Linebacker · ${p.season} ${p.team} · ${Math.floor(p.season / 10) * 10}s`));
  const rk = { ...p, generated: true, season: 2031, team: 'RK' };
  assert.match(houseHead(rk), /<header class="hc hc-2020">/);
  assert.ok(houseHead(rk).includes('generated rookie, class of 2031'));
});

test('a card picture is named for the man and his season', () => {
  assert.equal(cardFileName({ name: 'Ed "Too Tall" Jones', season: 1977 }), 'ed-too-tall-jones-1977.png');
  assert.equal(cardFileName({ name: 'Dominique Rodgers-Cromartie', season: 2009 }), 'dominique-rodgers-cromartie-2009.png');
});
