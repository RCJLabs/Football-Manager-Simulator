import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { overall } from '../src/engine/ratings.js';
import { createLeague, startSeason, registerPlayers, syncTenure, gameOptions } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { simulateAhead } from '../src/engine/autosim.js';
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

test('a tight era band beats best-available in season one, which makes it a choice', () => {
  const tight = league(7); const t = stock(tight, (p) => p.season >= 2010 && p.season <= 2019);
  const wide = league(7); const w = stock(wide, () => true);
  const ct = chemistryFor(tight, t, PLAYERS_BY_ID);
  const cw = chemistryFor(wide, w, PLAYERS_BY_ID);
  assert.ok(ct.spread < 6, `a one-decade squad should be tight, got ±${ct.spread}`);
  assert.ok(cw.spread > 12, `best-available spans eras, got ±${cw.spread}`);
  assert.ok(ct.score > cw.score + 15, `${ct.score} vs ${cw.score}`);
  assert.ok(ct.bonus - cw.bonus > 1, `worth ${(ct.bonus - cw.bonus).toFixed(2)} points, which is too little to be a decision`);
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
