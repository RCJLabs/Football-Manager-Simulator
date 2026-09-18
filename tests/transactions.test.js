import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek, standings } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { overall } from '../src/engine/ratings.js';
import {
  ownerMap, freeAgents, slotOf, fileClaim, cancelClaim, claimsThisWeek, aiFileClaims, processWaivers,
  lineupStrength, validateTrade, evaluateTrade, executeTrade, proposeTrade, tradeDeadlineWeek, tradesOpen,
  rostersValid, advanceWeekWithMoves, initWaivers, DEFAULT_WAIVER_LIMIT,
} from '../src/engine/transactions.js';

function fantasyLeague(seed, n = 8) {
  const league = createLeague({ name: 'T', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: n, seed, draftType: 'auction' });
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(seed), byId);
  startSeason(league, byId);
  return league;
}
const user = (league) => league.teams.findIndex((t) => t.isUser);
const bestFreeAt = (league, pos) => freeAgents(league, PLAYERS).filter((p) => p.pos === pos).sort((a, b) => overall(b) - overall(a))[0];

test('free agents are exactly the players nobody owns', () => {
  const league = fantasyLeague(1);
  const owned = ownerMap(league);
  assert.equal(owned.size, 8 * ROSTER_SLOTS.length);
  const fa = freeAgents(league, PLAYERS);
  assert.equal(fa.length, PLAYERS.length - owned.size);
  for (const p of fa) assert.ok(!owned.has(p.id));
});

test('a claim must swap like for like on your own roster, within the weekly limit', () => {
  const league = fantasyLeague(2);
  const u = user(league);
  const me = league.teams[u];
  const wr = bestFreeAt(league, 'WR');
  const myWr = me.slots.WR4, myRb = me.slots.RB2;
  assert.throws(() => fileClaim(league, u, wr.id, myRb, byId), /Swap a WR for a WR/);
  assert.throws(() => fileClaim(league, u, me.slots.WR1, myWr, byId), /is on a roster/);
  assert.throws(() => fileClaim(league, u, wr.id, league.teams[u === 0 ? 1 : 0].slots.WR1, byId), /not on your roster/);
  fileClaim(league, u, wr.id, myWr, byId);
  assert.throws(() => fileClaim(league, u, wr.id, me.slots.WR3, byId), /already have a claim/);
  const wr2 = freeAgents(league, PLAYERS).filter((p) => p.pos === 'WR')[1];
  assert.throws(() => fileClaim(league, u, wr2.id, myWr, byId), /already the drop/);
  fileClaim(league, u, wr2.id, me.slots.WR3, byId);
  assert.equal(claimsThisWeek(league, u).length, 2);
  const wr3 = freeAgents(league, PLAYERS).filter((p) => p.pos === 'WR')[2];
  assert.throws(() => fileClaim(league, u, wr3.id, me.slots.WR2, byId), new RegExp(`Only ${DEFAULT_WAIVER_LIMIT} claims`));
  assert.ok(cancelClaim(league, u, wr.id));
  assert.equal(claimsThisWeek(league, u).length, 1);
});

test('contested claims go by waiver priority and the winner drops to the back', () => {
  const league = fantasyLeague(3);
  initWaivers(league);
  const target = bestFreeAt(league, 'RB');
  const [first, second] = league.waiverOrder;
  // Both clubs want the same back; file the lower-priority club first to prove order beats timing.
  fileClaim(league, second, target.id, league.teams[second].slots.RB2, byId);
  fileClaim(league, first, target.id, league.teams[first].slots.RB2, byId);
  const results = processWaivers(league, byId);
  assert.equal(results.length, 2);
  const win = results.find((r) => r.team === first), lose = results.find((r) => r.team === second);
  assert.ok(win.ok, 'priority club got him');
  assert.ok(!lose.ok && /priority/.test(lose.reason));
  assert.equal(ownerMap(league).get(target.id), first);
  assert.equal(league.waiverOrder[league.waiverOrder.length - 1], first, 'winner goes to the back');
  assert.equal(league.waiverOrder[0], second, 'loser keeps his spot');
  assert.equal(league.claims.length, 0, 'wire cleared');
  assert.equal(league.transactions.length, 1);
  assert.ok(rostersValid(league, byId).ok);
});

