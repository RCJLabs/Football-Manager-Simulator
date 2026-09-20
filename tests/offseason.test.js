import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek, standings, userTeamIndex, newSeasonSameRosters, syncContracts } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { autoDraftAll, currentPicker, settlePointer, createDraft, snakes, seatAt } from '../src/engine/draft.js';
import { pickOwner } from '../src/engine/draftpicks.js';
import { snakeOverall, nextDraftSnakes } from '../src/engine/owedpicks.js';
import { overall } from '../src/engine/ratings.js';
import { keeperCost, keeperEligible, validateKeepers, enterOffseason, aiKeepers, confirmKeepers, closeFreeAgency, keeperLimit, MAX_KEEPS, seasonSummary } from '../src/engine/offseason.js';
import { fileClaim, processWaivers, freeAgents, rostersValid, ownerMap } from '../src/engine/transactions.js';

function playSeason(league) {
  while (league.phase === 'season' || league.phase === 'playoffs') {
    simulateWeekAi(league, byId, { includeUser: true });
    advanceWeek(league);
  }
  assert.equal(league.phase, 'complete');
}
function auctionLeague(seed, opts = {}) {
  const league = createLeague({ name: 'D', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction', injuries: 'off', ...opts });
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(seed), byId);
  startSeason(league, byId);
  return league;
}
function draftLeague(seed, opts = {}) {
  const league = createLeague({ name: 'D', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'snake', injuries: 'off', ...opts });
  autoDraftAll(league, league.draft, PLAYERS, new RNG(seed));
  startSeason(league, byId);
  return league;
}
const rosterIds = (t) => ROSTER_SLOTS.map((s) => t.slots[s.id]).filter(Boolean);

test('keeper cost is last price plus the larger of $3 or 15%, and three keeps is the limit', () => {
  assert.equal(keeperCost({ salary: 1 }), 4);
  assert.equal(keeperCost({ salary: 20 }), 23);
  assert.equal(keeperCost({ salary: 40 }), 46);
  assert.equal(keeperCost({ salary: 60 }), 69);
  assert.ok(keeperEligible({ salary: 10, kept: 0 }));
  assert.ok(keeperEligible({ salary: 10, kept: MAX_KEEPS - 1 }));
  assert.ok(!keeperEligible({ salary: 10, kept: MAX_KEEPS }));
});

test('season start gives every rostered player a contract at his auction price, and a waiver pickup a $1 deal', () => {
  const league = auctionLeague(21);
  const u = userTeamIndex(league);
  const me = league.teams[u];
  for (const id of rosterIds(me)) {
    const sale = league.auction.sold.find((s) => s.playerId === id);
    assert.equal(league.contracts[id].salary, sale.price);
    assert.equal(league.contracts[id].kept, 0);
  }
  // Claim somebody off the wire and re-sync: he arrives on the minimum.
  const fa = freeAgents(league, PLAYERS).filter((p) => p.pos === 'WR').sort((a, b) => overall(b) - overall(a))[0];
  fileClaim(league, u, fa.id, me.slots.WR4, byId);
  processWaivers(league, byId);
  syncContracts(league);
  assert.equal(league.contracts[fa.id].salary, 1);
  assert.equal(Object.keys(league.contracts).length, 8 * ROSTER_SLOTS.length, 'released players lose their contracts');
});

test('the offseason opens after the final, AI clubs pick keepers under the cap, the human is validated', () => {
  const league = auctionLeague(22);
  playSeason(league);
  assert.ok(league.history.length === 1 && league.history[0].finish.length === 8 && league.history[0].user.rank >= 1);
  const off = enterOffseason(league, PLAYERS, byId);
  assert.equal(league.phase, 'offseason');
  const limit = keeperLimit(league);
  assert.equal(limit, 6);
  for (const [ti, ids] of Object.entries(off.keepers)) {
    const v = validateKeepers(league, Number(ti), ids);
    assert.ok(v.ok, `${ti}: ${v.reason}`);
    assert.ok(ids.length <= limit);
  }
  const anyKept = Object.values(off.keepers).some((ids) => ids.length > 0);
  assert.ok(anyKept, 'somebody found a bargain worth keeping');
  const u = userTeamIndex(league);
  const me = league.teams[u];
  const mine = rosterIds(me);
  assert.ok(!validateKeepers(league, u, mine.slice(0, limit + 1)).ok, 'too many');
  assert.ok(!validateKeepers(league, u, [mine[0], mine[0]]).ok, 'duplicate');
  assert.ok(!validateKeepers(league, u, ['nobody-1999']).ok, 'not on the roster');
  // Ineligible after three keeps.
  league.contracts[mine[0]].kept = MAX_KEEPS;
  assert.ok(!validateKeepers(league, u, [mine[0]]).ok);
  league.contracts[mine[0]].kept = 0;
  // The cap: keepers plus a dollar for every open slot.
  const dear = mine.slice().sort((a, b) => league.contracts[b].salary - league.contracts[a].salary).slice(0, limit);
  const v = validateKeepers(league, u, dear);
  const committed = dear.reduce((s, id) => s + keeperCost(league.contracts[id]), 0);
  assert.equal(v.ok, committed + (ROSTER_SLOTS.length - limit) <= 200);
  const summary = seasonSummary(league);
  assert.equal(summary.season, 1);
  assert.ok(summary.champion);
});

test('confirming keepers re-packs rosters, carries the cap over, and the market fills the rest', () => {
  const league = auctionLeague(23);
  playSeason(league);
  enterOffseason(league, PLAYERS, byId);
  const u = userTeamIndex(league);
  const me = league.teams[u];
  const keep = rosterIds(me).sort((a, b) => overall(byId.get(b)) - overall(byId.get(a))).slice(0, 3);
  const costs = keep.map((id) => keeperCost(league.contracts[id]));
  const before = { ...league.contracts };
  const worst = standings(league).map((r) => r.idx).reverse();
  confirmKeepers(league, keep, PLAYERS, byId);
  assert.equal(league.phase, 'draft');
  assert.equal(league.season, 2);
  assert.equal(rosterIds(me).length, 3);
  for (const id of keep) {
    assert.ok(rosterIds(me).includes(id));
    assert.equal(league.contracts[id].salary, keeperCost(before[id]));
    assert.equal(league.contracts[id].kept, 1);
    assert.equal(league.auction.taken[id], u, 'keepers are off the board');
  }
  assert.equal(league.auction.budgets[u], 200 - costs.reduce((s, c) => s + c, 0));
  assert.equal(league.auction.startBudgets[u], league.auction.budgets[u]);
  assert.deepEqual(league.auction.order, worst, 'order is by the table, reversed');
  assert.ok(league.teams.every((t) => t.record.w + t.record.l === 0), 'records reset');
  assert.deepEqual(league.injuries, {});
  // Play the market out and start the season.
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(5), byId);
  assert.ok(league.auction.complete);
  assert.ok(rostersValid(league, byId).ok, rostersValid(league, byId).reason);
  assert.equal(ownerMap(league).size, 8 * ROSTER_SLOTS.length);
  startSeason(league, byId);
  assert.equal(league.phase, 'season');
  assert.equal(league.offseason, null);
  assert.equal(Object.keys(league.contracts).length, 8 * ROSTER_SLOTS.length, 'everyone has a contract again');
  const bought = rosterIds(me).filter((id) => !keep.includes(id));
  for (const id of bought) assert.equal(league.contracts[id].kept, 0);
});

