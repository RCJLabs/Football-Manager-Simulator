// Overtime ends on a winning touchdown, without the try.
//
// Once both sides have had the ball, a touchdown that puts the scorer ahead
// is the end of the game. The engine used to kick the try anyway, so an
// overtime winner went 41-37 where the rules make it 40-37. A touchdown that
// leaves its side behind or level still owes its try, and so does one on the
// first possession, when the other side has yet to have the ball.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, step } from '../src/engine/game.js';

const A = syntheticTeam('ot-a', 88, 3, 41);
const B = syntheticTeam('ot-b', 80, 3, 42);
const side = (T) => ({ ...T, lineup: buildLineup(T.slots, T.byId) });

/**
 * A game at first and goal from the one with `score` for the side that has
 * the ball and its opponent, `possessed` saying who has had it in overtime
 * (null for the fourth quarter).
 */
function atTheOne(seed, { mine, theirs, possessed }) {
  const g = createGame(side(A), side(B), { seed });
  while (g.phase !== 'play') step(g);
  const off = g.possession;
  g.score[off] = mine;
  g.score[1 - off] = theirs;
  if (possessed) {
    g.quarter = 5;
    g.clock = 600;
    g.ot = { possessed: off === 0 ? possessed : [possessed[1], possessed[0]] };
  } else {
    g.quarter = 4;
    g.clock = 60;
  }
  g.ballOn = 99; g.down = 1; g.toGo = 1;
  return { g, off };
}

/** Step until the score moves: the log index of the touchdown if the side with the ball scored one, else -1. */
function untilScore(g, off) {
  const start = [g.score[off], g.score[1 - off]];
  for (let n = 0; n < 40 && !g.final && g.score[off] === start[0] && g.score[1 - off] === start[1]; n++) step(g);
  return g.score[off] - start[0] === 6 ? g.log.findLastIndex((e) => e.scoring) : -1;
}

test('a touchdown that wins in overtime ends the game with no try', () => {
  let seen = 0;
  for (let seed = 1; seed <= 30; seed++) {
    // Four down, so the side with the ball needs the touchdown rather than
    // playing for a kick, and six puts it ahead.
    const { g, off } = atTheOne(seed, { mine: 16, theirs: 20, possessed: [true, true] });
    const at = untilScore(g, off);
    if (at < 0) continue;
    seen++;
    assert.equal(g.final, true, 'the game went on after a winning touchdown');
    assert.deepEqual([g.score[off], g.score[1 - off]], [22, 20]);
    const after = g.log.slice(at + 1).map((e) => e.type);
    assert.ok(!after.includes('xp') && !after.includes('2pt'), `a try after the winning touchdown: ${after.join(', ')}`);
  }
  assert.ok(seen >= 5, `only ${seen} touchdowns from the one in thirty tries`);
});

test('a touchdown that leaves its side behind or level still tries', () => {
  let seen = 0;
  for (let seed = 1; seed <= 30; seed++) {
    // The other side scored a touchdown and kicked on its possession; this
    // one answers with six and needs the try to tie or win.
    const { g, off } = atTheOne(seed, { mine: 0, theirs: 7, possessed: [true, true] });
    if (untilScore(g, off) < 0) continue;
    seen++;
    assert.equal(g.final, false, 'ended a game the try could still tie');
    assert.equal(g.phase, 'pat');
  }
  assert.ok(seen >= 5);
});

test('a touchdown on the first possession of overtime tries, and the other side gets the ball', () => {
  let seen = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const { g, off } = atTheOne(seed, { mine: 20, theirs: 20, possessed: [true, false] });
    if (untilScore(g, off) < 0) continue;
    seen++;
    assert.equal(g.final, false, 'ended overtime before the other side had the ball');
    assert.equal(g.phase, 'pat');
    step(g);
    assert.equal(g.final, false, 'the try ended the game');
  }
  assert.ok(seen >= 5);
});

test('a touchdown in the fourth quarter still tries', () => {
  let seen = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const { g, off } = atTheOne(seed, { mine: 16, theirs: 20, possessed: null });
    if (untilScore(g, off) < 0) continue;
    seen++;
    assert.equal(g.phase, 'pat', 'no try after a fourth-quarter touchdown');
  }
  assert.ok(seen >= 5);
});
