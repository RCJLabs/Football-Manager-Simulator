import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import {
  createLeague, startSeason, registerPlayers, simulateWeekAi, advanceWeek, userTeamIndex,
} from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { enterOffseason, confirmKeepers, aiKeepers, takeJob, closeFreeAgency } from '../src/engine/offseason.js';
import {
  validateTrade, evaluateTrade, executeTrade, proposeTrade, tradesOpen, tradeDeadlineWeek,
  lineupStrength, makeAiOffers, acceptOffer, rostersValid, MAX_TRADE_SIDE,
} from '../src/engine/transactions.js';
import {
  futureHand, futureOwner, futureSeason, futurePicksOpen, pickTradeDelta, pickBroker,
  projectedSlots, futurePickValue, RECORD_WEIGHT,
} from '../src/engine/futurepicks.js';

registerPlayers(byId);

/** A league in its second season, part way through, where picks can be traded. */
function inSeasonTwo(seed, week = 3) {
  const lg = createLeague({ name: 'T', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 12, seed, mode: 'pro', draftType: 'snake' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, byId);
  while (lg.phase === 'season') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  while (lg.phase === 'playoffs') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  const off = enterOffseason(lg, PLAYERS, byId);
  if (off.step === 'jobs') takeJob(lg, off.carousel.offers[0].team, PLAYERS, byId);
  confirmKeepers(lg, aiKeepers(lg, userTeamIndex(lg), PLAYERS, byId, new RNG(seed + 1)), PLAYERS, byId);
  if (lg.offseason?.step === 'freeagency') closeFreeAgency(lg, PLAYERS, byId);
  if (lg.draft) autoDraftAll(lg, lg.draft, PLAYERS, new RNG(90 + seed));
  startSeason(lg, byId);
  while (lg.phase === 'season' && lg.week < week) { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  return lg;
}

const firstOf = (lg, idx) => futureHand(lg, idx).find((p) => p.round === 1 && p.from === idx);
const rosterIds = (t) => ROSTER_SLOTS.map((s) => t.slots[s.id]).filter(Boolean);

test('a season-one league has no picks to trade', () => {
  const lg = createLeague({ name: 'T', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 12, seed: 1, mode: 'pro', draftType: 'snake' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(1));
  startSeason(lg, byId);
  assert.equal(futurePicksOpen(lg), false);
  assert.equal(futureHand(lg, 0).length, 0);
  const u = userTeamIndex(lg);
  const them = lg.teams.map((_, i) => i).find((i) => i !== u);
  const fake = { future: true, season: lg.season + 1, round: 1, from: u, to: u, key: 'x' };
  const v = validateTrade(lg, u, them, [], [rosterIds(lg.teams[them])[0]], byId, PLAYERS, { aPicks: [fake] });
  assert.equal(v.ok, false);
  assert.match(v.reason, /until a season has been played/);
});

test('picks are tradeable in season two, and only next year’s', () => {
  const lg = inSeasonTwo(2);
  assert.equal(futurePicksOpen(lg), true);
  const u = userTeamIndex(lg);
  const hand = futureHand(lg, u);
  assert.ok(hand.length > 0);
  for (const p of hand) assert.equal(p.season, futureSeason(lg));
  assert.equal(futureSeason(lg), lg.season + 1);
});

test('a pick counts as something given, so a player can be bought outright', () => {
  const lg = inSeasonTwo(3);
  const u = userTeamIndex(lg);
  const them = lg.teams.map((_, i) => i).find((i) => i !== u);
  const mine = firstOf(lg, u);
  assert.ok(mine, 'the user holds no first-rounder');
  // Nothing on the human's player side at all — the pick is the whole price.
  // The target has to be somebody who would actually play, because a deal for
  // a man who would be cut on arrival is refused.
  const target = rosterIds(lg.teams[them])
    .find((id) => validateTrade(lg, u, them, [], [id], byId, PLAYERS, { aPicks: [mine], bPicks: [] }).ok);
  assert.ok(target, 'no player on that roster would improve the human');
  const v = validateTrade(lg, u, them, [], [target], byId, PLAYERS, { aPicks: [mine], bPicks: [] });
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.picks, true);
  // And with neither a player nor a pick, it is still nothing.
  assert.equal(validateTrade(lg, u, them, [], [target], byId, PLAYERS).ok, false);
});

test('a club cannot trade a pick it does not hold', () => {
  const lg = inSeasonTwo(4);
  const u = userTeamIndex(lg);
  const them = lg.teams.map((_, i) => i).find((i) => i !== u);
  const theirs = firstOf(lg, them);
  const v = validateTrade(lg, u, them, [], [rosterIds(lg.teams[them])[0]], byId, PLAYERS, { aPicks: [theirs] });
  assert.equal(v.ok, false);
  assert.match(v.reason, /not/);
});

test('executing a trade moves the pick and writes it down', () => {
  const lg = inSeasonTwo(5);
  const u = userTeamIndex(lg);
  const them = lg.teams.map((_, i) => i).find((i) => i !== u);
  const mine = firstOf(lg, u);
  const target = rosterIds(lg.teams[them])
    .find((id) => validateTrade(lg, u, them, [], [id], byId, PLAYERS, { aPicks: [mine], bPicks: [] }).ok);
  assert.ok(target, 'no player on that roster would improve the human');
  const s = futureSeason(lg);
  executeTrade(lg, u, them, [], [target], byId, PLAYERS, { aPicks: [mine], bPicks: [] });
  assert.equal(futureOwner(lg, s, 1, u), them, 'the pick did not change hands');
  assert.equal(futureHand(lg, u).some((p) => p.round === 1 && p.from === u), false);
  assert.ok(futureHand(lg, them).some((p) => p.round === 1 && p.from === u));
  const tx = lg.transactions[lg.transactions.length - 1];
  assert.equal(tx.type, 'trade');
  assert.equal(tx.givesNext.length, 1);
  assert.equal(tx.getsNext.length, 0);
  assert.ok(rostersValid(lg, byId), 'the rosters did not survive a picks-for-player deal');
});

test('the club’s answer moves with the picks in the deal', () => {
  const lg = inSeasonTwo(6);
  const u = userTeamIndex(lg);
  const them = lg.teams.map((_, i) => i).find((i) => i !== u);
  const target = rosterIds(lg.teams[them])[0];
  const plain = evaluateTrade(lg, them, [target], [], byId, PLAYERS);
  const paid = evaluateTrade(lg, them, [target], [], byId, PLAYERS, { pickDelta: 40 });
  assert.ok(paid.delta > plain.delta, 'being handed a pick did not help');
  assert.equal(Math.round((paid.delta - plain.delta) * 10) / 10, 40);
  // And the other way: paying one costs.
  const paying = evaluateTrade(lg, them, [target], [], byId, PLAYERS, { pickDelta: -40 });
  assert.ok(paying.delta < plain.delta);
});

test('a pick is worth more to the club that needs it, and the ledger is signed', () => {
  const lg = inSeasonTwo(7);
  const u = userTeamIndex(lg);
  const slots = projectedSlots(lg, byId);
  const mine = firstOf(lg, u);
  const give = pickTradeDelta(lg, byId, u, [mine], [], slots);
  const get = pickTradeDelta(lg, byId, u, [], [mine], slots);
  assert.ok(give < 0 && get > 0, 'sending and receiving the same pick read the same way');
  assert.equal(Math.round((give + get) * 100) / 100, 0);
  assert.equal(pickTradeDelta(lg, byId, u, [], [], slots), 0);
});

test('the finish estimate leans on the record once a season is under way', () => {
  const lg = inSeasonTwo(8, 10);
  const played = lg.teams[0].record.w + lg.teams[0].record.l + lg.teams[0].record.t;
  assert.ok(played >= 5, `only ${played} games in`);
  // The club with the worst record should be guessed near the top of the draft
  // even if its roster is not the weakest — that is the whole point of the
  // blend, and at ten games the record carries most of the weight.
  const slots = projectedSlots(lg, byId);
  const pct = (t) => { const g = t.record.w + t.record.l + t.record.t; return g ? (t.record.w + 0.5 * t.record.t) / g : 0.5; };
  const worst = lg.teams.map((t, i) => ({ i, p: pct(t) })).sort((a, b) => a.p - b.p)[0].i;
  assert.ok(slots[worst] <= Math.ceil(lg.teams.length / 2), `the worst club is guessed to pick ${slots[worst]} of ${lg.teams.length}`);
  assert.ok(RECORD_WEIGHT > 0);
});

test('with no games played the estimate is the offseason one', () => {
  const lg = inSeasonTwo(9);
  // Wipe the season back to nothing and the record term must weigh nothing.
  const saved = lg.teams.map((t) => ({ ...t.record }));
  lg.teams.forEach((t) => { t.record = { w: 0, l: 0, t: 0, pf: 0, pa: 0 }; });
  const blank = projectedSlots(lg, byId);
  const byRoster = lg.teams
    .map((t, i) => ({ i, s: lineupStrength(t.slots, byId, null) }))
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const expect = new Array(lg.teams.length);
  byRoster.forEach((e, k) => { expect[e.i] = lg.teams.length - k; });
  assert.deepEqual(blank, expect);
  lg.teams.forEach((t, i) => { t.record = saved[i]; });
});

test('a pick deal the club likes goes through, and one it does not is refused', () => {
  const lg = inSeasonTwo(11);
  const u = userTeamIndex(lg);
  const them = lg.teams.map((_, i) => i).find((i) => i !== u);
  const mine = firstOf(lg, u);
  // The club has to be giving up somebody the human would actually play:
  // `backfillPlan` refuses a deal for a man who would be cut on arrival, which
  // is most of the roster when every slot is already full.
  const target = rosterIds(lg.teams[them])
    .find((id) => validateTrade(lg, u, them, [], [id], byId, PLAYERS, { aPicks: [mine], bPicks: [] }).ok);
  assert.ok(target, 'no player on that roster would improve the human');
  // Wildly overpay and the club agrees.
  const generous = proposeTrade(lg, u, them, [], [target], byId, PLAYERS, {
    userPicks: [mine], aiPicks: [], pickDelta: 500,
  });
  assert.equal(generous.ok, true);
  assert.equal(generous.accepted, true, generous.reason);
  assert.equal(futureOwner(lg, futureSeason(lg), 1, u), them);
});

test('AI offers can carry a pick, and taking one moves it', () => {
  const lg = inSeasonTwo(12, 4);
  const u = userTeamIndex(lg);
  assert.ok(tradesOpen(lg), `trades shut at week ${tradeDeadlineWeek(lg)}`);
  const broker = pickBroker(lg, byId);
  assert.ok(broker, 'no broker in a league that can trade picks');
  // Without a broker nothing changes; with one, offers may carry picks.
  const plain = makeAiOffers(lg, byId, new RNG(3), { pool: PLAYERS, max: 3 });
  for (const o of plain) assert.deepEqual(o.givesNext, []);
  lg.offers = []; lg.refusedOffers = [];
  const withPicks = makeAiOffers(lg, byId, new RNG(3), { pool: PLAYERS, max: 3, picks: broker });
  for (const o of withPicks) {
    assert.ok(Array.isArray(o.givesNext) && Array.isArray(o.wantsNext));
    const carried = [...o.givesNext, ...o.wantsNext];
    for (const p of carried) assert.equal(p.season, futureSeason(lg));
  }
  const carrier = withPicks.find((o) => o.givesNext.length || o.wantsNext.length);
  if (carrier) {
    const before = futureOwner(lg, futureSeason(lg), carrier.givesNext[0]?.round ?? 1, carrier.givesNext[0]?.from ?? u);
    acceptOffer(lg, carrier.id, byId, PLAYERS);
    if (carrier.givesNext.length) {
      assert.equal(futureOwner(lg, futureSeason(lg), carrier.givesNext[0].round, carrier.givesNext[0].from), u);
      assert.notEqual(before, u);
    }
    assert.ok(rostersValid(lg, byId));
  }
});

test('at most three picks a side', () => {
  const lg = inSeasonTwo(13);
  const u = userTeamIndex(lg);
  const them = lg.teams.map((_, i) => i).find((i) => i !== u);
  const hand = futureHand(lg, u);
  const tooMany = Array.from({ length: MAX_TRADE_SIDE + 1 }, (_, i) => hand[i % hand.length]);
  const v = validateTrade(lg, u, them, [], [rosterIds(lg.teams[them])[0]], byId, PLAYERS, { aPicks: tooMany });
  assert.equal(v.ok, false);
});
