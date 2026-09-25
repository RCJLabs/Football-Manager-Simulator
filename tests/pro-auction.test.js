// A pro league that fills its roster by auction is still a pro league: its
// contracts carry a term and run out, its keepers keep their deals, and its
// offseason auction is this year's rookies bid from what is left under the cap.
// Every one of those used to take the fantasy branch, because the auction was
// tested before the cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, migrateLeague, LEAGUE_VERSION } from '../src/engine/season.js';
import { autoCompleteAll, createAuction, availablePlayers, advanceToUser, slotsLeft, MIN_BID, BUDGET_SPREADS, DEFAULT_BUDGET } from '../src/engine/auction.js';
import { enterOffseason, confirmKeepers, validateKeepers, closeFreeAgency, aiKeepers } from '../src/engine/offseason.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { careerIndex, applyCareers } from '../src/engine/careers.js';
import { capSpace, capHit, MIN_SALARY, ROOKIE_YEARS, PRO_CAP } from '../src/engine/cap.js';
import { rookieClass } from '../src/engine/proleague.js';

registerPlayers(PLAYERS_BY_ID);

const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
const pool = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));
const rostered = (lg, i) => ROSTER_SLOTS.map((s) => lg.teams[i].slots[s.id]).filter(Boolean);

// Founding a 32-club auction is the slow part, so it is done once.
let founded = null;
function foundedLeague() {
  if (!founded) {
    const lg = createLeague({ name: 'PA', mode: 'pro', franchise: 3, seed: 7, draftType: 'auction', user: { name: 'Me', abbr: 'ME', color: '#fff' } });
    autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(7), PLAYERS_BY_ID);
    startSeason(lg, PLAYERS_BY_ID);
    founded = JSON.stringify(lg);
  }
  return JSON.parse(founded);
}
function inOffseason() {
  const lg = foundedLeague();
  lg.phase = 'complete';
  enterOffseason(lg, leaguePool(lg, PLAYERS), index(lg));
  return lg;
}

test('a pro league built at auction signs every man for a term, at what he went for', () => {
  const lg = foundedLeague();
  const paid = new Map(lg.auction.sold.map((s) => [s.playerId, s.price]));
  const terms = new Set();
  for (let i = 0; i < lg.teams.length; i++) {
    for (const id of rostered(lg, i)) {
      const c = lg.contracts[id];
      assert.ok(c.years >= 1 && c.years <= ROOKIE_YEARS, `${id} signed for ${c.years} years`);
      assert.equal(c.salary, Math.max(MIN_SALARY, paid.get(id) ?? MIN_SALARY), `${id} is paid what he went for`);
      terms.add(c.years);
    }
  }
  // Spread as a drafted founding intake is, so the league does not come due at once.
  assert.ok(terms.size >= 3, `founding terms ${[...terms]}`);
});

test('a pro league that auctions keeps its contracts as one that drafts does', () => {
  const lg = inOffseason();
  const u = lg.teams.findIndex((t) => t.isUser);
  const keep = rostered(lg, u).filter((id) => !lg.contracts[id].expiring).slice(0, 10);
  assert.ok(keep.length >= 5, 'the fixture has men under contract');
  const before = Object.fromEntries(keep.map((id) => [id, { ...lg.contracts[id] }]));
  const byId = index(lg);
  const v = validateKeepers(lg, u, keep, byId);
  assert.ok(v.ok, v.reason);
  confirmKeepers(lg, keep, pool(lg), byId);
  let written = 0;
  for (const id of keep) {
    const c = lg.contracts[id];
    // The same deal: no keeper's raise, and its term intact.
    assert.equal(c.salary, before[id].salary, `${id} was charged a raise`);
    assert.equal(c.years, before[id].years, `${id} lost his term`);
    written += c.salary;
  }
  // What the screen said keeping them costs is what the league wrote.
  assert.equal(written, v.committed);
});

