import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { irList } from '../src/engine/injuries.js';
import { createLeague, startSeason } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { overall } from '../src/engine/ratings.js';
import {
  slotOf, freeAgents, rostersValid, lineupStrength, positionDelta, backfillPlan, slotsAfterTrade,
  validateTrade, evaluateTrade, executeTrade, proposeTrade, MAX_TRADE_IMBALANCE,
} from '../src/engine/transactions.js';
import { makeAiOffers, acceptOffer, aiTrades, advanceWeekWithMoves } from '../src/engine/transactions.js';
import { simulateWeekAi, advanceWeek } from '../src/engine/season.js';
import { tradeBlock, openBlock, teamNeeds, findPlayers, bestAvailable, partingCost } from '../src/engine/tradeblock.js';

function league(seed, n = 8) {
  const lg = createLeague({ name: 'T', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: n, seed, draftType: 'auction' });
  autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), byId);
  startSeason(lg, byId);
  return lg;
}
const user = (lg) => lg.teams.findIndex((t) => t.isUser);
const at = (team, pos) => ROSTER_SLOTS.filter((s) => s.pos === pos).map((s) => team.slots[s.id]).filter(Boolean);

test('an uneven deal knows which positions it leaves short and which it crowds', () => {
  const lg = league(3);
  const a = lg.teams[0], b = lg.teams[1];
  const qb = at(a, 'QB')[0], wr = at(b, 'WR')[0];
  const d = positionDelta([qb], [wr], byId);
  assert.deepEqual(d.short, { QB: 1 });
  assert.deepEqual(d.long, { WR: 1 });
  // A matched swap has neither.
  const wr2 = at(a, 'WR')[0];
  const even = positionDelta([wr2], [wr], byId);
  assert.deepEqual(even.short, {});
  assert.deepEqual(even.long, {});
});

test('the backfill signs the best free agent at the hole and releases the weakest in the crowd', () => {
  const lg = league(4);
  const u = user(lg), me = lg.teams[u], them = lg.teams[u === 0 ? 1 : 0];
  const qb = at(me, 'QB')[0], wr = at(them, 'WR')[0];
  const plan = backfillPlan(lg, u, [qb], [wr], PLAYERS, byId);
  assert.ok(plan.ok, plan.reason);
  assert.equal(plan.signs.length, 1);
  assert.equal(plan.releases.length, 1);
  const signed = byId.get(plan.signs[0]);
  assert.equal(signed.pos, 'QB');
  const bestFaQb = freeAgents(lg, PLAYERS).filter((p) => p.pos === 'QB').sort((x, y) => overall(y) - overall(x))[0];
  assert.equal(signed.id, bestFaQb.id, 'the best quarterback available, not just any');
  // The released man is the weakest receiver once the incoming one is counted.
  const room = at(me, 'WR').concat(wr);
  const weakest = room.slice().sort((x, y) => overall(byId.get(x)) - overall(byId.get(y)))[0];
  assert.equal(plan.releases[0], weakest);
});

test('an uneven trade needs a free-agent pool, and stays refused without one', () => {
  // Searched rather than assumed. These leagues are built by auction and the
  // auction prices off the leverage table, so a fixed seed does not hold a
  // fixed roster: this used to grab the user's first quarterback and the next
  // club's first receiver, and the day the table changed that pair became a
  // quarterback who would have been cut on arrival — a legitimate refusal for
  // an entirely different reason than the one under test.
  const found = (() => {
    for (let seed = 5; seed < 25; seed++) {
      const lg = league(seed);
      const u = user(lg), other = u === 0 ? 1 : 0;
      for (const qb of at(lg.teams[u], 'QB')) {
        for (const wr of at(lg.teams[other], 'WR')) {
          if (validateTrade(lg, u, other, [qb], [wr], byId, PLAYERS).ok) return { lg, u, other, qb, wr };
        }
      }
    }
    return null;
  })();
  assert.ok(found, 'no quarterback-for-receiver deal in twenty leagues');
  const { lg, u, other, qb, wr } = found;
  const without = validateTrade(lg, u, other, [qb], [wr], byId);
  assert.equal(without.ok, false);
  assert.match(without.reason, /Positions must match/);
  const withPool = validateTrade(lg, u, other, [qb], [wr], byId, PLAYERS);
  assert.ok(withPool.ok, withPool.reason);
  assert.ok(withPool.uneven);
});