test('AI clubs file claims that improve their lineups and never break a roster', () => {
  const league = fantasyLeague(4);
  const before = league.teams.map((t) => lineupStrength(t.slots, byId));
  aiFileClaims(league, PLAYERS, byId, null);
  const claims = league.claims.slice();
  assert.ok(claims.length > 0, 'somebody worked the wire');
  for (const c of claims) {
    assert.ok(!league.teams[c.team].isUser, 'AI only');
    assert.equal(byId.get(c.add).pos, byId.get(c.drop).pos);
    assert.ok(claimsThisWeek(league, c.team).length <= DEFAULT_WAIVER_LIMIT);
  }
  processWaivers(league, byId);
  league.teams.forEach((t, i) => assert.ok(lineupStrength(t.slots, byId) >= before[i] - 1e-9, `${t.abbr} did not get worse`));
  assert.ok(rostersValid(league, byId).ok);
  // A successful AI pickup lands where he belongs on the depth chart.
  for (const tx of league.transactions) {
    const t = league.teams[tx.team];
    const slot = slotOf(t, tx.add);
    const pos = byId.get(tx.add).pos;
    const group = ROSTER_SLOTS.filter((s) => s.pos === pos).map((s) => overall(byId.get(t.slots[s.id])));
    for (let i = 1; i < group.length; i++) assert.ok(group[i - 1] >= group[i], `${t.abbr} ${pos} sorted`);
    assert.ok(slot);
  }
});

test('trades must match positions, stay small, and close at the deadline', () => {
  const league = fantasyLeague(5);
  const u = user(league);
  const ai = league.teams.findIndex((t) => !t.isUser);
  const me = league.teams[u], them = league.teams[ai];
  assert.ok(tradesOpen(league));
  assert.ok(!validateTrade(league, u, ai, [me.slots.QB1], [them.slots.RB1], byId).ok, 'QB for RB rejected');
  assert.ok(validateTrade(league, u, ai, [me.slots.QB1], [them.slots.QB1], byId).ok);
  assert.ok(validateTrade(league, u, ai, [me.slots.WR1, me.slots.OL1], [them.slots.OL2, them.slots.WR3], byId).ok, 'order within a side does not matter');
  assert.ok(!validateTrade(league, u, ai, [], [them.slots.QB1], byId).ok);
  assert.ok(!validateTrade(league, u, ai, [me.slots.OL1, me.slots.OL2, me.slots.OL3, me.slots.OL4], [them.slots.OL1, them.slots.OL2, them.slots.OL3, them.slots.OL4], byId).ok, 'four a side is too many');
  assert.ok(!validateTrade(league, u, ai, [them.slots.QB1], [me.slots.QB1], byId).ok, 'cannot give what you do not own');
  league.week = tradeDeadlineWeek(league) + 1;
  assert.ok(!tradesOpen(league));
  assert.match(validateTrade(league, u, ai, [me.slots.QB1], [them.slots.QB1], byId).reason, /deadline/);
});

test('the AI accepts a clear upgrade and refuses a fleece', () => {
  const league = fantasyLeague(6);
  const u = user(league);
  const ai = league.teams.findIndex((t) => !t.isUser);
  const me = league.teams[u], them = league.teams[ai];
  const myQb = byId.get(me.slots.QB1), theirQb = byId.get(them.slots.QB1);
  const better = overall(myQb) >= overall(theirQb) ? [u, ai] : [ai, u];
  // Offer the AI the better quarterback for the worse one: it should take it.
  const giver = better[0] === u ? me : them;
  const taker = better[0] === u ? them : me;
  if (giver === me && overall(myQb) - overall(theirQb) >= 3) {
    const r = proposeTrade(league, u, ai, [me.slots.QB1], [them.slots.QB1], byId);
    assert.ok(r.ok && r.accepted, `should accept an upgrade: ${r.reason}`);
    assert.equal(ownerMap(league).get(myQb.id), ai);
    assert.equal(ownerMap(league).get(theirQb.id), u);
    assert.equal(league.transactions.at(-1).type, 'trade');
  }
  void taker;
  // Now try to fleece them: their best receiver for our worst.
  const wrs = ['WR1', 'WR2', 'WR3', 'WR4'];
  const theirBest = wrs.map((k) => them.slots[k]).sort((a, b) => overall(byId.get(b)) - overall(byId.get(a)))[0];
  const myWorst = wrs.map((k) => me.slots[k]).sort((a, b) => overall(byId.get(a)) - overall(byId.get(b)))[0];
  if (overall(byId.get(theirBest)) > overall(byId.get(myWorst)) + 5) {
    const r = proposeTrade(league, u, ai, [myWorst], [theirBest], byId);
    assert.ok(r.ok && !r.accepted, 'a fleece is refused');
    assert.ok(r.delta < 0 || /Not enough/.test(r.reason));
    assert.equal(ownerMap(league).get(theirBest), ai, 'nothing moved');
  }
  assert.ok(rostersValid(league, byId).ok);
});

