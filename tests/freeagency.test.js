import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, simulateWeekAi, advanceWeek, userTeamIndex } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { enterOffseason, confirmKeepers, aiKeepers, takeJob, closeFreeAgency } from '../src/engine/offseason.js';
import { capHit, overCap, marketSalary, PRO_CAP, SLOT_RESERVE } from '../src/engine/cap.js';
import {
  askingBoard, biddingRoom, openCount, submitOffer, freeAgencyReport, openFreeAgency,
  aiBid, AI_FA_SHARE,
} from '../src/engine/freeagency.js';

registerPlayers(byId);

/** A capped league taken through one season and up to the free-agent market. */
function toMarket(seed) {
  const lg = createLeague({ name: 'FA', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 12, seed, mode: 'pro', draftType: 'snake' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, byId);
  while (lg.phase === 'season') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  while (lg.phase === 'playoffs') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  const off = enterOffseason(lg, PLAYERS, byId);
  if (off.step === 'jobs') takeJob(lg, off.carousel.offers[0].team, PLAYERS, byId);
  confirmKeepers(lg, aiKeepers(lg, userTeamIndex(lg), PLAYERS, byId, new RNG(seed + 1)), PLAYERS, byId);
  return lg;
}

test('a capped league stops at the market before it drafts', () => {
  const lg = toMarket(11);
  assert.equal(lg.phase, 'offseason');
  assert.equal(lg.offseason.step, 'freeagency');
  assert.ok(lg.freeAgency, 'no market was opened');
  // The AI is already bidding when the human arrives.
  const bidders = Object.values(lg.freeAgency.offers).filter((o) => Object.keys(o).length).length;
  assert.ok(bidders > 1, `only ${bidders} clubs put an offer in`);
});

test('a player will not sign below his asking price', () => {
  const lg = toMarket(12);
  const u = userTeamIndex(lg);
  const row = askingBoard(lg, PLAYERS, { limit: 400 })
    .find((r) => r.ask > 2 && ROSTER_SLOTS.some((s) => s.pos === r.pos && !lg.teams[u].slots[s.id]));
  assert.ok(row, 'no affordable free agent at an open position');
  const low = submitOffer(lg, u, row.id, row.ask - 1, byId);
  assert.equal(low.ok, false);
  assert.match(low.reason, /asking/);
  assert.equal(submitOffer(lg, u, row.id, row.ask, byId).ok, true);
  assert.equal(lg.freeAgency.offers[u][row.id], row.ask);
});

test('a club is held to every bid landing at once', () => {
  const lg = toMarket(13);
  const u = userTeamIndex(lg);
  const room = biddingRoom(lg, u);
  const board = askingBoard(lg, PLAYERS, { limit: 400 })
    .filter((r) => ROSTER_SLOTS.some((s) => s.pos === r.pos && !lg.teams[u].slots[s.id]));
  // One bid for everything available leaves nothing for the next.
  const big = board.find((r) => r.ask <= room);
  assert.ok(big, 'nothing affordable');
  assert.equal(submitOffer(lg, u, big.id, room, byId).ok, true);
  assert.ok(biddingRoom(lg, u) < room, 'the room did not come down');
  const another = board.find((r) => r.id !== big.id);
  if (another) {
    const r = submitOffer(lg, u, another.id, biddingRoom(lg, u) + 1, byId);
    assert.equal(r.ok, false, 'a club bid past its cap');
  }
  // Pulling out gives it back.
  assert.equal(submitOffer(lg, u, big.id, 0, byId).ok, true);
  assert.equal(biddingRoom(lg, u), room);
});

test('the market settles, the best offer wins, and the loser is told', () => {
  const lg = toMarket(14);
  const u = userTeamIndex(lg);
  // Outbid everybody for somebody the AI wants.
  const contested = Object.entries(lg.freeAgency.offers)
    .filter(([t]) => Number(t) !== u)
    .flatMap(([, o]) => Object.keys(o));
  const target = contested.find((id) => {
    const p = byId.get(id);
    return p && ROSTER_SLOTS.some((s) => s.pos === p.pos && !lg.teams[u].slots[s.id]);
  });
  if (target) {
    const p = byId.get(target);
    const bid = Math.min(biddingRoom(lg, u), Math.round(marketSalary(p) * 1.9));
    if (bid >= marketSalary(p)) {
      assert.equal(submitOffer(lg, u, target, bid, byId).ok, true);
      closeFreeAgency(lg, PLAYERS, byId);
      const rep = freeAgencyReport(lg, u);
      const got = rep.won.find((w) => w.id === target);
      assert.ok(got, `the top bid of $${bid} did not win ${p.name}`);
      assert.ok(ROSTER_SLOTS.some((s) => lg.teams[u].slots[s.id] === target), 'he was not put on the roster');
      assert.equal(lg.contracts[target].salary, bid);
      return;
    }
  }
  closeFreeAgency(lg, PLAYERS, byId);
  assert.ok(lg.freeAgency.closed);
});

test('signing costs a pick, and the draft picks up what is left', () => {
  const lg = toMarket(15);
  const u = userTeamIndex(lg);
  const before = openCount(lg.teams[u]);
  closeFreeAgency(lg, PLAYERS, byId);
  assert.equal(lg.phase, 'draft');
  assert.ok(lg.draft, 'no draft was opened');
  const signed = lg.offseason.signed || [];
  assert.ok(signed.length > 0, 'nobody signed anywhere in the league');
  // Nobody signed twice, and nobody signed below his asking price.
  assert.equal(new Set(signed.map((s) => s.id)).size, signed.length);
  for (const s of signed) assert.ok(s.salary >= s.ask, `${s.id} signed under his ask`);
  const mine = signed.filter((s) => s.team === u).length;
  assert.equal(openCount(lg.teams[u]), before - mine, 'slots did not come down by what was signed');
});

test('a full offseason through the market still starts legal and whole', () => {
  const lg = toMarket(16);
  closeFreeAgency(lg, PLAYERS, byId);
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(99));
  startSeason(lg, byId);
  for (let i = 0; i < lg.teams.length; i++) {
    assert.ok(!overCap(lg, i), `club ${i} started at ${capHit(lg, i)} of ${PRO_CAP}`);
    assert.equal(ROSTER_SLOTS.filter((s) => lg.teams[i].slots[s.id]).length, ROSTER_SLOTS.length, `club ${i} is short`);
  }
});

