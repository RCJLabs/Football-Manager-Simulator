// The edge rusher: one linebacker position, two jobs.
//
// A pure edge rusher rated 77 as an off-ball linebacker, because sixty per cent
// of an LB's rating sat in tackling, run fit and coverage -- three things a
// 3-4 outside backer is not paid to do. The fix is two weight vectors blended
// by `edgeness`, plus a pass rush that lets a genuine rusher take a seat off a
// mediocre lineman. Both halves are needed: the rating alone would price a man
// the field still ignored, and the engine alone could not reach him, because at
// 77 he was never drafted to start in the first place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYERS } from '../src/data/db.js';
import { POSITIONS, ROSTER_SLOTS, edgeness, weightsFor, EDGE_SPAN } from '../src/data/positions.js';
import { overall, rawOverall, buildLineup, composites, clearOverallCache } from '../src/engine/ratings.js';

const player = (id, pos, r) => ({ id, name: id, pos, season: 2000, team: 'XXX', r });
let n = 0;
/** A legal 27-slot roster, every attribute at `over` unless overridden. */
function squad(over = 82, overrides = {}) {
  const tag = `eg${n++}`;
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
const comp = (sq) => composites(buildLineup(sq.slots, sq.byId));
const find = (name) => PLAYERS.find((p) => p.name === name);

test('edgeness reads the pool without anybody tagging it', () => {
  // The measure is how much better he rushes than he covers. These are the
  // cases that say it is doing something real rather than fitting a list.
  assert.equal(edgeness('LB', find('Derrick Thomas').r), 1, 'a pure speed rusher');
  assert.equal(edgeness('LB', find('Ray Lewis').r), 0, 'an off-ball linebacker');
  assert.equal(edgeness('LB', find('Luke Kuechly').r), 0, 'a coverage linebacker');
  // Lawrence Taylor is the case worth pinning: chiefly a rusher, but a real
  // linebacker too, and he has to land between the pure rushers and the pure
  // backers without anybody putting him there.
  const lt = edgeness('LB', find('Lawrence Taylor').r);
  assert.ok(lt > 0.5 && lt < 1, `Lawrence Taylor did both jobs, got ${lt}`);
  assert.ok(lt < edgeness('LB', find('Derrick Thomas').r), 'and below a pure speed rusher');
  // Only linebackers have two jobs. Nothing else may be reshaped by this.
  for (const pos of ['DL', 'CB', 'S', 'QB', 'OL']) {
    assert.equal(edgeness(pos, { prs: 99, cov: 40 }), 0, `${pos} has no edge variant`);
  }
});

test('a man is rated on whichever job he is better at', () => {
  for (const d of [-40, -1, 0, 1, EDGE_SPAN / 2, EDGE_SPAN, 99]) {
    const r = { prs: 70 + d, cov: 70, tck: 70, rsd: 70, awr: 70, spd: 70 };
    const w = weightsFor('LB', r);
    assert.ok(w === POSITIONS.LB.weights || w === POSITIONS.LB.edgeWeights, 'one of the two, not a mixture');
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum} at prs-cov ${d}`);
  }
  // Every other position hands back its own single vector, untouched.
  assert.deepEqual(weightsFor('DL', { prs: 99 }), POSITIONS.DL.weights);
  assert.deepEqual(weightsFor('QB', { thp: 99 }), POSITIONS.QB.weights);
});

test('improving a player never makes him worse', () => {
  // The reason the rating is a maximum and not a blend. Blending made `overall`
  // non-monotonic in coverage: raising a rusher's `cov` cut his `edgeness`,
  // which moved weight off a vector paying `prs` 0.50 onto one paying 0.05, and
  // a man with `prs` 96 fell from 88 to 84 as his coverage went 67 to 82. The
  // economy reads `overall` as price, so that is a player getting cheaper for
  // getting better, and development, the rating editor and the draft board
  // would every one of them have acted on it.
  const attrs = ['prs', 'cov', 'tck', 'rsd', 'awr', 'spd'];
  const drops = [];
  for (const moving of attrs) {
    for (const prs of [70, 82, 90, 96]) for (const base of [65, 75, 85, 95]) {
      const r = { prs, cov: 70, tck: base, rsd: base, awr: base, spd: base };
      let prev = null;
      for (let v = 45; v <= 99; v++) {
        const o = rawOverall('LB', { ...r, [moving]: v });
        if (prev !== null && o < prev) drops.push(`${moving} ${v - 1}->${v} at prs ${prs} base ${base}: ${prev}->${o}`);
        prev = o;
      }
    }
  }
  assert.deepEqual(drops.slice(0, 5), [], `${drops.length} cases where a better attribute lowered the rating`);
});

test('a rating does not jump as a man grows into a rusher', () => {
  // A stored flag would step here. The blend is why it does not: the economy
  // reads `overall` as price, and a cliff is a man suddenly worth more for
  // having gained a single point.
  let prev = null;
  for (let prs = 60; prs <= 99; prs++) {
    const o = rawOverall('LB', { prs, cov: 70, tck: 80, rsd: 80, awr: 80, spd: 80 });
    if (prev !== null) assert.ok(o - prev <= 2, `overall jumped ${prev} -> ${o} at prs ${prs}`);
    prev = o;
  }
});

test('the edge vector rates him on rushing, the off-ball vector does not', () => {
  const dt = find('Derrick Thomas');
  assert.ok(overall(dt) >= 85, `a hall of famer with the single-game sack record reads ${overall(dt)}`);
  // The same attributes forced through the off-ball vector: what he used to be.
  let offBall = 0;
  for (const k in POSITIONS.LB.weights) offBall += dt.r[k] * POSITIONS.LB.weights[k];
  assert.ok(overall(dt) - offBall > 6, 'the two vectors disagree about him by a wide margin');
  // And a genuine off-ball linebacker is not touched by any of it.
  const lewis = find('Ray Lewis');
  let plain = 0;
  for (const k in POSITIONS.LB.weights) plain += lewis.r[k] * POSITIONS.LB.weights[k];
  assert.equal(overall(lewis), Math.round(plain), 'an off-ball backer is rated on the plain vector');
});

test('an edge backer takes a rushing seat; an off-ball one never does', () => {
  clearOverallCache();
  // Identical rosters except for ONE linebacker, who has the same elite pass
  // rush in both and differs only in coverage -- which is what decides whether
  // he is the man who rushes or the man who drops.
  const base = comp(squad(82));
  const edge = comp(squad(82, { LB1: { prs: 96, cov: 58 } }));
  const offBall = comp(squad(82, { LB1: { prs: 96, cov: 96 } }));

  assert.ok(edge.passRush > base.passRush + 1,
    `an elite edge rusher must move the pass rush (${base.passRush.toFixed(2)} -> ${edge.passRush.toFixed(2)})`);
  assert.ok(Math.abs(offBall.passRush - base.passRush) < 0.01,
    `a covering linebacker's pass rush must not (${base.passRush.toFixed(2)} -> ${offBall.passRush.toFixed(2)})`);

  // Blitzing is the case where everybody rushes, so it is deliberately ungated
  // and BOTH of them move it.
  assert.ok(offBall.blitzRush > base.blitzRush + 0.5, 'a blitz sends the off-ball backer too');
  assert.ok(edge.blitzRush > base.blitzRush + 0.5, 'and the edge rusher');
});

test('the gate applies to linebackers and to nobody else', () => {
  // `edgeness` returns 0 for a lineman, so reading it unconditionally discounted
  // the whole defensive line to the floor and quietly took three points off
  // every pass rush in the game. A flat roster must read flat.
  const flat = comp(squad(82));
  assert.ok(Math.abs(flat.passRush - 82) < 0.01, `a roster of 82s must rush at 82, got ${flat.passRush.toFixed(2)}`);
  // And a better line still rushes better, with no linebacker involved at all.
  const better = comp(squad(82, { DL: { prs: 92 } }));
  assert.ok(better.passRush > flat.passRush + 5, 'the line is still what rushes');
});

test('every edge rusher the record argues for now clears its bar', () => {
  // The twelve names legacy-check reported, and what it said each one needs.
  const BARS = { 'Derrick Thomas': 85, 'Kevin Greene': 84, 'James Harrison': 86, 'Terrell Suggs': 86,
    'DeMarcus Ware': 84, 'Von Miller': 84, 'Andre Tippett': 84, 'Micah Parsons': 84,
    'Cornelius Bennett': 84, 'Bryce Paup': 86, 'Khalil Mack': 84, 'T.J. Watt': 86 };
  const short = [];
  for (const [name, bar] of Object.entries(BARS)) {
    const p = find(name);
    assert.ok(p, `${name} is in the pool`);
    if (overall(p) < bar) short.push(`${name} ${overall(p)} < ${bar}`);
  }
  assert.deepEqual(short, [], 'edge rushers still under what the record supports');
});

test('an edge rusher is not charged for coverage he is not doing', () => {
  clearOverallCache();
  // Two rosters whose LB1 covers equally badly. In one he is an edge rusher, so
  // he is rushing on a passing down and the defence does not lean on him to
  // cover; in the other he is an off-ball backer who simply cannot cover, and
  // the defence pays for it. Same `cov`, different job.
  const base = comp(squad(82));
  const rusher = comp(squad(82, { LB1: { prs: 96, cov: 58 } }));
  const liability = comp(squad(82, { LB1: { prs: 60, cov: 58 } }));

  assert.ok(liability.covShort < base.covShort - 1,
    `a backer who cannot cover hurts the defence (${base.covShort.toFixed(2)} -> ${liability.covShort.toFixed(2)})`);
  assert.ok(rusher.covShort > liability.covShort + 1,
    `the same coverage costs less when he is the one rushing (${liability.covShort.toFixed(2)} vs ${rusher.covShort.toFixed(2)})`);
});

test('a front of nothing but rushers still has to cover somebody', () => {
  clearOverallCache();
  const base = comp(squad(82));
  const allEdge = comp(squad(82, { LB: { prs: 96, cov: 58 } }));
  assert.ok(allEdge.covShort < base.covShort - 1,
    `three rushers must still be a coverage problem (${base.covShort.toFixed(2)} -> ${allEdge.covShort.toFixed(2)})`);
  assert.ok(allEdge.passRush > base.passRush + 1, 'while genuinely rushing better');
});

test('a nearly-all-rusher front cannot cover on the strength of its last man', () => {
  clearOverallCache();
  // What `OFF_BALL_MIN` is actually for, which the all-rushers case above does
  // NOT catch: with every backer saturated the weights are uniformly zero and a
  // weighted mean degenerates to the plain one anyway, so removing the floor
  // changes nothing there. The floor bites when the weights are UNEQUAL and
  // small -- two pure rushers and one man who is 70% rusher. Without it the
  // defence's linebacker coverage would be read entirely off that last man,
  // letting a front of three rushers cover as though only he were on the field.
  const thin = comp(squad(82, {
    LB1: { prs: 96, cov: 58 },   // edgeness 1.00, weight 0
    LB2: { prs: 96, cov: 58 },   // edgeness 1.00, weight 0
    LB3: { prs: 91, cov: 70 },   // edgeness 0.70, weight 0.30 -> total 0.30, under the floor
  }));
  // Below the floor the plain mean is what you get: roughly (58 + 58 + 70) / 3,
  // not the 70 of the only man carrying any weight.
  assert.ok(thin.covShort < 82, `a front of rushers must not cover like a full corps, got ${thin.covShort.toFixed(2)}`);
  const lone = 0.4 * 82 + 0.35 * 70 + 0.25 * 82;
  assert.ok(thin.covShort < lone - 1,
    `coverage must not be read off the last off-ball man alone (${thin.covShort.toFixed(2)} vs ${lone.toFixed(2)})`);
});