test('a two-for-two trade lands every player in a slot of his own position', () => {
  const league = fantasyLeague(7);
  const u = user(league);
  const ai = league.teams.findIndex((t) => !t.isUser);
  const me = league.teams[u], them = league.teams[ai];
  const give = [me.slots.WR1, me.slots.OL1], get = [them.slots.OL5, them.slots.WR4];
  executeTrade(league, u, ai, give, get, byId);
  assert.equal(ownerMap(league).get(give[0]), ai);
  assert.equal(ownerMap(league).get(get[0]), u);
  assert.equal(byId.get(me.slots[slotOf(me, get[0])]).pos, 'OL');
  assert.equal(byId.get(me.slots[slotOf(me, get[1])]).pos, 'WR');
  assert.ok(rostersValid(league, byId).ok);
});

test('a full season with the wire running never corrupts a roster', () => {
  const league = fantasyLeague(8, 10);
  const u = user(league);
  const rng = new RNG(8);
  let moves = 0, guard = 0;
  while (league.phase !== 'complete' && guard++ < 60) {
    simulateWeekAi(league, byId, { includeUser: true });
    if (league.phase === 'season') {
      // The human also plays the wire now and then.
      const fa = bestFreeAt(league, 'DL');
      const me = league.teams[u];
      if (fa && overall(fa) > overall(byId.get(me.slots.DL4)) + 1) { try { fileClaim(league, u, fa.id, me.slots.DL4, byId); } catch {} }
    }
    const beforeTx = (league.transactions || []).length;
    advanceWeekWithMoves(league, byId, PLAYERS, rng, advanceWeek);
    moves += (league.transactions || []).length - beforeTx;
    const v = rostersValid(league, byId);
    assert.ok(v.ok, v.reason);
    // A club owns its filled slots plus anyone parked on injured reserve.
    const held = league.teams.reduce((n, t) => n + ROSTER_SLOTS.filter((sl) => t.slots[sl.id]).length + (t.ir || []).length, 0);
    assert.equal(ownerMap(league).size, held);
    assert.ok(held >= 10 * ROSTER_SLOTS.length - 10 * 2 && held <= 10 * ROSTER_SLOTS.length + 10 * 2, `${held} players owned`);
  }
  assert.equal(league.phase, 'complete');
  assert.ok(moves > 0, 'the wire moved players');
  const inPlayoffs = league.transactions.filter((t) => t.week > league.schedule.length);
  assert.equal(inPlayoffs.length, 0, 'rosters freeze for the playoffs');
});

test('pro leagues use reverse standings as the waiver order', () => {
  const league = createLeague({ name: 'P', mode: 'pro', franchise: 0, seed: 9, draftType: 'snake' });
  autoDraftAll(league, league.draft, PLAYERS, new RNG(9));
  startSeason(league, byId);
  simulateWeekAi(league, byId, { includeUser: true });
  advanceWeek(league);
  simulateWeekAi(league, byId, { includeUser: true });
  const worst = standings(league).at(-1).idx, best = standings(league)[0].idx;
  const target = bestFreeAt(league, 'CB');
  fileClaim(league, best, target.id, league.teams[best].slots.CB2, byId);
  fileClaim(league, worst, target.id, league.teams[worst].slots.CB2, byId);
  const results = processWaivers(league, byId);
  assert.ok(results.find((r) => r.team === worst).ok, 'worst record wins the claim');
  assert.ok(!results.find((r) => r.team === best).ok);
});