test('its offseason auction is this year\'s rookies, bid from what is left under the cap', () => {
  const lg = inOffseason();
  const u = lg.teams.findIndex((t) => t.isUser);
  const byId = index(lg);
  confirmKeepers(lg, aiKeepers(lg, u, pool(lg), byId, null), pool(lg), byId);
  closeFreeAgency(lg, pool(lg), index(lg));
  assert.equal(lg.phase, 'draft');
  const a = lg.auction;
  const cls = new Set(rookieClass(lg).map((p) => p.id));
  assert.deepEqual(new Set(a.eligible), cls);
  for (const p of availablePlayers(a, pool(lg))) assert.ok(cls.has(p.id), `${p.name} is not a rookie`);
  lg.teams.forEach((t, i) => assert.equal(a.startBudgets[i], Math.max(slotsLeft(t) * MIN_BID, capSpace(lg, i)), `${t.abbr} bids from its room`));

  autoCompleteAll(a, lg, pool(lg), new RNG(9), index(lg));
  assert.ok(a.complete);
  assert.ok(a.sold.length > 0, 'nobody was bought');
  for (const s of a.sold) assert.ok(cls.has(s.playerId));
  startSeason(lg, index(lg));
  for (const s of a.sold) {
    const c = lg.contracts[s.playerId];
    if (!c) continue; // cut to get under the cap at kickoff
    assert.equal(c.years, ROOKIE_YEARS);
    assert.equal(c.salary, Math.max(MIN_SALARY, s.price));
  }
  lg.teams.forEach((t, i) => assert.ok(capHit(lg, i) <= (lg.cap ?? PRO_CAP), `${t.abbr} is over the cap`));
});

test('a club with nothing left to nominate passes rather than holding the room', () => {
  // A rookie class can run out of a position; an all-time pool never did. Here
  // the room is offered one quarterback for eight clubs with 27 slots each.
  const lg = createLeague({ name: 'F', numTeams: 8, seed: 3, draftType: 'auction', user: { name: 'Me', abbr: 'ME', color: '#fff' } });
  const qb = PLAYERS.find((p) => p.pos === 'QB');
  const a = createAuction(lg, new RNG(3), { eligible: [qb.id] });
  lg.auction = a;
  const why = advanceToUser(a, lg, PLAYERS, new RNG(4), PLAYERS_BY_ID, { maxSteps: 50 });
  if (why === 'nominate' || why === 'bid') autoCompleteAll(a, lg, PLAYERS, new RNG(5), PLAYERS_BY_ID, { maxSteps: 50 });
  assert.ok(a.complete, `the auction stalled (${why})`);
  assert.ok(a.sold.length <= 1);
  assert.ok(a.sold.every((s) => s.playerId === qb.id));
});

test('a pro auction league saved without terms gets them on load', () => {
  const lg = foundedLeague();
  // As the old code wrote them: a price and nothing else.
  for (const c of Object.values(lg.contracts)) { delete c.years; delete c.round; }
  lg.season = 2;
  lg.version = 4;
  migrateLeague(lg);
  assert.equal(lg.version, LEAGUE_VERSION);
  assert.match(lg.migrationNote || '', /had no length/);
  const terms = new Set(Object.values(lg.contracts).map((c) => c.years));
  for (const y of terms) assert.ok(y >= 1 && y <= ROOKIE_YEARS);
  assert.ok(terms.size >= 3, 'every deal comes due at once');

  // A fantasy auction league's deals have no term by design, and stay that way.
  const fantasy = createLeague({ name: 'F', numTeams: 8, seed: 4, draftType: 'auction' });
  autoCompleteAll(fantasy.auction, fantasy, PLAYERS, new RNG(4), PLAYERS_BY_ID);
  startSeason(fantasy, PLAYERS_BY_ID);
  fantasy.version = 4;
  const before = JSON.stringify(fantasy.contracts);
  migrateLeague(fantasy);
  assert.equal(JSON.stringify(fantasy.contracts), before);
  assert.equal(fantasy.migrationNote, undefined);
});

test('a pro league has one cap for every club, whatever cap room it is asked for', () => {
  // Uneven room in a league with a hard cap was money the first kickoff took
  // back: half the clubs spent past $200 and were cut to it, paying dead
  // money for the men they lost.
  const lg = createLeague({ name: 'PS', mode: 'pro', franchise: 3, seed: 3, draftType: 'auction', budgetSpread: BUDGET_SPREADS.wide });
  assert.equal(lg.settings.budgetSpread, 0);
  assert.deepEqual(new Set(lg.auction.startBudgets), new Set([DEFAULT_BUDGET]));
  // A fantasy league still takes it.
  const f = createLeague({ name: 'F', numTeams: 8, seed: 3, draftType: 'auction', budgetSpread: BUDGET_SPREADS.wide });
  assert.ok(new Set(f.auction.startBudgets).size > 1, 'a fantasy league lost its cap room');
});
