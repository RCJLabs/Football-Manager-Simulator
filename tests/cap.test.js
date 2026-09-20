import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, simulateWeekAi, advanceWeek, userTeamIndex } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { enterOffseason, confirmKeepers, aiKeepers, takeJob, keeperCost, closeFreeAgency } from '../src/engine/offseason.js';
import {
  capOn, capHit, capSpace, overCap, rookieSalary, marketSalary, expireContracts,
  PRO_CAP, MIN_SALARY, ROOKIE_TOP, draftSize,
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
  // And he now costs what he is worth rather than what he was paid.
  const cost = keeperCost(lg.contracts[id], byId.get(id), lg);
  assert.equal(cost, marketSalary(byId.get(id)));
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
