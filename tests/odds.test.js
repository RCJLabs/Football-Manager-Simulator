// Playoff odds (odds.js): the rest of the season played many times through
// the league's own tiebreakers and bracket.
//
// The tiebreakers here are a copy, on tables, of `makeComparator` and
// `proStandings`; the first test is what keeps the copy honest. If the real
// ones change, it fails until the copy does too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, proStandings, standings, playoffFieldSize, isPro } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { applyCareers, careerIndex } from '../src/engine/careers.js';
import { playoffOdds, refreshOdds, oddsPoints, oddsKey, _seedsForTest, ODDS_RUNS, QUICK_RUNS } from '../src/engine/odds.js';
import { fmtShare } from '../src/ui/race.js';

registerPlayers(PLAYERS_BY_ID);
const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
const pool = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));

function league(mode, numTeams, draftType, seed) {
  const lg = createLeague({ name: 'O', user: {}, seed, mode, numTeams, franchise: mode === 'pro' ? 3 : 0, draftType, injuries: 'normal' });
  if (draftType === 'auction') autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), PLAYERS_BY_ID);
  else autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, PLAYERS_BY_ID);
  return lg;
}

/** Finish the regular season at random into the league's own tables. */
function finishAtRandom(lg, rng, tieShare) {
  for (const wk of lg.schedule) for (const g of wk.games) {
    if (g.result) continue;
    const hs = rng.int(3, 40);
    const as = rng.next() < tieShare ? hs : rng.int(3, 40);
    g.result = { score: [hs, as] };
    const h = lg.teams[g.home].record, a = lg.teams[g.away].record;
    h.pf += hs; h.pa += as; a.pf += as; a.pa += hs;
    if (hs > as) { h.w++; a.l++; } else if (as > hs) { a.w++; h.l++; } else { h.t++; a.t++; }
    lg.results.push({ season: lg.season, phase: 'season', week: wk.week, home: g.home, away: g.away, score: [hs, as] });
  }
}

const PRO = league('pro', 32, 'snake', 5);
simulateAhead(PRO, index(PRO), pool(PRO), new RNG(9), 'halfway');
const FANTASY = league('fantasy', 8, 'auction', 6);
simulateAhead(FANTASY, index(FANTASY), pool(FANTASY), new RNG(9), 'halfway');

test('the copy of the tiebreakers seeds every finish exactly as the real standings do', () => {
  let checked = 0;
  for (const base of [PRO, FANTASY]) {
    const frozen = JSON.stringify(base);
    const rng = new RNG(base.seed * 3);
    for (let i = 0; i < 150; i++) {
      const L = JSON.parse(frozen);
      // Every fourth finish is full of ties, so records level and the deep
      // tiebreakers (division, conference, common games, strength of victory
      // and of schedule, points) all get exercised.
      finishAtRandom(L, rng, i % 4 === 0 ? 0.3 : 0.02);
      const mine = _seedsForTest(L);
      const real = isPro(L) ? proStandings(L).map((c) => c.seeds) : [standings(L).slice(0, playoffFieldSize(L.teams.length)).map((r) => r.idx)];
      assert.deepEqual(mine.pools, real, `finish ${i} of a ${L.mode} league seeds differently`);
      if (isPro(L)) {
        const winners = proStandings(L).flatMap((c) => c.divisions.map((d) => d.rows[0].idx)).sort((a, b) => a - b);
        assert.deepEqual([...mine.divisionWinners].sort((a, b) => a - b), winners);
      }
      checked++;
    }
  }
  assert.equal(checked, 300);
});

test('the odds add up: fourteen berths, eight divisions, two byes and one title a pro season', () => {
  const o = playoffOdds(PRO, index(PRO), { runs: 400 });
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  assert.ok(Math.abs(sum(o.playoff) - 14) < 1e-9);
  assert.ok(Math.abs(sum(o.division) - 8) < 1e-9);
  assert.ok(Math.abs(sum(o.bye) - 2) < 1e-9);
  assert.ok(Math.abs(sum(o.title) - 1) < 1e-9);
  for (let i = 0; i < 32; i++) {
    assert.ok(o.division[i] <= o.playoff[i] + 1e-9, 'won the division without making the playoffs');
    assert.ok(o.bye[i] <= o.division[i] + 1e-9, 'a bye without the division');
    assert.ok(o.title[i] <= o.playoff[i] + 1e-9, 'a title without the playoffs');
  }
  const f = playoffOdds(FANTASY, index(FANTASY), { runs: 400 });
  assert.ok(Math.abs(sum(f.playoff) - playoffFieldSize(8)) < 1e-9);
  assert.ok(Math.abs(sum(f.title) - 1) < 1e-9);
});

