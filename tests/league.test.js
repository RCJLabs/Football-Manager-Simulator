import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticPool } from '../scripts/synthetic.mjs';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { createLeague, buildSchedule, startSeason, simulateWeekAi, weekComplete, advanceWeek, standings, currentWeek, userGameThisWeek } from '../src/engine/season.js';
import { autoDraftAll, runAiPicks, makePick, currentPicker, availablePlayers, RNG } from '../src/engine/draft.js';
import { remainingPicks, executePickTrade } from '../src/engine/draftpicks.js';
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
  // One backup slot: a second QB goes to QB2, a third has nowhere to go.
  const qb2 = availablePlayers(league.draft, pool).find((p) => p.pos === 'QB');
  makePick(league, league.draft, qb2);
  assert.equal(league.teams[u].slots.QB2, qb2.id);
  runAiPicks(league, league.draft, pool, rng);
  assert.equal(currentPicker(league.draft), u);
  const qb3 = availablePlayers(league.draft, pool).find((p) => p.pos === 'QB');
  assert.throws(() => makePick(league, league.draft, qb3), /No open QB slot/);
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

test('the pool is deep enough for the largest league, with a real talent tail', async () => {
  const { PLAYERS } = await import('../src/data/players.js');
  const { overall } = await import('../src/engine/ratings.js');
  const { SLOT_COUNTS } = await import('../src/data/positions.js');
  const byPos = {};
  for (const p of PLAYERS) (byPos[p.pos] ??= []).push(p);
  for (const [pos, per] of Object.entries(SLOT_COUNTS)) {
    assert.ok((byPos[pos] || []).length >= per * 16, `${pos}: ${(byPos[pos] || []).length} available, a 16-team league needs ${per * 16}`);
  }
  // The curve must actually fall away, or every draft pick is a good player and
  // the back of the roster costs nothing to fill.
  const sorted = PLAYERS.map(overall).sort((a, b) => b - a);
  const at = (f) => sorted[Math.floor(sorted.length * f)];
  assert.ok(at(0) >= 95, `best player ${at(0)}`);
  assert.ok(at(0.5) <= 84, `median player ${at(0.5)} should be a solid starter, not a star`);
  assert.ok(at(0.9) <= 72, `90th percentile ${at(0.9)} should be replacement level`);
  assert.ok(sorted[sorted.length - 1] <= 62, `worst player ${sorted[sorted.length - 1]}`);
  for (const [pos, arr] of Object.entries(byPos)) {
    const o = arr.map(overall).sort((a, b) => b - a);
    assert.ok(o[0] - o[o.length - 1] >= 25, `${pos} spans only ${o[0] - o[o.length - 1]} points`);
  }
});

test('every league size produces a balanced schedule and a champion', async () => {
  const { playoffFieldSize } = await import('../src/engine/season.js');
  const { autoCompleteAll } = await import('../src/engine/auction.js');
  const { PLAYERS, PLAYERS_BY_ID } = await import('../src/data/db.js');
  for (const n of [8, 10, 12]) {
    const league = createLeague({ name: 'T', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: n, seed: 400 + n, draftType: 'auction' });
    assert.equal(league.teams.length, n, 'enough AI clubs exist for this size');
    autoCompleteAll(league.auction, league, PLAYERS, new Rng(n), PLAYERS_BY_ID);
    startSeason(league);
    const weeks = league.schedule.length;
    assert.equal(weeks, { 8: 14, 10: 13, 12: 13 }[n], `${n} teams plays ${weeks} weeks`);
    for (const wk of league.schedule) assert.equal(wk.games.length, n / 2);
    let guard = 0;
    while (league.phase !== 'complete' && guard++ < 60) {
      simulateWeekAi(league, PLAYERS_BY_ID, { includeUser: true });
      advanceWeek(league);
    }
    assert.equal(league.phase, 'complete', `${n}-team league finished`);
    assert.ok(league.champion != null);
    assert.equal(league.playoffs.pools[0].seeds.length, playoffFieldSize(n));
    for (const t of league.teams) assert.equal(t.record.w + t.record.l + t.record.t, weeks);
  }
});

test('nobody starts a season a man short', () => {
  // Uneven pick trades let a club draft fewer times than it has slots. What it
  // did not draft it signs off the board, and the invariant is that every
  // roster is whole by kickoff however it got there.
  const lg = createLeague({ name: 'F', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 21, draftType: 'snake' });
  const d = lg.draft;
  const u = lg.teams.findIndex((t) => t.isUser);
  const o = lg.teams.findIndex((t) => !t.isUser);
  const mine = remainingPicks(d, u), theirs = remainingPicks(d, o);
  executePickTrade(lg, d, u, o, mine.slice(-3), [theirs[0]]);
  assert.equal(remainingPicks(d, u).length, ROSTER_SLOTS.length - 2, 'the user drafts twice fewer');
  assert.equal(remainingPicks(d, o).length, ROSTER_SLOTS.length + 2, 'the other club holds two spare');

  autoDraftAll(lg, d, pool, new Rng(5));
  const filled = (i) => ROSTER_SLOTS.filter((s) => lg.teams[i].slots[s.id]).length;
  assert.equal(filled(u), ROSTER_SLOTS.length - 2, 'short before the season starts');
  assert.equal(filled(o), ROSTER_SLOTS.length, 'spare picks are simply skipped');

  startSeason(lg, byId, pool);
  for (let i = 0; i < lg.teams.length; i++) {
    assert.equal(filled(i), ROSTER_SLOTS.length, `club ${i} started a man short`);
  }
  const signings = (lg.transactions || []).filter((t) => t.type === 'fill');
  assert.equal(signings.length, 2, `expected two signings, got ${signings.length}`);
  assert.ok(signings.every((t) => t.team === u), 'only the short club should sign');
  // And nobody was signed twice.
  const ids = ROSTER_SLOTS.flatMap((s) => lg.teams.map((t) => t.slots[s.id])).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, 'a player is on two rosters');
});
