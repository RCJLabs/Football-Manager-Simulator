import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason } from '../src/engine/season.js';
import { spreadBudgets, autoCompleteAll, BUDGET_SPREADS, DEFAULT_BUDGET, slotsLeft } from '../src/engine/auction.js';
import { buildLineup, teamPower } from '../src/engine/ratings.js';

test('a spread shares the same money out unevenly', () => {
  for (const n of [8, 10, 12, 32]) {
    for (const spread of [0.1, 0.2]) {
      const b = spreadBudgets(DEFAULT_BUDGET, n, spread, new RNG(5));
      assert.equal(b.length, n);
      // The room is no richer or poorer, which is what makes this a
      // redistribution rather than an easier or harder game for everybody.
      assert.equal(b.reduce((s, x) => s + x, 0), DEFAULT_BUDGET * n, `${n} clubs at ${spread}: the pot changed size`);
      assert.equal(Math.min(...b), Math.round(DEFAULT_BUDGET * (1 - spread)), 'the poorest club gets exactly what was advertised');
      assert.equal(Math.max(...b), Math.round(DEFAULT_BUDGET * (1 + spread)), 'and so does the richest');
      assert.equal(new Set(b).size, n, 'every club gets its own number');
    }
  }
});

test('an even spread is the old behaviour exactly', () => {
  const b = spreadBudgets(DEFAULT_BUDGET, 10, 0, new RNG(1));
  assert.deepEqual(b, Array.from({ length: 10 }, () => DEFAULT_BUDGET));
  assert.deepEqual(spreadBudgets(DEFAULT_BUDGET, 1, 0.2, new RNG(1)), [DEFAULT_BUDGET], 'one club cannot be unequal with itself');
  assert.equal(BUDGET_SPREADS.even, 0);
});

test('who gets the money is the shuffle’s business, and it is seeded', () => {
  const a = spreadBudgets(200, 12, 0.2, new RNG(9));
  const b = spreadBudgets(200, 12, 0.2, new RNG(9));
  assert.deepEqual(a, b, 'the same seed builds the same league');
  const c = spreadBudgets(200, 12, 0.2, new RNG(10));
  assert.notDeepEqual(a, c, 'a different seed does not');
  // Unshuffled it is an ordered ramp; that is the thing the shuffle undoes.
  const plain = spreadBudgets(200, 12, 0.2, null);
  for (let i = 1; i < plain.length; i++) assert.ok(plain[i] >= plain[i - 1], 'unshuffled it climbs');
  assert.notDeepEqual(a, plain, 'and shuffled it does not');
});

test('a league carries the choice and hands it to the auction', () => {
  const mk = (spread, type = 'auction') => createLeague({ name: 'T', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 10, seed: 7, draftType: type, budgetSpread: spread });
  const even = mk(0);
  assert.equal(even.settings.budgetSpread, 0);
  assert.equal(new Set(even.auction.startBudgets).size, 1, 'everyone starts level by default');
  const wide = mk(BUDGET_SPREADS.wide);
  assert.equal(wide.settings.budgetSpread, 0.2);
  assert.equal(new Set(wide.auction.startBudgets).size, 10);
  assert.equal(wide.auction.startBudgets.reduce((s, x) => s + x, 0), 200 * 10);
  assert.deepEqual(wide.auction.budgets, wide.auction.startBudgets, 'nothing is spent yet');
  // A snake draft has no money in it, so the setting cannot leak into one.
  const snake = mk(BUDGET_SPREADS.wide, 'snake');
  assert.equal(snake.auction, null, 'createLeague leaves the auction slot null for a draft');
  assert.ok(snake.draft, 'it built a draft instead');
});

test('the poorest club still fills all twenty-seven slots', () => {
  // The whole guarantee of this auction is that a club always keeps $1 per
  // unfilled slot, so every roster completes. A club starting $40 short is
  // exactly where that would break if it were going to.
  const lg = createLeague({ name: 'T', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 10, seed: 12, draftType: 'auction', budgetSpread: BUDGET_SPREADS.wide });
  const poorest = lg.auction.startBudgets.indexOf(Math.min(...lg.auction.startBudgets));
  assert.equal(lg.auction.startBudgets[poorest], 160);
  const rng = new RNG(lg.rngState);
  autoCompleteAll(lg.auction, lg, PLAYERS, rng, byId);
  startSeason(lg, byId);
  for (const [i, t] of lg.teams.entries()) {
    assert.equal(slotsLeft(t), 0, `club ${i} finished the auction a man short`);
    for (const s of ROSTER_SLOTS) assert.ok(t.slots[s.id], `club ${i} has nobody at ${s.id}`);
  }
  assert.ok(lg.auction.budgets[poorest] >= 0, 'and nobody went overdrawn');
  const owned = lg.teams.flatMap((t) => ROSTER_SLOTS.map((s) => t.slots[s.id]));
  assert.equal(new Set(owned).size, owned.length, 'nobody is on two rosters');
});

test('money buys a better squad, which is the point of offering it', () => {
  // Not a tautology and not free: the auction could hand unequal budgets to
  // equal rosters if the price guide flattened everything out, and a single
  // room could go either way on luck. Measured across twelve leagues, with the
  // bar set where the signal is — the richest club beats the poorest most of
  // the time, not every time.
  let richerStronger = 0, leagues = 0;
  for (let seed = 60; seed < 72; seed++) {
    const lg = createLeague({ name: 'T', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 10, seed, draftType: 'auction', budgetSpread: BUDGET_SPREADS.wide });
    const rng = new RNG(lg.rngState);
    autoCompleteAll(lg.auction, lg, PLAYERS, rng, byId);
    const budgets = lg.auction.startBudgets;
    const rich = budgets.indexOf(Math.max(...budgets));
    const poor = budgets.indexOf(Math.min(...budgets));
    const power = (i) => teamPower(buildLineup(lg.teams[i].slots, byId));
    if (power(rich) > power(poor)) richerStronger++;
    leagues++;
  }
  assert.ok(richerStronger / leagues >= 0.75,
    `the richest club outbuilt the poorest in only ${richerStronger} of ${leagues} leagues`);
});
