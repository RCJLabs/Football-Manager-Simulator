// The pro keeper round used to hold no decision.
//
// Re-signing an expiring man and declining him both cost `marketSalary`, and
// only declining carried the risk of losing him in free agency — so declining
// was strictly dominated. `RESIGN_PREMIUM` prices the exclusive window, which
// is what makes the two options comparable rather than one plainly worse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { createLeague, registerPlayers, startSeason } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { RNG } from '../src/engine/rng.js';
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

// --- the franchise tag ------------------------------------------------------
//
// The real league's tag overrides a player who will not re-sign. Nothing here
// needs overriding — re-signing is already unilateral — so what it buys is term
// instead: one year at a premium, against a fresh VET_YEARS deal that DEAD_SHARE
// makes expensive to leave.
import { TAG_PREMIUM, TAG_TOP_N, tagCost, setTag, canTag, tagOf, positionRates, aiTagChoice } from '../src/engine/offseason.js';
import { VET_YEARS } from '../src/engine/cap.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';

// Rates come off who is actually rostered, so the league has to have drafted —
// an undrafted one has 32 empty sheets and prices every position at nothing.
const tagReady = (seed = 9) => {
  const lg = pro();
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, PLAYERS_BY_ID);
  lg.offseason = { step: 'keepers', keepers: {}, tagged: {}, rates: positionRates(lg, PLAYERS_BY_ID) };
  return lg;
};

test('the tag costs more than re-signing, or it would be the same defect reversed', () => {
  assert.ok(TAG_PREMIUM > RESIGN_PREMIUM,
    `${TAG_PREMIUM} must exceed ${RESIGN_PREMIUM} or tagging dominates re-signing`);
  const lg = tagReady();
  const p = someone('QB', 10);
  assert.ok(tagCost(lg, p) > keeperCost({ expiring: true }, p, lg),
    'a tag that costs no more than a re-signing buys nothing but a shorter deal for free');
});

test('the position rate floors the price so tagging a squad player is absurd', () => {
  // Without the floor the tag is a flat multiple of a man's own worth, which
  // makes it cheapest exactly where it should be dearest.
  const lg = tagReady();
  const rates = lg.offseason.rates;
  assert.ok(Object.keys(rates).length > 0, 'no rates were built');
  for (const [pos, rate] of Object.entries(rates)) {
    assert.ok(Number.isFinite(rate) && rate > 0, `${pos} priced at ${rate}`);
  }
  const cheap = [...PLAYERS_BY_ID.values()].filter((x) => x.pos === 'QB').sort((a, b) => marketSalary(a) - marketSalary(b))[0];
  assert.equal(tagCost(lg, cheap), Math.max(rates.QB, Math.ceil(marketSalary(cheap) * TAG_PREMIUM)));
  assert.ok(TAG_TOP_N >= 3, 'a mean of fewer than three is one man s salary wearing a hat');
});

test('one tag a club, and only on a man whose deal is up', () => {
  const lg = tagReady();
  const team = lg.teams[0];
  const ids = ROSTER_SLOTS.map((s) => team.slots[s.id]).filter(Boolean);
  const [a, b] = ids;
  lg.contracts[a] = { expiring: true };
  lg.contracts[b] = { expiring: false, years: 2 };
  assert.equal(canTag(lg, 0, b).ok, false, 'a man under contract cannot be tagged');
  setTag(lg, 0, a);
  assert.equal(tagOf(lg, 0), a);
  // Tagging somebody else replaces it rather than stacking.
  lg.contracts[b] = { expiring: true };
  setTag(lg, 0, b);
  assert.equal(tagOf(lg, 0), b, 'the tag moved');
  assert.equal(Object.keys(lg.offseason.tagged).length, 1, 'a club held two tags at once');
  setTag(lg, 0, null);
  assert.equal(tagOf(lg, 0), null);
});

test('a tagged man signs for one year, not the usual term', () => {
  assert.ok(VET_YEARS > 1, 'the tag is only interesting because the normal deal is longer');
});

test('the AI tags a man past his peak, not its best player', () => {
  // The point is avoiding the back end of a long deal, so youth is the wrong
  // target however good he is.
  const lg = tagReady();
  const young = { id: 'y', pos: 'QB', age: 24, ovr: 99 };
  const old = { id: 'o', pos: 'QB', age: 34, ovr: 88 };
  lg.contracts = { y: { expiring: true }, o: { expiring: true } };
  const pick = aiTagChoice(lg, 0, [young, old], PLAYERS_BY_ID);
  assert.equal(pick, 'o', 'the tag went to the man with his best years still ahead');
});

test('a league saved before the tag existed does not throw on the keeper screen', () => {
  // An offseason written by an older version has no `rates` and no `tagged`.
  // The screen prices every expiring man through tagCost to label the button,
  // so a throw here would be a blank keeper round on somebody's live save.
  const lg = pro();
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(4));
  startSeason(lg, PLAYERS_BY_ID);
  lg.offseason = { step: 'keepers', keepers: {} };
  const p = someone('QB', 10);
  assert.equal(tagOf(lg, 0), null, 'no tag is held in a save that never had them');
  const cost = tagCost(lg, p);
  assert.equal(cost, Math.ceil(marketSalary(p) * TAG_PREMIUM),
    'with no cached rates the floor simply drops out rather than breaking the price');
  assert.ok(cost > keeperCost({ expiring: true }, p, lg), 'and it is still dearer than re-signing');
  // aiTagChoice must decline rather than throw when there is nothing to read.
  assert.doesNotThrow(() => aiTagChoice(lg, 0, [], PLAYERS_BY_ID));
});
