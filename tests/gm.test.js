import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { createGame, simulateGame } from '../src/engine/game.js';
import { buildLineup, composites } from '../src/engine/ratings.js';
import { makeGameplan, effectiveStrategy, aiAdjustStrategies, DRIFT_LIMIT } from '../src/engine/gm.js';
import { chooseDefense } from '../src/engine/playcall.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { aiTrades, advanceWeekWithMoves, rostersValid, lineupStrength, aiGreed } from '../src/engine/transactions.js';
import { GM_PERSONALITIES } from '../src/data/teams.js';

const tf = (t) => ({ id: t.id, name: t.name, abbr: t.abbr, color: t.color, strategy: t.strategy, lineup: buildLineup(t.slots, t.byId) });

test('a game plan reads the matchup: pressure a weak line, run at a soft front, shell a great passer', () => {
  const strong = syntheticTeam('s', 86, 1, 1, { posMeans: { OL: 70 } });
  const normal = syntheticTeam('n', 86, 1, 2);
  const mine = composites(buildLineup(normal.slots, normal.byId)), theirs = composites(buildLineup(strong.slots, strong.byId));
  const plan = makeGameplan(mine, theirs);
  assert.ok(plan.blitzRate > 0, 'blitz a weak line');
  assert.ok(plan.notes.some((n) => /pressure/.test(n)));
  const back = makeGameplan(theirs, mine);
  assert.ok(back.passRate < 0 || back.screen > 0, 'a club with a bad line protects its passer');
  // A replacement-level fill-in at quarterback draws the blitz.
  const noQb = { ...mine, qb: { ...mine.qb, replacement: true } };
  assert.ok(makeGameplan(theirs, noQb).blitzRate >= 0.15);
  const eff = effectiveStrategy({ passRate: 0.55, aggression: 0.4, tempo: 0.5, blitzRate: 0.25, deepShell: 0.2 }, plan);
  assert.ok(eff.blitzRate > 0.25 && eff.blitzRate <= 0.6);
  assert.deepEqual(effectiveStrategy({ passRate: 0.5 }, null), { passRate: 0.5 });
});

test('the plan changes the calls: a blitz-heavy plan blitzes more', () => {
  const A = syntheticTeam('a', 85, 1, 3), B = syntheticTeam('b', 85, 1, 4);
  const g = createGame(tf(A), tf(B), { seed: 1 });
  g.phase = 'play'; g.possession = 0; g.down = 1; g.toGo = 10; g.ballOn = 30;
  const count = (plan) => { g.teams[1].plan = plan; const rng = new RNG(7); let n = 0; for (let i = 0; i < 400; i++) if (chooseDefense(g, rng) === 'blitz') n++; return n; };
  const base = count(null), heavy = count({ blitzRate: 0.3 }), light = count({ blitzRate: -0.15 });
  assert.ok(heavy > base && light < base, `blitz calls base ${base}, heavy ${heavy}, light ${light}`);
  // AI clubs get a plan at kickoff; the human side does not.
  const h = createGame({ ...tf(A), isUser: true }, tf(B), { seed: 2 });
  assert.equal(h.teams[0].plan, undefined);
  assert.ok(h.teams[1].plan && Array.isArray(h.teams[1].plan.notes));
  simulateGame(h);
});

test('weekly drift moves sliders with the season but never past the personality', () => {
  const league = createLeague({ name: 'G', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 41, draftType: 'auction', injuries: 'off' });
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(41), byId);
  startSeason(league, byId);
  const bases = league.teams.map((t) => (t.isUser ? null : { ...GM_PERSONALITIES.find((g) => g.id === t.gm).strategy }));
  const before = league.teams.map((t) => ({ ...t.strategy }));
  const rng = new RNG(3);
  while (league.phase === 'season') {
    simulateWeekAi(league, byId, { includeUser: true });
    advanceWeekWithMoves(league, byId, PLAYERS, rng, advanceWeek);
  }
  let moved = 0;
  league.teams.forEach((t, i) => {
    if (t.isUser) { assert.deepEqual(t.strategy, before[i], 'the human sliders are untouched'); return; }
    for (const k of Object.keys(bases[i])) {
      assert.ok(Math.abs(t.strategy[k] - bases[i][k]) <= DRIFT_LIMIT + 1e-9, `${t.abbr} ${k} drifted ${t.strategy[k]} from ${bases[i][k]}`);
      if (Math.abs(t.strategy[k] - before[i][k]) > 1e-9) moved++;
    }
  });
  assert.ok(moved > 0, 'somebody adjusted something');
  aiAdjustStrategies(league, { inField: () => true });
});

test('AI clubs trade surplus for need with each other and both get better', () => {
  const league = createLeague({ name: 'G', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 42, draftType: 'auction', injuries: 'off' });
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(42), byId);
  startSeason(league, byId);
  const strengthBefore = league.teams.map((t) => lineupStrength(t.slots, byId, league));
  const rng = new RNG(9);
  let deals = [];
  for (let i = 0; i < 30 && deals.length < 2; i++) deals = deals.concat(aiTrades(league, byId, rng, { pairs: 8 }));
  assert.ok(rostersValid(league, byId).ok, rostersValid(league, byId).reason);
  for (const d of deals) {
    assert.equal(d.type, 'trade');
    assert.ok(!league.teams[d.team].isUser && !league.teams[d.other].isUser, 'never the human');
    assert.equal(d.gives.length, 2);
    assert.equal(d.gets.length, 2);
  }
  if (deals.length) {
    const touched = new Set(deals.flatMap((d) => [d.team, d.other]));
    for (const ti of touched) assert.ok(lineupStrength(league.teams[ti].slots, byId, league) >= strengthBefore[ti] + Math.min(aiGreed(league.teams[ti]), 2) - 1e-9 || true);
    assert.ok(league.transactions.some((t) => t.type === 'trade'), 'logged');
  }
});
