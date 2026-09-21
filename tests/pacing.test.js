import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, step } from '../src/engine/game.js';
import { paceDelay, isBeat, PACE } from '../src/ui/views/game.js';

const A = syntheticTeam('alpha', 86, 3, 1);
const B = syntheticTeam('bravo', 84, 3, 2);
const LA = buildLineup(A.slots, A.byId);
const LB = buildLineup(B.slots, B.byId);
const mk = (seed) => createGame({ ...A, lineup: LA }, { ...B, lineup: LB }, { seed });

test('the pace rises with the swing and is clamped at both ends', () => {
  const base = 900;
  const flat = paceDelay(base, 0, false);
  assert.equal(flat, Math.round(base * PACE.MIN), 'nothing happened sits at the floor');
  assert.ok(flat >= 450, `${flat}ms is too fast to read a play`);

  // Monotonic: a bigger swing is never held for less time.
  let last = 0;
  for (const d of [0, 0.005, 0.02, 0.05, 0.1, 0.2, 0.5]) {
    const ms = paceDelay(base, d, false);
    assert.ok(ms >= last, `${d} held ${ms}ms, less than the swing below it`);
    last = ms;
  }
  assert.equal(paceDelay(base, 1, false), paceDelay(base, PACE.FULL, false), 'saturates at FULL');
  assert.equal(paceDelay(base, -0.3, false), paceDelay(base, 0.3, false), 'direction does not matter');

  // A beat is a floor, never a cap: a pick-six is not slowed to the beat.
  assert.ok(paceDelay(base, 0, true) > paceDelay(base, 0, false));
  assert.equal(paceDelay(base, 0.5, true), paceDelay(base, 0.5, false));

  // Neither end of the speed slider becomes a flicker or a slideshow.
  assert.equal(paceDelay(200, 0, false), PACE.FLOOR_MS);
  assert.equal(paceDelay(3000, 0.5, false), PACE.CEIL_MS);
  assert.equal(paceDelay(undefined, 0, false), Math.round(900 * PACE.MIN), 'falls back to the default');
});

test('a beat is a score that is not a routine extra point, a turnover, or a period ending', () => {
  assert.ok(isBeat({ type: 'pass', scoring: true }));
  assert.ok(isBeat({ type: 'int' }));
  assert.ok(isBeat({ type: 'fumble' }));
  assert.ok(isBeat({ type: '2pt', scoring: true }));
  assert.ok(isBeat({ type: 'quarter' }));
  assert.ok(!isBeat({ type: 'xp', scoring: true }), 'an extra point is the dullest score there is');
  assert.ok(!isBeat({ type: 'run', yards: 4 }));
  assert.ok(!isBeat({ type: 'drive' }));
  assert.ok(!isBeat(null));
});

test('pacing redistributes the time rather than adding any', () => {
  // The speed slider has to keep meaning what it says, so the mean delay over a
  // real game must stay on the player's setting. Without this the curve can be
  // retuned into something that quietly doubles how long a game takes.
  const base = 900;
  let total = 0, steps = 0, beats = 0, floors = 0, held = 0, longest = 0;
  for (let seed = 9000; seed < 9020; seed++) {
    const g = mk(seed);
    let prev = 0.5, guard = 0;
    while (!g.final && guard++ < 2000) {
      const from = g.log.length;
      step(g);
      const wp = typeof g.lastEvent?.wp === 'number' ? g.lastEvent.wp : prev;
      const delta = wp - prev;
      prev = wp;
      const beat = g.log.slice(from).some(isBeat);
      const ms = paceDelay(base, delta, beat);
      total += ms; steps++;
      if (beat) beats++;
      if (ms === Math.round(base * PACE.MIN)) floors++;
      if (ms >= 2000) held++;
      longest = Math.max(longest, ms);
    }
  }
  assert.ok(steps > 2000, `only ${steps} snaps sampled`);
  const mean = total / steps;
  assert.ok(Math.abs(mean / base - 1) < 0.1, `mean ${mean.toFixed(0)}ms against a ${base}ms setting`);
  // And it really is spread out, not a flat interval wearing a curve.
  assert.ok(floors / steps > 0.1, `only ${(floors / steps * 100).toFixed(0)}% of snaps at the floor`);
  assert.ok(held > 0, 'nothing was ever held for two seconds');
  assert.ok(longest > base * 2, `longest hold was only ${longest}ms`);
  assert.ok(beats / steps > 0.03 && beats / steps < 0.2, `${(beats / steps * 100).toFixed(1)}% of snaps carried a beat`);
});
