import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { overall } from '../src/engine/ratings.js';
import { createLeague, startSeason, registerPlayers, syncTenure, gameOptions } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { simulateAhead, simulateAheadAsync } from '../src/engine/autosim.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { applyCareers, careerIndex } from '../src/engine/careers.js';
import {
  chemistry, chemistryFor, chemistryBonuses, eraSpread, seasonsTogether, describeChemistry, MAX_BONUS,
} from '../src/engine/chemistry.js';

registerPlayers(PLAYERS_BY_ID);

function league(seed, opts = {}) {
  const lg = createLeague({ name: 'H', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction', injuries: 'normal', ...opts });
  autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), PLAYERS_BY_ID);
  startSeason(lg, PLAYERS_BY_ID);
  return lg;
}
const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
const pool = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));

/** Rebuild the user's roster from whichever players `pick` allows. */
function stock(lg, pick) {
  const u = lg.teams.findIndex((t) => t.isUser);
  const taken = new Set(lg.teams.flatMap((t, i) => (i === u ? [] : ROSTER_SLOTS.map((s) => t.slots[s.id]))));
  for (const s of ROSTER_SLOTS) {
    const cand = PLAYERS.filter((p) => p.pos === s.pos && !taken.has(p.id) && pick(p)).sort((a, b) => overall(b) - overall(a))[0];
    if (cand) { lg.teams[u].slots[s.id] = cand.id; taken.add(cand.id); }
  }
  return u;
}

test('era spread is the standard deviation of where a squad comes from', () => {
  assert.equal(eraSpread([2015, 2015, 2015]), 0);
  assert.ok(eraSpread([2010, 2012, 2014, 2016]) < 3);
  assert.ok(eraSpread([1950, 1975, 2000, 2024]) > 25);
  assert.equal(eraSpread([2000]), 0, 'one man has no spread');
});

// Over three leagues, because what is left after the other clubs have bought
// is a draw: about one league in six leaves a best-available squad bunched in
// a couple of decades (seed 10 on the table before coverage made sacks, seed 7
// on the one after, each a spread of 10 to 12 and a gap of 10 to 14), while
// the claim is about the choice a manager faces in leagues in general.
test('a tight era band beats best-available in season one, which makes it a choice', () => {
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const rows = [7, 8, 9].map((seed) => {
    const tight = league(seed); const t = stock(tight, (p) => p.season >= 2010 && p.season <= 2019);
    const wide = league(seed); const w = stock(wide, () => true);
    return { ct: chemistryFor(tight, t, PLAYERS_BY_ID), cw: chemistryFor(wide, w, PLAYERS_BY_ID) };
  });
  for (const { ct } of rows) assert.ok(ct.spread < 6, `a one-decade squad should be tight, got ±${ct.spread}`);
  const spread = mean(rows.map((r) => r.cw.spread));
  const gap = mean(rows.map((r) => r.ct.score - r.cw.score));
  const worth = mean(rows.map((r) => r.ct.bonus - r.cw.bonus));
  assert.ok(spread > 12, `best-available spans eras, got ±${spread.toFixed(1)}`);
  assert.ok(gap > 15, `the tight band scores ${gap.toFixed(1)} more`);
  assert.ok(worth > 1, `worth ${worth.toFixed(2)} points, which is too little to be a decision`);
});

test('a wide era spread stops mattering once the squad has played together', () => {
  const lg = league(8);
  const u = stock(lg, () => true);
  const cold = chemistry(lg, u, PLAYERS_BY_ID);
  // Four seasons of the same eleven men.
  lg.season = 5;
  lg.tenure = { [u]: Object.fromEntries(ROSTER_SLOTS.map((s) => [lg.teams[u].slots[s.id], 5]).filter(([id]) => id)) };
  const warm = chemistry(lg, u, PLAYERS_BY_ID);
  assert.equal(warm.spread, cold.spread, 'the same men, so the same spread');
  assert.ok(warm.cohesion > cold.cohesion + 30, 'but the era penalty has decayed');
  assert.ok(warm.score > cold.score, `${cold.score} -> ${warm.score}`);
});

test('tenure counts seasons on the roster, not the age of a contract', () => {
  const lg = league(9);
  const u = lg.teams.findIndex((t) => t.isUser);
  const id = ROSTER_SLOTS.map((s) => lg.teams[u].slots[s.id]).find(Boolean);
  assert.equal(seasonsTogether(lg, u, id), 0, 'first season: nobody has been here before');
  syncTenure(lg);
  syncTenure(lg);
  assert.equal(seasonsTogether(lg, u, id), 2, 'two more seasons held');
  // A re-auction resets the contract but not the man's time at the club.
  lg.contracts[id] = { salary: 9, kept: 0, since: 4 };
  assert.equal(seasonsTogether(lg, u, id), 2, 'a fresh contract for the same player is not a fresh player');
});