test('a draft league runs its offseason draft worst to first and skips clubs that are already full', () => {
  const league = draftLeague(24);
  playSeason(league);
  enterOffseason(league, PLAYERS, byId);
  const u = userTeamIndex(league);
  const me = league.teams[u];
  const limit = keeperLimit(league);
  const keep = rosterIds(me).slice(0, limit);
  const worst = standings(league).map((r) => r.idx).reverse();
  confirmKeepers(league, keep, PLAYERS, byId);
  assert.equal(league.phase, 'draft');
  assert.deepEqual(league.draft.order, worst);
  assert.equal(currentPicker(league.draft), worst[0]);
  for (const id of keep) assert.equal(league.draft.taken[id], u);
  autoDraftAll(league, league.draft, PLAYERS, new RNG(9));
  assert.ok(league.draft.complete);
  assert.ok(rostersValid(league, byId).ok, rostersValid(league, byId).reason);
  assert.ok(league.draft.picks.every((p) => !keep.includes(p.playerId)));
  startSeason(league, byId);
  assert.equal(league.phase, 'season');
  for (const id of keep) assert.equal(league.contracts[id].kept, 1);
});

test('the draft pointer steps over full rosters', () => {
  const league = createLeague({ name: 'D', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 4, seed: 25, draftType: 'snake' });
  // Fill team 0 completely before the draft starts.
  const full = league.teams[0];
  const pool = PLAYERS.slice();
  for (const s of ROSTER_SLOTS) { const p = pool.find((x) => x.pos === s.pos && !Object.values(full.slots).includes(x.id)); full.slots[s.id] = p.id; }
  const taken = Object.fromEntries(Object.values(full.slots).map((id) => [id, 0]));
  league.draft = createDraft(league, new RNG(1), { order: [0, 1, 2, 3], taken });
  assert.notEqual(currentPicker(league.draft), 0, 'the full club never has the pick');
  autoDraftAll(league, league.draft, PLAYERS, new RNG(2));
  assert.ok(league.draft.complete);
  assert.ok(league.draft.picks.every((p) => p.team !== 0));
  assert.ok(rostersValid(league, byId).ok);
  settlePointer(league, league.draft);
  assert.ok(league.draft.complete);
});

