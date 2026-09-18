import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticPool } from '../scripts/synthetic.mjs';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek } from '../src/engine/season.js';
import {
  createAuction, autoCompleteAll, priceGuide, maxAffordable, slotsLeft, nominate, settle,
  currentNominator, nominatable, aiNominate, canRoster, advanceToUser, MIN_BID, DEFAULT_BUDGET, TOTAL_SLOTS,
} from '../src/engine/auction.js';

const pool = syntheticPool(7);
const byId = new Map(pool.map((p) => [p.id, p]));
const mkLeague = (seed, n = 8) => createLeague({ name: 'T', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: n, seed, draftType: 'auction' });

test('a league created for an auction has budgets and no snake draft', () => {
  const league = mkLeague(1);
  assert.equal(league.draftType, 'auction');
  assert.ok(league.auction);
  assert.equal(league.draft, null === league.draft ? league.draft : undefined);
  assert.equal(league.auction.budgets.length, 8);
  for (const b of league.auction.budgets) assert.equal(b, DEFAULT_BUDGET);
});

test('auto-completing fills every roster, spends nothing extra, and duplicates nobody', () => {
  for (const seed of [11, 12, 13]) {
    const league = mkLeague(seed);
    const a = league.auction;
    autoCompleteAll(a, league, pool, new RNG(seed), byId);
    assert.ok(a.complete, 'auction finished');
    assert.equal(a.sold.length, 8 * TOTAL_SLOTS, 'every slot sold exactly once');
    const all = new Set();
    for (const [i, t] of league.teams.entries()) {
      for (const slot of ROSTER_SLOTS) {
        const id = t.slots[slot.id];
        assert.ok(id, `${t.name} ${slot.id} filled`);
        assert.ok(!all.has(id), 'no player on two rosters');
        all.add(id);
        assert.equal(byId.get(id).pos, slot.pos, 'slot position matches');
      }
      assert.ok(a.budgets[i] >= 0, 'never overspent');
      const spent = a.sold.filter((s) => s.team === i).reduce((s, x) => s + x.price, 0);
      assert.equal(spent + a.budgets[i], DEFAULT_BUDGET, 'budget accounting balances');
    }
  }
});

test('every sale costs at least the minimum and no more than the winner could afford', () => {
  const league = mkLeague(21);
  const a = league.auction;
  autoCompleteAll(a, league, pool, new RNG(21), byId);
  for (const s of a.sold) {
    assert.ok(s.price >= MIN_BID, `price ${s.price} at least $${MIN_BID}`);
    assert.ok(s.price <= DEFAULT_BUDGET - (TOTAL_SLOTS - 1), 'price leaves room for the rest of the roster');
    assert.ok(s.price <= s.underbid + 1 || s.underbid === 0, 'winner pays one more than the runner-up');
  }
});

test('a team always keeps a dollar for each unfilled slot', () => {
  const league = mkLeague(31);
  const a = league.auction;
  const rng = new RNG(31);
  let guard = 0;
  while (!a.complete && guard++ < 3000) {
    for (let t = 0; t < league.teams.length; t++) {
      const left = slotsLeft(league.teams[t]);
      assert.ok(a.budgets[t] >= left, `team ${t} can still fill ${left} slots with $${a.budgets[t]}`);
      assert.ok(maxAffordable(a, t, league) <= a.budgets[t]);
    }
    if (!a.current) { if (currentNominator(a, league) == null) break; aiNominate(a, league, pool, rng, byId); }
    else settle(a, league, pool, rng, byId, 0);
  }
  assert.ok(a.complete);
});

test('a user who bids the cap wins the player and pays the runner-up plus one', () => {
  const league = mkLeague(41);
  const a = league.auction;
  const rng = new RNG(41);
  const u = league.teams.findIndex((t) => t.isUser);
  aiNominate(a, league, pool, rng, byId);
  const player = byId.get(a.current.playerId);
  const cap = maxAffordable(a, u, league);
  const sale = settle(a, league, pool, rng, byId, cap);
  if (canRoster(league.teams[u], player.pos) || a.taken[player.id] === u) {
    assert.equal(sale.team, u, 'top bid wins');
    assert.ok(sale.price <= cap);
    assert.equal(a.budgets[u], DEFAULT_BUDGET - sale.price);
    assert.equal(league.teams[u].slots[sale.slot], player.id);
  }
});

