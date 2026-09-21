import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { overall } from '../src/engine/ratings.js';
import { createLeague, startSeason, registerPlayers, userTeamIndex } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { freeAgents, rostersValid } from '../src/engine/transactions.js';
import { chemistryBonuses } from '../src/engine/chemistry.js';
import {
  startCareer, developed, stepCareer, advanceCareers, releaseRetired, applyCareers, careerIndex,
  ceilingFor, primeAge, careerPhase, PRIME_AGE, ROOKIE_AGE,
} from '../src/engine/careers.js';

registerPlayers(PLAYERS_BY_ID);

function league(seed, opts = {}) {
  const lg = createLeague({ name: 'C', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction', injuries: 'normal', ...opts });
  autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), PLAYERS_BY_ID);
  startSeason(lg, PLAYERS_BY_ID);
  return lg;
}
const pool = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));
const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));

test('a real player enters at his own prime, a rookie enters at twenty-two', () => {
  const lg = { seed: 4242 };
  for (const pos of Object.keys(PRIME_AGE)) {
    const p = PLAYERS.find((x) => x.pos === pos);
    if (!p) continue;
    const c = startCareer(lg, p);
    assert.ok(Math.abs(c.age - primeAge(pos)) <= 2, `${pos} entered at ${c.age}, prime is ${primeAge(pos)}`);
    assert.equal(c.entry, overall(p), 'entry rating is what the pool says');
  }
  const rookie = { id: 'rk-1', name: 'A B', pos: 'WR', season: 2027, team: 'RK', generated: true, r: { spd: 70, cth: 65, rte: 62, rac: 66 } };
  const rc = startCareer(lg, rookie);
  assert.ok(Math.abs(rc.age - ROOKIE_AGE) <= 1, `rookie entered at ${rc.age}`);
});

test('the same league gives the same man the same career however late he is signed', () => {
  const p = PLAYERS.find((x) => x.pos === 'QB');
  const a = startCareer({ seed: 99 }, p);
  const b = startCareer({ seed: 99 }, p);
  assert.deepEqual(a, b, 'derived from the seed and the id, not from when it was asked for');
  const other = startCareer({ seed: 100 }, p);
  assert.ok(other.age !== a.age || other.growth !== a.growth, 'a different league is a different career');
});

test('growth stops at the ceiling and never runs past it', () => {
  const lg = { seed: 5 };
  const rookie = { id: 'rk-c', name: 'A B', pos: 'WR', season: 2027, team: 'RK', generated: true, r: { spd: 64, cth: 62, rte: 60, rac: 63 } };
  let c = { ...startCareer(lg, rookie), growth: 2.2 };
  c.ceiling = ceilingFor(c.entry, c.growth, new RNG(1));
  let peak = overall(developed(rookie, c));
  for (let yr = 0; yr < 12; yr++) {
    c = stepCareer(lg, rookie, c, yr).career;
    peak = Math.max(peak, overall(developed(rookie, c)));
  }
  assert.ok(peak <= c.ceiling, `peaked at ${peak} against a ceiling of ${c.ceiling}`);
  assert.ok(peak > c.entry, 'and he did grow');
});

test('a ceiling leaves less room the better a player already is', () => {
  const rng = () => new RNG(7);
  assert.ok(ceilingFor(60, 1, rng()) - 60 > ceilingFor(85, 1, rng()) - 85, 'a 60 has more to gain than an 85');
  assert.ok(ceilingFor(60, 1.8, rng()) > ceilingFor(60, 0.4, rng()), 'and a better growth draw reaches further');
  assert.ok(ceilingFor(95, 2.2, rng()) <= 96, 'nobody generated tops out above 96');
});

test('careers advance in the offseason, and only for players under contract', () => {
  const lg = league(31);
  const owned = new Set(lg.teams.flatMap((t) => ROSTER_SLOTS.map((s) => t.slots[s.id]).filter(Boolean)));
  const spare = PLAYERS.find((p) => !owned.has(p.id));
  advanceCareers(lg, index(lg));
  assert.ok(Object.keys(lg.dev).length >= owned.size - 5, 'everyone rostered has a career');
  assert.equal(lg.dev[spare.id], undefined, 'a man nobody signed is untouched');
  const after = index(lg);
  assert.equal(overall(after.get(spare.id)), overall(spare), 'and still sits at his prime');
});

