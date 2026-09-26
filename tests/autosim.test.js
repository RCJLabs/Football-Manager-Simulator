import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, userTeamIndex } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { simulateAhead, simulateAheadAsync, simulateSteps, describeStep, targetAvailable, halfwayWeek, describeRun, TARGETS } from '../src/engine/autosim.js';
import { applyCareers, careerIndex } from '../src/engine/careers.js';
import { leaguePool } from '../src/engine/rookies.js';
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

// Stepped, for a page that has to keep drawing. The engine does the same work
// in the same order either way; these hold it to that.

/** Indexes built for each call, as the app hands them over. */
const idx = (lg) => careerIndex(lg, leagueIndex(lg, byId));
const poolOf = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));
const outcome = (r) => JSON.stringify({ weeks: r.weeks, decided: r.decided, from: r.from, to: r.to });

test('a run taken a step at a time ends exactly where one run straight through does', async () => {
  for (const opts of [{}, { draftType: 'snake' }]) {
    const base = opts.draftType === 'snake' ? (() => {
      const lg = createLeague({ name: 'S', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 91, draftType: 'snake', injuries: 'normal' });
      autoDraftAll(lg, lg.draft, PLAYERS, new RNG(91));
      startSeason(lg, byId);
      return lg;
    })() : league(91);
    const straight = JSON.parse(JSON.stringify(base));
    const stepped = JSON.parse(JSON.stringify(base));
    const r1 = new RNG(12), r2 = new RNG(12);
    for (const target of ['halfway', 'playoffs', 'offseason', 'nextSeason', 'nextSeason']) {
      const a = simulateAhead(straight, idx(straight), poolOf(straight), r1, target);
      let pauses = 0;
      const b = await simulateAheadAsync(stepped, idx(stepped), poolOf(stepped), r2, target, { pause: async () => { pauses++; } });
      assert.equal(JSON.stringify(stepped), JSON.stringify(straight), `${opts.draftType || 'auction'}: the leagues came apart at ${target}`);
      assert.equal(outcome(b), outcome(a), `${target}: a different account of the run`);
      assert.equal(r2.state, r1.state, `${target}: the random state moved differently`);
      assert.ok(pauses >= a.weeks, `${target}: ${a.weeks} weeks played in ${pauses} steps`);
    }
  }
});

test('a step is at most a week, and the offseason goes in stages', () => {
  const lg = league(92);
  const stages = [];
  let lastWeek = lg.week, lastRound = null, lastPhase = lg.phase;
  const run = simulateSteps(lg, idx(lg), poolOf(lg), new RNG(13), 'nextSeason');
  let step = run.next();
  for (; !step.done; step = run.next()) {
    const at = step.value;
    assert.deepEqual(Object.keys(at).sort(), ['phase', 'round', 'season', 'stage', 'week']);
    if (at.stage === 'week') {
      // Exactly one week or playoff round further on, or over a phase boundary.
      const next = at.phase !== lastPhase
        || (at.phase === 'season' && at.week === lastWeek + 1)
        || (at.phase === 'playoffs' && at.round === lastRound + 1);
      assert.ok(next, `from ${lastPhase} ${lastWeek}/${lastRound} to ${at.phase} ${at.week}/${at.round}`);
      lastWeek = at.week; lastRound = at.round; lastPhase = at.phase;
    } else stages.push(at.stage);
  }
  assert.equal(step.value.to.season, 2);
  // An auction league with no cap and no coaching jobs: no free agency, no carousel.
  assert.deepEqual(stages, ['offseason', 'keepers', 'market']);
  assert.equal(lg.phase, 'season');
});

test('each step says where the run has got to', () => {
  const lg = league(93);
  const n = lg.schedule.length;
  assert.equal(describeStep(lg, { stage: 'week', season: 1, week: 5, phase: 'season' }), `Season 1, week 5 of ${n}`);
  assert.equal(describeStep(lg, { stage: 'week', season: 1, week: 14, round: 2, phase: 'playoffs' }), 'Season 1, playoff round 2');
  assert.equal(describeStep(lg, { stage: 'week', season: 1, week: 1, phase: 'complete' }), 'Season 1 is over');
  assert.equal(describeStep(lg, { stage: 'offseason', season: 1, week: 1, phase: 'offseason' }), 'Season 1 is over; the offseason opens');
  assert.equal(describeStep(lg, { stage: 'jobs', season: 1, week: 1, phase: 'offseason' }), 'A new job taken');
  assert.equal(describeStep(lg, { stage: 'keepers', season: 2, week: 1, phase: 'offseason' }), 'Keepers chosen');
  assert.equal(describeStep(lg, { stage: 'freeagency', season: 2, week: 1, phase: 'offseason' }), 'Free agency closed');
  assert.equal(describeStep(lg, { stage: 'market', season: 2, week: 1, phase: 'draft' }), 'The auction is done');
  assert.equal(describeStep({ ...lg, draftType: 'snake' }, { stage: 'market', season: 2, week: 1, phase: 'draft' }), 'The draft is done');
});