test('a deal may not restructure a roster: unmatched positions are capped', () => {
  const lg = league(6);
  const u = user(lg), other = u === 0 ? 1 : 0;
  const me = lg.teams[u], them = lg.teams[other];
  const gives = [at(me, 'QB')[0], at(me, 'RB')[0], at(me, 'TE')[0]];
  const gets = [at(them, 'WR')[0], at(them, 'DL')[0], at(them, 'LB')[0]];
  const v = validateTrade(lg, u, other, gives, gets, byId, PLAYERS);
  assert.equal(v.ok, false);
  assert.match(v.reason, new RegExp(`${MAX_TRADE_IMBALANCE} unmatched`));
});

/** A club holding a receiver who would improve the user's room, and that man. */
// Find a club that would take one of our spare `givePos` men and holds a
// `getPos` man we would take. Both halves matter: the engine refuses a deal
// that hands a club somebody who would not make its roster, so a test that
// names two players and hopes is a test that breaks the next time the pool
// moves — which it did.
function swapPair(lg, u, givePos, getPos) {
  const me = lg.teams[u];
  const ovr = (id) => overall(byId.get(id));
  const mine = at(me, givePos).slice().sort((x, y) => ovr(x) - ovr(y));
  const myFloor = Math.min(...at(me, getPos).map(ovr));
  for (let i = 0; i < lg.teams.length; i++) {
    if (i === u) continue;
    const them = lg.teams[i];
    const theirFloor = Math.min(...at(them, givePos).map(ovr));
    const want = at(them, getPos).slice().sort((x, y) => ovr(y) - ovr(x))[0];
    if (!want || ovr(want) <= myFloor) continue;
    const give = mine.find((id) => ovr(id) > theirFloor);
    if (give) return { team: i, give, get: want };
  }
  return null;
}

function upgradeAt(lg, u, pos) {
  const floor = Math.min(...at(lg.teams[u], pos).map((id) => overall(byId.get(id))));
  for (let i = 0; i < lg.teams.length; i++) {
    if (i === u) continue;
    const best = at(lg.teams[i], pos).slice().sort((x, y) => overall(byId.get(y)) - overall(byId.get(x)))[0];
    if (best && overall(byId.get(best)) > floor) return { team: i, id: best };
  }
  return null;
}

test('an executed uneven trade leaves both rosters legal and logs its paperwork', () => {
  const lg = league(7, 12);
  const u = user(lg), me = lg.teams[u];
  const up = swapPair(lg, u, 'QB', 'WR');
  assert.ok(up, 'somebody in a twelve-club league will swap a receiver for a quarterback');
  const other = up.team, wr = up.get, qb = up.give;
  const before = new Set(at(me, 'QB'));
  const tx = executeTrade(lg, u, other, [qb], [wr], byId, PLAYERS);
  const v = rostersValid(lg, byId);
  assert.ok(v.ok, v.reason);
  assert.ok(tx.signs && tx.releases, 'the log carries the signings and releases');
  assert.equal(tx.signs[0].length, 1);
  assert.equal(tx.releases[0].length, 1);
  // The quarterback room is full again, and it is not the man we traded.
  const after = at(lg.teams[u], 'QB');
  assert.equal(after.length, before.size);
  assert.ok(!after.includes(qb));
  assert.ok(at(lg.teams[u], 'WR').includes(wr), 'the receiver we traded for is on the roster');
  // Every slot still holds its own position.
  for (const s of ROSTER_SLOTS) {
    const p = byId.get(lg.teams[u].slots[s.id]);
    assert.ok(p, `${s.id} empty`);
    assert.equal(p.pos, s.pos);
  }
});

