import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { createGame, simulateGame, step } from '../src/engine/game.js';
import { buildLineup } from '../src/engine/ratings.js';
import { RATES, walkOff } from '../src/engine/penalties.js';

const tf = (t) => ({ id: t.id, name: t.name, abbr: t.abbr, color: t.color, strategy: t.strategy, lineup: buildLineup(t.slots, t.byId) });
const A = syntheticTeam('a', 85, 4, 1), B = syntheticTeam('b', 85, 4, 2);

test('flags land at a football-shaped rate and can be switched off', () => {
  let flags = 0, yds = 0, n = 150;
  for (let i = 0; i < n; i++) {
    const g = createGame(tf(A), tf(B), { seed: 4000 + i });
    simulateGame(g);
    for (const s of [0, 1]) { flags += g.stats[s].team.penalties; yds += g.stats[s].team.penYds; }
  }
  assert.ok(flags / n > 6 && flags / n < 15, `${flags / n} flags per game`);
  assert.ok(yds / n > 45 && yds / n < 130, `${yds / n} penalty yards per game`);
  const g = createGame(tf(A), tf(B), { seed: 4001, penalties: false });
  simulateGame(g);
  assert.equal(g.stats[0].team.penalties + g.stats[1].team.penalties, 0);
  assert.ok(!g.log.some((e) => e.flag));
});

test('every flag in the log is charged to exactly one club, and nullified plays are not counted', () => {
  for (let i = 0; i < 20; i++) {
    const g = createGame(tf(A), tf(B), { seed: 4100 + i });
    simulateGame(g);
    const logged = g.log.filter((e) => e.flag).length;
    assert.equal(logged, g.stats[0].team.penalties + g.stats[1].team.penalties, 'one stat per flag');
    for (const s of [0, 1]) {
      const t = g.stats[s].team;
      assert.ok(t.penYds >= t.penalties, 'at least a yard a flag');
      // Penalty yards never leak into offensive yardage.
      assert.equal(t.totalYds, t.passYds + t.rushYds);
      const att = Object.values(g.stats[s].players).reduce((sum, p) => sum + p.pass.att, 0);
      assert.equal(att, t.passAtt, 'pass attempts stay consistent after a nullified throw');
    }
    // A pre-snap flag or a hold is not a play. (An onside kick is charged as a play to the kicking team.)
    const onside = g.log.filter((e) => /onside kick/i.test(e.text)).length;
    assert.equal(g.playCount + onside, g.stats[0].team.plays + g.stats[1].team.plays);
  }
});

test('a pre-snap foul replays the down, interference gives a first down at the spot, roughing tacks on fifteen', () => {
  let sawFalseStart = false, sawDpi = false, sawRoughing = false;
  for (let i = 0; i < 60 && !(sawFalseStart && sawDpi && sawRoughing); i++) {
    const g = createGame(tf(A), tf(B), { seed: 4200 + i });
    let prev = null;
    while (!g.final) {
      const before = { down: g.down, toGo: g.toGo, ballOn: g.ballOn, phase: g.phase, off: g.possession };
      step(g);
      const e = g.lastEvent;
      if (before.phase === 'play' && e && e.flag) {
        if (/False start/.test(e.text) && e.type === 'penalty') {
          sawFalseStart = true;
          assert.equal(g.down, before.down, 'same down');
          assert.equal(g.ballOn, before.ballOn - Math.min(5, Math.floor(before.ballOn / 2)));
          assert.equal(g.toGo, Math.min(before.toGo + Math.min(5, Math.floor(before.ballOn / 2)), 100 - g.ballOn));
        }
        if (/Pass interference/.test(e.text)) {
          sawDpi = true;
          assert.equal(g.down, 1);
          assert.ok(g.ballOn > before.ballOn && g.ballOn < 100, 'moved up, never a score');
        }
        if (/Roughing the passer/.test(e.text) && !e.scoring) {
          sawRoughing = true;
          assert.equal(g.down, 1, 'automatic first down');
          assert.ok(g.ballOn >= before.ballOn + Math.min(15, Math.floor((100 - before.ballOn) / 2)) - 0 || g.possession !== before.off);
        }
      }
      prev = e;
    }
    void prev;
  }
  assert.ok(sawFalseStart && sawDpi && sawRoughing, `saw false start ${sawFalseStart}, DPI ${sawDpi}, roughing ${sawRoughing}`);
});

test('half the distance to the goal', () => {
  const g = createGame(tf(A), tf(B), { seed: 1 });
  g.ballOn = 4; g.possession = 0;
  assert.equal(walkOff(g, { side: 0, yards: 10 }, 0), 2);
  g.ballOn = 96;
  assert.equal(walkOff(g, { side: 1, yards: 15 }, 0), 2);
  g.ballOn = 50;
  assert.equal(walkOff(g, { side: 1, yards: 15 }, 0), 15);
  assert.ok(RATES.holdPass > RATES.holdRun);
});
