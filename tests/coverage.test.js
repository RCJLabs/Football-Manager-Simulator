// Deep coverage is partly a footrace.
//
// A corner's `spd` reached the simulation only through `defSpeed`, and every
// use of that is clamped to `Math.max(0, receiver.spd - defSpeed)` — so once a
// secondary is fast enough, more speed does nothing. Measured on the
// calibration population, the receiver is the faster man in 38% of matchups,
// leaving a corner's speed inert in the other 62%. What was missing is that
// speed never helped him COVER: two corners with the same `cov` and four tenths
// between them covered a post identically. Wiring it lifted `spd` from 0.094 of
// a corner's measured leverage to 0.141, against the 0.170 he is priced at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POSITIONS, ROSTER_SLOTS } from '../src/data/positions.js';
import { buildLineup, composites, clearOverallCache } from '../src/engine/ratings.js';

const player = (id, pos, r) => ({ id, name: id, pos, season: 2000, team: 'XXX', r });
let n = 0;
function squad(over = 82, overrides = {}) {
  const tag = `cv${n++}`;
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

test('a faster secondary covers deep better, at equal coverage', () => {
  clearOverallCache();
  // The exact case that was invisible: same `cov`, different legs.
  const slow = comp(squad(82, { CB: { spd: 70 }, S: { spd: 70 } }));
  const fast = comp(squad(82, { CB: { spd: 94 }, S: { spd: 94 } }));
  assert.ok(fast.covDeep > slow.covDeep + 3,
    `legs must matter deep (${slow.covDeep.toFixed(2)} -> ${fast.covDeep.toFixed(2)})`);
  // Coverage is unchanged, so this is speed doing it and nothing else.
  assert.equal(Math.round(slow.covShort), Math.round(comp(squad(82)).covShort),
    'a slow secondary with the same cov is unchanged underneath');
});

test('speed is wired to the deep ball, not to the flat', () => {
  clearOverallCache();
  // A quick slant is not a footrace. Only `covDeep` was given the term, so the
  // short and medium composites must be untouched by legs alone.
  const base = comp(squad(82));
  const fast = comp(squad(82, { CB: { spd: 96 }, S: { spd: 96 } }));
  assert.ok(Math.abs(fast.covShort - base.covShort) < 0.01, 'short coverage is not a footrace');
  assert.ok(Math.abs(fast.covMed - base.covMed) < 0.01, 'nor is the intermediate');
  assert.ok(fast.covDeep > base.covDeep + 2, 'but deep is');
});

test('an ordinary secondary sits where the calibration left it', () => {
  clearOverallCache();
  // Centred on 82, the mean of the population every engine constant was fitted
  // against. Centring on the wrong population has moved scoring in this engine
  // twice; the term must be worth exactly nothing at the centre.
  const mid = comp(squad(82));
  const plain = 0.5 * 82 + 0.4 * 82 + 0.1 * 82;
  assert.ok(Math.abs(mid.covDeep - plain) < 0.01,
    `covDeep at the centre must read ${plain}, got ${mid.covDeep.toFixed(3)}`);
});

test('the corner carries more of the footrace than the safety', () => {
  clearOverallCache();
  // 0.6 / 0.4. The corner is the man on the receiver; the safety is help.
  const base = comp(squad(82));
  const cbFast = comp(squad(82, { CB: { spd: 94 } }));
  const sFast = comp(squad(82, { S: { spd: 94 } }));
  assert.ok(cbFast.covDeep > base.covDeep, 'a fast corner helps');
  assert.ok(sFast.covDeep > base.covDeep, 'a fast safety helps');
  assert.ok(cbFast.covDeep > sFast.covDeep, 'and the corner helps more');
});
