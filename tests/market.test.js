import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek } from '../src/engine/season.js';
import { autoCompleteAll, priceGuide, availablePlayers, maxAffordable, openSlotsByPos, slotsLeft, canRoster } from '../src/engine/auction.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { overall } from '../src/engine/ratings.js';
import { freeAgents, aiFileClaims, advanceWeekWithMoves, waiverLimit } from '../src/engine/transactions.js';
import { enterOffseason, keeperCost, keeperLimit } from '../src/engine/offseason.js';
import { faBoard, joinValue, wouldReplace, keeperBoard, keeperAdvice, AI_CLAIM_GAIN, positionScarcity, lotAdvice, lotNote } from '../src/engine/market.js';

function league(seed, n = 12, draftType = 'auction') {
  const lg = createLeague({ name: 'M', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: n, seed, draftType, injuries: 'normal' });
  if (draftType === 'auction') autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), byId);
  else autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, byId);
  return lg;
}
const user = (lg) => lg.teams.findIndex((t) => t.isUser);
const playWeeks = (lg, n, seed = 4) => {
  const rng = new RNG(seed);
  for (let i = 0; i < n && lg.phase === 'season'; i++) {
    simulateWeekAi(lg, byId, { includeUser: true });
    advanceWeekWithMoves(lg, byId, PLAYERS, rng, advanceWeek);
  }
};

test('a free agent is ranked by what he adds, not by his rating', () => {
  const lg = league(3);
  const u = user(lg);
  const board = faBoard(lg, PLAYERS, byId, u, { limit: 400 });
  assert.ok(board.total > 0);
  assert.equal(board.claims, waiverLimit(lg));
  // Sorted by gain, rating only breaking ties.
  for (let i = 1; i < board.players.length; i++) {
    assert.ok(board.players[i].gain <= board.players[i - 1].gain, 'gain descends');
  }
  // The highest-rated man in the pool is usually not the most useful one: a
  // kicker outranks everybody on rating and is worth almost nothing.
  const fa = freeAgents(lg, PLAYERS).slice().sort((a, b) => overall(b) - overall(a));
  const topRated = board.players.find((r) => r.id === fa[0].id);
  assert.ok(topRated, 'the best-rated free agent is on the board somewhere');
  const bestByGain = board.players[0];
  if (topRated.id !== bestByGain.id) {
    assert.ok(bestByGain.gain >= topRated.gain, 'and he is not automatically the top of it');
  }
});

test('the gain is measured against the man he would actually replace', () => {
  const lg = league(5);
  const u = user(lg), me = lg.teams[u];
  const board = faBoard(lg, PLAYERS, byId, u, { limit: 400 });
  const row = board.players.find((r) => r.gain > 0) || board.players[0];
  const p = byId.get(row.id);
  const room = ROSTER_SLOTS.filter((s) => s.pos === p.pos).map((s) => me.slots[s.id]).filter(Boolean);
  assert.ok(room.includes(row.drop), 'the man he replaces is in that room');
  const weakest = room.slice().sort((a, b) => overall(byId.get(a)) - overall(byId.get(b)))[0];
  // Availability weights a hurt man down, so the weakest by raw rating is only
  // the answer when nobody in that room is injured.
  if (!Object.keys(lg.injuries || {}).some((id) => room.includes(id))) {
    assert.equal(row.drop, weakest);
  }
  // Filling an empty room is pure gain, and replacing nobody replaces nobody.
  const rooms = { WR: [] };
  assert.ok(joinValue(rooms, { pos: 'WR', r: p.r }) >= 0);
  assert.equal(wouldReplace(rooms, { pos: 'WR' }), null);
});

test('the filters are the ones the screen offers, and they narrow the same list', () => {
  const lg = league(7);
  const u = user(lg);
  const all = faBoard(lg, PLAYERS, byId, u, { limit: 2000 });
  const cbs = faBoard(lg, PLAYERS, byId, u, { pos: 'CB', limit: 2000 });
  assert.ok(cbs.total > 0 && cbs.total < all.total);
  for (const r of cbs.players) assert.equal(r.pos, 'CB');
  const named = faBoard(lg, PLAYERS, byId, u, { q: byId.get(cbs.players[0].id).name, limit: 50 });
  assert.ok(named.players.some((r) => r.id === cbs.players[0].id), 'a man is findable by name');
  const era = faBoard(lg, PLAYERS, byId, u, { era: '1990s', limit: 2000 });
  for (const r of era.players) assert.equal(`${Math.floor(byId.get(r.id).season / 10) * 10}s`, '1990s');
});

