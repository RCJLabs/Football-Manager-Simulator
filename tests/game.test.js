import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, simulateGame, step, decisionNeeded } from '../src/engine/game.js';

const A = syntheticTeam('alpha', 86, 3, 1);
const B = syntheticTeam('bravo', 84, 3, 2);
const LA = buildLineup(A.slots, A.byId);
const LB = buildLineup(B.slots, B.byId);
const mk = (seed, opts = {}) => createGame({ ...A, lineup: LA }, { ...B, lineup: LB }, { seed, ...opts });

test('a game is deterministic for a given seed', () => {
  const g1 = simulateGame(mk(11)), g2 = simulateGame(mk(11));
  assert.deepEqual(g1.score, g2.score);
  assert.equal(g1.log.length, g2.log.length);
  assert.equal(g1.log.at(-1).text, g2.log.at(-1).text);
});

test('stepping play by play gives the same result as simulating', () => {
  const g1 = simulateGame(mk(12));
  const g2 = mk(12);
  let guard = 0;
  while (!g2.final && guard++ < 3000) step(g2);
  assert.deepEqual(g1.score, g2.score);
  assert.equal(g1.playCount, g2.playCount);
});

test('200 games satisfy structural invariants', () => {
  for (let seed = 100; seed < 300; seed++) {
    const g = simulateGame(mk(seed));
    assert.ok(g.final, 'game finished');
    assert.ok(g.quarter >= 4, 'played four quarters');
    assert.ok(g.score[0] >= 0 && g.score[1] >= 0);
    assert.ok(g.score[0] + g.score[1] < 130, `plausible total ${g.score}`);
    assert.ok(g.playCount > 80 && g.playCount < 220, `plausible play count ${g.playCount}`);
    // Score only changes on scoring events, by a legal amount.
    let prev = [0, 0];
    for (const e of g.log) {
      const d = [e.score[0] - prev[0], e.score[1] - prev[1]];
      const changed = d[0] !== 0 || d[1] !== 0;
      if (changed) {
        assert.ok(e.scoring, `score changed on non-scoring event: ${e.type} ${e.text}`);
        const pts = Math.abs(d[0]) + Math.abs(d[1]);
        assert.ok([1, 2, 3, 6].includes(pts), `illegal score delta ${d} on ${e.text}`);
        assert.ok(d[0] === 0 || d[1] === 0);
      }
      prev = e.score;
    }
    assert.deepEqual(prev, g.score);
    for (const side of [0, 1]) {
      const t = g.stats[side].team;
      const P = Object.values(g.stats[side].players);
      const sum = (f) => P.reduce((s, p) => s + f(p), 0);
      assert.equal(t.passAtt, sum((p) => p.pass.att), 'pass attempts match');
      assert.equal(t.passCmp, sum((p) => p.pass.cmp), 'completions match');
      assert.equal(sum((p) => p.pass.cmp), sum((p) => p.rec.rec), 'completions equal receptions');
      assert.equal(sum((p) => p.pass.att), sum((p) => p.rec.tgt), 'attempts equal targets');
      assert.equal(sum((p) => p.pass.yds), sum((p) => p.rec.yds), 'passing yards equal receiving yards');
      assert.equal(t.passYds, sum((p) => p.pass.yds) - sum((p) => p.pass.sckYds), 'net passing yards');
      assert.equal(t.rushYds, sum((p) => p.rush.yds), 'rushing yards');
      assert.equal(t.rushAtt, sum((p) => p.rush.att), 'rush attempts');
      assert.equal(t.totalYds, t.passYds + t.rushYds, 'total yards');
      assert.equal(t.sacksAllowed, sum((p) => p.pass.sck));
      assert.equal(t.sacksAllowed, Object.values(g.stats[1 - side].players).reduce((s, p) => s + p.def.sck, 0), 'sacks credited to defenders');
      assert.equal(sum((p) => p.pass.int), Object.values(g.stats[1 - side].players).reduce((s, p) => s + p.def.int, 0), 'interceptions credited');
      assert.ok(t.thirdConv <= t.thirdAtt);
      assert.equal(t.points, g.score[side]);
    }
    assert.equal(g.stats[0].team.top + g.stats[1].team.top, g.quarter >= 5 ? 3600 + (g.playoff ? 900 : 600) * (g.quarter - 4) - (g.final ? g.clock : 0) : 3600, 'time of possession adds up');
  }
});

test('the better team wins more often', () => {
  let a = 0;
  for (let seed = 1000; seed < 1200; seed++) { const g = simulateGame(mk(seed)); if (g.score[0] > g.score[1]) a++; }
  assert.ok(a > 110, `stronger team won ${a}/200`);
});

test('league averages are football-shaped', () => {
  const agg = { pts: 0, yds: 0, pass: 0, cmp: 0, att: 0, rush: 0, ratt: 0, to: 0, n: 0 };
  for (let seed = 2000; seed < 2150; seed++) {
    const g = simulateGame(mk(seed));
    for (const s of [0, 1]) {
      const t = g.stats[s].team;
      agg.pts += g.score[s]; agg.yds += t.totalYds; agg.pass += t.passYds; agg.cmp += t.passCmp; agg.att += t.passAtt; agg.rush += t.rushYds; agg.ratt += t.rushAtt; agg.to += t.turnovers; agg.n++;
    }
  }
  const per = (x) => x / agg.n;
  assert.ok(per(agg.pts) > 16 && per(agg.pts) < 32, `points ${per(agg.pts)}`);
  assert.ok(per(agg.yds) > 260 && per(agg.yds) < 430, `yards ${per(agg.yds)}`);
  assert.ok(agg.cmp / agg.att > 0.55 && agg.cmp / agg.att < 0.72, `comp% ${agg.cmp / agg.att}`);
  assert.ok(agg.rush / agg.ratt > 3.4 && agg.rush / agg.ratt < 5.2, `ypc ${agg.rush / agg.ratt}`);
  assert.ok(per(agg.to) > 0.5 && per(agg.to) < 2.2, `turnovers ${per(agg.to)}`);
});

test('playoff games never end tied', () => {
  for (let seed = 3000; seed < 3400; seed++) {
    const g = simulateGame(mk(seed, { playoff: true }));
    assert.notEqual(g.score[0], g.score[1], `seed ${seed} tied`);
  }
});

test('coach mode: decisionNeeded reports offense turns and honors calls', () => {
  const g = mk(55);
  step(g); // kickoff
  assert.equal(g.phase, 'play');
  const user = g.possession;
  assert.equal(decisionNeeded(g, user, false), 'offense');
  assert.equal(decisionNeeded(g, 1 - user, false), null);
  assert.equal(decisionNeeded(g, 1 - user, true), 'defense');
  step(g, { off: 'pass_deep', def: 'blitz' });
  assert.equal(g.lastCall.off, 'pass_deep');
  assert.equal(g.lastCall.def, 'blitz');
  assert.ok(['pass', 'incomplete', 'sack', 'int', 'fumble', 'run'].includes(g.log.at(-1).type) || g.log.at(-1).type === 'drive' || g.log.at(-1).type === 'timeout', g.log.at(-1).type);
});

test('serialized game can be resumed identically', () => {
  const g = mk(66);
  for (let i = 0; i < 40; i++) step(g);
  const copy = JSON.parse(JSON.stringify(g));
  simulateGame(g);
  simulateGame(copy);
  assert.deepEqual(copy.score, g.score);
  assert.equal(copy.log.length, g.log.length);
});
