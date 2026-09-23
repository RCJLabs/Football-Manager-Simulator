import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { overall } from '../src/engine/ratings.js';
import { createLeague, startSeason, registerPlayers } from '../src/engine/season.js';
import { autoCompleteAll, priceGuide, availablePlayers } from '../src/engine/auction.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { generateRookies, leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { applyCareers, careerIndex, startCareer } from '../src/engine/careers.js';
import {
  scoutReport, scoutedOverall, shownOverall, marketView, isScouted, scoutingOn, accuracyOf,
  coarseAttrs, scoutLabel, scoutingHits, MIN_WIDTH, UPSIDE_WEIGHT, USER_ACCURACY,
} from '../src/engine/scouting.js';

registerPlayers(PLAYERS_BY_ID);

function league(seed, opts = {}) {
  const lg = createLeague({ name: 'K', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction', injuries: 'normal', ...opts });
  autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), PLAYERS_BY_ID);
  startSeason(lg, PLAYERS_BY_ID);
  return lg;
}
const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
const pool = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));
const userIdx = (lg) => lg.teams.findIndex((t) => t.isUser);
const klass = (lg, n = 200) => generateRookies(lg, new RNG(lg.seed + 1), { size: n, season: 1 });

test('real players are never fogged, whatever the setting', () => {
  const lg = league(3);
  lg.settings.scouting = true;
  for (const p of PLAYERS.slice(0, 40)) {
    const r = scoutReport(lg, p, userIdx(lg));
    assert.equal(r.known, true, `${p.name} should never be hidden`);
    assert.equal(r.low, overall(p));
    assert.equal(r.high, overall(p));
  }
});

test('an unplayed rookie shows a band, and it always contains what he is today', () => {
  const lg = league(4);
  lg.settings.scouting = true;
  const rookies = klass(lg, 300);
  let widest = 0;
  for (const p of rookies) {
    const r = scoutReport(lg, p, userIdx(lg));
    assert.equal(r.known, false);
    assert.ok(r.high - r.low >= MIN_WIDTH, `band ${r.low}-${r.high} claims more precision than anyone has`);
    assert.ok(overall(p) >= r.low && overall(p) <= r.high, `${overall(p)} outside ${r.low}-${r.high}`);
    widest = Math.max(widest, r.high - r.low);
  }
  assert.ok(widest >= 20, `no prospect in 300 read as boom-or-bust (widest ${widest})`);
});

test('the width of a band tracks real upside rather than being noise', () => {
  const lg = league(5);
  lg.settings.scouting = true;
  const rows = klass(lg, 300).map((p) => ({
    width: scoutReport(lg, p, userIdx(lg)).width,
    room: Math.max(0, (startCareer(lg, p).ceiling ?? 0) - overall(p)),
  }));
  const wide = rows.filter((r) => r.width >= 18);
  const narrow = rows.filter((r) => r.width <= 8);
  assert.ok(wide.length > 10 && narrow.length > 10, 'need both kinds to compare');
  const mean = (a, k) => a.reduce((s, x) => s + x[k], 0) / a.length;
  assert.ok(mean(wide, 'room') > mean(narrow, 'room') + 8,
    `a wide band should mean real room: ${mean(wide, 'room').toFixed(1)} vs ${mean(narrow, 'room').toFixed(1)}`);
  assert.equal(scoutLabel({ known: false, width: 25 }), 'boom or bust');
  assert.equal(scoutLabel({ known: true, width: 0 }), '');
});

test('two clubs read the same prospect differently, and the shrewd ones read better', () => {
  const lg = league(6);
  lg.settings.scouting = true;
  const rookies = klass(lg, 400);
  // The read a perfect scout would make, off the same draws: what each club
  // is trying to see.
  const fair = (p) => scoutedOverall(lg, p, 0, { accuracy: 1 });
  const err = lg.teams.map((_, i) => {
    const e = rookies.map((p) => Math.abs(scoutedOverall(lg, p, i) - fair(p)));
    return { acc: accuracyOf(lg, i), err: e.reduce((a, b) => a + b, 0) / e.length };
  });
  const best = err.reduce((a, b) => (a.acc > b.acc ? a : b));
  const worst = err.reduce((a, b) => (a.acc < b.acc ? a : b));
  assert.ok(best.err < worst.err, `savvy ${best.acc} erred ${best.err.toFixed(2)}, naive ${worst.acc} erred ${worst.err.toFixed(2)}`);
  // And two clubs genuinely disagree, or there is no market.
  const p = rookies[3];
  const views = lg.teams.map((_, i) => scoutedOverall(lg, p, i));
  assert.ok(new Set(views).size > 1, 'every club read him identically');
});

