import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, step } from '../src/engine/game.js';
import { wantsTimeout, isHurryUp, CALL_GRID, matchup } from '../src/engine/playcall.js';

const A = syntheticTeam('alpha', 84, 3, 1);
const B = syntheticTeam('bravo', 84, 3, 2);
const LA = buildLineup(A.slots, A.byId);
const LB = buildLineup(B.slots, B.byId);
/** A second-quarter snapshot: seconds left, our lead, our spot. */
const q2 = (clock, lead, ballOn) => {
  const g = createGame({ ...A, lineup: LA }, { ...B, lineup: LB }, { seed: 1, homeAdvantage: false });
  g.quarter = 2; g.clock = clock; g.phase = 'play'; g.possession = 0;
  g.ballOn = ballOn; g.down = 1; g.toGo = 10; g.score = [14 + lead, 14];
  g.clockRunning = true; g.timeouts = [3, 3]; g.drive = null; g.drives = [];
  return g;
};

test('before half the clock is stopped on position and time, not on the score', () => {
  // The rule this replaces required a lead of no more than a field goal, so a
  // club up seven took the two-minute drill off: 1.00 point and a 79.0% win
  // rate over 400 games, against 3.32 and 89.0% for spending them.
  for (const lead of [-14, -7, 0, 3, 7, 14, 21]) {
    assert.equal(wantsTimeout(q2(50, lead, 60), 0), true, `leading by ${lead} on the opponent's 40`);
  }
  // Still gated on having something to gain.
  assert.equal(wantsTimeout(q2(50, 7, 20), 0), false, 'deep in our own half there is nothing to buy');
  assert.equal(wantsTimeout(q2(600, 7, 60), 0), false, 'ten minutes left is not a two-minute drill');
  assert.equal(wantsTimeout(q2(50, 7, 60), 1), false, 'the defence does not stop the clock before half');
  // And on having one to spend.
  const spent = q2(50, 7, 60);
  spent.timeouts = [0, 3];
  assert.equal(wantsTimeout(spent, 0), false);
});

test('a lead is a reason to sit on the ball in our own half, not across midfield', () => {
  assert.equal(isHurryUp(q2(90, 14, 60), 0), true, 'up fourteen in field-goal range, still hurry');
  assert.equal(isHurryUp(q2(90, 14, 20), 0), false, 'up fourteen on our own 20, sit on it');
  // Trailing or close, the old behaviour is unchanged wherever we are.
  assert.equal(isHurryUp(q2(90, -7, 20), 0), true);
  assert.equal(isHurryUp(q2(90, 0, 20), 0), true);
  assert.equal(isHurryUp(q2(90, 7, 20), 0), true);
  assert.equal(isHurryUp(q2(300, 14, 60), 0), false, 'five minutes left is not the end of the half');
});

test('a two-high shell is the look that rewards running', () => {
  // The defect this fixes: no defensive call rewarded a run. The medium pass
  // beat both runs against all four looks, so at first down there was never a
  // reason to hand the ball off.
  const deepCol = Object.entries(CALL_GRID).map(([call, row]) => [call, row.deep]).sort((a, b) => b[1] - a[1]);
  assert.equal(deepCol[0][0], 'run_out', `the best call against a shell is ${deepCol[0][0]}`);
  assert.ok(CALL_GRID.run_out.deep > CALL_GRID.pass_med.deep, 'the outside run beats the medium pass');
  assert.ok(CALL_GRID.run_out.deep > CALL_GRID.pa_pass.deep, 'and beats play action, whose fake a deep shell ignores');
  assert.equal(matchup('run_out', 'deep').verdict, 'won');
  assert.equal(matchup('run_in', 'deep').verdict, 'won');

  // And a stacked box still eats the run, so it is a trade rather than a gift.
  assert.ok(CALL_GRID.run_in.run_stop < CALL_GRID.run_in.base);
  assert.equal(matchup('run_in', 'run_stop').verdict, 'pinched');

  // No call beats the outside run against every defence any more.
  const DEF = ['base', 'run_stop', 'blitz', 'deep'];
  for (const [call, row] of Object.entries(CALL_GRID)) {
    if (call === 'run_out') continue;
    assert.ok(DEF.some((d) => row[d] <= CALL_GRID.run_out[d] + 0.15),
      `${call} still beats the outside run against every defence`);
  }
});

test('the run still owns short yardage, which the yards table cannot show', () => {
  const convert = (call, toGo, n = 400) => {
    const g = createGame({ ...A, lineup: LA }, { ...B, lineup: LB }, { seed: 4242, penalties: false, homeAdvantage: false });
    step(g);
    let got = 0, plays = 0;
    while (plays < n && !g.final) {
      g.quarter = 1; g.clock = 900; g.phase = 'play'; g.possession = 0;
      g.down = 3; g.toGo = toGo; g.ballOn = 45; g.score = [0, 0]; g.clockRunning = false; g.drive = null;
      const from = g.log.length;
      step(g, { off: call, def: 'base' });
      const e = g.log.slice(from).find((x) => x.from != null);
      if (!e) continue;
      plays++;
      if ((e.yards || 0) >= toGo && e.type !== 'int' && e.type !== 'fumble') got++;
    }
    return got / plays;
  };
  const run = convert('run_in', 1);
  const pass = convert('pass_med', 1);
  assert.ok(run > pass + 0.1, `3rd & 1: the run converted ${(run * 100).toFixed(0)}%, the pass ${(pass * 100).toFixed(0)}%`);
  // The relationship inverts once there is real distance to make up.
  const runLong = convert('run_in', 8);
  const passLong = convert('pass_med', 8);
  assert.ok(passLong > runLong + 0.1, `3rd & 8: the pass converted ${(passLong * 100).toFixed(0)}%, the run ${(runLong * 100).toFixed(0)}%`);
});
