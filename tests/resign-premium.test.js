// The pro keeper round used to hold no decision.
//
// Re-signing an expiring man and declining him both cost `marketSalary`, and
// only declining carried the risk of losing him in free agency — so declining
// was strictly dominated. `RESIGN_PREMIUM` prices the exclusive window, which
// is what makes the two options comparable rather than one plainly worse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS_BY_ID } from '../src/data/db.js';
import { createLeague, registerPlayers } from '../src/engine/season.js';
import { keeperCost, RESIGN_PREMIUM, BIRD_IN_HAND } from '../src/engine/offseason.js';
import { marketSalary, MIN_SALARY } from '../src/engine/cap.js';

registerPlayers(PLAYERS_BY_ID);
const pro = () => createLeague({ name: 'P', mode: 'pro', numTeams: 32, franchise: 3, seed: 5, draftType: 'snake', user: {} });
const fantasy = () => createLeague({ name: 'F', numTeams: 8, seed: 5, draftType: 'auction', user: { name: 'Me', abbr: 'ME', color: '#fff' } });
const someone = (pos, minOvr = 0) => [...PLAYERS_BY_ID.values()].find((p) => p.pos === pos && marketSalary(p) > minOvr);

test('an expiring deal costs more than the market asks', () => {
  const lg = pro();
  const p = someone('QB', 10);
  const market = marketSalary(p);
  const cost = keeperCost({ expiring: true, salary: MIN_SALARY }, p, lg);
  assert.ok(cost > market,
    `re-signing must cost more than declining and re-buying, or declining is dominated: ${cost} vs ${market}`);
  assert.equal(cost, Math.ceil(market * RESIGN_PREMIUM));
});

test('the premium sits below what a club thinks certainty is worth', () => {
  // aiKeepers weighs market * BIRD_IN_HAND against keeperCost. At or above it,
  // every surplus is negative and every club declines everybody.
  assert.ok(RESIGN_PREMIUM < BIRD_IN_HAND,
    `${RESIGN_PREMIUM} must stay under ${BIRD_IN_HAND} or the keeper round empties into the market`);
  assert.ok(RESIGN_PREMIUM > 1, 'at 1 the choice is dominated again, which is the defect this fixes');
});

test('a deal with years left is untouched by it', () => {
  // A contract under term is not a decision and must not be repriced.
  const lg = pro();
  const p = someone('RB', 10);
  assert.equal(keeperCost({ expiring: false, years: 3, salary: 17 }, p, lg), 17);
});

test('the fantasy league never sees the premium', () => {
  // Fantasy keeps its own rule: last year's price plus the greater of $3 or 15%.
  const lg = fantasy();
  const p = someone('WR', 10);
  const cost = keeperCost({ salary: 20 }, p, lg);
  assert.equal(cost, Math.max(20 + 3, Math.ceil(20 * 1.15)));
  assert.notEqual(cost, Math.ceil(marketSalary(p) * RESIGN_PREMIUM));
});
