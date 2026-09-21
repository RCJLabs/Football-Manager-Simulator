import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, step } from '../src/engine/game.js';
import { CALL_GRID, matchup, OFFENSE_CALLS, DEFENSE_CALLS } from '../src/engine/playcall.js';

const DEF = Object.keys(DEFENSE_CALLS);

test('the grid covers every call that can be defended, and nothing else', () => {
  for (const off of Object.keys(CALL_GRID)) {
    assert.ok(OFFENSE_CALLS[off], `${off} is not an offensive call`);
    assert.notEqual(OFFENSE_CALLS[off].kind, 'special', `${off} is a kick, nobody calls a defence against it`);
    assert.deepEqual(Object.keys(CALL_GRID[off]).sort(), DEF.slice().sort(), `${off} row`);
    for (const d of DEF) assert.ok(CALL_GRID[off][d] > 0, `${off} vs ${d}`);
  }
  // Every non-special call has a row: a call in the panel with no matchup would
  // silently render a blank chip.
  for (const [k, v] of Object.entries(OFFENSE_CALLS)) {
    if (v.kind === 'special') assert.equal(CALL_GRID[k], undefined, `${k} should not be in the grid`);
    else assert.ok(CALL_GRID[k], `${k} is missing from the grid`);
  }
});

test('matchup reads the grid and refuses what it cannot judge', () => {
  assert.equal(matchup('fg', 'base'), null, 'nobody defends a field goal');
  assert.equal(matchup('kneel', 'base'), null);
  assert.equal(matchup('pass_med', 'nonsense'), null);
  assert.equal(matchup('nonsense', 'base'), null);

  for (const off of Object.keys(CALL_GRID)) {
    // The neutral look is the reference, so it is always exactly zero and says
    // so in words rather than showing a chip reading +0.0.
    const straight = matchup(off, 'base');
    assert.equal(straight.delta, 0, `${off} vs base`);
    assert.equal(straight.verdict, 'straight');
    const ranks = DEF.map((d) => matchup(off, d).rank).sort();
    assert.deepEqual(ranks, [1, 2, 3, 4], `${off} ranks`);
  }
  // Best gets rank 1 and a positive delta; worst gets the last rank, negative.
  const best = matchup('pass_deep', 'run_stop');
  const worst = matchup('pass_deep', 'deep');
  assert.equal(best.rank, 1);
  assert.equal(worst.rank, 4);
  assert.ok(best.delta > 0 && worst.delta < 0);
  assert.equal(best.verdict, 'won');
  assert.equal(worst.verdict, 'lost');
  // The reads a player is meant to learn, in both directions.
  assert.equal(matchup('screen', 'blitz').verdict, 'won', 'the screen is the answer to a blitz');
  assert.equal(matchup('run_in', 'run_stop').verdict, 'pinched', 'a stacked box eats the inside run');
  assert.equal(matchup('pa_pass', 'run_stop').verdict, 'won', 'play action punishes a run-committed defence');
  // A look that changes nothing says so rather than dressing up a rounding
  // error: a blitz is the quick game's own answer, so it barely moves it.
  assert.equal(matchup('pass_short', 'blitz').verdict, 'even');
  assert.equal(matchup('pass_short', 'deep').verdict, 'lost', 'five underneath is the quick game\'s counter');
});

test('the grid still matches what the engine does', () => {
  // The grid is measured, so it can drift silently when the matrix in
  // game/plays.js changes. This does not re-measure it — 3,000 snaps a cell is
  // a script, not a test — but it checks the shape the display depends on: that
  // the best look for a call really is better than the worst, by a margin a
  // short sample can see. `scripts/call-grid.mjs` regenerates the numbers.
  const A = syntheticTeam('alpha', 84, 3, 1);
  const B = syntheticTeam('bravo', 84, 3, 2);
  const LA = buildLineup(A.slots, A.byId);
  const LB = buildLineup(B.slots, B.byId);
  const ypp = (off, def, n) => {
    const g = createGame({ ...A, lineup: LA }, { ...B, lineup: LB }, { seed: 4242, penalties: false });
    step(g);
    let yards = 0, plays = 0;
    while (plays < n && !g.final) {
      g.quarter = 1; g.clock = 900; g.phase = 'play'; g.down = 1; g.toGo = 10;
      g.ballOn = 25; g.score = [0, 0]; g.clockRunning = false; g.drive = null;
      const from = g.log.length;
      step(g, { off, def });
      const e = g.log.slice(from).find((x) => x.from != null);
      if (!e) continue;
      plays++; yards += e.yards || 0;
    }
    return yards / plays;
  };
  let checked = 0;
  for (const off of Object.keys(CALL_GRID)) {
    const row = CALL_GRID[off];
    const vals = DEF.map((d) => row[d]);
    if (Math.max(...vals) - Math.min(...vals) < 2) continue; // pass_short is flat by design
    const best = DEF[vals.indexOf(Math.max(...vals))];
    const worst = DEF[vals.indexOf(Math.min(...vals))];
    const gotBest = ypp(off, best, 500);
    const gotWorst = ypp(off, worst, 500);
    assert.ok(gotBest > gotWorst, `${off}: the grid says ${best} beats ${worst}, the engine gave ${gotBest.toFixed(2)} vs ${gotWorst.toFixed(2)} — re-run scripts/call-grid.mjs`);
    checked++;
  }
  assert.ok(checked >= 5, `only ${checked} rows had enough spread to check`);
});

test('every call has a look that counters it, so every call is a decision', () => {
  // A row that is flat across all four defences is a call with nothing to read:
  // the short pass used to span 0.75 yards, so no defensive guess changed it
  // either way and the chip could never teach anything about it.
  for (const [call, row] of Object.entries(CALL_GRID)) {
    const vals = DEF.map((d) => row[d]);
    assert.ok(Math.max(...vals) - Math.min(...vals) >= 2,
      `${call} spans only ${(Math.max(...vals) - Math.min(...vals)).toFixed(2)} yards — no defence changes it`);
    // And somewhere in the row the chip has to say something other than "that
    // changed almost nothing". Which direction does not matter: a stacked box
    // eating the run is a downside read, a screen punishing a blitz is an
    // upside one, and the medium pass earns its keep by being merely good
    // everywhere — its biggest swing is 1.8 yards and it is still a decision.
    const verdicts = DEF.map((d) => matchup(call, d).verdict);
    assert.ok(verdicts.some((v) => v !== 'even' && v !== 'straight'),
      `${call} reads as even against all four looks`);
  }
});

test('the two committed looks divide the playbook between them', () => {
  // Stack the box is the answer to the run, the two-high shell is the answer to
  // the pass, and each is beaten by what the other stops. A blitz counters
  // nothing — it is a gamble, not a read — and base is the reference.
  const worstFor = (call) => {
    const vals = DEF.map((d) => CALL_GRID[call][d]);
    return DEF[vals.indexOf(Math.min(...vals))];
  };
  for (const run of ['run_in', 'run_out']) assert.equal(worstFor(run), 'run_stop', `${run} should fear a stacked box`);
  for (const pass of ['screen', 'pass_short', 'pass_med', 'pass_deep', 'pa_pass']) {
    assert.equal(worstFor(pass), 'deep', `${pass} should fear a two-high shell`);
  }
  // And each look pays for what it gives up: the run punishes the shell, the
  // deep ball punishes the stacked box.
  assert.equal(matchup('run_out', 'deep').verdict, 'won');
  assert.equal(matchup('pass_deep', 'run_stop').verdict, 'won');
});
