import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, step } from '../src/engine/game.js';

const A = syntheticTeam('alpha', 84, 3, 1);
const B = syntheticTeam('bravo', 84, 3, 2);
const LA = buildLineup(A.slots, A.byId);
const LB = buildLineup(B.slots, B.byId);

/** One situation, one pairing, held fixed. Returns yards and conversion rate. */
function snap(off, def, { down, toGo, ballOn }, n = 500) {
  const g = createGame({ ...A, lineup: LA }, { ...B, lineup: LB }, { seed: 4242, penalties: false, homeAdvantage: false });
  step(g);
  let yards = 0, plays = 0, got = 0;
  while (plays < n && !g.final) {
    g.quarter = 1; g.clock = 900; g.phase = 'play'; g.possession = 0;
    g.down = down; g.toGo = toGo; g.ballOn = ballOn;
    g.score = [0, 0]; g.clockRunning = false; g.drive = null;
    const from = g.log.length;
    step(g, { off, def });
    const e = g.log.slice(from).find((x) => x.from != null);
    if (!e) continue;
    plays++;
    yards += e.yards || 0;
    if ((e.yards || 0) >= toGo && e.type !== 'int' && e.type !== 'fumble') got++;
  }
  return { ypp: yards / plays, rate: got / plays };
}

test('the stacked box earns its place on third and short', () => {
  // Solving first and ten alone says a stacked box is never worth calling.
  // That is a claim about first down: it is a third-and-one call, and at first
  // down nobody is running into it. `scripts/situational-grid.mjs` has the
  // whole table; this holds the shape that finding rests on.
  const third1 = { down: 3, toGo: 1, ballOn: 50 };
  const rates = Object.fromEntries(['base', 'run_stop', 'blitz', 'deep']
    .map((d) => [d, snap('run_in', d, third1).rate]));
  const worst = Object.entries(rates).sort((a, b) => a[1] - b[1])[0][0];
  assert.equal(worst, 'run_stop', `the run converts worst against ${worst}, not a stacked box`);
  assert.ok(rates.run_stop < rates.deep - 0.1,
    `stacked box ${(rates.run_stop * 100).toFixed(0)}% against a shell's ${(rates.deep * 100).toFixed(0)}%`);
  // And it is a trade, not a free stop: the pass converts better against it.
  assert.ok(snap('pass_short', 'run_stop', third1).rate > rates.run_stop,
    'a stacked box should be throwable on third and one');
});

test('the blitz earns its place where there is no room behind it', () => {
  // In a compressed field the deep ball has nowhere to go, so the thing a blitz
  // sells — coverage over the top — is not worth anything, and the pressure it
  // buys is. It is the defence's call at first and goal.
  const goal = { down: 1, toGo: 6, ballOn: 94 };
  const open = { down: 1, toGo: 10, ballOn: 25 };
  // Two thousand snaps each: against the quick game the blitz buys less than
  // it did, a fifth of a yard rather than a third, since sacks on early downs
  // came down to the real rate and some pressure now ends in a throwaway
  // (DESIGN.md, "The drive model, held to real play-by-play").
  for (const call of ['pass_short', 'pass_med', 'pa_pass']) {
    assert.ok(snap(call, 'blitz', goal, 2000).ypp < snap(call, 'base', goal, 2000).ypp,
      `${call} should suffer from a blitz inside the six`);
  }
  // Out in the open the same blitz is a gamble rather than a stop.
  assert.ok(snap('screen', 'blitz', open).ypp > snap('screen', 'base', open).ypp + 2,
    'a screen should punish a blitz in the open field');
});

test('a third and long is a different game from a third and one', () => {
  // `passingDown()` only bites from third down and scales with the distance, so
  // the same call is worth very different things at either end of it.
  const short = snap('run_in', 'base', { down: 3, toGo: 1, ballOn: 50 });
  const long = snap('run_in', 'base', { down: 3, toGo: 12, ballOn: 50 });
  assert.ok(short.rate > 0.6, `third and one converted only ${(short.rate * 100).toFixed(0)}% on the ground`);
  assert.ok(long.rate < 0.15, `third and twelve converted ${(long.rate * 100).toFixed(0)}% on the ground`);
  // The pass is the other way round.
  const pShort = snap('pass_med', 'base', { down: 3, toGo: 1, ballOn: 50 });
  const pLong = snap('pass_med', 'base', { down: 3, toGo: 12, ballOn: 50 });
  assert.ok(pShort.rate < short.rate, 'the run should win third and one');
  assert.ok(pLong.rate > long.rate, 'the pass should win third and twelve');
});

test('second and seven is first and ten to this engine, and that is on purpose', () => {
  // Down reaches a play only through `passingDown()`, which starts at third, and
  // through short yardage. So a second and seven resolves exactly like a first
  // and ten — the difference between them is which plays get called, which is
  // `chooseOffense`'s job, not the resolver's. Worth a test so that nobody
  // reads the situational grid and files it as a bug.
  const a = snap('pass_med', 'base', { down: 1, toGo: 10, ballOn: 35 });
  const b = snap('pass_med', 'base', { down: 2, toGo: 7, ballOn: 35 });
  assert.ok(Math.abs(a.ypp - b.ypp) < 0.35, `1st & 10 gave ${a.ypp.toFixed(2)}, 2nd & 7 gave ${b.ypp.toFixed(2)}`);
});