test('a player signed at his prime declines slowly, not off a cliff', () => {
  const lg = league(52);
  // Careers are created on the first advance, so this runs one to bring them
  // into being before choosing a man. A real player enters within two years
  // EITHER SIDE of his prime, so the first name on the roster may still be
  // climbing and is entitled to improve; this took whatever landed in slot one
  // and called it a prime, which held only for as long as the draft kept
  // putting the same man there.
  advanceCareers(lg, index(lg), { season: 1 }); lg.season++;
  const id = ROSTER_SLOTS.map((s) => lg.teams[0].slots[s.id]).filter(Boolean)
    .find((pid) => lg.dev[pid] && lg.dev[pid].age >= primeAge(PLAYERS_BY_ID.get(pid).pos));
  assert.ok(id, 'somebody on the roster is at or past his prime');
  const byId = index(lg);
  const base = PLAYERS_BY_ID.get(id);
  const before = overall(byId.get(id) || base);
  for (let i = 0; i < 3; i++) { advanceCareers(lg, index(lg), { season: i + 2 }); lg.season++; }
  const after = overall(index(lg).get(id) || base);
  assert.ok(after <= before, `should not have improved past his prime: ${before} -> ${after}`);
  assert.ok(before - after <= 8, `three seasons cost ${before - after}, which is a cliff rather than a decline`);
  assert.ok(byId.get(id), 'still in the pool');
});

test('the pool keeps its size when players retire, because codes fingerprint it', () => {
  const lg = league(63);
  const someone = ROSTER_SLOTS.map((s) => lg.teams[0].slots[s.id]).find(Boolean);
  lg.retired = [someone];
  const view = pool(lg);
  assert.equal(view.length, PLAYERS.length, 'a retired man stays in the pool, flagged');
  assert.equal(view.find((p) => p.id === someone).retired, true);
  assert.equal(freeAgents({ ...lg, teams: lg.teams.map((t) => ({ ...t, slots: {}, ir: [] })) }, view).some((p) => p.id === someone), false,
    'but he cannot be signed');
});

test('retiring frees the slot and drops the contract', () => {
  const lg = league(74);
  const slot = ROSTER_SLOTS.find((s) => lg.teams[0].slots[s.id]);
  const id = lg.teams[0].slots[slot.id];
  lg.contracts[id] = { salary: 5, kept: 0, since: 1 };
  const n = releaseRetired(lg, [id]);
  assert.equal(n, 1);
  assert.equal(lg.teams[0].slots[slot.id], null, 'the slot is empty for the market to fill');
  assert.equal(lg.contracts[id], undefined, 'and he is off the books');
});

test('the developed view is idempotent and leaves the shipped pool alone', () => {
  const lg = league(85);
  advanceCareers(lg, index(lg));
  const once = pool(lg);
  const twice = applyCareers(lg, once);
  const id = Object.keys(lg.dev)[0];
  assert.deepEqual(twice.find((p) => p.id === id).r, once.find((p) => p.id === id).r, 'applying twice is applying once');
  assert.deepEqual(PLAYERS_BY_ID.get(id).r, PLAYERS.find((p) => p.id === id).r, 'the shipped player is untouched');
  assert.equal(PLAYERS_BY_ID.get(id).age, undefined, 'no age leaked onto the base pool');
});

test('a dynasty ages, retires and reloads without corrupting a roster', () => {
  const lg = league(96);
  for (let s = 0; s < 5; s++) simulateAhead(lg, index(lg), pool(lg), new RNG(400 + s), 'nextSeason');
  const byId = index(lg);
  const valid = rostersValid(lg, byId);
  assert.ok(valid.ok, valid.reason);
  assert.ok(lg.season >= 6, `reached season ${lg.season}`);
  const ages = Object.values(lg.dev).map((c) => c.age);
  assert.ok(ages.length > 50, 'plenty of careers running');
  assert.ok(Math.max(...ages) > Math.min(...ages) + 4, 'and a real spread of ages');
  // Everyone who is still rostered is somebody a club chose to keep or re-buy.
  for (const t of lg.teams) {
    for (const s of ROSTER_SLOTS) {
      const id = t.slots[s.id];
      if (id) assert.ok(!(lg.retired || []).includes(id), `${id} retired but is still on a roster`);
    }
  }
});

test('careers can be switched off and then nothing ages', () => {
  const lg = league(17, {});
  lg.settings.careers = false;
  const id = ROSTER_SLOTS.map((s) => lg.teams[0].slots[s.id]).find(Boolean);
  const before = overall(PLAYERS_BY_ID.get(id));
  for (let s = 0; s < 3; s++) simulateAhead(lg, index(lg), pool(lg), new RNG(700 + s), 'nextSeason');
  assert.equal(lg.dev, undefined, 'no career state at all');
  assert.equal(overall(index(lg).get(id)), before, 'and he is exactly who he was');
});

