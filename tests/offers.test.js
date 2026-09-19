import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek, userTeamIndex } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import {
  makeAiOffers, liveOffers, acceptOffer, declineOffer, pruneOffers, initOffers, advanceWeekWithMoves,
  lineupStrength, rostersValid, ownerMap, aiGreed, slotOf, tradeDeadlineWeek, MAX_LIVE_OFFERS, OFFER_FAIR_MARGIN,
} from '../src/engine/transactions.js';

function league(seed, n = 8) {
  const lg = createLeague({ name: 'O', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: n, seed, draftType: 'auction', injuries: 'off' });
  autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), byId);
  startSeason(lg, byId);
  return lg;
}
const rosterIds = (t) => ROSTER_SLOTS.map((s) => t.slots[s.id]).filter(Boolean);

test('AI clubs offer deals that help them and are not insulting to the human', () => {
  const lg = league(51);
  const u = userTeamIndex(lg);
  let made = makeAiOffers(lg, byId, null, { max: 8 });
  if (!made.length) made = makeAiOffers(league(56), byId, null, { max: 8 });
  assert.ok(made.length > 0, 'somebody called');
  assert.ok(made.length <= MAX_LIVE_OFFERS);
  const baseU = lineupStrength(lg.teams[u].slots, byId, lg);
  for (const o of made) {
    assert.notEqual(o.from, u, 'never from the human');
    assert.equal(o.gives.length, 2);
    assert.equal(o.wants.length, 2);
    for (const id of o.gives) assert.ok(slotOf(lg.teams[o.from], id), 'they own what they offer');
    for (const id of o.wants) assert.ok(slotOf(lg.teams[u], id), 'they ask for players you own');
    const posGives = o.gives.map((id) => byId.get(id).pos).sort();
    const posWants = o.wants.map((id) => byId.get(id).pos).sort();
    assert.deepEqual(posGives, posWants, 'positions match');
    assert.ok(o.aiGain >= aiGreed(lg.teams[o.from]), `${o.from} gains ${o.aiGain}, greed ${aiGreed(lg.teams[o.from])}`);
    assert.ok(o.userDelta >= -OFFER_FAIR_MARGIN, `insulting offer: user ${o.userDelta}`);
    assert.ok(/thin at [A-Z]+ and deep at [A-Z]+/.test(o.note), o.note);
    assert.equal(o.week, lg.week);
  }
  void baseU;
});

/** A league whose clubs have a deal to propose at week one. Not every roster does. */
function leagueWithOffer(from = 51) {
  for (let seed = from; seed < from + 20; seed++) {
    const lg = league(seed);
    const made = makeAiOffers(lg, byId, null, { max: 8 });
    if (made.length) return { lg, made, seed };
  }
  throw new Error('no league in twenty produced an offer');
}

test('accepting an offer does the deal; declining kills it for the season', () => {
  const { lg, made, seed } = leagueWithOffer(52);
  const u = userTeamIndex(lg);
  const first = made[0];
  assert.ok(first);
  const before = lineupStrength(lg.teams[u].slots, byId, lg);
  const tx = acceptOffer(lg, first.id, byId);
  assert.equal(tx.type, 'trade');
  assert.ok(rostersValid(lg, byId).ok, rostersValid(lg, byId).reason);
  const owned = ownerMap(lg);
  for (const id of first.gives) assert.equal(owned.get(id), u, 'you got their players');
  for (const id of first.wants) assert.equal(owned.get(id), first.from, 'they got yours');
  const after = lineupStrength(lg.teams[u].slots, byId, lg);
  assert.ok(Math.abs((after - before) - first.userDelta) < 0.2, `promised ${first.userDelta}, got ${(after - before).toFixed(1)}`);
  assert.throws(() => acceptOffer(lg, first.id, byId), /already answered/);
  assert.throws(() => acceptOffer(lg, 'nope', byId), /no longer on the table/);
  // Unrelated offers stay on the table; any that named a traded player goes stale.
  const moved = new Set([...first.gives, ...first.wants]);
  for (const o of lg.offers) {
    if (o === first) continue;
    const touched = [...o.gives, ...o.wants].some((id) => moved.has(id));
    assert.equal(!!o.answered, touched, `offer ${o.id} touched=${touched} answered=${o.answered}`);
  }

  const lg2 = league(seed);
  const [again] = makeAiOffers(lg2, byId, null, { max: 8 });
  assert.ok(declineOffer(lg2, again.id));
  assert.equal(declineOffer(lg2, again.id), false, 'declining twice does nothing');
  assert.ok(lg2.refusedOffers.length === 1);
  const repeat = makeAiOffers(lg2, byId, null, { max: 8 });
  assert.ok(!repeat.some((o) => o.from === again.from && o.gives.join() === again.gives.join() && o.wants.join() === again.wants.join()), 'the same deal is not re-offered');
});

