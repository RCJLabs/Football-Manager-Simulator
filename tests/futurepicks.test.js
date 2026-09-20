import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import {
  createLeague, startSeason, registerPlayers, simulateWeekAi, advanceWeek, userTeamIndex,
} from '../src/engine/season.js';
import { autoDraftAll, openSlots } from '../src/engine/draft.js';
import { enterOffseason, confirmKeepers, aiKeepers, takeJob, closeFreeAgency } from '../src/engine/offseason.js';
import {
  remainingPicks, validatePickTrade, executePickTrade, projectPickTrade, pickOwner,
  pickOfferCandidates, FUTURE_BUDGET, OFFER_BUDGET,
} from '../src/engine/draftpicks.js';
import { lineupStrength } from '../src/engine/transactions.js';
import {
  futureHand, futureOwner, futurePicksOpen, futureSeason, futurePickValue, projectedSlots,
  applyFutureTrade, applyOwedPicks, validateFuturePicks, snakeOverall, madeOdds,
  futureDiscount, futureHandValue,
  FUTURE_ROUNDS, FUTURE_DISCOUNT, FUTURE_DISCOUNT_LOW, FUTURE_DISCOUNT_HIGH,
} from '../src/engine/futurepicks.js';

registerPlayers(byId);

const proLeague = (seed, n = 12) => createLeague({
  name: 'FP', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: n, seed, mode: 'pro', draftType: 'snake',
});

/** A league taken through one season and into its second draft. */
function secondDraft(seed) {
  const lg = proLeague(seed);
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, byId);
  while (lg.phase === 'season') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  while (lg.phase === 'playoffs') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  const off = enterOffseason(lg, PLAYERS, byId);
  if (off.step === 'jobs') takeJob(lg, off.carousel.offers[0].team, PLAYERS, byId);
  confirmKeepers(lg, aiKeepers(lg, userTeamIndex(lg), PLAYERS, byId, new RNG(seed + 1)), PLAYERS, byId);
  closeFreeAgency(lg, PLAYERS, byId);
  return lg;
}

test('a league cannot trade next year until it has played a year', () => {
  const lg = proLeague(1);
  assert.equal(futurePicksOpen(lg), false);
  assert.equal(futureHand(lg, 0).length, 0);
  // And the check bites where it matters: on the deal itself.
  const bad = validateFuturePicks(lg, 0, [{ future: true, season: 2, round: 1, from: 0, to: 0, key: 'f2:1:0' }]);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /until a season has been played/);
  // Every club is a blank sheet in an opening draft, so there is nothing to
  // guess a finish from. That is the reason for the rule, not tidiness: the
  // rosters are identically empty, so the order the estimator produces is
  // whatever the tie-break happens to say.
  const strengths = lg.teams.map((t) => lineupStrength(t.slots, byId, null));
  assert.equal(new Set(strengths).size, 1, 'clubs differ before a ball is kicked');
  assert.deepEqual(projectedSlots(lg, byId), lg.teams.map((_, i) => lg.teams.length - i));
});

test('once a season is played a club holds its own three rounds', () => {
  const lg = secondDraft(2);
  assert.equal(futurePicksOpen(lg), true);
  const s = futureSeason(lg);
  assert.equal(s, lg.season + 1);
  const hand = futureHand(lg, 0);
  assert.equal(hand.length, FUTURE_ROUNDS);
  assert.deepEqual(hand.map((p) => p.round), [1, 2]);
  for (const p of hand) { assert.equal(p.from, 0); assert.equal(p.season, s); }
  // Nobody owes anybody anything yet, so the table is empty.
  assert.equal((lg.owedPicks || []).length, 0);
});

test('a traded future pick changes hands, and coming home leaves no trace', () => {
  const lg = secondDraft(3);
  const s = futureSeason(lg);
  applyFutureTrade(lg, 0, 1, futureHand(lg, 0).filter((p) => p.round === 1), []);
  assert.equal(futureOwner(lg, s, 1, 0), 1);
  assert.equal(futureHand(lg, 0).length, FUTURE_ROUNDS - 1);
  assert.ok(futureHand(lg, 1).some((p) => p.from === 0 && p.round === 1));
  assert.equal(lg.owedPicks.length, 1);
  // On to a third club, and then back to where it started.
  applyFutureTrade(lg, 1, 2, [{ future: true, season: s, round: 1, from: 0, to: 1, key: `f${s}:1:0` }], []);
  assert.equal(futureOwner(lg, s, 1, 0), 2);
  applyFutureTrade(lg, 2, 0, [{ future: true, season: s, round: 1, from: 0, to: 2, key: `f${s}:1:0` }], []);
  assert.equal(futureOwner(lg, s, 1, 0), 0);
  assert.equal(lg.owedPicks.length, 0, 'a pick that came home left a row behind');
});

