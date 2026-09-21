import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import {
  buildSchedule, buildProSchedule, createLeague, gameSeed, playoffFieldSize, powerRankings,
  userTeamIndex, isPro, autoDepth, FANTASY_SIZES, PRO_SIZE, LEAGUE_VERSION,
} from '../src/engine/season.js';
import { overall } from '../src/engine/ratings.js';

const fantasy = (n, seed = 3) => createLeague({ name: 'T', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: n, seed, draftType: 'auction' });
const pro = (seed = 4) => createLeague({ name: 'P', mode: 'pro', numTeams: PRO_SIZE, franchise: 12, seed, draftType: 'snake', user: {} });

/** Every structural claim a schedule has to satisfy, whatever built it. */
function audit(weeks, numTeams) {
  const games = {}, home = {}, pairs = new Map();
  for (const wk of weeks) {
    const seen = new Set();
    for (const g of wk.games) {
      assert.notEqual(g.home, g.away, `week ${wk.week}: a club cannot play itself`);
      assert.ok(!seen.has(g.home) && !seen.has(g.away), `week ${wk.week}: a club plays twice in one week`);
      seen.add(g.home); seen.add(g.away);
      games[g.home] = (games[g.home] || 0) + 1; games[g.away] = (games[g.away] || 0) + 1;
      home[g.home] = (home[g.home] || 0) + 1;
      const key = [g.home, g.away].sort((a, b) => a - b).join('v');
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
    assert.equal(wk.games.every((g) => g.result === null), true, 'a fresh schedule carries no results');
  }
  const played = [...Array(numTeams).keys()].map((i) => games[i] || 0);
  return { played, home: [...Array(numTeams).keys()].map((i) => home[i] || 0), pairs };
}

test('a fantasy schedule gives every club the same number of games', () => {
  for (const n of FANTASY_SIZES) {
    const weeks = buildSchedule(n, new RNG(3));
    const { played, home } = audit(weeks, n);
    assert.equal(new Set(played).size, 1, `${n} clubs: some play more than others`);
    assert.equal(played[0], weeks.length, `${n} clubs: every club plays every week`);
    assert.equal(weeks[0].games.length, n / 2, `${n} clubs: the week is full`);
    // Hosting cannot be perfectly even when the double round robin is cut
    // short, but it must not be lopsided.
    const half = weeks.length / 2;
    for (const h of home) assert.ok(Math.abs(h - half) <= 1.5, `${n} clubs: ${h} home games against ${weeks.length}`);
    assert.equal(home.reduce((a, b) => a + b, 0), weeks.length * (n / 2), 'every game has exactly one host');
  }
});

test('eight clubs play a clean double round robin, home and away against everyone', () => {
  const weeks = buildSchedule(8, new RNG(3));
  const { pairs, home } = audit(weeks, 8);
  assert.equal(weeks.length, 14);
  assert.equal(pairs.size, 28, 'every one of the twenty-eight pairings exists');
  for (const [key, count] of pairs) assert.equal(count, 2, `${key} met ${count} times, not twice`);
  for (const h of home) assert.equal(h, 7, 'and hosting splits exactly');
});

test('the shuffle reorders weeks without changing what is in them', () => {
  const plain = buildSchedule(10, null);
  const shuffled = buildSchedule(10, new RNG(11));
  const fingerprint = (w) => w.games.map((g) => `${g.home}v${g.away}`).sort().join(',');
  assert.deepEqual(new Set(plain.map(fingerprint)), new Set(shuffled.map(fingerprint)), 'same rounds, different order');
  assert.deepEqual(shuffled.map((w) => w.week), plain.map((w) => w.week), 'and the weeks are still numbered 1..n');
});

test('the pro slate is seventeen games, one bye, and a last week of rivalries', () => {
  const lg = pro();
  const weeks = buildProSchedule(lg.teams, new RNG(4), 1, null);
  const { played } = audit(weeks, PRO_SIZE);
  assert.equal(weeks.length, 18);
  for (const p of played) assert.equal(p, 17, 'every club plays seventeen');
  // Eighteen weeks and seventeen games is one bye each, by arithmetic; assert it
  // where a club could otherwise be missed twice and doubled up elsewhere.
  const byes = {};
  for (const wk of weeks) {
    const seen = new Set(wk.games.flatMap((g) => [g.home, g.away]));
    for (let i = 0; i < PRO_SIZE; i++) if (!seen.has(i)) byes[i] = (byes[i] || 0) + 1;
  }
  for (let i = 0; i < PRO_SIZE; i++) assert.equal(byes[i], 1, `club ${i} rests ${byes[i]} times`);
  const sameDiv = (a, b) => lg.teams[a].conf === lg.teams[b].conf && lg.teams[a].div === lg.teams[b].div;
  const divGames = {};
  for (const wk of weeks) for (const g of wk.games) if (sameDiv(g.home, g.away)) { divGames[g.home] = (divGames[g.home] || 0) + 1; divGames[g.away] = (divGames[g.away] || 0) + 1; }
  for (let i = 0; i < PRO_SIZE; i++) assert.equal(divGames[i], 6, 'home and away against three rivals');
  assert.ok(weeks[17].games.every((g) => sameDiv(g.home, g.away)), 'the last week is all division games');
  assert.equal(weeks[17].games.length, 16, 'and everybody is in it');
});

test('a game seed is fixed by the league, season, week and the two clubs', () => {
  const lg = fantasy(8, 21);
  const a = gameSeed(lg, 3, 1, 2);
  assert.equal(gameSeed(lg, 3, 1, 2), a, 'the same game replays the same way');
  assert.notEqual(gameSeed(lg, 4, 1, 2), a, 'a different week is a different game');
  assert.notEqual(gameSeed(lg, 3, 2, 1), a, 'so is the reverse fixture');
  assert.notEqual(gameSeed(lg, 3, 1, 3), a, 'so is a different opponent');
  assert.notEqual(gameSeed({ ...lg, season: lg.season + 1 }, 3, 1, 2), a, 'and so is next season');
  assert.notEqual(gameSeed(fantasy(8, 22), 3, 1, 2), a, 'another league does not replay this one');
  assert.equal(Number.isFinite(a), true);
});

test('the playoff field grows with the league in documented steps', () => {
  assert.equal(playoffFieldSize(4), 2);
  assert.equal(playoffFieldSize(5), 2);
  assert.equal(playoffFieldSize(6), 4);
  assert.equal(playoffFieldSize(8), 4);
  assert.equal(playoffFieldSize(11), 4);
  assert.equal(playoffFieldSize(12), 6);
  assert.equal(playoffFieldSize(13), 6);
  assert.equal(playoffFieldSize(14), 8);
  assert.equal(playoffFieldSize(PRO_SIZE), 8);
  // Never more clubs in the field than in the league, and always even.
  for (let n = 4; n <= 32; n++) {
    const f = playoffFieldSize(n);
    assert.ok(f <= n && f % 2 === 0, `${n} clubs produced a field of ${f}`);
  }
});

test('power rankings sort by strength and feel an injury', () => {
  const lg = fantasy(8, 31);
  // Fill every roster so there is something to rank.
  const pool = [...byId.values()];
  lg.teams.forEach((t, i) => {
    for (const [k, s] of ROSTER_SLOTS.entries()) {
      t.slots[s.id] = pool.filter((p) => p.pos === s.pos)[i * 3 + k] ?.id ?? pool.find((p) => p.pos === s.pos).id;
    }
  });
  const ranks = powerRankings(lg, byId);
  assert.equal(ranks.length, 8);
  for (let i = 1; i < ranks.length; i++) assert.ok(ranks[i - 1].power >= ranks[i].power, 'sorted strongest first');
  assert.deepEqual([...ranks].map((r) => r.idx).sort((a, b) => a - b), [...Array(8).keys()], 'every club appears once');
  // A starter on the ledger is off the field, so the club has to read weaker.
  const top = ranks[0];
  const qb = lg.teams[top.idx].slots.QB1;
  lg.injuries = { [qb]: { weeks: 3 } };
  const hurt = powerRankings(lg, byId).find((r) => r.idx === top.idx);
  assert.ok(hurt.power < top.power, 'losing the quarterback costs power');
});

test('a new league is internally consistent before anything is drafted', () => {
  const lg = fantasy(10, 41);
  assert.equal(lg.version, LEAGUE_VERSION);
  assert.equal(lg.teams.length, 10);
  assert.equal(lg.teams.filter((t) => t.isUser).length, 1, 'exactly one club is yours');
  assert.equal(userTeamIndex(lg), lg.teams.findIndex((t) => t.isUser));
  assert.equal(isPro(lg), false);
  assert.equal(isPro(pro()), true);
  assert.equal(new Set(lg.teams.map((t) => t.abbr)).size, 10, 'no two clubs share an abbreviation');
  for (const t of lg.teams) assert.deepEqual(t.record, { w: 0, l: 0, t: 0, pf: 0, pa: 0 });
});

/** A club filled with real players, deliberately in a bad order. */
function stocked(seed = 51) {
  const lg = fantasy(8, seed);
  const pool = [...byId.values()];
  const t = lg.teams[userTeamIndex(lg)];
  for (const pos of new Set(ROSTER_SLOTS.map((x) => x.pos))) {
    const slots = ROSTER_SLOTS.filter((x) => x.pos === pos).map((x) => x.id);
    // Worst first, which is exactly what the button is for.
    const men = pool.filter((p) => p.pos === pos).sort((a, b) => overall(a) - overall(b)).slice(0, slots.length);
    slots.forEach((id, i) => { t.slots[id] = men[i].id; });
  }
  return { lg, t, u: userTeamIndex(lg) };
}

test('auto-order puts the best man in the starting slot', () => {
  const { lg, t, u } = stocked();
  const before = ROSTER_SLOTS.map((s) => t.slots[s.id]);
  const moved = autoDepth(lg, u, byId);
  assert.ok(moved > 0, 'a chart built worst-first had nothing to fix');
  for (const pos of new Set(ROSTER_SLOTS.map((x) => x.pos))) {
    const ids = ROSTER_SLOTS.filter((x) => x.pos === pos).map((x) => t.slots[x.id]);
    for (let i = 1; i < ids.length; i++) {
      assert.ok(overall(byId.get(ids[i - 1])) >= overall(byId.get(ids[i])), `${pos}: ${ids[i - 1]} sits above a better man`);
    }
  }
  // Nobody gained, lost or cloned on the way.
  const after = ROSTER_SLOTS.map((s) => t.slots[s.id]);
  assert.deepEqual(new Set(after), new Set(before), 'the same men are on the roster');
  assert.equal(new Set(after).size, after.length, 'and each of them once');
});

test('auto-order is idempotent and says so', () => {
  const { lg, u } = stocked(52);
  assert.ok(autoDepth(lg, u, byId) > 0);
  assert.equal(autoDepth(lg, u, byId), 0, 'a chart already in order reports no changes');
});

test('auto-order leaves an injured man where he is', () => {
  // The chart says who is ahead when everyone is fit. `buildLineup` already
  // sits the hurt man; demoting him here would leave him behind on his return.
  const { lg, t, u } = stocked(53);
  autoDepth(lg, u, byId);
  const qb1 = t.slots.QB1;
  lg.injuries = { [qb1]: { weeks: 4 } };
  autoDepth(lg, u, byId);
  assert.equal(t.slots.QB1, qb1, 'the injured starter keeps his place on the chart');
});

test('auto-order only touches the club it was asked about', () => {
  const { lg, u } = stocked(54);
  const other = u === 0 ? 1 : 0;
  const before = ROSTER_SLOTS.map((s) => lg.teams[other].slots[s.id]);
  autoDepth(lg, u, byId);
  assert.deepEqual(ROSTER_SLOTS.map((s) => lg.teams[other].slots[s.id]), before, 'the neighbours are untouched');
  assert.equal(autoDepth(lg, 99, byId), 0, 'and a club that does not exist is not an error');
});