test('the asking price is built from the room, not from the truth', () => {
  const lg = league(7);
  lg.settings.scouting = true;
  lg.rookies = klass(lg, 60);
  const p = lg.rookies[0];
  // Market view sits above his current rating by the upside the room pays for,
  // and carries nobody's private error.
  assert.ok(marketView(lg, p) >= overall(p), 'the room pays something for upside');
  assert.equal(marketView(lg, p), marketView(lg, p), 'and it is stable');
  const off = league(7);
  off.settings.scouting = false;
  off.rookies = lg.rookies;
  assert.equal(marketView(off, p), overall(p), 'with scouting off it is just the rating');
});

test('list order follows what the observer believes, so a place in a table leaks nothing', () => {
  const lg = league(8);
  lg.settings.scouting = true;
  const rookies = klass(lg, 80);
  const u = userIdx(lg);
  const byShown = rookies.slice().sort((a, b) => shownOverall(lg, b, u) - shownOverall(lg, a, u));
  const byTruth = rookies.slice().sort((a, b) => overall(b) - overall(a));
  assert.notDeepEqual(byShown.map((p) => p.id), byTruth.map((p) => p.id), 'ranking by truth would put the number back on screen');
  for (const p of rookies) assert.equal(shownOverall(lg, p, u), scoutReport(lg, p, u).estimate);
});

test('attributes coarsen to the shape of a player, not the number', () => {
  const lg = league(9);
  lg.settings.scouting = true;
  const p = klass(lg, 20)[0];
  const seen = coarseAttrs(lg, p, userIdx(lg));
  assert.ok(seen.length > 1);
  for (const a of seen) {
    assert.equal(a.exact, false);
    assert.equal(a.value % 5, 0, `${a.attr} showed ${a.value}, which is a precise number`);
  }
  const real = coarseAttrs(lg, PLAYERS[0], userIdx(lg));
  assert.ok(real.every((a) => a.exact), 'a real player is shown exactly');
});

test('a rookie is known once he has been on a roster through a season', () => {
  const lg = league(10);
  lg.settings.scouting = true;
  const p = klass(lg, 10)[0];
  lg.rookies = [p];
  assert.equal(isScouted(lg, p), false);
  // A career entry is what careers.js creates for anyone under contract at an
  // offseason, so having one means he played. Statistics alone do not work:
  // AI regular-season box scores keep team totals only.
  lg.dev = { [p.id]: startCareer(lg, p) };
  assert.equal(isScouted(lg, p), true);
  assert.equal(scoutReport(lg, p, userIdx(lg)).known, true);
});

test('switching scouting off shows every number exactly', () => {
  const lg = league(11);
  lg.settings.scouting = false;
  assert.equal(scoutingOn(lg), false);
  for (const p of klass(lg, 30)) {
    const r = scoutReport(lg, p, userIdx(lg));
    assert.equal(r.known, true);
    assert.equal(r.low, overall(p));
  }
});

test('a dynasty produces a scouting report card with hits and misses in it', () => {
  const lg = createLeague({ name: 'P', mode: 'pro', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 32, seed: 41, draftType: 'snake', injuries: 'normal' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(41));
  startSeason(lg, PLAYERS_BY_ID);
  for (let i = 0; i < 3; i++) simulateAhead(lg, index(lg), pool(lg), new RNG(700 + i), 'nextSeason');
  const hits = scoutingHits(lg, pool(lg), userIdx(lg));
  assert.ok(hits.length > 5, `only ${hits.length} rookies had finished a season`);
  for (const h of hits) {
    assert.ok(h.high - h.low >= MIN_WIDTH);
    assert.ok(typeof h.verdict === 'string' && h.verdict.length);
    assert.ok(h.now >= 40 && h.now <= 99);
  }
  assert.ok(hits.some((h) => h.moved >= 3), 'nobody developed at all');
  assert.ok(hits.some((h) => h.moved <= 2), 'everybody developed, which is not a bet');
  // Sorted best first, so the card reads as a story.
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i - 1].moved >= hits[i].moved);
});

test('a league that predates scouting keeps showing exact numbers', () => {
  const lg = league(12);
  delete lg.settings.scouting;
  assert.equal(scoutingOn(lg), false);
  assert.equal(scoutReport(lg, klass(lg, 5)[0], userIdx(lg)).known, true);
});

test('fog does not break the auction or leave a roster short', () => {
  const lg = createLeague({ name: 'F', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 55, draftType: 'auction', injuries: 'normal' });
  lg.settings.scouting = true;
  lg.rookies = klass(lg, 40);
  const withRookies = applyCareers(lg, leaguePool(lg, PLAYERS));
  const byId = careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
  autoCompleteAll(lg.auction, lg, withRookies, new RNG(55), byId);
  startSeason(lg, byId);
  for (const t of lg.teams) {
    for (const s of ROSTER_SLOTS) {
      const id = t.slots[s.id];
      assert.ok(id, `${t.abbr} left ${s.id} empty`);
      assert.equal(byId.get(id).pos, s.pos);
    }
  }
  const guide = priceGuide(lg.auction, lg, withRookies);
  assert.ok(guide.prices.size >= 0);
});