test('reading the odds changes nothing in the league, and reads the same twice', () => {
  const before = JSON.stringify(PRO);
  const a = playoffOdds(PRO, index(PRO), { runs: 300 });
  const b = playoffOdds(PRO, index(PRO), { runs: 300 });
  assert.equal(JSON.stringify(PRO), before, 'the league moved');
  assert.deepEqual(a, b);
});

test('a better record and a stronger club both mean better odds', () => {
  const lg = JSON.parse(JSON.stringify(PRO));
  const byId = index(lg);
  const o = playoffOdds(lg, byId, { runs: 400 });
  // Hand one club three more wins, taken from the losses column.
  const i = o.playoff.map((p, k) => [p, k]).find(([p, k]) => p > 0.2 && p < 0.8 && lg.teams[k].record.l >= 3)?.[1];
  assert.ok(i != null, 'no club in the middle of the race');
  lg.teams[i].record.w += 3; lg.teams[i].record.l -= 3;
  const after = playoffOdds(lg, byId, { runs: 400 });
  assert.ok(after.playoff[i] > o.playoff[i], `${o.playoff[i]} → ${after.playoff[i]} after three more wins`);
});

test('in the playoffs only the bracket is left: the field is certain and the title goes to a club still alive', () => {
  const lg = league('pro', 32, 'snake', 11);
  simulateAhead(lg, index(lg), pool(lg), new RNG(12), 'playoffs');
  assert.equal(lg.phase, 'playoffs');
  const o = playoffOdds(lg, index(lg), { runs: 300 });
  const alive = new Set(lg.playoffs.pools.flatMap((p) => p.alive));
  const seeded = new Set(lg.playoffs.pools.flatMap((p) => p.seeds));
  for (let i = 0; i < 32; i++) {
    assert.equal(o.playoff[i], seeded.has(i) ? 1 : 0);
    if (!alive.has(i)) assert.equal(o.title[i], 0, 'a title for a club not in the bracket');
  }
  assert.ok(Math.abs(o.title.reduce((s, x) => s + x, 0) - 1) < 1e-9);
});

test('readings are kept by week, a quick one is read again in full, and a new season starts a new list', () => {
  const lg = JSON.parse(JSON.stringify(FANTASY));
  const byId = index(lg);
  // Simulating ahead already left quick readings for every week it played.
  const pts = oddsPoints(lg);
  assert.ok(pts.length >= 3, `only ${pts.length} readings kept`);
  assert.ok(pts.every((p) => p.runs === QUICK_RUNS));
  assert.deepEqual(pts.map((p) => p.key), pts.map((_, k) => `w${k + 1}`), 'a week was skipped or read twice');
  const key = oddsKey(lg);
  const full = refreshOdds(lg, byId);
  assert.equal(full.key, key);
  assert.equal(full.runs, ODDS_RUNS);
  assert.equal(oddsPoints(lg).filter((p) => p.key === key).length, 1);
  assert.equal(refreshOdds(lg, byId), full, 'a full reading was taken again');
  // Thousandths, and they add up as shares do.
  assert.ok(full.playoff.every((m) => Number.isInteger(m) && m >= 0 && m <= 1000));
  lg.season += 1;
  assert.deepEqual(oddsPoints(lg), []);
});

test('a chance is never printed as certain unless the markers say so', () => {
  assert.equal(fmtShare(1000), '>99%');
  assert.equal(fmtShare(1000, { sure: true }), 'In');
  assert.equal(fmtShare(0), '<1%');
  assert.equal(fmtShare(0, { gone: true }), 'Out');
  assert.equal(fmtShare(344), '34%');
  assert.equal(fmtShare(4), '<1%');
  assert.equal(fmtShare(995), '>99%');
});
