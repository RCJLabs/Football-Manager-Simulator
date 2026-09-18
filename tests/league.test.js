import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticPool } from '../scripts/synthetic.mjs';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { createLeague, buildSchedule, startSeason, simulateWeekAi, weekComplete, advanceWeek, standings, currentWeek, userGameThisWeek } from '../src/engine/season.js';
import { autoDraftAll, runAiPicks, makePick, currentPicker, availablePlayers, RNG } from '../src/engine/draft.js';
import { RNG as Rng } from '../src/engine/rng.js';

const pool = syntheticPool(7);
const byId = new Map(pool.map((p) => [p.id, p]));

test('schedule is a double round-robin with one game per team per week', () => {
  for (const n of [4, 6, 8]) {
    const sched = buildSchedule(n, new Rng(1));
    assert.equal(sched.length, 2 * (n - 1));
    const pairs = {};
    for (const wk of sched) {
      const seen = new Set();
      assert.equal(wk.games.length, n / 2);
      for (const g of wk.games) {
        assert.ok(!seen.has(g.home) && !seen.has(g.away), 'team plays once per week');
        seen.add(g.home); seen.add(g.away);
        const key = [g.home, g.away].sort().join('-');
        pairs[key] = (pairs[key] || 0) + 1;
      }
    }
    assert.equal(Object.keys(pairs).length, (n * (n - 1)) / 2);
    assert.ok(Object.values(pairs).every((c) => c === 2), 'every pair meets twice');
    // Home/away split
    for (const key of Object.keys(pairs)) {
      const [a, b] = key.split('-').map(Number);
      const homes = sched.flatMap((w) => w.games).filter((g) => (g.home === a && g.away === b)).length;
      assert.equal(homes, 1, 'each team hosts once');
    }
  }
});

test('auto draft fills every slot with the right position and no duplicates', () => {
  const league = createLeague({ name: 'T', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 3, draftType: 'snake' });
  const rng = new RNG(league.rngState);
  autoDraftAll(league, league.draft, pool, rng);
  assert.ok(league.draft.complete);
  const all = new Set();
  for (const t of league.teams) {
    for (const slot of ROSTER_SLOTS) {
      const id = t.slots[slot.id];
      assert.ok(id, `${t.name} ${slot.id} filled`);
      assert.ok(!all.has(id), 'no duplicate players');
      all.add(id);
      assert.equal(byId.get(id).pos, slot.pos, 'slot position matches');
    }
  }
  assert.equal(league.draft.picks.length, 8 * ROSTER_SLOTS.length);
});

test('user picks interleave with AI picks in snake order', () => {
  const league = createLeague({ name: 'T', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 4, seed: 9, draftType: 'snake' });
  const u = league.teams.findIndex((t) => t.isUser);
  const rng = new RNG(league.rngState);
  runAiPicks(league, league.draft, pool, rng);
  assert.equal(currentPicker(league.draft), u);
  const qb = availablePlayers(league.draft, pool).find((p) => p.pos === 'QB');
  makePick(league, league.draft, qb);
  assert.equal(league.teams[u].slots.QB1, qb.id);
  assert.throws(() => makePick(league, league.draft, qb), /already taken/);
  runAiPicks(league, league.draft, pool, rng);
  assert.equal(currentPicker(league.draft), u);
  // No second QB slot -> picking another QB must fail
  const qb2 = availablePlayers(league.draft, pool).find((p) => p.pos === 'QB');
  assert.throws(() => makePick(league, league.draft, qb2), /No open QB slot/);
});

test('a full season runs to a champion with consistent standings', () => {
  const league = createLeague({ name: 'T', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 6, seed: 21, draftType: 'snake' });
  const rng = new RNG(league.rngState);
  autoDraftAll(league, league.draft, pool, rng);
  league.rngState = rng.state;
  startSeason(league);
  assert.equal(league.phase, 'season');
  assert.equal(league.schedule.length, 10);
  let guard = 0;
  while (league.phase !== 'complete' && guard++ < 40) {
    assert.ok(currentWeek(league));
    if (league.phase === 'season') assert.ok(userGameThisWeek(league), 'user plays every week');
    simulateWeekAi(league, byId, { includeUser: true });
    assert.ok(weekComplete(league));
    assert.ok(advanceWeek(league));
  }
  assert.equal(league.phase, 'complete');
  assert.ok(league.champion != null);
  const rows = standings(league);
  const wins = rows.reduce((s, r) => s + r.w, 0), losses = rows.reduce((s, r) => s + r.l, 0);
  assert.equal(wins, losses);
  for (const r of rows) assert.equal(r.gp, 10);
  assert.equal(rows.reduce((s, r) => s + r.pf, 0), rows.reduce((s, r) => s + r.pa, 0));
  // Season stats accumulated for the user team
  const me = league.teams.find((t) => t.isUser);
  assert.ok(Object.keys(me.seasonStats.players).length > 15);
  assert.equal(me.seasonStats.team.points, me.record.pf);
  assert.equal(league.history.length, 1);
});