test('a save from before careers existed opens and upgrades cleanly', () => {
  const lg = league(23);
  // What an older save looks like: no career state, no tenure ledger, and no
  // setting either way, since both shipped after it was written.
  delete lg.dev; delete lg.retired; delete lg.tenure;
  delete lg.settings.careers; delete lg.settings.chemistry;
  const id = ROSTER_SLOTS.map((s) => lg.teams[0].slots[s.id]).find(Boolean);
  assert.equal(overall(index(lg).get(id)), overall(PLAYERS_BY_ID.get(id)), 'nothing has aged yet');
  const bonuses = chemistryBonuses(lg, index(lg));
  assert.ok(bonuses.every((b) => b === 0), 'nothing is applied to a league that predates the rule');
  // An absent setting is not the same as a true one: a league somebody is
  // halfway through keeps the rules it started with until they say otherwise.
  simulateAhead(lg, index(lg), pool(lg), new RNG(23), 'nextSeason');
  assert.equal(lg.dev, undefined, 'nobody aged behind their back');
  assert.equal(overall(index(lg).get(id)), overall(PLAYERS_BY_ID.get(id)));
  // Turning it on in settings is all it takes.
  lg.settings.careers = true;
  lg.settings.chemistry = true;
  simulateAhead(lg, index(lg), pool(lg), new RNG(24), 'nextSeason');
  assert.ok(Object.keys(lg.dev).length > 50, 'and then careers start');
  assert.ok(chemistryBonuses(lg, index(lg)).some((b) => b !== 0), 'and chemistry starts counting');
});

test('careerPhase reads where a player is rather than just his age', () => {
  assert.equal(careerPhase('RB', 21), 'developing');
  assert.equal(careerPhase('RB', 25), 'in his prime');
  assert.equal(careerPhase('RB', 32), 'declining');
  assert.equal(careerPhase('QB', 32), 'holding on', 'a quarterback at 32 is not a back at 32');
});

test('generated players reach the record books even from a stale index', () => {
  // The bug this guards: season.js keeps a module-level player index, set by
  // registerPlayers, and writes the record books from it. A caller that
  // registered the shipped pool once — every script and test here does — left
  // it without the league's own rookies, and players missing from it were
  // skipped in silence. Awards, the record book and the hall of fame simply had
  // no generated players in them, with nothing to say so.
  registerPlayers(PLAYERS_BY_ID);
  const lg = createLeague({ name: 'R', mode: 'pro', numTeams: 32, franchise: 12, seed: 41, draftType: 'snake', user: {} });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(41));
  startSeason(lg, PLAYERS_BY_ID);
  for (let i = 0; i < 3; i++) simulateAhead(lg, index(lg), pool(lg), new RNG(700 + i), 'nextSeason');

  const rostered = new Set(lg.teams.flatMap((t) => ROSTER_SLOTS.map((s) => t.slots[s.id]).filter(Boolean)));
  const generated = [...rostered].filter((id) => String(id).startsWith('rk-'));
  assert.ok(generated.length > 10, `only ${generated.length} rookies were ever signed`);
  const played = generated.filter((id) => lg.careers?.[id]?.games > 0);
  assert.ok(played.length > 5, `${played.length} of ${generated.length} rostered rookies have a career record`);
  // And they are real records, not empty shells.
  const c = lg.careers[played[0]];
  assert.ok(c.games >= 1 && c.seasons >= 1, JSON.stringify(c));
});

test('a club fields the same number of players whoever they are', () => {
  // Generated players used to be absent from stat accumulation entirely, which
  // is the shape a dropped-index bug takes: not an error, a gap.
  const lg = createLeague({ name: 'F', mode: 'pro', numTeams: 32, franchise: 12, seed: 5, draftType: 'snake', user: {} });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(5));
  startSeason(lg, PLAYERS_BY_ID);
  simulateAhead(lg, index(lg), pool(lg), new RNG(1), 'offseason');
  const counts = lg.teams.map((t) => Object.values(t.seasonStats.players).filter((s) => s.games > 0).length);
  assert.ok(Math.min(...counts) > 20, `a club fielded only ${Math.min(...counts)} players with a stat line`);
  // The human's club is not special: computer clubs keep full season lines too.
  const u = userTeamIndex(lg);
  assert.ok(Math.abs(counts[u] - counts[(u + 1) % 32]) < 12, `your club ${counts[u]} vs an AI club ${counts[(u + 1) % 32]}`);
});
