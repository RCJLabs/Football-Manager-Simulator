// The play board's reading of a game (engine/tendencies.js): the down and
// distance each snap was called on, read back from the log; the situation it
// belongs to; the points it added; and the tallies the board prints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, simulateGame, step } from '../src/engine/game.js';
import { CALL_GRID, OFFENSE_CALLS, DEFENSE_CALLS } from '../src/engine/playcall.js';
import { expectedPoints } from '../src/engine/winprob.js';
import {
  SITUATIONS, situationKey, snapState, pointsAdded, readSnaps, defenceTendency, offenceTendency, callGrid,
} from '../src/engine/tendencies.js';

const A = syntheticTeam('alpha', 86, 3, 1);
const B = syntheticTeam('bravo', 84, 3, 2);
const LA = buildLineup(A.slots, A.byId);
const LB = buildLineup(B.slots, B.byId);
const mk = (seed) => createGame({ ...A, lineup: LA }, { ...B, lineup: LB }, { seed });
const GAMES = Array.from({ length: 40 }, (_, i) => simulateGame(mk(500 + i)));
const ep = (spot, down = 1, toGo = 10) => expectedPoints(spot, down, toGo);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} against ${b}`);

test('the down and distance read back from a play are the ones it was called on, on every snap', () => {
  let snaps = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const g = mk(seed);
    while (!g.final) {
      const at = g.phase === 'play' ? { down: g.down, toGo: g.toGo, ballOn: g.ballOn, off: g.possession } : null;
      const from = g.log.length;
      step(g);
      for (const e of g.log.slice(from)) {
        if (e.from == null || !e.situation) continue;
        snaps++;
        const read = snapState(e);
        assert.ok(at, `a snap was logged out of a ${g.phase} phase: ${e.situation}`);
        assert.deepEqual(read, { down: at.down, toGo: at.toGo, ballOn: at.ballOn }, e.situation);
        assert.equal(e.snapOff, at.off);
      }
    }
  }
  assert.ok(snaps > 3000, `only ${snaps} snaps checked`);
});

test('a goal-to-go snap reads its distance from the spot, and anything else reads as no snap', () => {
  assert.deepEqual(snapState({ situation: 'Q2 1:10 · 1st & Goal at NE 6', from: 94 }), { down: 1, toGo: 6, ballOn: 94 });
  assert.deepEqual(snapState({ situation: 'Q4 0:30 · 4th & 12 at DAL 45', from: 45 }), { down: 4, toGo: 12, ballOn: 45 });
  assert.equal(snapState({ type: 'drive', text: 'Dallas ball at DAL 25.' }), null);
  assert.equal(snapState({ situation: 'Q1 15:00 · 1st & 10 at DAL 25' }), null, 'no spot, no snap');
  assert.equal(snapState(null), null);
});

test('the situations follow what the AI leans on, the goal line first', () => {
  const cases = [
    [{ down: 1, toGo: 10, ballOn: 25 }, 'first'],
    [{ down: 1, toGo: 5, ballOn: 95 }, 'goal'],
    [{ down: 3, toGo: 2, ballOn: 92 }, 'goal'],
    [{ down: 2, toGo: 2, ballOn: 40 }, 'short'],
    [{ down: 4, toGo: 1, ballOn: 60 }, 'short'],
    [{ down: 2, toGo: 3, ballOn: 40 }, 'second'],
    [{ down: 2, toGo: 15, ballOn: 40 }, 'second'],
    [{ down: 3, toGo: 3, ballOn: 40 }, 'medium'],
    [{ down: 3, toGo: 6, ballOn: 40 }, 'medium'],
    [{ down: 3, toGo: 7, ballOn: 40 }, 'long'],
    [{ down: 4, toGo: 9, ballOn: 40 }, 'long'],
  ];
  for (const [at, key] of cases) assert.equal(situationKey(at), key, JSON.stringify(at));
  assert.deepEqual(SITUATIONS.map((s) => s.key).sort(), ['first', 'goal', 'long', 'medium', 'second', 'short']);
});

test('points added: the state a play left less the one it started from, a score and a turnover priced as the fourth-down arithmetic prices them', () => {
  const sit = 'Q1 10:00 · 3rd & 5 at AAA 40';
  const start = ep(40, 3, 5);
  const e = (fields, score = [0, 0]) => ({ situation: sit, from: 40, snapOff: 0, score, ...fields });
  close(pointsAdded(e({ type: 'pass', ballOn: 46, down: 1, toGo: 10 })), ep(46) - start, 'a first down');
  close(pointsAdded(e({ type: 'run', ballOn: 42, down: 4, toGo: 3 })), ep(42, 4, 3) - start, 'short of it');
  close(pointsAdded(e({ type: 'pass', ballOn: 100, down: 3, toGo: 5 }, [6, 0])), 7 - ep(25) - start, 'a touchdown');
  close(pointsAdded(e({ type: 'int', at: 55, ret: 100 }, [0, 6])), -(7 - ep(25)) - start, 'a pick-six');
  close(pointsAdded(e({ type: 'sack', yards: -41 }, [0, 2])), -2 - ep(25) - start, 'a safety');
  close(pointsAdded(e({ type: 'int', at: 60, ret: 10 })), -ep(50) - start, 'an interception returned to midfield');
  close(pointsAdded(e({ type: 'int', at: 102, ret: 0 })), -ep(20) - start, 'a touchback');
  close(pointsAdded(e({ type: 'fumble', yards: 8, ret: 3 })), -ep(55) - start, 'a fumble at the 48 run back three');
  // The score before counts: points already on the board are not this play's.
  close(pointsAdded(e({ type: 'pass', ballOn: 46, down: 1, toGo: 10 }, [13, 7]), [13, 7]), ep(46) - start, 'with a score on the board');
  // Fourth down, short: logged before the ball changes hands, as a fifth down.
  const fourth = { situation: 'Q3 2:00 · 4th & 2 at AAA 45', from: 45, snapOff: 0, score: [0, 0], type: 'run', ballOn: 46, down: 5, toGo: 1 };
  close(pointsAdded(fourth), -ep(54) - ep(45, 4, 2), 'turnover on downs');
  assert.equal(pointsAdded({ type: 'drive' }), null);
});

test('where a turnover hands the ball over is where the game spots the next drive, to the yard', () => {
  let checked = 0;
  for (const g of GAMES) {
    for (const s of readSnaps(g.log)) {
      const e = g.log[s.i];
      const prev = g.log[s.i - 1].score;
      const scored = e.score[0] !== prev[0] || e.score[1] !== prev[1];
      if (scored || !(e.type === 'int' || e.type === 'fumble' || e.down > 4)) continue;
      const next = g.log.slice(s.i + 1).find((x) => x.type === 'drive');
      if (!next) continue; // an overtime that ended on it
      assert.notEqual(next.off, s.off);
      const want = -ep(next.ballOn) - expectedPoints(s.ballOn, s.down, s.toGo);
      // The log spots an interception to a tenth of a yard and the drive to a
      // whole one: half a yard at most, a fortieth of a point.
      assert.ok(Math.abs(s.points - want) <= 0.03, `${e.type} at ${e.situation}: ${s.points} against ${want}`);
      checked++;
    }
  }
  assert.ok(checked > 30, `only ${checked} turnovers checked`);
});

test('points a play come out near zero over many games, so the board\'s colours mean better or worse than usual', () => {
  const all = GAMES.flatMap((g) => readSnaps(g.log).map((s) => s.points));
  const mean = all.reduce((a, b) => a + b, 0) / all.length;
  // The curve is fitted to this engine's drives (winprob.js, `npm run ep`).
  // If the engine moves away from it the board goes green or red everywhere,
  // and this is where that shows.
  assert.ok(Math.abs(mean) < 0.12, `mean points a play ${mean.toFixed(3)} over ${all.length} snaps`);
});

test('the snaps are the scrimmage calls both sides defend, and reading them changes nothing', () => {
  const g = GAMES[0];
  const before = JSON.stringify(g.log);
  const snaps = readSnaps(g.log);
  assert.equal(JSON.stringify(g.log), before);
  assert.ok(snaps.length > 80);
  for (const s of snaps) {
    assert.ok(CALL_GRID[s.call], s.call);
    assert.ok(DEFENSE_CALLS[s.defCall], s.defCall);
    assert.ok(Number.isFinite(s.points));
  }
  // Kicks, kneels and spikes are left out; every snap that is kept is on the list.
  const kept = new Set(snaps.map((s) => s.i));
  for (const e of g.log) if (CALL_GRID[e.call] && e.situation) assert.ok(kept.has(e.i), e.situation);
  assert.ok(!snaps.some((s) => ['fg', 'punt', 'kneel', 'spike'].includes(s.call)));
  assert.deepEqual(readSnaps(null), []);
  assert.deepEqual(readSnaps([{ type: 'run', call: 'run_in', defCall: 'base', text: 'An old entry with no situation.' }]), []);
});

test('the tallies add up: every snap once in its situation and once over all', () => {
  const g = GAMES[1];
  const snaps = readSnaps(g.log);
  for (const side of [0, 1]) {
    const mine = snaps.filter((s) => s.off === side);
    const def = defenceTendency(snaps, 1 - side);
    const off = offenceTendency(snaps, side);
    assert.equal(def.all.n, mine.length);
    assert.equal(off.all.n, mine.length);
    assert.equal(SITUATIONS.reduce((a, s) => a + def.by[s.key].n, 0), mine.length);
    for (const s of SITUATIONS) {
      assert.equal(Object.values(def.by[s.key].calls).reduce((a, b) => a + b, 0), def.by[s.key].n);
      assert.equal(off.by[s.key].calls.run + off.by[s.key].calls.pass, off.by[s.key].n);
    }
    const grid = callGrid(snaps, side);
    assert.equal(grid.total.n, mine.length);
    close(grid.total.points, mine.reduce((a, s) => a + s.points, 0), 'total points');
    const rows = Object.values(grid.rows), cols = Object.values(grid.cols);
    assert.equal(rows.reduce((a, r) => a + r.n, 0), mine.length);
    assert.equal(cols.reduce((a, c) => a + c.n, 0), mine.length);
    for (const [call, row] of Object.entries(grid.rows)) {
      assert.equal(Object.values(row.cells).reduce((a, c) => a + c.n, 0), row.n, call);
      assert.equal(OFFENSE_CALLS[call].kind === 'run' || OFFENSE_CALLS[call].kind === 'pass', true);
    }
  }
});

test('over many games the board shows the AI\'s real leanings: the box stacked on short yardage, the ball thrown on third and long', () => {
  const def = { first: [0, 0], short: [0, 0] }; // [stacked, all]
  const off = { long: [0, 0], short: [0, 0] }; // [passes, all]
  for (const g of GAMES) {
    const snaps = readSnaps(g.log);
    for (const side of [0, 1]) {
      const d = defenceTendency(snaps, side), o = offenceTendency(snaps, side);
      for (const k of Object.keys(def)) { def[k][0] += d.by[k].calls.run_stop; def[k][1] += d.by[k].n; }
      for (const k of Object.keys(off)) { off[k][0] += o.by[k].calls.pass; off[k][1] += o.by[k].n; }
    }
  }
  const share = ([a, n]) => a / n;
  assert.ok(share(def.short) > share(def.first) + 0.15, `stacked ${share(def.short).toFixed(2)} on short yardage against ${share(def.first).toFixed(2)} on first down`);
  assert.ok(share(off.long) > 0.8, `thrown on ${share(off.long).toFixed(2)} of third and long`);
  assert.ok(share(off.short) < share(off.long) - 0.3, `thrown on ${share(off.short).toFixed(2)} of short yardage`);
});