test('three straight offseasons run clean and the history keeps score', () => {
  const league = auctionLeague(26);
  for (let season = 1; season <= 3; season++) {
    playSeason(league);
    enterOffseason(league, PLAYERS, byId);
    const u = userTeamIndex(league);
    const keep = aiKeepers(league, u, PLAYERS, byId, null);
    confirmKeepers(league, keep, PLAYERS, byId);
    autoCompleteAll(league.auction, league, PLAYERS, new RNG(season), byId);
    startSeason(league, byId);
    assert.equal(league.season, season + 1);
    assert.ok(rostersValid(league, byId).ok);
  }
  assert.equal(league.history.length, 3);
  assert.ok(Object.values(league.contracts).every((c) => c.kept <= MAX_KEEPS));
});

test('running it back with the same rosters still works alongside the offseason', () => {
  const league = auctionLeague(27);
  playSeason(league);
  newSeasonSameRosters(league, byId);
  assert.equal(league.season, 2);
  assert.equal(league.phase, 'season');
  assert.equal(Object.keys(league.contracts).length, 8 * ROSTER_SLOTS.length);
});

test('a man with years left on his deal is kept without having to be a bargain', () => {
  // The defect this pins: the keeper round used to re-run every player through
  // a surplus test each offseason, so a contract meant nothing after the year
  // it was signed in. It fell hardest on the draft, which is priced above
  // market on purpose — a first-round rookie costs 15 to 20 against a guide
  // that says he is worth about 5, so his own club let him go every time.
  const pro = createLeague({ name: 'P', mode: 'pro', franchise: 1, seed: 31, draftType: 'snake', injuries: 'off' });
  autoDraftAll(pro, pro.draft, PLAYERS, new RNG(31));
  startSeason(pro, byId);
  playSeason(pro);
  enterOffseason(pro, PLAYERS, byId);

  const pool = PLAYERS;
  let bound = 0, boundKept = 0, dear = 0, dearKept = 0;
  for (let i = 0; i < pro.teams.length; i++) {
    const keep = new Set(aiKeepers(pro, i, pool, byId, new RNG(900 + i)));
    for (const id of rosterIds(pro.teams[i])) {
      const c = pro.contracts[id] || {};
      if (c.expiring || (c.years ?? 0) <= 0) continue;
      bound++;
      if (keep.has(id)) boundKept++;
      // The ones the old rule dropped: paid well above what a guide says they
      // are worth. They are exactly the club's own draft picks.
      if ((c.salary ?? 1) >= 8) { dear++; if (keep.has(id)) dearKept++; }
    }
  }
  assert.ok(bound > 100, `only ${bound} men are under contract`);
  assert.ok(boundKept / bound > 0.9, `${boundKept} of ${bound} men under contract were kept`);
  assert.ok(dear > 10, `only ${dear} expensive deals to test`);
  assert.ok(dearKept / dear > 0.85, `${dearKept} of ${dear} dear contracts were kept`);

  // And the list a club produces still satisfies the validator, which is what
  // the first attempt at this got wrong: it exempted contracts from the cap
  // test, and `confirmKeepers` then threw on the human's own list.
  for (let i = 0; i < pro.teams.length; i++) {
    const keep = aiKeepers(pro, i, pool, byId, new RNG(900 + i));
    const v = validateKeepers(pro, i, keep, byId);
    assert.ok(v.ok, `club ${i}: ${v.reason}`);
  }
});

