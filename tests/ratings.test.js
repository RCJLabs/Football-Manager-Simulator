import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POSITIONS, ROSTER_SLOTS } from '../src/data/positions.js';
import {
  overall, rawOverall, forgetOverall, clearOverallCache, buildLineup, composites, teamPower, TRUE_LEVERAGE,
} from '../src/engine/ratings.js';

const player = (id, pos, r, extra = {}) => ({ id, name: id, pos, season: 2000, team: 'XXX', r, ...extra });
const RB = (id, over) => player(id, 'RB', { spd: over, elu: over, pow: over, awr: over, rec: over, car: over });

test('the overall cache is keyed by id, which is the trap it is', () => {
  // This is not a curiosity. The game fingerprint built every synthetic pair as
  // alpha against bravo, so every pair produced the same player ids, and this
  // cache handed the first pair's ratings back for all of them — a 95-against-60
  // blowout reported the same team power as an even matchup. The contract is
  // exactly what bit: same id, same answer, whatever the attributes say.
  clearOverallCache();
  const first = RB('twin', 90);
  const second = RB('twin', 50);
  assert.equal(overall(first), 90);
  assert.equal(overall(second), 90, 'the second player inherits the first one’s cached rating');
  // rawOverall is the way out, and why anything rating loose attributes must use it.
  assert.equal(rawOverall('RB', second.r), 50);
  forgetOverall('twin');
  assert.equal(overall(second), 50, 'forgetting the id lets the truth back in');
  clearOverallCache();
});

test('a player carrying his own ovr never consults the cache', () => {
  clearOverallCache();
  const aged = RB('aged', 80);
  assert.equal(overall(aged), 80);
  // Careers age a man and hand him an `ovr`; two leagues hold the same id at
  // different ages, so his own number has to win over anything remembered.
  const older = { ...aged, ovr: 71 };
  assert.equal(overall(older), 71);
  assert.equal(overall(aged), 80, 'and the cached one is untouched by it');
  clearOverallCache();
});

test('rawOverall weights by the position and treats a missing attribute as 60', () => {
  const w = POSITIONS.QB.weights;
  const r = { thp: 90, tha: 80, awr: 70, mob: 60 };
  const want = Math.round(r.thp * w.thp + r.tha * w.tha + r.awr * w.awr + r.mob * w.mob);
  assert.equal(rawOverall('QB', r), want);
  // A rookie generator or a migration can hand over a short row; 60 is the
  // documented stand-in and silently scoring it as zero would be far worse.
  const { mob, ...short } = r;
  assert.equal(rawOverall('QB', short), Math.round(r.thp * w.thp + r.tha * w.tha + r.awr * w.awr + 60 * w.mob));
});

// Every squad gets its own ids. Reusing them means `overall` serves the first
// squad's cached numbers to all the rest — which is the trap the first test in
// this file is about, and which this helper fell into on the way to being
// written: a bumped quarterback kept reading as the unbumped one.
let squadNo = 0;
function squad(over = 82, overrides = {}) {
  const tag = `sq${squadNo++}`;
  const slots = {}, byId = new Map();
  for (const s of ROSTER_SLOTS) {
    const id = `${tag}-${s.id}`;
    const r = {};
    for (const a of POSITIONS[s.pos].attrs) r[a] = overrides[s.id]?.[a] ?? overrides[s.pos]?.[a] ?? over;
    byId.set(id, player(id, s.pos, r));
    slots[s.id] = id;
  }
  return { slots, byId };
}

test('a lineup follows slot order, and an injury moves the next man up', () => {
  const { slots, byId } = squad();
  const full = buildLineup(slots, byId);
  assert.deepEqual(full.QB.map((p) => p.id), [slots.QB1, slots.QB2], 'depth-chart order is slot order');
  assert.equal(full.WR.length, 4);
  // The ledger is consulted per player, so the hurt man is simply absent and
  // everyone behind him shifts forward — which is what makes a bench matter.
  const hurt = buildLineup(slots, byId, { [slots.QB1]: { weeks: 2 } });
  assert.deepEqual(hurt.QB.map((p) => p.id), [slots.QB2], 'the backup is now first');
  assert.equal(buildLineup(slots, new Map()).QB, undefined, 'a slot pointing at nobody contributes nobody');
});