test('the rival count is about the clubs that really do file for the same man', () => {
  // Not a claim that it is exact — it leaves out the activity roll that decides
  // whether a GM looks at the wire at all. It has to beat chance by a lot.
  let filed = 0, matched = 0, flagged = 0, weeks = 0;
  for (const seed of [11, 12, 13]) {
    const lg = league(seed);
    const u = user(lg);
    const rng = new RNG(seed);
    for (let w = 0; w < 6 && lg.phase === 'season'; w++) {
      simulateWeekAi(lg, byId, { includeUser: true });
      const board = faBoard(lg, PLAYERS, byId, u, { limit: 3000, rivalsFor: 3000 });
      const contested = new Set(board.players.filter((r) => r.rivals > 0).map((r) => r.id));
      flagged += contested.size;
      const before = (lg.claims || []).length;
      aiFileClaims(lg, PLAYERS, byId, null);
      const theirs = (lg.claims || []).slice(before).filter((c) => c.team !== u);
      filed += theirs.length;
      for (const c of theirs) if (contested.has(c.add)) matched++;
      weeks++;
      advanceWeekWithMoves(lg, byId, PLAYERS, rng, advanceWeek);
    }
  }
  assert.ok(weeks > 0 && filed > 0, `clubs should work the wire: ${filed} claims over ${weeks} weeks`);
  assert.ok(flagged > 0, 'and somebody should be flagged as contested');
  assert.ok(matched / filed > 0.4, `most filed claims should have been flagged: ${matched} of ${filed}`);
});

test('a keeper board prices the decision, not just the cost', () => {
  const lg = league(17);
  playWeeks(lg, 40);
  while (lg.phase === 'playoffs') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  enterOffseason(lg, PLAYERS, byId);
  const u = user(lg);
  const board = keeperBoard(lg, PLAYERS, byId, u);
  assert.equal(board.auction, true);
  assert.equal(board.limit, keeperLimit(lg));
  assert.equal(board.rows.length, ROSTER_SLOTS.filter((s) => lg.teams[u].slots[s.id]).length);
  for (const r of board.rows) {
    assert.equal(r.cost, keeperCost(lg.contracts[r.id] || {}));
    assert.ok(r.market >= 1, 'every man has a market price');
    assert.equal(r.surplus, r.market - r.cost, 'surplus is exactly market minus keeper price');
    assert.ok(r.worth > 0);
  }
  // Best value first.
  for (let i = 1; i < board.rows.length; i++) {
    assert.ok(board.rows[i].surplus <= board.rows[i - 1].surplus, 'sorted by saving');
  }
  // The board disagrees with rating order, which is the whole point of it.
  const byRating = board.rows.slice().sort((a, b) => b.ovr - a.ovr);
  assert.notDeepEqual(board.rows.map((r) => r.id), byRating.map((r) => r.id),
    'if it agreed with rating order it would be telling you nothing new');
});

test('a draft league has keepers but no prices, and says so', () => {
  const lg = league(19, 12, 'snake');
  playWeeks(lg, 40);
  while (lg.phase === 'playoffs') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  enterOffseason(lg, PLAYERS, byId);
  const board = keeperBoard(lg, PLAYERS, byId, user(lg));
  assert.equal(board.auction, false);
  for (const r of board.rows) {
    assert.equal(r.market, null);
    assert.equal(r.surplus, null);
  }
  assert.match(keeperAdvice(board.rows[0]), /slot|pool/);
});

test('the advice names the trade-off rather than just ranking', () => {
  const base = { eligible: true, market: 20, cost: 10, surplus: 10 };
  assert.match(keeperAdvice(base), /bargain/i);
  assert.match(keeperAdvice({ ...base, surplus: 4 }), /Worth keeping/i);
  assert.match(keeperAdvice({ ...base, surplus: 0 }), /neither here nor there/i);
  assert.match(keeperAdvice({ ...base, surplus: -6 }), /Let him go/i);
  assert.match(keeperAdvice({ ...base, eligible: false }), /back to the pool/i);
});

test('an injured free agent is never counted as contested', () => {
  const lg = league(23);
  playWeeks(lg, 6);
  const u = user(lg);
  const board = faBoard(lg, PLAYERS, byId, u, { limit: 3000, rivalsFor: 3000 });
  for (const r of board.players) {
    if (r.hurt) assert.equal(r.rivals, 0, 'nobody claims a man who cannot play');
  }
  assert.ok(AI_CLAIM_GAIN > 0);
});

// ---------------------------------------------------------------------------
// The auction room
// ---------------------------------------------------------------------------
const auctionLeague = (seed, n = 12) => createLeague({ name: 'A', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: n, seed, draftType: 'auction' });

test('a player added to a room with space is added, not swapped in', () => {
  // The bug this catches scored a perfectly good backup quarterback at minus
  // fifty-four, by charging the roster for a man it was not losing.
  const rooms = { QB: [{ id: 'a', ovr: 95 }] };
  const backup = { pos: 'QB', r: {}, id: 'b' };
  // A second quarterback goes into the empty QB2 slot: pure gain.
  const added = joinValue(rooms, { ...backup });
  assert.ok(added > 0, `a backup into an open slot is worth something: ${added}`);
  assert.equal(wouldReplace(rooms, backup), null, 'and replaces nobody');
  // Once both slots are full he has to displace somebody.
  const full = { QB: [{ id: 'a', ovr: 95 }, { id: 'b', ovr: 90 }] };
  assert.equal(wouldReplace(full, backup), 'b', 'the weakest goes');
});

