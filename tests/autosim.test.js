import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, userTeamIndex } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { simulateAhead, targetAvailable, halfwayWeek, describeRun, TARGETS } from '../src/engine/autosim.js';
import { rostersValid } from '../src/engine/transactions.js';
import { leagueIndex } from '../src/engine/rookies.js';
import { enterOffseason } from '../src/engine/offseason.js';

registerPlayers(byId);

function league(seed, opts = {}) {
  const lg = createLeague({ name: 'S', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction', injuries: 'normal', ...opts });
  autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), byId);
  startSeason(lg, byId);
  return lg;
}

test('each target lands where it says and stops there', () => {
  const half = league(81);
  const r1 = simulateAhead(half, byId, PLAYERS, new RNG(1), 'halfway');
  assert.equal(half.phase, 'season');
  assert.equal(half.week, halfwayWeek(half) + 1, 'sits just past the halfway week');
  assert.ok(r1.weeks > 0);
  assert.match(describeRun(r1), /weeks? simulated to season 1, week/);
  // Running it again does nothing, because it is behind us.
  assert.equal(targetAvailable(half, 'halfway'), false);
  assert.equal(simulateAhead(half, byId, PLAYERS, new RNG(1), 'halfway').weeks, 0);

  const toPlayoffs = league(82);
  simulateAhead(toPlayoffs, byId, PLAYERS, new RNG(2), 'playoffs');
  assert.equal(toPlayoffs.phase, 'playoffs');
  assert.ok(toPlayoffs.playoffs, 'a bracket exists');
  assert.ok(toPlayoffs.teams.every((t) => t.record.w + t.record.l + t.record.t === toPlayoffs.schedule.length));

  const toEnd = league(83);
  const r3 = simulateAhead(toEnd, byId, PLAYERS, new RNG(3), 'offseason');
  assert.equal(toEnd.phase, 'complete');
  assert.ok(toEnd.champion != null);
  assert.equal(toEnd.history.length, 1);
  assert.equal(r3.decided.length, 0, 'nothing was decided on your behalf');
  assert.match(describeRun(r3), /the end of season 1/);
});

test('reaching next season runs the offseason and says what it decided', () => {
  const lg = league(84);
  const before = lg.teams.map((t) => ROSTER_SLOTS.map((s) => t.slots[s.id]).join());
  const r = simulateAhead(lg, byId, PLAYERS, new RNG(4), 'nextSeason');
  assert.equal(lg.phase, 'season');
  assert.equal(lg.season, 2);
  assert.equal(lg.week, 1);
  assert.equal(lg.history.length, 1, 'season one is in the books');
  // The offseason brought a rookie class, so the run hands back the pool it ended with.
  assert.ok(r.pool.length > PLAYERS.length, 'the returned pool carries the new class');
  assert.equal(r.byId.size, r.pool.length);
  assert.ok(rostersValid(lg, r.byId).ok, rostersValid(lg, r.byId).reason);
  assert.ok(lg.teams.every((t) => t.record.w + t.record.l === 0), 'records reset');
  const after = lg.teams.map((t) => ROSTER_SLOTS.map((s) => t.slots[s.id]).join());
  assert.notDeepEqual(after, before, 'the market changed the rosters');
  assert.ok(r.decided.some((d) => /offseason/.test(d)));
  assert.ok(r.decided.some((d) => /keeper/.test(d)));
  assert.ok(r.decided.some((d) => /auction/.test(d)));
  assert.match(describeRun(r), /with the offseason opened/);
  // Three seasons in a row stay valid.
  for (let i = 0; i < 2; i++) simulateAhead(lg, leagueIndex(lg, byId), PLAYERS, new RNG(5 + i), 'nextSeason');
  assert.equal(lg.season, 4);
  assert.equal(lg.history.length, 3);
  assert.ok(rostersValid(lg, leagueIndex(lg, byId)).ok);
});

test('what is offered depends on where the league stands', () => {
  const lg = league(85);
  assert.deepEqual(TARGETS.filter((t) => targetAvailable(lg, t)), ['halfway', 'playoffs', 'offseason', 'nextSeason']);
  simulateAhead(lg, byId, PLAYERS, new RNG(6), 'playoffs');
  assert.deepEqual(TARGETS.filter((t) => targetAvailable(lg, t)), ['offseason', 'nextSeason']);
  simulateAhead(lg, byId, PLAYERS, new RNG(7), 'offseason');
  assert.deepEqual(TARGETS.filter((t) => targetAvailable(lg, t)), ['nextSeason']);
  // Skipping the keeper screen is the same operation, so it is offered there too.
  enterOffseason(lg, PLAYERS, byId);
  assert.equal(lg.phase, 'offseason');
  assert.deepEqual(TARGETS.filter((t) => targetAvailable(lg, t)), ['nextSeason']);
  const skipped = simulateAhead(lg, byId, PLAYERS, new RNG(71), 'nextSeason');
  assert.equal(lg.phase, 'season');
  assert.equal(lg.season, 2);
  assert.ok(skipped.decided.some((d) => /keeper/.test(d)));
  // A league still in its draft offers nothing.
  const fresh = createLeague({ name: 'S', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 86, draftType: 'auction' });
  assert.deepEqual(TARGETS.filter((t) => targetAvailable(fresh, t)), []);
  assert.throws(() => simulateAhead(lg, byId, PLAYERS, new RNG(8), 'nonsense'), /Unknown target/);
});

test('a pro league simulates a whole season and into the next', () => {
  const lg = createLeague({ name: 'P', mode: 'pro', franchise: 3, seed: 87, draftType: 'snake', injuries: 'normal' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(87));
  startSeason(lg, byId);
  const t0 = Date.now();
  const r = simulateAhead(lg, byId, PLAYERS, new RNG(9), 'nextSeason');
  const ms = Date.now() - t0;
  assert.equal(lg.season, 2);
  assert.equal(lg.phase, 'season');
  assert.equal(lg.teams.length, 32);
  assert.ok(rostersValid(lg, r.byId).ok, rostersValid(lg, r.byId).reason);
  assert.ok(ms < 20000, `a 32-club season plus offseason took ${ms}ms`);
  void userTeamIndex;
});