test('defensive awareness reaches the field, and is neutral at the population it was centred on', () => {
  // It used to be gathered as `defAwr` and consumed by nothing, so two
  // secondaries eight points apart in awareness played identical games.
  const one = squad(82);
  const mid = composites(buildLineup(one.slots, one.byId));
  const base = composites(buildLineup(one.slots, one.byId));
  assert.ok(Number.isFinite(base.covMed));
  // 82 is the mean of the population every constant in plays.js was fitted
  // against, so a squad at 82 must read its coverage straight.
  assert.equal(Math.round(base.covMed), 82, 'an 82-awareness defence is neither helped nor taxed');
  const smart = squad(82, { CB: { cov: 82, awr: 92 }, S: { cov: 82, awr: 92 }, LB: { cov: 82, awr: 92 } });
  const dim = squad(82, { CB: { cov: 82, awr: 72 }, S: { cov: 82, awr: 72 }, LB: { cov: 82, awr: 72 } });
  const cs = composites(buildLineup(smart.slots, smart.byId));
  const cd = composites(buildLineup(dim.slots, dim.byId));
  assert.ok(cs.covMed > base.covMed && base.covMed > cd.covMed, 'coverage tracks awareness in both directions');
  assert.ok(cs.runStop > cd.runStop, 'and a smarter front fits the run better');
  assert.equal(mid.covMed, base.covMed, 'same squad, same answer');
});

test('pass rush leans on the two best rushers rather than the average of four', () => {
  const even = squad(82, { DL: { prs: 82, rsd: 82, tck: 82, awr: 82 } });
  const lop = squad(82, { DL: { prs: 82, rsd: 82, tck: 82, awr: 82 } });
  // Give one front two genuine rushers and two who cannot rush at all, holding
  // the four-man mean where it was.
  for (const [i, slot] of ['DL1', 'DL2', 'DL3', 'DL4'].entries()) {
    lop.byId.get(lop.slots[slot]).r.prs = i < 2 ? 96 : 68;
  }
  const a = composites(buildLineup(even.slots, even.byId));
  const b = composites(buildLineup(lop.slots, lop.byId));
  assert.ok(b.passRush > a.passRush, 'two real rushers beat four average ones at the same mean');
});

test('team power weighs the starters by leverage and ignores the bench', () => {
  const { slots, byId } = squad(80);
  const before = teamPower(buildLineup(slots, byId));
  assert.ok(Math.abs(before - 80) < 0.001, 'a squad of eighties is an eighty');
  // A bench player is not on the field and must not move it. This has to be a
  // SEPARATE squad: mutating the first one's bench after reading it proves
  // nothing, because `overall` has already cached those ids and will keep
  // answering 80 whatever the attributes now say. Written that way first, it
  // passed against a `teamPower` that counted the bench.
  const rich = squad(80);
  for (const s of ROSTER_SLOTS.filter((x) => !x.starter)) {
    for (const a of POSITIONS[s.pos].attrs) rich.byId.get(rich.slots[s.id]).r[a] = 99;
  }
  assert.equal(teamPower(buildLineup(rich.slots, rich.byId)), before, 'the bench does not play');
  // The quarterback is worth the most, so lifting him has to move it more than
  // lifting the kicker by the same amount.
  const bump = (slot) => { const s2 = squad(80); for (const a of POSITIONS[ROSTER_SLOTS.find((x) => x.id === slot).pos].attrs) s2.byId.get(s2.slots[slot]).r[a] = 90; return teamPower(buildLineup(s2.slots, s2.byId)); };
  assert.ok(bump('QB1') > bump('K1'), 'leverage decides whose ten points matter');
  assert.ok(TRUE_LEVERAGE.QB > TRUE_LEVERAGE.K, 'and the table says so out loud');
});
