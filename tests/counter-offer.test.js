// A refused trade used to end at "No deal" and a hint at the size of the gap.
// Now the club names the nearest version of the human's own deal it would take.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek, registerPlayers } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { proposeTrade, MAX_TRADE_SIDE } from '../src/engine/transactions.js';
import { counterOffer } from '../src/engine/dealfinder.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';

registerPlayers(byId);
const league = (seed = 13) => {
  const lg = createLeague({ name: 'C', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction' });
  autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), byId);
  startSeason(lg, byId);
  for (let w = 0; w < 3; w++) { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg); }
  return lg;
};
const clone = (x) => JSON.parse(JSON.stringify(x));
// Refused proposals: my worst at a position for their best there.
const refusals = (lg) => {
  const u = lg.teams.findIndex((t) => t.isUser), out = [];
  for (let ai = 0; ai < lg.teams.length; ai++) {
    if (ai === u) continue;
    for (const pos of ['WR', 'RB', 'QB', 'DL', 'CB', 'LB', 'TE']) {
      const mine = ROSTER_SLOTS.filter((s) => s.pos === pos).map((s) => lg.teams[u].slots[s.id]).filter(Boolean);
      const theirs = ROSTER_SLOTS.filter((s) => s.pos === pos).map((s) => lg.teams[ai].slots[s.id]).filter(Boolean);
      if (!mine.length || !theirs.length) continue;
      const give = [mine[mine.length - 1]], get = [theirs[0]];
      const r = proposeTrade(clone(lg), u, ai, give, get, byId, PLAYERS, {});
      if (r.ok && !r.accepted) out.push({ u, ai, give, get });
    }
  }
  return out;
};

test('every counter offered is one the club actually accepts', () => {
  // The whole point: "they would take it" has to be true. Proposed for real on
  // a copy of the league, through the same door the human uses.
  const lg = league();
  let checked = 0;
  for (const { u, ai, give, get } of refusals(lg)) {
    const c = counterOffer(lg, byId, PLAYERS, u, ai, give, get);
    if (!c || c.none) continue;
    const r = proposeTrade(clone(lg), u, ai, c.gives, c.gets, byId, PLAYERS, { userPicks: c.userPicks, aiPicks: c.aiPicks });
    assert.ok(r.ok && r.accepted, `the counter to ${give}->${get} was refused in turn: ${r.reason}`);
    checked++;
  }
  assert.ok(checked >= 10, `only ${checked} counters were checked, which is too few to mean anything`);
});

test('the counter offered is the one that costs the human least', () => {
  const lg = league();
  for (const { u, ai, give, get } of refusals(lg)) {
    const c = counterOffer(lg, byId, PLAYERS, u, ai, give, get);
    if (!c || c.none) continue;
    const cheapest = Math.min(...c.options.map((o) => o.cost));
    assert.equal(c.cost, cheapest, 'a dearer counter was offered while a cheaper one worked');
  }
});

test('a deal the club would take gets no counter', () => {
  const lg = league();
  const u = lg.teams.findIndex((t) => t.isUser);
  // Give them my best at a position for their worst there: accepted.
  for (let ai = 0; ai < lg.teams.length; ai++) {
    if (ai === u) continue;
    const mine = ROSTER_SLOTS.filter((s) => s.pos === 'WR').map((s) => lg.teams[u].slots[s.id]).filter(Boolean);
    const theirs = ROSTER_SLOTS.filter((s) => s.pos === 'WR').map((s) => lg.teams[ai].slots[s.id]).filter(Boolean);
    const give = [mine[0]], get = [theirs[theirs.length - 1]];
    if (!proposeTrade(clone(lg), u, ai, give, get, byId, PLAYERS, {}).accepted) continue;
    assert.equal(counterOffer(lg, byId, PLAYERS, u, ai, give, get), null, 'an accepted deal was answered with a counter');
    return;
  }
});

test('a counter never strips their side to nothing', () => {
  // Leaving the club giving nothing would be a gift, not a trade.
  const lg = league();
  for (const { u, ai, give, get } of refusals(lg)) {
    const c = counterOffer(lg, byId, PLAYERS, u, ai, give, get);
    for (const o of c?.options || []) assert.ok(o.gets.length > 0, 'a counter left the club giving nothing');
  }
});

test('the net figure is honest about standing pat', () => {
  // Cheapest-to-accept can still be your starting quarterback. The number shown
  // beside it must be the real change to your lineup, sign and all, so a bad
  // answer reads as a bad answer.
  const lg = league();
  let worse = 0;
  for (const { u, ai, give, get } of refusals(lg)) {
    const c = counterOffer(lg, byId, PLAYERS, u, ai, give, get);
    if (!c || c.none) continue;
    assert.ok(Number.isFinite(c.net) && Number.isFinite(c.cost));
    if (c.net < 0) worse++;
  }
  assert.ok(worse > 0, 'no counter ever left the human worse off, so the honesty line is untested');
});

test('a counter never breaks the rules a proposal is held to', () => {
  // The club's own arithmetic would take a fourth player happily; the trade
  // rules would not. Offer the maximum for one star, get refused, and every
  // counter — not just the cheapest — must still be a legal proposal. Without
  // `validateTrade` in the search, "add one more of yours" is offered past the
  // limit and refused the moment it is proposed.
  const lg = league(17);
  const u = lg.teams.findIndex((t) => t.isUser);
  let checked = 0;
  for (let ai = 0; ai < lg.teams.length && checked < 6; ai++) {
    if (ai === u) continue;
    // A legal offer at the size limit: the backup at the star's position, and
    // two cheap men elsewhere — two unmatched positions, which is the most a
    // side may carry. (Three cheap bodies for a quarterback is refused by that
    // rule before the club is ever asked.)
    const star = lg.teams[ai].slots.QB1;
    const backup = lg.teams[u].slots.QB2;
    const cheap = ['WR4', 'LB3'].map((sl) => lg.teams[u].slots[sl]).filter(Boolean);
    if (!star || !backup || cheap.length < MAX_TRADE_SIDE - 1) continue;
    const give = [backup, ...cheap.slice(0, MAX_TRADE_SIDE - 1)];
    const r = proposeTrade(clone(lg), u, ai, give, [star], byId, PLAYERS, {});
    if (!r.ok || r.accepted) continue;
    const c = counterOffer(lg, byId, PLAYERS, u, ai, give, [star]);
    for (const o of c?.options || []) {
      assert.ok(o.gives.length <= MAX_TRADE_SIDE, `a counter asked for ${o.gives.length} players a side`);
      const again = proposeTrade(clone(lg), u, ai, o.gives, o.gets, byId, PLAYERS, { userPicks: o.userPicks, aiPicks: o.aiPicks });
      assert.ok(again.ok, `a counter the rules refuse was offered: ${again.reason}`);
    }
    checked++;
  }
  assert.ok(checked > 0, 'no maximum-size proposal was refused, so the rule went untested');
});