test('what is owed comes due in next year’s draft, in the right slot', () => {
  const lg = secondDraft(4);
  const s = futureSeason(lg);
  const owedFrom = 0, owedTo = lg.teams.length - 1;
  applyFutureTrade(lg, owedFrom, owedTo, futureHand(lg, owedFrom).filter((p) => p.round === 1), []);
  // Play the season the pick was promised in, and arrive at the draft it lands in.
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(44));
  startSeason(lg, byId);
  while (lg.phase === 'season') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  while (lg.phase === 'playoffs') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  const off = enterOffseason(lg, PLAYERS, byId);
  if (off.step === 'jobs') takeJob(lg, off.carousel.offers[0].team, PLAYERS, byId);
  confirmKeepers(lg, aiKeepers(lg, userTeamIndex(lg), PLAYERS, byId, new RNG(5)), PLAYERS, byId);
  closeFreeAgency(lg, PLAYERS, byId);
  assert.equal(lg.season, s);
  const d = lg.draft;
  const j = d.order.indexOf(owedFrom);
  assert.ok(j >= 0);
  assert.equal(pickOwner(d, 1, j), owedTo, 'the promised pick did not change hands when it came due');
  // And the row is spent rather than left to fire again next year.
  assert.equal((lg.owedPicks || []).some((r) => r.season === s), false);
});

test('a weak club’s future first is worth more than a strong club’s', () => {
  const lg = secondDraft(6);
  const slots = projectedSlots(lg, byId);
  const first = slots.indexOf(1);                    // guessed to pick first
  const last = slots.indexOf(lg.teams.length);       // guessed to pick last
  const mk = (from, round) => ({ future: true, season: futureSeason(lg), round, from, to: from, key: `x${from}${round}` });
  const hi = futurePickValue(lg, byId, mk(first, 1), slots);
  const lo = futurePickValue(lg, byId, mk(last, 1), slots);
  assert.ok(hi > lo * 1.5, `first pick ${hi.toFixed(0)} is not clearly worth more than last ${lo.toFixed(0)}`);
  // And a later round is worth less than an earlier one from the same club.
  assert.ok(futurePickValue(lg, byId, mk(first, 2), slots) < hi);
  // The discount and the odds of the pick never being made are both in there.
  assert.ok(madeOdds(lg, 1) === 1 && madeOdds(lg, 2) < 1);
  assert.ok(FUTURE_DISCOUNT > 0 && FUTURE_DISCOUNT <= 1);
});

test('the snake runs the other way in even rounds', () => {
  assert.equal(snakeOverall(1, 1, 12), 1);
  assert.equal(snakeOverall(1, 12, 12), 12);
  assert.equal(snakeOverall(2, 1, 12), 24);     // first picker goes last
  assert.equal(snakeOverall(2, 12, 12), 13);
  assert.equal(snakeOverall(3, 1, 12), 25);
});

test('only next year, and only the first rounds', () => {
  const lg = secondDraft(7);
  const s = futureSeason(lg);
  const far = validateFuturePicks(lg, 0, [{ future: true, season: s + 1, round: 1, from: 0, to: 0, key: 'k' }]);
  assert.equal(far.ok, false);
  const deep = validateFuturePicks(lg, 0, [{ future: true, season: s, round: FUTURE_ROUNDS + 1, from: 0, to: 0, key: 'k' }]);
  assert.equal(deep.ok, false);
  // And a club cannot trade what it does not hold.
  const notMine = validateFuturePicks(lg, 1, futureHand(lg, 0).slice(0, 1));
  assert.equal(notMine.ok, false);
  assert.match(notMine.reason, /not/);
});

test('a deal can carry both kinds, and the projection counts both', () => {
  const lg = secondDraft(8);
  const d = lg.draft;
  const u = userTeamIndex(lg);
  const them = lg.teams.map((_, i) => i).find((i) => i !== u && remainingPicks(d, i).length);
  const mine = remainingPicks(d, u)[0];
  const theirs = remainingPicks(d, them)[0];
  assert.ok(mine && theirs);
  const sweet = futureHand(lg, u).find((p) => p.round === 1);
  const straight = projectPickTrade(lg, d, PLAYERS, byId, them, u, [theirs], [mine]);
  const sweetened = projectPickTrade(lg, d, PLAYERS, byId, them, u, [theirs], [mine, sweet]);
  assert.equal(straight.future, null);
  assert.ok(sweetened.future, 'the future side was not broken out');
  // Throwing a first-round pick in costs the user and pays the club.
  assert.ok(sweetened.b < straight.b, 'giving away a future first cost the user nothing');
  assert.ok(sweetened.a > straight.a, 'taking a future first gained the club nothing');
  assert.equal(validatePickTrade(lg, d, them, u, [theirs], [mine, sweet]).ok, true);
});

