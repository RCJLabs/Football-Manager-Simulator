import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, simulateWeekAi, advanceWeek, userTeamIndex, migrateLeague, LEAGUE_VERSION } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { enterOffseason, confirmKeepers, aiKeepers, takeJob, keeperCost, closeFreeAgency, RESIGN_PREMIUM } from '../src/engine/offseason.js';
import {
  capOn, capHit, capSpace, overCap, rookieSalary, marketSalary, expireContracts,
  deadCharge, bookDead, deadHit, tickDead, cutToCap,
  PRO_CAP, MIN_SALARY, ROOKIE_TOP, ROOKIE_YEARS, DEAD_SHARE, draftSize,
} from '../src/engine/cap.js';

registerPlayers(byId);

const proLeague = (seed) => createLeague({ name: 'P', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 12, seed, mode: 'pro', draftType: 'snake' });
const drafted = (seed) => {
  const lg = proLeague(seed);
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, byId);
  return lg;
};

test('the rookie scale falls with the pick and leaves room for veterans', () => {
  const total = 27 * 12;
  assert.equal(rookieSalary(1, total), ROOKIE_TOP);
  assert.equal(rookieSalary(total, total), MIN_SALARY);
  for (let k = 2; k <= total; k++) {
    assert.ok(rookieSalary(k, total) <= rookieSalary(k - 1, total), `pick ${k} costs more than ${k - 1}`);
  }
  // The point of a rookie scale: a roster drafted top to bottom has to leave
  // money to re-sign anybody, or the cap is decoration.
  const lg = drafted(3);
  for (let i = 0; i < lg.teams.length; i++) {
    const hit = capHit(lg, i);
    assert.ok(hit > PRO_CAP * 0.35 && hit < PRO_CAP * 0.65, `club ${i} drafted a roster costing ${hit} of ${PRO_CAP}`);
  }
});

test('a fantasy league has no cap at all', () => {
  const lg = createLeague({ name: 'F', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 2, draftType: 'auction' });
  assert.equal(capOn(lg), false);
  assert.equal(capHit(lg, 0), 0);
  assert.equal(capSpace(lg, 0), Infinity);
  assert.equal(overCap(lg, 0), false);
  assert.deepEqual(expireContracts(lg), []);
});

test('an expiring contract keeps the player and raises his price', () => {
  const lg = drafted(4);
  const t = 0;
  const id = ROSTER_SLOTS.map((s) => lg.teams[t].slots[s.id]).find(Boolean);
  const c = lg.contracts[id];
  const wasSalary = c.salary;
  c.years = 1;
  const marked = expireContracts(lg);
  // He is still on the roster — releasing him here is what made the cap
  // toothless, because keeping good players then cost nothing.
  assert.ok(ROSTER_SLOTS.some((s) => lg.teams[t].slots[s.id] === id), 'an expiring player was released');
  assert.ok(marked.some((x) => x.id === id), 'his deal was not marked up');
  assert.equal(lg.contracts[id].expiring, true);
  // And he now costs what he is worth rather than what he was paid — plus the
  // premium on the exclusive window, without which re-signing and declining
  // cost the same and only declining carried risk, so declining was dominated.
  const cost = keeperCost(lg.contracts[id], byId.get(id), lg);
  const market = marketSalary(byId.get(id));
  assert.equal(cost, Math.ceil(market * RESIGN_PREMIUM));
  assert.ok(cost > market, 'the exclusive window has to cost something or it is not a choice');
  const stillUnder = ROSTER_SLOTS.map((s) => lg.teams[t].slots[s.id]).find((x) => x && !lg.contracts[x]?.expiring);
  if (stillUnder) assert.equal(keeperCost(lg.contracts[stillUnder], byId.get(stillUnder), lg), lg.contracts[stillUnder].salary);
  void wasSalary;
});

