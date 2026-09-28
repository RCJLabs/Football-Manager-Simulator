// The field view: a top-down drawing of each play, from what the engine logs.
//
// Along the field the drawing is held to the engine: a play ends on the yard
// line the engine put it on, a throw comes down where its air yards say, a
// punt lands where it landed and the return stops where the return stopped.
// Across the field it is drawn to fit, and must stay on the field and carry
// the ball from snap to snap on the hashes. The engine grew the fields it
// draws from — air yards, where a pick was made, where a kick came down,
// where a flagged return was stopped, out of bounds — without its results
// moving (checked against the previous release, 90 games byte for byte, when
// this was written; see DESIGN.md, "The field").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, simulateGame } from '../src/engine/game.js';
import { playShape, playShapes, fieldSvg, naturalSeconds, W, HASH } from '../src/ui/field.js';

function games(n, seed0 = 7000) {
  const out = [];
  for (let s = 0; s < n; s++) {
    const A = syntheticTeam(`a${s}`, 80 + (s % 9), 3, seed0 + s * 2);
    const B = syntheticTeam(`b${s}`, 78 + (s % 7), 4, seed0 + s * 2 + 1);
    const g = createGame({ ...A, lineup: buildLineup(A.slots, A.byId) }, { ...B, lineup: buildLineup(B.slots, B.byId) }, { seed: seed0 + s, penalties: true });
    simulateGame(g);
    out.push(g);
  }
  return out;
}
const GAMES = games(24);
const EVENTS = GAMES.flatMap((g) => g.log);
const X = (side, v) => (side === 0 ? v : 100 - v);

test('the engine logs where each play went: air yards, pick spots, landings, returns, misses', () => {
  const seen = {};
  for (const e of EVENTS) {
    seen[e.type] = (seen[e.type] || 0) + 1;
    if (e.type === 'pass') {
      assert.ok(Number.isInteger(e.air), `a completion without air yards: ${e.text}`);
      // Caught at or behind where it finished, unless caught in the end zone.
      assert.ok(e.air <= e.yards || (e.scoring && e.from + e.air >= 100), `${e.air} in the air for ${e.yards}: ${e.text}`);
    }
    if (e.type === 'incomplete') assert.equal(e.air == null, /throws it away/.test(e.text), e.text);
    if (e.type === 'int') {
      // The spot is the engine's own; the air yards beside it are rounded.
      assert.ok(Math.abs(e.at - (e.from + Math.min(e.air, 100 - e.from))) <= 0.55, e.text);
      assert.ok(e.ret >= 0);
    }
    if (e.type === 'run' || e.type === 'sack' || e.type === 'penalty') assert.equal(e.air, undefined);
    if (e.type === 'punt' && e.yards >= 0) assert.ok(e.land > e.from, `a punt that came down behind the punter: ${e.text}`);
    if (e.type === 'fg' && !e.scoring) {
      assert.ok(['blocked', 'wide right', 'wide left', 'short'].includes(e.miss), e.text);
      assert.ok(e.miss === 'blocked' ? /BLOCKED/.test(e.text) : e.text.includes(`(${e.miss})`), e.text);
    }
    if (e.type === 'kickoff' || e.type === 'td') {
      assert.ok(e.from === 35 || e.from === 20, `kicked from ${e.from}`);
      assert.ok(e.to >= 0 && e.to <= 100);
      assert.equal(e.land == null, /Touchback/.test(e.text), e.text);
    }
    if (e.ran != null) assert.ok(e.flag && /FLAG/.test(e.text), 'a stopped-return spot on a return without a flag');
    if (e.oob !== undefined) assert.equal(e.oob, true, 'out of bounds is logged only when true');
  }
  for (const t of ['pass', 'incomplete', 'run', 'sack', 'punt', 'kickoff', 'fg', 'penalty']) assert.ok(seen[t] > 0, `no ${t} in the sample`);
});