test('offers arrive with the new week, expire, and stop at the deadline', () => {
  // Across several leagues rather than one: whether any single club rings you
  // is luck, and pinning the behaviour to one seed makes this a test of that
  // seed's luck that flakes whenever a rating or a leverage number is retuned.
  let leaguesWithOffers = 0, totalWeeksWithOffers = 0;
  for (const seed of [53, 61, 72, 88, 91]) {
    const lg = league(seed);
    const rng = new RNG(4);
    let weeksWithOffers = 0;
    while (lg.phase === 'season') {
      const week = lg.week;
      const live = liveOffers(lg);
      if (live.length) { weeksWithOffers++; for (const o of live) assert.equal(o.week, week); }
      if (lg.week > tradeDeadlineWeek(lg)) assert.equal(live.length, 0, `offers past the deadline in week ${lg.week}`);
      simulateWeekAi(lg, byId, { includeUser: true });
      advanceWeekWithMoves(lg, byId, PLAYERS, rng, advanceWeek);
      // Last week's unanswered offers are gone.
      assert.ok(liveOffers(lg).every((o) => o.week === lg.week));
    }
    if (weeksWithOffers) leaguesWithOffers++;
    totalWeeksWithOffers += weeksWithOffers;
    assert.ok(lg.offers.length < 60, `offer list grew to ${lg.offers.length}`);
    assert.ok(rostersValid(lg, byId).ok);
  }
  assert.ok(leaguesWithOffers >= 3, `the phone rang in only ${leaguesWithOffers} of 5 leagues`);
  assert.ok(totalWeeksWithOffers >= 5, `offers in ${totalWeeksWithOffers} weeks across 5 seasons`);
});

test('taking every offer never breaks a roster and stays inside the rules', () => {
  const lg = league(54);
  const u = userTeamIndex(lg);
  const rng = new RNG(6);
  let taken = 0;
  while (lg.phase === 'season') {
    for (const o of liveOffers(lg)) {
      if (o.answered) continue;
      acceptOffer(lg, o.id, byId);
      taken++;
      assert.ok(rostersValid(lg, byId).ok, rostersValid(lg, byId).reason);
      assert.equal(rosterIds(lg.teams[u]).length, ROSTER_SLOTS.length);
    }
    simulateWeekAi(lg, byId, { includeUser: true });
    advanceWeekWithMoves(lg, byId, PLAYERS, rng, advanceWeek);
  }
  assert.ok(taken > 0, `took ${taken} offers`);
  assert.equal(new Set(ownerMap(lg).keys()).size, 8 * ROSTER_SLOTS.length, 'nobody is on two rosters');
  const trades = lg.transactions.filter((t) => t.type === 'trade' && (t.team === u || t.other === u));
  assert.equal(trades.length, taken, 'every accepted offer is in the log');
});

test('pruning keeps the list small and initOffers is safe on an old league', () => {
  const lg = league(55);
  initOffers(lg);
  assert.deepEqual(lg.offers, []);
  makeAiOffers(lg, byId, null, { max: 8 });
  lg.offers[0].answered = 'declined';
  lg.week += 3;
  pruneOffers(lg);
  assert.equal(lg.offers.length, 0, 'stale and answered offers are dropped');
  lg.refusedOffers = new Array(400).fill('x');
  pruneOffers(lg);
  assert.equal(lg.refusedOffers.length, 200);
});
