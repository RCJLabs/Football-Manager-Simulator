import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import {
  createLeague, startSeason, registerPlayers, simulateWeekAi, advanceWeek, userTeamIndex,
} from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import {
  proposeTrade, validateTrade, evaluateTrade, lineupStrength, slotsAfterTrade, tradeDeadlineWeek,
} from '../src/engine/transactions.js';
import { dealPlan, scanClub, findDeals, dealStillValid, DEAL_FLOOR } from '../src/engine/dealfinder.js';
import { enterOffseason, confirmKeepers, aiKeepers, takeJob, closeFreeAgency } from '../src/engine/offseason.js';

registerPlayers(byId);

function midSeason(seed, weeks = 3) {
  const lg = createLeague({ name: 'D', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 12, seed, mode: 'pro', draftType: 'snake' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, byId);
  for (let i = 0; i < weeks; i++) { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  return lg;
}

test('a found deal is one the club actually takes', () => {
  const lg = midSeason(4);
  const u = userTeamIndex(lg);
  const deals = findDeals(lg, byId, PLAYERS);
  assert.ok(deals.length > 0, 'nothing found in a week that should have several');
  // The promise the panel makes: press it and it goes through.
  const d = deals[0];
  const r = proposeTrade(lg, u, d.club, d.wants, d.gives, byId, PLAYERS);
  assert.equal(r.accepted, true, `the best deal was refused: ${r.reason}`);
});

test('every found deal clears both bars, not just the club’s', () => {
  const lg = midSeason(9);
  const u = userTeamIndex(lg);
  const base = lineupStrength(lg.teams[u].slots, byId, lg);
  for (const d of findDeals(lg, byId, PLAYERS)) {
    assert.equal(validateTrade(lg, d.club, u, d.gives, d.wants, byId, PLAYERS).ok, true);
    assert.equal(evaluateTrade(lg, d.club, d.gives, d.wants, byId, PLAYERS).accept, true, 'a club would not take its own deal');
    const out = slotsAfterTrade(lg, u, d.wants, d.gives, PLAYERS, byId);
    assert.ok(out, 'the human could not field a roster');
    assert.ok(lineupStrength(out.slots, byId, lg) - base >= DEAL_FLOOR, 'a deal that does not help the human was offered');
    assert.equal(Math.round((lineupStrength(out.slots, byId, lg) - base) * 10) / 10, d.userDelta);
  }
});

test('one deal a club, best first', () => {
  const lg = midSeason(15);
  const deals = findDeals(lg, byId, PLAYERS);
  assert.equal(new Set(deals.map((d) => d.club)).size, deals.length, 'the same club appeared twice');
  for (let i = 1; i < deals.length; i++) assert.ok(deals[i - 1].userDelta >= deals[i].userDelta);
});

test('the search splits into chunks small enough to keep a phone alive', () => {
  const lg = midSeason(4);
  const plan = dealPlan(lg, byId);
  assert.ok(plan, 'no plan in an open market');
  assert.equal(plan.clubs.length, lg.teams.length - 1);
  // Scanning every club has to add up to the same answer as one sweep, which
  // is what lets the screen do it a club at a time.
  const piecemeal = [];
  for (let i = 0; i < plan.clubs.length; i++) piecemeal.push(...scanClub(lg, byId, PLAYERS, plan, i));
  const swept = findDeals(lg, byId, PLAYERS, { max: 99 });
  assert.equal(new Set(swept.map((d) => d.club)).size, swept.length);
  for (const d of swept) {
    assert.ok(piecemeal.some((p) => p.club === d.club && p.userDelta === d.userDelta), 'a swept deal was not found club by club');
  }
  assert.equal(scanClub(lg, byId, PLAYERS, plan, 999).length, 0, 'scanning past the end did something');
});

test('the market being shut means no plan at all', () => {
  const lg = midSeason(6, 2);
  lg.week = tradeDeadlineWeek(lg) + 1;
  assert.equal(dealPlan(lg, byId), null);
  assert.deepEqual(findDeals(lg, byId, PLAYERS), []);
});

test('a deal stops standing once the players move', () => {
  const lg = midSeason(9);
  const u = userTeamIndex(lg);
  const deals = findDeals(lg, byId, PLAYERS);
  assert.ok(deals.length >= 1);
  const d = deals[0];
  assert.equal(dealStillValid(lg, byId, PLAYERS, d, u), true);
  // Do it, and the same deal cannot be done twice.
  proposeTrade(lg, u, d.club, d.wants, d.gives, byId, PLAYERS);
  assert.equal(dealStillValid(lg, byId, PLAYERS, d, u), false);
  // And a deal naming somebody who was never there does not stand either.
  assert.equal(dealStillValid(lg, byId, PLAYERS, { ...d, gives: ['nobody'] }, u), false);
  assert.equal(dealStillValid(lg, byId, PLAYERS, null, u), false);
});

test('the finder agrees with a brute-force count of what exists', () => {
  const lg = midSeason(15);
  const u = userTeamIndex(lg);
  const base = lineupStrength(lg.teams[u].slots, byId, lg);
  const plan = dealPlan(lg, byId);
  // Every candidate the plan holds, checked the long way round.
  let truth = 0;
  for (const entry of plan.clubs) {
    for (const c of entry.candidates) {
      if (!validateTrade(lg, entry.club, u, c.gives, c.wants, byId, PLAYERS).ok) continue;
      if (!evaluateTrade(lg, entry.club, c.gives, c.wants, byId, PLAYERS).accept) continue;
      const out = slotsAfterTrade(lg, u, c.wants, c.gives, PLAYERS, byId);
      if (out && lineupStrength(out.slots, byId, lg) - base >= DEAL_FLOOR) truth++;
    }
  }
  const all = [];
  for (let i = 0; i < plan.clubs.length; i++) all.push(...scanClub(lg, byId, PLAYERS, plan, i));
  assert.equal(all.length, truth, 'the finder and the long way round disagree');
});

test('every transaction a league writes has a shape the log can read', () => {
  // The Moves log used to treat any row it did not recognise as a trade and
  // read `league.teams[t.other].isUser` off it. `cut`, `sign` and `fill` carry
  // no other club, and a pro league makes cuts at kickoff, so opening the tab
  // took it down. This holds the contract the screen relies on.
  const known = new Set(['waiver', 'ir', 'activate', 'release', 'cut', 'sign', 'fill', 'trade', 'picks']);
  // A whole season and an offseason, because `cut`, `sign` and `fill` are all
  // written between seasons and none of them exist in a freshly drafted one.
  const lg = midSeason(4, 0);
  while (lg.phase === 'season') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  while (lg.phase === 'playoffs') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  const off = enterOffseason(lg, PLAYERS, byId);
  if (off.step === 'jobs') takeJob(lg, off.carousel.offers[0].team, PLAYERS, byId);
  confirmKeepers(lg, aiKeepers(lg, userTeamIndex(lg), PLAYERS, byId, new RNG(5)), PLAYERS, byId);
  if (lg.offseason?.step === 'freeagency') closeFreeAgency(lg, PLAYERS, byId);
  if (lg.draft) autoDraftAll(lg, lg.draft, PLAYERS, new RNG(55));
  startSeason(lg, byId);
  const seen = new Set((lg.transactions || []).map((t) => t.type));
  assert.ok(seen.size > 0, 'a season and an offseason produced no transactions at all');
  // The three that used to crash it have to be in this sample, or the test is
  // passing by not exercising them.
  assert.ok(seen.has('cut') || seen.has('sign') || seen.has('fill'), `only saw ${[...seen].join(', ')}`);
  for (const t of lg.transactions) {
    assert.ok(known.has(t.type), `the log has no line for a "${t.type}" transaction`);
    assert.ok(lg.teams[t.team], `transaction ${t.type} names no club`);
    // Only the two-sided kinds may name a second club, and if they do it exists.
    if (t.other != null) assert.ok(lg.teams[t.other], `transaction ${t.type} names a club that is not there`);
    if (t.type === 'trade' || t.type === 'picks') assert.ok(lg.teams[t.other], `a ${t.type} with nobody on the other end`);
  }
});