test('founding contracts are staggered so the league does not expire at once', () => {
  const lg = drafted(6);
  const terms = Object.values(lg.contracts).map((c) => c.years);
  const spread = new Set(terms);
  assert.ok(spread.size >= 3, `every founding deal runs ${[...spread].join('/')} years, so the league turns over in one go`);
});

test('nobody is over the cap at kickoff, season after season', () => {
  const lg = drafted(9);
  for (let i = 0; i < lg.teams.length; i++) assert.ok(!overCap(lg, i), `club ${i} started over the cap`);
  for (let year = 0; year < 3; year++) {
    while (lg.phase === 'season') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
    while (lg.phase === 'playoffs') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
    const off = enterOffseason(lg, PLAYERS, byId);
    if (off.step === 'jobs') takeJob(lg, off.carousel.offers[0].team, PLAYERS, byId);
    confirmKeepers(lg, aiKeepers(lg, userTeamIndex(lg), PLAYERS, byId, new RNG(year + 1)), PLAYERS, byId);
    // A capped league shops before it drafts, so the market has to settle
    // before there is a draft to run.
    closeFreeAgency(lg, PLAYERS, byId);
    autoDraftAll(lg, lg.draft, PLAYERS, new RNG(100 + year));
    startSeason(lg, byId);
    for (let i = 0; i < lg.teams.length; i++) {
      assert.ok(!overCap(lg, i), `club ${i} started season ${lg.season} at ${capHit(lg, i)} of ${PRO_CAP}`);
      assert.equal(ROSTER_SLOTS.filter((s) => lg.teams[i].slots[s.id]).length, ROSTER_SLOTS.length, `club ${i} is short`);
    }
  }
  // And the cap has to actually bite by now, or it is not doing anything.
  const hits = lg.teams.map((_, i) => capHit(lg, i));
  const mean = hits.reduce((a, b) => a + b, 0) / hits.length;
  assert.ok(mean > PRO_CAP * 0.6, `clubs are spending ${mean.toFixed(0)} of ${PRO_CAP}; the cap is not binding`);
});

test('the draft scale is measured against the whole draft, whatever the league size', () => {
  for (const n of [8, 12, 32]) {
    const lg = createLeague({ name: 'N', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: n, seed: 1, mode: 'pro', draftType: 'snake' });
    assert.equal(draftSize(lg), ROSTER_SLOTS.length * lg.teams.length);
    assert.equal(rookieSalary(1, draftSize(lg)), ROOKIE_TOP);
  }
});

test('a founding intake signed on one day is fanned out on load', () => {
  const lg = drafted(21);
  // A save from before syncContracts learned to stagger, two seasons in: every
  // founding deal was written on the full rookie term and has run down by the
  // same two years, so the whole league comes due in one offseason.
  lg.season = 3;
  for (const c of Object.values(lg.contracts)) if (c.round != null) c.years = ROOKIE_YEARS - 2;
  lg.version = 3;
  const before = Object.fromEntries(Object.entries(lg.contracts).map(([id, c]) => [id, c.years]));
  assert.equal(new Set(Object.values(before).filter((y) => y > 0)).size, 1, 'the fixture was not flat');

  migrateLeague(lg);
  assert.equal(lg.version, LEAGUE_VERSION);
  assert.ok(lg.migrationNote, 'the player was not told anything changed');

  const after = Object.entries(lg.contracts).filter(([, c]) => c.since === 1 && c.round != null);
  assert.ok(new Set(after.map(([, c]) => c.years)).size >= 3, 'the cohort still lands in one year');
  // Never shortens: the keeper screen prints "3y left" and somebody may have
  // been counting on it.
  for (const [id, c] of after) assert.ok(c.years >= before[id], `${id} lost a year it had been promised`);
  // And the spread is bounded — a contract cannot run away.
  for (const [id, c] of after) assert.ok(c.years <= before[id] + ROOKIE_YEARS - 1);
});