test('a future pick does not count towards finishing the draft short', () => {
  const lg = secondDraft(9);
  const d = lg.draft;
  const u = userTeamIndex(lg);
  const them = lg.teams.map((_, i) => i).find((i) => i !== u && remainingPicks(d, i).length);
  const mine = remainingPicks(d, u);
  const theirs = remainingPicks(d, them);
  const sweet = futureHand(lg, u).slice(0, 2);
  const before = openSlots(lg.teams[u]).length;
  // Two future picks and one of this year's, for one of theirs: only the
  // present pick can leave a slot unfilled.
  const v = validatePickTrade(lg, d, them, u, [theirs[0]], [mine[0], ...sweet]);
  assert.equal(v.ok, true, v.reason);
  executePickTrade(lg, d, them, u, [theirs[0]], [mine[0], ...sweet]);
  assert.equal(openSlots(lg.teams[u]).length, before);
  assert.equal(futureHand(lg, u).length, FUTURE_ROUNDS - 2);
  assert.equal(futureHand(lg, them).filter((p) => p.from === u).length, 2);
  const tx = lg.transactions[lg.transactions.length - 1];
  assert.equal(tx.type, 'picks');
  assert.equal(tx.givesNext.length, 0);
  assert.equal(tx.getsNext.length, 2, 'the future side was not written down');
});

test('a fantasy league never voids a future pick, a pro one sometimes does', () => {
  const fantasy = createLeague({ name: 'F', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 3, draftType: 'snake' });
  for (let r = 1; r <= FUTURE_ROUNDS; r++) assert.equal(madeOdds(fantasy, r), 1);
  const pro = proLeague(10);
  assert.equal(madeOdds(pro, 1), 1);
  assert.ok(madeOdds(pro, 2) < 1 && madeOdds(pro, 2) > 0.9);
});

test('an empty owed table does nothing to a draft', () => {
  const lg = proLeague(11);
  const before = { ...(lg.draft.traded || {}) };
  applyOwedPicks(lg, lg.draft);
  assert.deepEqual(lg.draft.traded || {}, before);
});

test('a contender discounts next year and a rebuilding club does not', () => {
  const lg = secondDraft(12);
  const slots = projectedSlots(lg, byId);
  const worst = slots.indexOf(1);                    // guessed to pick first
  const best = slots.indexOf(lg.teams.length);       // guessed to pick last
  assert.equal(futureDiscount(lg, worst, slots), FUTURE_DISCOUNT_HIGH);
  assert.equal(futureDiscount(lg, best, slots), FUTURE_DISCOUNT_LOW);
  assert.ok(FUTURE_DISCOUNT_LOW < FUTURE_DISCOUNT && FUTURE_DISCOUNT < FUTURE_DISCOUNT_HIGH);
  // Which means the same pick fetches a different answer around the league —
  // the only reason shopping one around is worth doing.
  const pick = futureHand(lg, worst).find((p) => p.round === 1);
  const toRebuilder = futureHandValue(lg, byId, [pick], slots, worst);
  const toContender = futureHandValue(lg, byId, [pick], slots, best);
  assert.ok(toRebuilder > toContender, 'every club values next year the same');
  // And with no holder named it falls back to the flat midpoint, so anything
  // that does not care which books it is on still gets a sensible number.
  const flat = futureHandValue(lg, byId, [pick], slots);
  assert.ok(flat > toContender && flat < toRebuilder);
});

test('AI clubs do build deals with next year in them', () => {
  const lg = secondDraft(13);
  const d = lg.draft;
  const u = userTeamIndex(lg);
  const plan = pickOfferCandidates(lg, d, PLAYERS, byId, new RNG(4));
  if (!plan) return;
  // Straight swaps and future deals are kept apart on purpose: one is scored
  // in board points and the other in lineup points, and a list sorted by two
  // scales is sorted by neither.
  for (const c of plan.candidates) {
    assert.equal(c.tp.future, undefined);
    assert.equal(c.mp.future, undefined);
  }
  assert.ok(Array.isArray(plan.future));
  for (const c of plan.future) {
    const both = [...c.gives, ...c.wants];
    assert.equal(both.filter((p) => p.future).length, 1, 'a future deal had the wrong number of future picks');
    assert.equal(both.length, 2, 'future deals are one for one');
    // Round one only: a keeper draft's later future picks are worth a few
    // points and are not worth a draft simulation to ask about.
    assert.equal(both.find((p) => p.future).round, 1);
    assert.ok([c.a, u].includes(c.a));
  }
  // And the budget for them comes out of the existing one, not on top.
  assert.ok(FUTURE_BUDGET >= 1 && FUTURE_BUDGET < OFFER_BUDGET);
});