test('a rookie draft runs straight worst-to-first; a fantasy draft still snakes', () => {
  // The snake exists to make a fantasy draft fair: twenty-seven rounds out of
  // one all-time pool, and picking last every round would be ruinous. A rookie
  // draft is five rounds over one class and the unfairness is the design — the
  // worst club is supposed to get the better of it, every round, as it does in
  // the real thing.
  const fan = draftLeague(26);
  assert.ok(snakes(fan.draft), 'a fantasy draft should turn round on itself');
  assert.equal(pickOwner(fan.draft, 1, 0), fan.draft.order[0]);
  assert.equal(pickOwner(fan.draft, 2, 0), fan.draft.order[fan.draft.order.length - 1], 'round two did not reverse');

  const pro = createLeague({ name: 'P', mode: 'pro', franchise: 1, seed: 26, draftType: 'snake', injuries: 'off' });
  autoDraftAll(pro, pro.draft, PLAYERS, new RNG(26));
  // The founding draft is the all-time pool over twenty-seven rounds, so it
  // stays a snake for the same reason the fantasy one does.
  assert.ok(snakes(pro.draft), 'the founding pro draft should still snake');
  startSeason(pro, byId);
  playSeason(pro);
  const table = standings(pro).map((r) => r.idx);
  enterOffseason(pro, PLAYERS, byId);
  const u = userTeamIndex(pro);
  confirmKeepers(pro, aiKeepers(pro, u, PLAYERS, byId, null), PLAYERS, byId);
  // A capped league shops before it drafts, so the rookie draft does not exist
  // until the market closes.
  assert.equal(pro.offseason.step, 'freeagency');
  closeFreeAgency(pro, PLAYERS, byId);
  const d = pro.draft;
  assert.equal(snakes(d), false, 'a rookie draft should run straight');
  assert.deepEqual(d.order, table.slice().reverse(), 'the order is not the table reversed');
  // Every round opens with the club that finished worst, and closes with the best.
  for (let r = 1; r <= d.rounds; r++) {
    assert.equal(pickOwner(d, r, 0), table[table.length - 1], `round ${r} did not open with the worst club`);
    assert.equal(pickOwner(d, r, d.order.length - 1), table[0], `round ${r} did not close with the best club`);
  }
  // The seat arithmetic is its own inverse in both shapes, which is what lets
  // applyOwedPicks turn a club's seat back into the pick number it owns.
  for (const draft of [fan.draft, d]) {
    for (let r = 1; r <= 3; r++) {
      for (let x = 0; x < draft.order.length; x++) assert.equal(seatAt(draft, r, seatAt(draft, r, x)), x);
    }
  }
});

test('a future pick is valued against the draft it will be made in', () => {
  // The club picking first holds pick 1 either way, but its second-round pick
  // is the last of round two in a snake and the first of it in a straight
  // draft. Valuing a pro league's future picks on the snake overrated the
  // good clubs' and underrated the bad ones'.
  assert.equal(snakeOverall(2, 1, 32, true), 64, 'in a snake the first picker goes last in round two');
  assert.equal(snakeOverall(2, 1, 32, false), 33, 'running straight he goes first again');
  assert.equal(snakeOverall(2, 32, 32, true), 33);
  assert.equal(snakeOverall(2, 32, 32, false), 64);
  assert.equal(snakeOverall(1, 5, 32, true), snakeOverall(1, 5, 32, false), 'round one is the same either way');
  assert.equal(nextDraftSnakes({ mode: 'pro' }), false);
  assert.equal(nextDraftSnakes({ mode: 'fantasy' }), true);
});