test('scarcity is measured against the rest of the board, not a fixed line', () => {
  const lg = auctionLeague(5);
  const a = lg.auction;
  const guide = priceGuide(a, lg, PLAYERS);
  const sc = positionScarcity(a, lg, PLAYERS, guide);
  const all = Object.values(sc);
  assert.ok(all.length >= 10);
  // Headcount alone would call every position deep: it is a pool of over a
  // thousand for a few hundred slots.
  for (const x of all) assert.ok(x.ratio > 2, `every position is deep by count: ${x.ratio}`);
  // So the flag has to be relative, and it has to split the board.
  const tight = all.filter((x) => x.tight).length;
  assert.ok(tight > 0 && tight < all.length, `tightness should divide the board, got ${tight} of ${all.length}`);
  for (const x of all) assert.ok(x.drop != null && x.drop >= 0);
  // With no guide there is no replacement level to measure against.
  const bare = positionScarcity(a, lg, PLAYERS);
  for (const x of Object.values(bare)) { assert.equal(x.drop, null); assert.equal(x.tight, false); }
});

test('the advice on a lot is about what you get instead', () => {
  const lg = auctionLeague(7);
  const a = lg.auction;
  const u = user(lg);
  const guide = priceGuide(a, lg, PLAYERS);
  const pool = availablePlayers(a, PLAYERS).sort((x, y) => guide.prices.get(y.id) - guide.prices.get(x.id));
  const p = pool[0];
  const adv = lotAdvice(a, lg, PLAYERS, byId, u, p, guide, { currentBid: 1 });
  assert.equal(adv.ask, guide.prices.get(p.id));
  assert.equal(adv.cap, maxAffordable(a, u, lg));
  assert.ok(adv.next, 'somebody else plays that position');
  assert.equal(adv.dropOff, overall(p) - adv.next.ovr);
  assert.ok(adv.dropOff >= 0, 'the next man is not better than the best man');
  // Rivals are clubs that can still roster the position and raise the bid.
  let expected = 0;
  lg.teams.forEach((t, i) => {
    if (i === u || t.isUser) return;
    if (canRoster(t, p.pos) && maxAffordable(a, i, lg) > 1) expected++;
  });
  assert.equal(adv.rivals, expected);
  assert.ok(adv.rivals <= lg.teams.length - 1);
  assert.equal(adv.mustFill, false, 'nothing is forced at the opening lot');
  assert.match(lotNote(adv, 'Somebody'), /Somebody|last one|fill this slot/);
});

test('a lot nobody else can bid on says so, and a forced slot overrides the advice', () => {
  const lg = auctionLeague(9, 8);
  const a = lg.auction;
  const u = user(lg);
  // Spend every other club down to nothing.
  lg.teams.forEach((t, i) => { if (i !== u) a.budgets[i] = 0; });
  const guide = priceGuide(a, lg, PLAYERS);
  const p = availablePlayers(a, PLAYERS)[0];
  assert.equal(lotAdvice(a, lg, PLAYERS, byId, u, p, guide, { currentBid: 1 }).rivals, 0);

  // A club with one slot left and only that position open has to fill it.
  const me = lg.teams[u];
  for (const s of ROSTER_SLOTS) if (s.pos !== p.pos) me.slots[s.id] = me.slots[s.id] || 'x';
  const openHere = openSlotsByPos(me)[p.pos] || 0;
  assert.ok(openHere > 0 && openHere >= slotsLeft(me));
  const forced = lotAdvice(a, lg, PLAYERS, byId, u, p, guide, { currentBid: 1 });
  assert.equal(forced.mustFill, true);
  assert.match(lotNote(forced, 'Someone'), /have to fill/);
});

test('advice keeps up as the room empties, and stays quick', () => {
  const lg = auctionLeague(11);
  const a = lg.auction;
  const u = user(lg);
  autoCompleteAll(a, lg, PLAYERS, new RNG(11), byId, { maxSteps: 200 });
  const guide = priceGuide(a, lg, PLAYERS);
  const rest = availablePlayers(a, PLAYERS);
  assert.ok(rest.length > 0);
  const t0 = performance.now();
  let n = 0;
  for (const p of rest.slice(0, 20)) {
    const adv = lotAdvice(a, lg, PLAYERS, byId, u, p, guide, { currentBid: 2 });
    assert.ok(Number.isFinite(adv.gain));
    assert.ok(adv.cap >= 0);
    n++;
  }
  const per = (performance.now() - t0) / n;
  assert.ok(per < 40, `advice should be cheap enough to render live: ${per.toFixed(1)} ms each`);
});