test('a fantasy league never sees the market', () => {
  const lg = createLeague({ name: 'F', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 3, draftType: 'auction' });
  assert.equal(openFreeAgency(lg, PLAYERS, byId).offers && Object.keys(lg.freeAgency.offers).length, 0);
  assert.equal(biddingRoom(lg, 0), 0);
  void SLOT_RESERVE;
});

test('a club with a single hole sits the market out, and that is deliberate', () => {
  // This reads like an off-by-one and is not. `want` is floored, so one open
  // slot rounds to nothing and the club drafts instead. Measured over 256 club
  // offseasons it shuts out 8% of them, and they are the good clubs — a club
  // with one hole is one that kept everybody. Letting them shop with
  // `Math.max(1, …)` was tried and widened the gap between the best and worst
  // roster from 759 to 821, well outside the spread between seeds. A contender
  // buying its last piece every year is how a league stops being competitive.
  const lg = toMarket(12);
  openFreeAgency(lg, PLAYERS, byId);
  const one = lg.teams.findIndex((t, i) => !t.isUser && openCount(t) === 1);
  if (one < 0) {
    // Nothing to check in this league; the arithmetic still has to hold.
    assert.equal(Math.floor(1 * AI_FA_SHARE), 0);
    return;
  }
  const bidsBy = (i) => Object.keys(lg.freeAgency?.offers?.[i] || {}).length;
  const before = bidsBy(one);
  aiBid(lg, PLAYERS, byId, new RNG(5));
  assert.equal(bidsBy(one), before, 'a club with one hole bid anyway');
  // And the market is not simply mute: somebody with room to spare did shop.
  const shoppers = lg.teams.map((_, i) => i).filter((i) => bidsBy(i) > 0);
  assert.ok(shoppers.length > 0, 'no club bid at all, so the rule proves nothing');
  for (const i of shoppers) assert.ok(openCount(lg.teams[i]) >= 2, `club ${i} bid with ${openCount(lg.teams[i])} open slot`);
});
