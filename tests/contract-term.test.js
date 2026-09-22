// Every veteran contract in this game was three years — VET_YEARS, flat, for
// everybody, with the franchise tag the one exception. So the cap was a
// budgeting exercise: you knew the price and you knew you had him three years,
// and there was nothing to decide about either.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { createLeague, registerPlayers, startSeason } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { RNG } from '../src/engine/rng.js';
import {
  keeperCost, TERM_PRICE, TERMS, termFor, setTerm, aiTerm,
  RESIGN_PREMIUM, TAG_PREMIUM, tagCost, setTag, positionRates,
} from '../src/engine/offseason.js';
import { marketSalary, VET_YEARS } from '../src/engine/cap.js';
import { primeAge } from '../src/engine/careers.js';

registerPlayers(PLAYERS_BY_ID);
const pro = (seed = 9) => {
  const lg = createLeague({ name: 'T', mode: 'pro', numTeams: 32, franchise: 3, seed, draftType: 'snake', user: {} });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, PLAYERS_BY_ID);
  lg.offseason = { step: 'keepers', keepers: {}, tagged: {}, terms: {}, rates: positionRates(lg, PLAYERS_BY_ID) };
  return lg;
};
// The dearest man at the position, not the first over some threshold: leverage
// differs by position, and a receiver never clears a bar a quarterback walks over.
const someone = (pos) => [...PLAYERS_BY_ID.values()]
  .filter((p) => p.pos === pos)
  .sort((a, b) => marketSalary(b) - marketSalary(a))[0];

test('the default is the old flat three years, priced exactly as before', () => {
  // A league that never touches this must be unchanged, so the three-year entry
  // has to BE the re-sign premium rather than a number that matches it today.
  assert.equal(TERM_PRICE[VET_YEARS], RESIGN_PREMIUM);
  const lg = pro();
  const p = someone('QB');
  assert.equal(termFor(lg, p.id), VET_YEARS, 'an untouched man is not on the default term');
  assert.equal(keeperCost({ expiring: true }, p, lg), Math.ceil(marketSalary(p) * RESIGN_PREMIUM));
});

test('a shorter deal costs more a year and a longer one less', () => {
  const lg = pro();
  const p = someone('RB');
  const yearly = TERMS.map((t) => { setTerm(lg, p.id, t); return keeperCost({ expiring: true }, p, lg); });
  for (let i = 1; i < yearly.length; i++) {
    assert.ok(yearly[i] <= yearly[i - 1],
      `${TERMS[i]}y costs ${yearly[i]} against ${TERMS[i - 1]}y at ${yearly[i - 1]} — length must not raise the annual price`);
  }
  assert.ok(yearly[0] > yearly[yearly.length - 1], 'every term costs the same, so there is nothing to decide');
});

test('the tag is not made pointless by a freely available short deal', () => {
  // One year is the tag: expensive and one a club. If a two-year deal were
  // cheaper per year AND shorter, the tag would be a strictly worse version of
  // itself, which is the defect this file has already had twice.
  assert.ok(!TERM_PRICE[1], 'a one-year term on the open menu undercuts the tag');
  assert.ok(TAG_PREMIUM > TERM_PRICE[Math.min(...TERMS)],
    'the tag must cost more a year than the shortest open term, being shorter still');
  const lg = pro();
  const p = someone('WR');
  setTerm(lg, p.id, 2);
  const two = keeperCost({ expiring: true }, p, lg);
  lg.contracts[p.id] = { expiring: true };
  setTag(lg, 0, p.id);
  assert.ok(tagCost(lg, p) > two, 'a tag that costs less than a two-year deal is free flexibility');
});

test('a length off the menu falls back rather than throwing', () => {
  const lg = pro();
  const p = someone('TE');
  setTerm(lg, p.id, 7);
  assert.equal(termFor(lg, p.id), VET_YEARS, 'a nonsense term must not become a contract');
  setTerm(lg, p.id, 1);
  assert.equal(termFor(lg, p.id), VET_YEARS, 'one year is the tag and must not be selectable here');
});

test('the AI buys the old short and locks up the young', () => {
  const young = { pos: 'QB', age: primeAge('QB') - 4 };
  const peak = { pos: 'QB', age: primeAge('QB') };
  const old = { pos: 'QB', age: primeAge('QB') + 5 };
  assert.ok(aiTerm({}, young) > aiTerm({}, peak), 'a man still climbing should be locked up for longer');
  assert.ok(aiTerm({}, old) < aiTerm({}, peak), 'a man past his peak should be bought a year at a time');
  assert.equal(aiTerm({}, { pos: 'QB' }), VET_YEARS, 'with no age there is no reason to prefer a length');
  for (const t of [young, peak, old]) assert.ok(TERM_PRICE[aiTerm({}, t)], `${aiTerm({}, t)} is not on the menu`);
});
