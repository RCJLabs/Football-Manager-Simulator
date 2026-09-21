import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, simulateGame, step } from '../src/engine/game.js';
import { pbpOrder } from '../src/ui/views/game.js';

const A = syntheticTeam('alpha', 86, 3, 1);
const B = syntheticTeam('bravo', 84, 3, 2);
const LA = buildLineup(A.slots, A.byId);
const LB = buildLineup(B.slots, B.byId);
const mk = (seed) => createGame({ ...A, lineup: LA }, { ...B, lineup: LB }, { seed });

test('the play-by-play shows every event exactly once', () => {
  for (let seed = 9500; seed < 9520; seed++) {
    const g = simulateGame(mk(seed));
    const out = pbpOrder(g.log);
    assert.equal(out.length, g.log.length, `seed ${seed}`);
    assert.deepEqual(out.map((e) => e.i).sort((a, b) => a - b), g.log.map((e) => e.i), `seed ${seed}`);
  }
  assert.deepEqual(pbpOrder([]), []);
  assert.deepEqual(pbpOrder(null), []);
  assert.deepEqual(pbpOrder(undefined), []);
});

test('a drive header sits above its own plays, never underneath them', () => {
  // This is the whole point: reversing a log puts a header, which is logged
  // first, below everything it introduces.
  for (let seed = 9500; seed < 9515; seed++) {
    const g = simulateGame(mk(seed));
    const out = pbpOrder(g.log);
    const at = new Map(out.map((e, idx) => [e.i, idx]));
    // Walk the chronological log: each event belongs to the last header before
    // it, and must render below that header.
    let header = null;
    for (const e of g.log) {
      if (e.type === 'drive') { header = e; continue; }
      if (!header || e.type === 'final') continue;
      if (e.type === 'kickoff') continue; // belongs to the drive it hands off to
      assert.ok(at.get(e.i) > at.get(header.i),
        `seed ${seed}: "${(e.text || '').slice(0, 40)}" renders above its own drive header`);
    }
  }
});

test('inside a drive the newest play is on top, and the drive above is newer still', () => {
  const g = simulateGame(mk(9500));
  const out = pbpOrder(g.log);
  const at = new Map(out.map((e, idx) => [e.i, idx]));
  let header = null, prevInDrive = null, headers = 0;
  for (const e of g.log) {
    if (e.type === 'drive') { header = e; prevInDrive = null; headers++; continue; }
    if (!header || e.type === 'final' || e.type === 'kickoff') continue;
    if (prevInDrive) {
      assert.ok(at.get(e.i) < at.get(prevInDrive.i),
        `an earlier play renders above a later one inside the same drive`);
    }
    prevInDrive = e;
  }
  assert.ok(headers > 10, `only ${headers} drives sampled`);
  // Drives themselves run newest first.
  const driveRows = g.log.filter((e) => e.type === 'drive').map((e) => at.get(e.i));
  for (let i = 1; i < driveRows.length; i++) assert.ok(driveRows[i] < driveRows[i - 1], 'drives are not newest first');
});

test('the final whistle is the top line, and a live game leads with the play that just happened', () => {
  const done = simulateGame(mk(9500));
  const top = pbpOrder(done.log)[0];
  assert.equal(top.type, 'final', `top line was ${top.type}`);

  // Mid-game: a drive header may lead (it labels the possession), but the newest
  // play must be immediately under it — never buried.
  const live = mk(9501);
  for (let i = 0; i < 24; i++) step(live);
  const out = pbpOrder(live.log);
  const newest = live.log.at(-1);
  const pos = out.findIndex((e) => e.i === newest.i);
  assert.ok(pos <= 1, `the newest event rendered at row ${pos}`);
});

test('a kickoff belongs to the drive it handed the ball to', () => {
  const g = simulateGame(mk(9500));
  const out = pbpOrder(g.log);
  const at = new Map(out.map((e, idx) => [e.i, idx]));
  let checked = 0;
  for (let i = 1; i < g.log.length; i++) {
    if (g.log[i].type !== 'drive' || g.log[i - 1].type !== 'kickoff') continue;
    const kick = g.log[i - 1], head = g.log[i];
    // Under its own drive's header, not stranded under the previous drive.
    assert.ok(at.get(kick.i) > at.get(head.i), 'the kickoff renders above the drive it started');
    const older = g.log.slice(0, i - 1).reverse().find((e) => e.type === 'drive');
    if (older) assert.ok(at.get(kick.i) < at.get(older.i), 'the kickoff is stranded under the previous drive');
    checked++;
  }
  assert.ok(checked >= 5, `only ${checked} kickoffs checked`);
});
