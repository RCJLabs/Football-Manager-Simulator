// The recap after the final whistle: the score by quarter, the player of the
// game, the turning points drawn on the field, and the highlight reel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, simulateGame } from '../src/engine/game.js';
import { fantasyPoints } from '../src/engine/stats.js';
import { thinLog } from '../src/engine/season.js';
import { gameStory } from '../src/ui/charts.js';
import { playShapes } from '../src/ui/field.js';
import { lineScore, playerOfTheGame, statLine, highlights, buildRecap, recapTop, reelCard, turnsCard } from '../src/ui/recap.js';

function played(seed) {
  const A = syntheticTeam(`a${seed}`, 80 + (seed % 7), 4, seed * 2 + 1);
  const B = syntheticTeam(`b${seed}`, 80 + (seed % 5), 4, seed * 2 + 2);
  const g = createGame({ ...A, lineup: buildLineup(A.slots, A.byId) }, { ...B, lineup: buildLineup(B.slots, B.byId) }, { seed, injuryLevel: 2 });
  simulateGame(g);
  const byId = new Map([...A.byId, ...B.byId]);
  const box = { teams: g.teams, score: g.score, final: true, overtime: g.quarter >= 5, log: g.log, players: [g.stats[0].players, g.stats[1].players], injuries: g.teams.map((t) => t.injuries || []) };
  return { g, byId, box };
}
const GAMES = Array.from({ length: 40 }, (_, k) => played(8100 + k));

test('the score by quarter adds up to the final, with an overtime column only after overtime', () => {
  for (const { g } of GAMES) {
    const ls = lineScore(g.log, g.score);
    assert.ok(ls, `no line score for a ${g.score.join('-')} game`);
    for (const side of [0, 1]) {
      assert.equal(ls.rows[side].reduce((a, b) => a + b, 0), g.score[side]);
      assert.equal(ls.totals[side], g.score[side]);
      for (const v of ls.rows[side]) assert.ok(Number.isInteger(v) && v >= 0, `a quarter of ${v} points`);
    }
    assert.equal(ls.periods.includes('OT'), g.quarter >= 5);
    // A season's logs are thinned when it ends; the score is kept whole on
    // every scoring play, so the line score reads the same from what is left.
    assert.deepEqual(lineScore(thinLog(g.log.map((e) => ({ ...e }))), g.score), ls, 'the thinned log reads a different line score');
  }
  // Overtime is rare enough that its column is tested on its own rather than
  // waited for in the sample.
  const fake = [{ q: 1, score: [7, 0] }, { q: 4, score: [7, 7] }, { q: 5, score: [13, 7] }];
  assert.deepEqual(lineScore(fake, [13, 7]), { periods: ['1', '2', '3', '4', 'OT'], rows: [[7, 0, 0, 0, 6], [0, 0, 0, 7, 0]], totals: [13, 7] });
  assert.equal(lineScore(fake, [14, 7]), null, 'a line score that does not add up to the final is not shown');
  assert.equal(lineScore(null, [0, 0]), null);
});

test('the player of the game is the biggest fantasy line on the winning side', () => {
  for (const { g, byId, box } of GAMES) {
    const potg = playerOfTheGame(box.players, g.score, byId);
    if (g.score[0] === g.score[1]) continue;
    const win = g.score[0] > g.score[1] ? 0 : 1;
    assert.equal(potg.side, win, 'from the losing side');
    const best = Math.max(...Object.values(box.players[win]).map((s) => fantasyPoints(s)));
    assert.equal(potg.pts, best);
    assert.ok(statLine(potg.s).length > 0);
  }
});

test('a man\'s game in a line, whatever he plays', () => {
  const blank = () => ({ pass: { cmp: 0, att: 0, yds: 0, td: 0, int: 0 }, rush: { att: 0, yds: 0, td: 0 }, rec: { rec: 0, yds: 0, td: 0 }, def: { tkl: 0, sck: 0, int: 0, ff: 0, fr: 0, pd: 0, td: 0 }, k: { fgm: 0, fga: 0, xpm: 0, xpa: 0 }, ret: { td: 0 } });
  const qb = blank(); Object.assign(qb.pass, { cmp: 23, att: 32, yds: 292, td: 2 }); Object.assign(qb.rush, { att: 2, yds: 3 });
  assert.equal(statLine(qb), '23/32, 292 yds, 2 TD', 'a quarterback\'s two kneels are not his game');
  const lb = blank(); Object.assign(lb.def, { tkl: 9, sck: 2, int: 1 });
  assert.equal(statLine(lb), '9 tkl, 2 sck, 1 INT');
  const k = blank(); Object.assign(k.k, { fgm: 4, fga: 5, xpm: 2, xpa: 2 });
  assert.equal(statLine(k), '4/5 FG, 2/2 XP');
});

test('the highlights: in order, drawable, at most six, every turning point among them', () => {
  let crowded = 0;
  for (const { byId, box } of GAMES) {
    const r = buildRecap(box, byId);
    assert.ok(r.reel.length <= 6);
    for (let n = 1; n < r.reel.length; n++) assert.ok(r.reel[n].k > r.reel[n - 1].k, 'out of order');
    const turning = new Set(r.turns.map((t) => t.k));
    for (const h of r.reel) {
      assert.ok(h.shape, 'a highlight that cannot be drawn');
      if (!turning.has(h.k)) assert.ok(!['xp', 'penalty', 'kneel', 'spike'].includes(h.e.type), `a ${h.e.type} in the reel`);
    }
    for (const t of r.turns) assert.ok(r.reel.some((h) => h.k === t.k), 'a turning point missing from the reel');
    // Without them held a place, the scores can crowd them out: the case the
    // rule is for, and it has to occur in the sample to be tested at all.
    const plain = highlights(box.log, playShapes(box.log));
    if (r.turns.some((t) => !plain.some((h) => h.k === t.k))) crowded++;
  }
  assert.ok(crowded > 0, 'no game where the turning points needed their place held');
});

test('the turning-point cards name the plays the story names, drawn where they can be', () => {
  for (const { byId, box } of GAMES) {
    const r = buildRecap(box, byId);
    const told = gameStory(box, byId).find((l) => /^Turning point/.test(l)) || '';
    for (const t of r.turns) {
      assert.ok(told.includes(`${t.e.text.replace(/\s*[A-Z]{2,4} \d+, [A-Z]{2,4} \d+\.$/, '')}`), 'a card the story does not name');
      assert.ok(t.shape, 'a turning point in a full log that cannot be drawn');
    }
    for (let n = 1; n < r.turns.length; n++) assert.ok(r.turns[n].k > r.turns[n - 1].k, 'cards out of order');
  }
});

test('the recap renders from a full log and from a thinned one', () => {
  for (const { byId, box } of GAMES.slice(0, 10)) {
    for (const log of [box.log, thinLog(box.log.map((e) => ({ ...e })))]) {
      const b = { ...box, log };
      const r = buildRecap(b, byId);
      const top = recapTop(r, b);
      assert.match(top, /class="linescore"/);
      assert.match(top, new RegExp(`<b>${b.score[0]}</b>`));
      const reel = reelCard(r, b);
      if (r.reel.length) assert.equal((reel.match(/class="rdot/g) || []).length, r.reel.length);
      turnsCard(r, b, { extras: true });
    }
  }
});