test('a deal that buys a player only to cut him is refused', () => {
  const lg = league(7, 12);
  const u = user(lg), me = lg.teams[u];
  const floor = Math.min(...at(me, 'WR').map((id) => overall(byId.get(id))));
  let found = null;
  for (let i = 0; i < lg.teams.length && !found; i++) {
    if (i === u) continue;
    const dud = at(lg.teams[i], 'WR').find((id) => overall(byId.get(id)) < floor);
    if (dud) found = { team: i, id: dud };
  }
  assert.ok(found, 'somebody carries a receiver who would not crack our room');
  const v = validateTrade(lg, u, found.team, [at(me, 'QB')[1]], [found.id], byId, PLAYERS);
  assert.equal(v.ok, false);
  assert.match(v.reason, /would not make/);
});

test('a club judges the roster it would field, hole filled, not the hole', () => {
  const lg = league(8);
  const u = user(lg), other = u === 0 ? 1 : 0;
  const me = lg.teams[u], them = lg.teams[other];
  const give = at(me, 'WR')[3] || at(me, 'WR')[2], getId = at(them, 'DL')[3];
  const withPool = evaluateTrade(lg, other, [getId], [give], byId, PLAYERS);
  const without = evaluateTrade(lg, other, [getId], [give], byId);
  assert.equal(without.accept, false, 'with no pool it cannot square the roster, so it declines');
  assert.match(without.reason, /could not field a roster/);
  assert.ok(Number.isFinite(withPool.delta), 'with a pool it produces a real number');
  assert.ok(withPool.after > 0);
});

test('a club will not trade down in position however thin its own room', () => {
  // Offer a kicker for their best receiver. Shipping a starting receiver's
  // leverage for a kicker's has to be refused whatever the kicker arithmetic
  // says — the exact ratio moves when the leverage table is re-measured, the
  // direction does not. Seed-searched for a pair that shapes a legal roster,
  // because `evaluateTrade` returns before it reaches the premium when the
  // club cannot field one, and a premium of `undefined` reads like the rule is
  // missing when it is only unreached.
  const found = (() => {
    for (let seed = 9; seed < 29; seed++) {
      const lg = league(seed);
      const u = user(lg), other = u === 0 ? 1 : 0;
      const k = at(lg.teams[u], 'K')[0];
      const wr = at(lg.teams[other], 'WR').slice().sort((x, y) => overall(byId.get(y)) - overall(byId.get(x)))[0];
      if (!k || !wr) continue;
      const ev = evaluateTrade(lg, other, [wr], [k], byId, PLAYERS);
      if (ev.premium != null) return { lg, u, other, k, wr, ev };
    }
    return null;
  })();
  assert.ok(found, 'no receiver-for-kicker deal in twenty leagues shaped a roster');
  const { lg, u, other, k, wr, ev } = found;
  assert.equal(ev.accept, false);
  assert.ok(ev.premium > 0, `a premium should be charged: ${ev.premium}`);
  const r = proposeTrade(lg, u, other, [k], [wr], byId, PLAYERS);
  assert.equal(r.accepted, false);
});

test('the block shops replaceable men and never a starting quarterback', () => {
  for (const seed of [11, 12, 13]) {
    const lg = league(seed, 12);
    const block = openBlock(lg, byId, PLAYERS);
    assert.ok(block.length > 0, 'somebody is always available');
    for (const b of block) {
      const team = lg.teams[b.team];
      assert.ok(!team.isUser, 'the user is not on their own block');
      const slot = ROSTER_SLOTS.find((s) => s.id === slotOf(team, b.id));
      assert.ok(slot, 'a blocked player is on the roster');
      if (slot.starter) assert.notEqual(b.pos, 'QB', `${lg.teams[b.team].abbr} shopped a starting QB`);
    }
    // Sorted by what it costs the owner to part, cheapest first.
    for (let i = 1; i < block.length; i++) assert.ok(block[i].cost >= block[i - 1].cost);
  }
});