test('a league that was already staggered is left alone', () => {
  const lg = drafted(22);
  lg.season = 3;
  lg.version = 3;
  const before = JSON.stringify(lg.contracts);
  migrateLeague(lg);
  assert.equal(JSON.stringify(lg.contracts), before, 'a healthy league was rewritten');
  assert.equal(lg.migrationNote, undefined);
});

test('the spread never touches a fantasy league or a first season', () => {
  const fantasy = createLeague({ name: 'F', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 4, draftType: 'auction' });
  fantasy.version = 3;
  const fBefore = JSON.stringify(fantasy.contracts);
  migrateLeague(fantasy);
  assert.equal(JSON.stringify(fantasy.contracts), fBefore);

  // Season one is where the stagger is written in the first place; there is
  // nothing to repair and no elapsed time to repair it against.
  const fresh = drafted(23);
  for (const c of Object.values(fresh.contracts)) if (c.round != null) c.years = ROOKIE_YEARS;
  fresh.season = 1;
  fresh.version = 3;
  const sBefore = JSON.stringify(fresh.contracts);
  migrateLeague(fresh);
  assert.equal(JSON.stringify(fresh.contracts), sBefore);
  assert.equal(fresh.migrationNote, undefined);
});

test('cutting a man you are still paying leaves a bill; letting a deal run out does not', () => {
  // Half the money follows him, for the years that were left.
  assert.deepEqual(deadCharge({ salary: 20, years: 3 }), { amount: 10, years: 3 });
  assert.deepEqual(deadCharge({ salary: 9, years: 2 }), { amount: 4, years: 2 });
  // A deal that is up costs nothing to walk away from — that is the difference
  // between declining to re-sign a man and cutting one.
  assert.equal(deadCharge({ salary: 20, years: 0, expiring: true }), null);
  assert.equal(deadCharge({ salary: 20, years: 0 }), null);
  assert.equal(deadCharge(null), null);
  // Floored, so a minimum deal leaves nothing. `cutToCap` depends on it: a cut
  // that freed no money could loop without ever getting a club under the cap.
  assert.equal(deadCharge({ salary: 1, years: 4 }), null);
  assert.equal(deadCharge({ salary: 2, years: 4 }).amount, 1);
  assert.ok(DEAD_SHARE > 0 && DEAD_SHARE < 1, 'a cut has to free more than it costs, or nothing converges');
});

test('dead money counts against the cap, runs down a year at a time, and then stops', () => {
  const lg = drafted(9);
  const u = userTeamIndex(lg);
  const before = capHit(lg, u);
  bookDead(lg, u, 'someone', { salary: 16, years: 2 });
  assert.equal(deadHit(lg, u), 8);
  assert.equal(capHit(lg, u), before + 8, 'a man you are still paying is on the books');
  assert.equal(capSpace(lg, u), (lg.cap ?? PRO_CAP) - before - 8);
  // Nobody else is charged for it.
  assert.equal(deadHit(lg, (u + 1) % lg.teams.length), 0);
  tickDead(lg);
  assert.equal(deadHit(lg, u), 8, 'two years means two years');
  tickDead(lg);
  assert.equal(deadHit(lg, u), 0, 'and then it is done');
  assert.equal(capHit(lg, u), before);
});

test('the cap shed books what it still owes, and still gets a club under the cap', () => {
  const lg = drafted(10);
  const u = userTeamIndex(lg);
  // Push the club well over by making its deals expensive.
  for (const s of ROSTER_SLOTS) {
    const id = lg.teams[u].slots[s.id];
    if (id) lg.contracts[id] = { ...(lg.contracts[id] || {}), salary: 14, years: 3 };
  }
  assert.ok(overCap(lg, u), 'the setup did not put the club over');
  const released = cutToCap(lg, u, byId);
  assert.ok(released.length > 0, 'nobody was cut');
  assert.ok(deadHit(lg, u) > 0, 'the cuts left no bill at all');
  // The point of flooring the charge: shedding still converges.
  assert.ok(!overCap(lg, u), `still $${-capSpace(lg, u)} over after ${released.length} cuts`);
});