test('every play is drawn, on the field, ending where the engine says it ended', () => {
  const kinds = new Set();
  for (const g of GAMES) {
    const shapes = playShapes(g.log);
    g.log.forEach((e, k) => {
      const sh = shapes[k];
      const isPlay = e.from != null || e.type === 'xp' || e.type === '2pt';
      assert.equal(!!sh, isPlay, `${e.type} drawn: ${!!sh}`);
      if (!sh) return;
      kinds.add(e.type);
      const pts = [...sh.ball.pts, ...sh.lines.flatMap((l) => l.pts), ...sh.actors.flatMap((a) => a.pts), ...sh.marks.map((m) => m.at), ...(sh.form ? [...sh.form.off, ...sh.form.def] : [])];
      for (const [x, y] of pts) assert.ok(Number.isFinite(x) && Number.isFinite(y) && x >= -10 && x <= 110 && y >= 0 && y <= W, `${e.type} off the field at ${x},${y}`);
      for (const tl of [sh.ball, ...sh.actors]) {
        assert.equal(tl.pts.length, tl.ts.length);
        tl.ts.forEach((t, j) => assert.ok(j === 0 || t >= tl.ts[j - 1] - 1e-9, 'time runs backwards'));
        assert.ok(Math.abs(tl.ts.at(-1) - 1) < 1e-9);
      }
      assert.ok(sh.nextY >= HASH[0] - 1e-9 && sh.nextY <= HASH[1] + 1e-9, 'the next snap is spotted off the hashes');
      const side = e.snapOff;
      const near = (x, v) => Math.abs(x - X(side, v)) <= 0.51;
      const clampIn = (v) => Math.max(0.5, Math.min(99.5, v));
      if (['run', 'pass', 'sack'].includes(e.type) && !e.scoring) assert.ok(near(sh.end[0], clampIn(e.from + e.yards)), `${e.text}: drawn to ${sh.end[0]}`);
      if (['run', 'pass'].includes(e.type) && e.scoring && e.from + e.yards >= 100) assert.ok(side === 0 ? sh.end[0] > 100 : sh.end[0] < 0, 'a touchdown short of the end zone');
      if (e.type === 'pass') assert.ok(near(sh.lines.find((l) => l.kind === 'throw').pts.at(-1)[0], Math.max(0, Math.min(109, e.from + e.air))), 'caught away from its air yards');
      if (e.type === 'int') assert.ok(near(sh.lines.find((l) => l.kind === 'throw').pts.at(-1)[0], Math.min(109, e.at)), 'picked away from the pick spot');
      if (e.type === 'punt' && e.yards >= 0 && !e.scoring) {
        assert.ok(near(sh.lines.find((l) => l.kind === 'kick').pts.at(-1)[0], Math.min(109, e.land)), 'a punt drawn landing away from where it landed');
        if (e.land < 100) assert.ok(near(sh.end[0], clampIn(e.to)), 'a punt drawn finishing away from its spot');
      }
      if (e.type === 'kickoff' && e.land != null && !e.onside) assert.ok(near(sh.end[0], clampIn(e.to)), 'a kick return drawn finishing away from its spot');
      if (e.oob && ['run', 'pass'].includes(e.type) && !e.scoring) assert.ok(sh.end[1] <= 1 || sh.end[1] >= W - 1, `out of bounds in the middle of the field: ${e.text}`);
    });
  }
  for (const t of ['kickoff', 'run', 'pass', 'incomplete', 'sack', 'punt', 'fg', 'xp', 'penalty']) assert.ok(kinds.has(t), `nothing of kind ${t} drawn`);
});

test('a play is drawn the same way every time', () => {
  const g = GAMES[3];
  const a = JSON.stringify(playShapes(g.log));
  const b = JSON.stringify(playShapes(g.log.map((e) => ({ ...e }))));
  assert.equal(a, b);
});

test('a flag on a return: run to where it was stopped, flagged there, walked back', () => {
  const e = { i: 40, type: 'punt', yards: 0, from: 30, snapOff: 0, land: 75, ran: 62, to: 69, flag: true, text: 'P punts 45 yards, returned 13 yards. FLAG: holding on B on the return, 7 yards.' };
  const sh = playShape(e);
  assert.match(sh.label, /13-yd return · flag/);
  assert.doesNotMatch(sh.label, /fair catch/, 'the return this replaced read as a fair catch');
  const ret = sh.lines.find((l) => l.kind === 'return');
  assert.ok(Math.abs(ret.pts.at(-1)[0] - 62) < 0.01, 'the return runs to where it was stopped');
  assert.ok(Math.abs(sh.end[0] - 69) < 0.01, 'and the ball is walked back to its spot');
  assert.ok(sh.marks.some((m) => m.kind === 'flag' && Math.abs(m.at[0] - 62) < 0.01), 'the flag is where the foul was, not at the line');
});

test('a play logged before these fields existed still draws, on the field', () => {
  const old = EVENTS.filter((e) => e.from != null).map(({ air, at, ret, land, ran, miss, oob, ...rest }) => rest);
  for (const e of old) {
    if (e.type === 'kickoff' || e.type === 'td') continue;
    const sh = playShape(e);
    for (const [x, y] of [...sh.ball.pts, sh.end]) assert.ok(Number.isFinite(x) && Number.isFinite(y) && x >= -10 && x <= 110 && y >= 0 && y <= W, `${e.type} from an old save off the field`);
  }
});

test('the drawing: still when asked, moving when asked, labels inside the end lines', () => {
  for (const g of GAMES.slice(0, 6)) {
    for (let k = 1; k <= g.log.length; k += 7) {
      const view = { ...g, log: g.log.slice(0, k), phase: 'play', final: false };
      const still = fieldSvg(view, { animate: false });
      assert.doesNotMatch(still, /<animate|<set /, 'a still field animates');
      const moving = fieldSvg(view, { animate: true, seconds: 1 });
      const label = /<text class="plabel" x="([-\d.]+)" y="[-\d.]+" text-anchor="(\w+)"[^>]*>([^<]*)</.exec(moving);
      if (!label) continue;
      assert.match(moving, /<animateMotion/);
      // Set flush against an end line when near one; otherwise centred with
      // room on both sides for a face wider than average.
      const [x, anchor, text] = [+label[1], label[2], label[3]];
      const half = text.length * 2.9 * 0.36;
      if (anchor === 'end') assert.ok(x <= 110, `"${text}" set past the end line`);
      else if (anchor === 'start') assert.ok(x >= -10, `"${text}" set past the end line`);
      else assert.ok(x - half >= -10 && x + half <= 110, `"${text}" runs past an end line at x=${x}`);
    }
  }
});

test('a play takes between a little over half a second and two on screen', () => {
  for (const sh of playShapes(GAMES[0].log).filter(Boolean)) {
    const s = naturalSeconds(sh);
    assert.ok(s >= 0.55 && s <= 2.1, `${s}s`);
  }
});