test('the block and the needs are pure: the same league answers the same way twice', () => {
  const lg = league(14, 12);
  const a = JSON.stringify(tradeBlock(lg, byId, PLAYERS));
  const b = JSON.stringify(tradeBlock(lg, byId, PLAYERS));
  assert.equal(a, b);
  assert.equal(JSON.stringify(teamNeeds(lg, byId)), JSON.stringify(teamNeeds(lg, byId)));
});

test('needs name the positions a club is actually behind the league at', () => {
  const lg = league(15, 12);
  const needs = teamNeeds(lg, byId);
  assert.equal(needs.length, lg.teams.length);
  for (const list of needs) {
    assert.ok(list.length <= 3);
    for (const n of list) assert.ok(n.short > 0, 'a need is a shortfall, not a ranking');
    for (let i = 1; i < list.length; i++) assert.ok(list[i].short <= list[i - 1].short);
  }
});

test('search reaches every club at once, by name and by position', () => {
  const lg = league(16, 12);
  const u = user(lg);
  const all = findPlayers(lg, byId, { exclude: u, limit: 2000 });
  assert.equal(all.total, (lg.teams.length - 1) * ROSTER_SLOTS.length);
  const cbs = findPlayers(lg, byId, { pos: 'CB', exclude: u, limit: 2000 });
  assert.ok(cbs.total > 0);
  for (const x of cbs.players) assert.equal(x.pos, 'CB');
  // Sorted best first, so the answer to "who is the best available CB" is row one.
  for (let i = 1; i < cbs.players.length; i++) assert.ok(cbs.players[i].ovr <= cbs.players[i - 1].ovr);
  const named = findPlayers(lg, byId, { q: byId.get(cbs.players[0].id).name, exclude: u });
  assert.ok(named.players.some((x) => x.id === cbs.players[0].id), 'a player is findable by his own name');
  const minned = findPlayers(lg, byId, { minOvr: 95, exclude: u, limit: 2000 });
  for (const x of minned.players) assert.ok(x.ovr >= 95);
});

test('parting cost tracks leverage: a kicker goes cheap, a quarterback does not', () => {
  const lg = league(17, 12);
  const best = bestAvailable(lg, PLAYERS);
  const t = lg.teams[1];
  const k = at(t, 'K')[0], qb = at(t, 'QB')[0];
  assert.ok(partingCost(t, k, byId, best, lg) < partingCost(t, qb, byId, best, lg),
    'giving up the starting quarterback has to cost more than giving up the kicker');
});

test('a user-facing uneven deal reports the lineup it would leave behind', () => {
  const lg = league(18, 12);
  const u = user(lg);
  const up = swapPair(lg, u, 'S', 'LB');
  assert.ok(up, 'somebody will swap a linebacker for a safety');
  const other = up.team, give = up.give, getId = up.get;
  const v = validateTrade(lg, u, other, [give], [getId], byId, PLAYERS);
  assert.ok(v.ok, v.reason);
  const outcome = slotsAfterTrade(lg, u, [give], [getId], PLAYERS, byId);
  assert.ok(outcome, 'the roster squares');
  assert.ok(Number.isFinite(lineupStrength(outcome.slots, byId, lg)));
  for (const s of ROSTER_SLOTS) assert.ok(outcome.slots[s.id], `${s.id} would be empty`);
});

