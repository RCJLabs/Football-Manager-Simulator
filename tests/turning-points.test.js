// A finished season's play-by-play is thinned to keep saves under the browser's
// quota, and what survived used to be chosen by play TYPE — scores, turnovers,
// flags, injuries. Leverage is not a type. A twenty-two-yard completion is
// routine in the first quarter and the whole game with forty seconds left, so
// the archive named different turning points than the live game had, and could
// drop the play that decided it outright.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { createGame, simulateGame } from '../src/engine/game.js';
import { buildLineup } from '../src/engine/ratings.js';
import { thinLog } from '../src/engine/season.js';
import { TURNING_POINT, FAINT_TURN } from '../src/engine/winprob.js';

const tf = (t) => ({ id: t.id, name: t.name, abbr: t.abbr, color: t.color, strategy: t.strategy, lineup: buildLineup(t.slots, t.byId) });
const played = (seed) => {
  const g = createGame(tf(syntheticTeam('a', 85, 4, 1)), tf(syntheticTeam('b', 84, 4, 2)), { seed });
  simulateGame(g);
  return g.log;
};
// The rule `gameStory` applies, kept in step with it by the shared constants.
const turningPoints = (log) => {
  const sw = [];
  let prev = null;
  for (const e of log) {
    if (typeof e.wp !== 'number') continue;
    if (prev != null && e.situation) sw.push({ e, delta: e.wp - prev });
    prev = e.wp;
  }
  sw.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  let top = sw.slice(0, 3).filter((s) => Math.abs(s.delta) >= TURNING_POINT);
  if (!top.length && sw.length && Math.abs(sw[0].delta) >= FAINT_TURN) top = sw.slice(0, 1);
  return top.map((s) => s.e.text || '').join('|');
};

test('thinning a season does not change which plays decided its games', () => {
  let checked = 0;
  for (let seed = 900; seed < 960; seed++) {
    const full = played(seed);
    const thin = thinLog(full.map((e) => ({ ...e })));
    assert.equal(turningPoints(thin), turningPoints(full),
      `game ${seed} tells a different story once it is in the archive`);
    checked++;
  }
  assert.ok(checked === 60);
});

test('the archive keeps every play the story is allowed to name', () => {
  // The structural version of the test above: whatever the reporting floor is,
  // no play at or above it may be reduced to a bare { q, wp }.
  for (let seed = 900; seed < 920; seed++) {
    const full = played(seed);
    const thin = thinLog(full.map((e) => ({ ...e })));
    let prev = null;
    for (let i = 0; i < full.length; i++) {
      const e = full[i];
      const swung = typeof e.wp === 'number' && prev != null && Math.abs(e.wp - prev) >= FAINT_TURN;
      if (typeof e.wp === 'number') prev = e.wp;
      if (!swung || !e.situation) continue;
      assert.ok(thin[i] && thin[i].text === e.text,
        `game ${seed} threw away a ${Math.round(Math.abs(e.wp - prev) * 100)}-point swing: ${e.text}`);
    }
  }
});

test('the floors are ordered, and thinning uses the lower one', () => {
  // The headline bar cannot sit below the fallback, or the fallback never runs;
  // and thinning must keep down to the fallback, not the headline, or a quiet
  // game loses the one play it was going to cite.
  assert.ok(TURNING_POINT > FAINT_TURN, `${TURNING_POINT} must exceed ${FAINT_TURN}`);
  assert.ok(FAINT_TURN > 0, 'a floor of zero keeps every play and defeats the thinning');
});

test('thinning still throws away the quiet plays', () => {
  // The point of it is bytes. If this stops shrinking, the feature above has
  // eaten the reason the feature below exists.
  const full = played(931);
  const thin = thinLog(full.map((e) => ({ ...e })));
  const bytes = (x) => JSON.stringify(x).length;
  assert.ok(bytes(thin) < bytes(full) * 0.55,
    `thinned to ${(100 * bytes(thin) / bytes(full)).toFixed(0)}% of the full log, which is not worth doing`);
});