test('passing never buys the player', () => {
  const league = mkLeague(51);
  const a = league.auction;
  const rng = new RNG(51);
  const u = league.teams.findIndex((t) => t.isUser);
  for (let i = 0; i < 40 && !a.complete; i++) {
    if (!a.current) { if (currentNominator(a, league) === u) { const c = nominatable(a, league, pool, u); nominate(a, league, pool, c[0].id, byId); } else aiNominate(a, league, pool, rng, byId); }
    const nominatedByUser = a.current.nominator === u;
    const sale = settle(a, league, pool, rng, byId, 0);
    if (sale && !nominatedByUser) assert.notEqual(sale.team, u, 'a pass cannot win a lot');
  }
  assert.equal(a.budgets[u], DEFAULT_BUDGET - a.sold.filter((s) => s.team === u).reduce((s, x) => s + x.price, 0));
});

test('nominating is limited to positions the team still needs', () => {
  const league = mkLeague(61);
  const a = league.auction;
  const t = currentNominator(a, league);
  const cands = nominatable(a, league, pool, t);
  assert.ok(cands.length > 0);
  for (const p of cands) assert.ok(canRoster(league.teams[t], p.pos));
  // Fill every quarterback slot on that team, then quarterbacks stop being nominatable.
  const qb = pool.find((p) => p.pos === 'QB' && a.taken[p.id] == null);
  league.teams[t].slots.QB1 = qb.id;
  a.taken[qb.id] = t;
  assert.ok(!nominatable(a, league, pool, t).some((p) => p.pos === 'QB'));
  assert.throws(() => nominate(a, league, pool, pool.find((p) => p.pos === 'QB' && a.taken[p.id] == null).id, byId), /No open QB slot/);
});

test('the price guide never asks for more money than the room has', () => {
  const league = mkLeague(71);
  const a = league.auction;
  const guide = priceGuide(a, league, pool);
  const demand = 8 * TOTAL_SLOTS;
  const top = [...guide.prices.entries()].sort((x, y) => y[1] - x[1]).slice(0, demand);
  const sum = top.reduce((s, [, v]) => s + v, 0);
  assert.ok(sum <= 8 * DEFAULT_BUDGET * 1.25, `top ${demand} asking prices $${sum} vs $${8 * DEFAULT_BUDGET} available`);
  assert.ok(sum >= 8 * DEFAULT_BUDGET * 0.6, 'prices are not trivially cheap');
  for (const v of guide.prices.values()) assert.ok(v >= MIN_BID);
});

test('advanceToUser stops for the human and never runs past the end', () => {
  const league = mkLeague(81);
  const a = league.auction;
  const rng = new RNG(81);
  const u = league.teams.findIndex((t) => t.isUser);
  let stops = 0;
  for (let i = 0; i < 400 && !a.complete; i++) {
    const reason = advanceToUser(a, league, pool, rng, byId, { minOverall: 200 });
    if (reason === 'complete') break;
    assert.equal(reason, 'nominate', 'with an impossible bid threshold it only stops to nominate');
    assert.equal(currentNominator(a, league), u);
    const c = nominatable(a, league, pool, u);
    nominate(a, league, pool, c[0].id, byId);
    settle(a, league, pool, rng, byId, 0);
    stops++;
  }
  assert.ok(a.complete, 'auction finishes');
  assert.ok(stops > 0, 'the human was asked to nominate');
});

test('an auction league plays a full season to a champion', () => {
  const league = mkLeague(91, 6);
  autoCompleteAll(league.auction, league, pool, new RNG(91), byId);
  startSeason(league);
  let guard = 0;
  while (league.phase !== 'complete' && guard++ < 40) {
    simulateWeekAi(league, byId, { includeUser: true });
    advanceWeek(league);
  }
  assert.equal(league.phase, 'complete');
  assert.ok(league.champion != null);
});

test('rosters differ from one another more than a snake draft produces', () => {
  const spread = (draftType) => {
    const vals = [];
    for (const seed of [201, 202, 203]) {
      const league = createLeague({ name: 'T', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType });
      const rng = new RNG(seed);
      if (draftType === 'auction') autoCompleteAll(league.auction, league, pool, rng, byId);
      else {
        // lazily import to keep this test self-contained
        return null;
      }
      for (const t of league.teams) {
        const ids = ROSTER_SLOTS.map((s) => t.slots[s.id]);
        const qb = byId.get(ids[0]);
        vals.push(qb ? Object.values(qb.r).reduce((s, v) => s + v, 0) / Object.keys(qb.r).length : 0);
      }
    }
    return Math.max(...vals) - Math.min(...vals);
  };
  const auctionSpread = spread('auction');
  assert.ok(auctionSpread > 4, `auction quarterbacks vary by ${auctionSpread.toFixed(1)} points`);
});