test('the bonus is measured against the league, so it cannot inflate for everyone', () => {
  const lg = league(11);
  const bonuses = chemistryBonuses(lg, PLAYERS_BY_ID);
  assert.equal(bonuses.length, lg.teams.length);
  const sum = bonuses.reduce((s, x) => s + x, 0);
  assert.ok(Math.abs(sum) < 1.5, `bonuses should roughly cancel across a league, summed to ${sum.toFixed(2)}`);
  for (const b of bonuses) assert.ok(Math.abs(b) <= MAX_BONUS + 1e-9, `${b} is outside the stated bound`);
  // Everyone settling together moves nobody.
  lg.season = 6;
  lg.tenure = Object.fromEntries(lg.teams.map((t, i) => [i, Object.fromEntries(ROSTER_SLOTS.map((s) => [t.slots[s.id], 6]).filter(([id]) => id))]));
  const settled = chemistryBonuses(lg, PLAYERS_BY_ID);
  assert.ok(Math.max(...settled) - Math.min(...settled) < 1, 'a league that settles together gains nothing over itself');
});

test('switching chemistry off zeroes it everywhere', () => {
  const lg = league(12);
  lg.settings.chemistry = false;
  assert.deepEqual(chemistryBonuses(lg, PLAYERS_BY_ID), lg.teams.map(() => 0));
  assert.equal(chemistryFor(lg, 0, PLAYERS_BY_ID).bonus, 0);
  assert.deepEqual(gameOptions(lg, { home: 0, away: 1 }, PLAYERS_BY_ID).chem, [0, 0]);
});

test('game options carry both sides, and only the two clubs playing', () => {
  const lg = league(13);
  stock(lg, (p) => p.season >= 2010 && p.season <= 2019);
  const u = lg.teams.findIndex((t) => t.isUser);
  const other = u === 0 ? 1 : 0;
  const opts = gameOptions(lg, { home: u, away: other }, index(lg));
  assert.equal(opts.chem.length, 2);
  assert.ok(opts.chem[0] > opts.chem[1], 'the era-tight club is the one with the edge');
});

test('chemistry survives a dynasty and stays inside its stated bound', () => {
  const lg = league(14);
  for (let s = 0; s < 4; s++) simulateAhead(lg, index(lg), pool(lg), new RNG(900 + s), 'nextSeason');
  const byId = index(lg);
  const bonuses = chemistryBonuses(lg, byId);
  for (const b of bonuses) assert.ok(Math.abs(b) <= MAX_BONUS + 1e-9, `${b} out of bounds after four seasons`);
  const reading = chemistryFor(lg, 0, byId);
  assert.ok(reading.score >= 0 && reading.score <= 100);
  assert.ok(reading.rank >= 1 && reading.rank <= lg.teams.length);
  assert.equal(typeof describeChemistry(reading), 'string');
});

test('an empty roster reads as neutral rather than throwing', () => {
  const lg = league(15);
  for (const s of ROSTER_SLOTS) lg.teams[0].slots[s.id] = null;
  const c = chemistry(lg, 0, PLAYERS_BY_ID);
  assert.equal(c.starters, 0);
  assert.equal(c.score, 50);
});

test('a game is played with the chemistry the rosters have now', () => {
  // The bonus was cached by the league object, its tenure object and the
  // player index, and a roster change replaces none of them, so games went on
  // being played with the chemistry of whenever the cache last filled — while
  // the team screen, which reads it fresh, showed something else.
  const lg = league(14);
  // Held, as the app holds its index through a season.
  const byId = index(lg);
  const u = lg.teams.findIndex((t) => t.isUser);
  const other = u === 0 ? 1 : 0;
  const entry = { home: u, away: other };
  const before = gameOptions(lg, entry, byId).chem;
  // A new starting lineup from one decade: the club's chemistry moves.
  stock(lg, (p) => p.season >= 1990 && p.season <= 1999);
  const now = chemistryBonuses(lg, byId);
  assert.notDeepEqual([now[u], now[other]], before, 'the fixture did not move the chemistry');
  assert.deepEqual(gameOptions(lg, entry, byId).chem, [now[u], now[other]]);
});

test('what a stretch of games comes to does not depend on what else was simulated', async () => {
  // Found proving simulate-ahead's steps: two copies of one league simulated
  // in turn came out differently from the same league simulated on its own —
  // a club had six wins by the playoffs one way and seven the other.
  const base = league(15);
  const [alone, b, c] = [0, 1, 2].map(() => JSON.parse(JSON.stringify(base)));
  const ra = new RNG(21), rb = new RNG(21), rc = new RNG(21);
  for (const target of ['halfway', 'playoffs']) simulateAhead(alone, index(alone), pool(alone), ra, target);
  for (const target of ['halfway', 'playoffs']) {
    simulateAhead(b, index(b), pool(b), rb, target);
    await simulateAheadAsync(c, index(c), pool(c), rc, target);
  }
  assert.equal(JSON.stringify(b), JSON.stringify(alone), 'interleaved, the league came out differently');
  assert.equal(JSON.stringify(c), JSON.stringify(alone));
});