test('two clubs are never sold the same free agent', () => {
  const lg = league(19, 12);
  // Find a pair where each side's man improves the other's room, so the guard
  // against buying-to-cut does not fire and we are testing the pool instead.
  let pair = null;
  for (let a = 0; a < lg.teams.length && !pair; a++) {
    for (let b = 0; b < lg.teams.length && !pair; b++) {
      if (a === b || lg.teams[a].isUser || lg.teams[b].isUser) continue;
      const qbA = at(lg.teams[a], 'QB')[1], wrB = at(lg.teams[b], 'WR')[0];
      if (!qbA || !wrB) continue;
      const v = validateTrade(lg, a, b, [qbA], [wrB], byId, PLAYERS);
      if (v.ok && v.uneven) pair = { v };
    }
  }
  assert.ok(pair, 'a twelve-club league has at least one workable uneven pairing');
  // One side is short a quarterback, the other short a receiver, so both sign.
  const overlap = pair.v.fills.a.signs.filter((id) => pair.v.fills.b.signs.includes(id));
  assert.equal(overlap.length, 0);
});

test('clubs ring the human with uneven deals, and say what taking one would cost', () => {
  let seen = null;
  for (let seed = 51; seed <= 62 && !seen; seed++) {
    const lg = league(seed, 12);
    const made = makeAiOffers(lg, byId, null, { max: 8, pool: PLAYERS });
    seen = made.find((o) => o.uneven) || null;
    if (seen) {
      assert.ok(seen.fills, 'an uneven offer carries the paperwork it would cost the human');
      assert.ok(seen.fills.signs.length || seen.fills.releases.length);
      // Refusing to supply the pool is an error the caller can read.
      assert.throws(() => acceptOffer(lg, seen.id, byId), /uneven/);
      const tx = acceptOffer(lg, seen.id, byId, PLAYERS);
      assert.ok(tx);
      const v = rostersValid(lg, byId);
      assert.ok(v.ok, v.reason);
    }
  }
  assert.ok(seen, 'somewhere in twelve leagues a club wants an uneven deal');
});

test('an offer made without a pool is still matched, and still works', () => {
  const lg = league(63, 12);
  const made = makeAiOffers(lg, byId, null, { max: 8 });
  for (const o of made) assert.ok(!o.uneven, 'no pool, no uneven offer');
  if (made.length) {
    acceptOffer(lg, made[0].id, byId);
    assert.ok(rostersValid(lg, byId).ok);
  }
});

test('clubs deal unevenly among themselves without breaking a roster', () => {
  let uneven = 0, deals = 0;
  for (let seed = 71; seed <= 78; seed++) {
    const lg = league(seed, 12);
    const rng = new RNG(seed * 3);
    for (let i = 0; i < 12; i++) {
      for (const tx of aiTrades(lg, byId, rng, { pairs: 6, pool: PLAYERS })) {
        deals++;
        if (tx.signs) uneven++;
      }
      const v = rostersValid(lg, byId);
      assert.ok(v.ok, v.reason);
    }
  }
  assert.ok(deals > 0, 'clubs trade with each other');
  assert.ok(uneven > 0, `some of those deals are uneven: ${uneven} of ${deals}`);
});

test('a full season of uneven dealing leaves every roster legal and nobody twice-owned', () => {
  const lg = league(81, 12);
  const rng = new RNG(4);
  while (lg.phase === 'season') {
    simulateWeekAi(lg, byId, { includeUser: true });
    advanceWeekWithMoves(lg, byId, PLAYERS, rng, advanceWeek);
    const v = rostersValid(lg, byId);
    assert.ok(v.ok, v.reason);
  }
  const ids = new Set();
  for (const t of lg.teams) {
    // A slot may sit empty only while its man is on injured reserve, which is
    // the rule `rostersValid` has always enforced; a trade must not add to it.
    const empty = ROSTER_SLOTS.filter((sl) => !t.slots[sl.id]).length;
    assert.ok(empty <= irList(t).length, `${t.abbr} has ${empty} empty slots and ${irList(t).length} on injured reserve`);
    for (const sl of ROSTER_SLOTS) {
      const id = t.slots[sl.id];
      if (!id) continue;
      assert.equal(byId.get(id).pos, sl.pos, `${t.abbr} ${sl.id} holds a ${byId.get(id).pos}`);
      assert.ok(!ids.has(id), 'nobody on two rosters');
      ids.add(id);
    }
  }
});
