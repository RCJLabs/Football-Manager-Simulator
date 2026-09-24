import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticTeam } from '../scripts/synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, simulateGame, step, decisionNeeded, callTimeout, timeoutLegal, takeClock, setTempo } from '../src/engine/game.js';
import { wantsTimeout, isHurryUp, isClockKill } from '../src/engine/playcall.js';

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
      // A ball thrown away is an attempt with nobody targeted.
      assert.equal(sum((p) => p.pass.att), sum((p) => p.rec.tgt) + t.throwaways, 'attempts equal targets and throwaways');
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

test('run lengths have a tail, not a cliff', () => {
  // The band between a good run and a touchdown run. A uniform breakaway draw
  // leaves it empty and caps the long run at its own top end, which read as
  // too few explosive plays in the realism audit. The old shape gave 0.55 runs
  // of twenty or more a team and is excluded by the floor here. The real game
  // gives 0.66 (2022-23 play-by-play). The floor used to be 0.7, set from what
  // the engine did while its backs broke far too many.
  const runs = [];
  let sides = 0;
  for (let seed = 4000; seed < 4150; seed++) {
    const g = simulateGame(mk(seed));
    sides += g.stats.length;
    for (const e of g.log) {
      if (e.type !== 'run') continue;
      const m = /for (-?\d+) yards?/.exec(e.text);
      if (m) runs.push(Number(m[1]));
      else if (/for no gain/.test(e.text)) runs.push(0);
      else { const l = /for a loss of (\d+)/.exec(e.text); if (l) runs.push(-Number(l[1])); }
    }
  }
  const per = (n) => n / sides;
  const twenty = per(runs.filter((y) => y >= 20).length);
  const forty = runs.filter((y) => y >= 40).length;
  assert.ok(twenty > 0.56 && twenty < 0.9, `runs of 20+ per team ${twenty}`);
  assert.ok(forty >= 8, `runs of 40+ over ${sides} team-games: ${forty}`);
  assert.ok(Math.max(...runs) > 45, `longest run ${Math.max(...runs)} — the tail has a ceiling`);
});

test('third down is the hardest down', () => {
  // Third and long gets the rush home and the ball thrown past the marker, so
  // a series that reaches third down should gain less than one on first.
  // Before anything in the passing game read toGo third down gained *more*
  // than first — 6.27 yards against 6.18 — which is why the defence could not
  // get off the field. `passingDown()` in plays.js is what reads it now.
  const gain = { 1: [], 3: [] };
  const SCRIM = new Set(['run', 'pass', 'incomplete', 'sack']);
  for (let seed = 5000; seed < 5120; seed++) {
    const g = simulateGame(mk(seed));
    // Log entries carry post-play state, so the down a play was run on is the
    // previous entry's; a 'drive' entry opens a series at first and ten.
    let pre = null;
    for (const e of g.log) {
      if (e.type === 'drive') { pre = { down: 1, toGo: 10 }; continue; }
      if (SCRIM.has(e.type) && pre && gain[pre.down]) {
        let y = null;
        if (e.type === 'incomplete') y = 0;
        else {
          const m = /for (-?\d+) yards?/.exec(e.text);
          if (m) y = Number(m[1]);
          else if (/for no gain/.test(e.text)) y = 0;
          else { const l = /for a loss of (\d+)/.exec(e.text); if (l) y = -Number(l[1]); }
        }
        if (y != null) gain[pre.down].push(y);
      }
      if (e.down) pre = { down: e.down, toGo: e.toGo };
    }
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const first = mean(gain[1]), third = mean(gain[3]);
  assert.ok(gain[3].length > 500, `only ${gain[3].length} third-down plays sampled`);
  assert.ok(third < first, `third down gained ${third.toFixed(2)}, first down ${first.toFixed(2)}`);
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

test('every scrimmage play logs where it was snapped from and by whom', () => {
  // The field strip draws the play as a bar, which means it needs the line of
  // scrimmage and the frame to read it in. Neither is recoverable from the rest
  // of the entry: `ballOn`/`off` are post-play on an ordinary snap, pre-flip on
  // a turnover, and post-enforcement when a flag is tacked on.
  const SCRIMMAGE = new Set(['run', 'pass', 'incomplete', 'sack', 'int', 'fumble', 'punt', 'fg', 'kneel', 'spike', 'penalty']);
  const KICK = new Set(['punt', 'fg']);
  let drawn = 0, flags = 0, kicks = 0, ordinary = 0;
  for (let seed = 4000; seed < 4060; seed++) {
    const g = simulateGame(mk(seed));
    for (const e of g.log) {
      if (!SCRIMMAGE.has(e.type)) {
        assert.equal(e.from, undefined, `${e.type} should not claim a snap spot`);
        continue;
      }
      drawn++;
      if (e.type === 'penalty') flags++;
      assert.ok(Number.isInteger(e.from) && e.from >= 0 && e.from <= 100, `${e.type} from=${e.from}`);
      assert.ok(e.snapOff === 0 || e.snapOff === 1, `${e.type} snapOff=${e.snapOff}`);
      // The bar runs from the snap to `to` when the play carries one — a kick,
      // whose `yards` is 0 because nothing was gained from scrimmage — and to
      // `from + yards` otherwise. Either way it has to stay on the field.
      const end = e.to != null ? e.to : e.from + e.yards;
      assert.ok(end >= 0 && end <= 100, `${e.type} ends off the field: ${e.from} -> ${end}`);
      if (KICK.has(e.type)) { kicks++; assert.notEqual(e.to, undefined, `${e.type} has no landing spot`); }
      else assert.equal(e.to, undefined, `${e.type} should take its end from yards`);
      // On a clean snap the spot is checkable against the entry itself, which
      // pins `from` as pre-snap and `snapOff` as the club that had the ball.
      // Turnovers and kicks are logged before `changePossession`, and a flagged
      // play after enforcement, so for those the entry's own `ballOn` is not
      // the end of the play — which is the whole reason `from` exists.
      const keeps = !KICK.has(e.type) && e.type !== 'int' && e.type !== 'fumble';
      if (keeps && !e.flag && !e.scoring && e.off === e.snapOff) {
        ordinary++;
        assert.equal(e.ballOn, end, `${e.type}: ${e.from} + ${e.yards} != ${e.ballOn}`);
      }
    }
  }
  assert.ok(drawn > 4000, `only ${drawn} drawable plays sampled`);
  assert.ok(flags > 100, `only ${flags} penalties sampled`);
  assert.ok(kicks > 300, `only ${kicks} kicks sampled`);
  assert.ok(ordinary > 3000, `only ${ordinary} spot-checkable plays sampled`);
});

test('a coach can spend their own timeouts, and only at a legal moment', () => {
  const g = mk(77);
  step(g); // kickoff
  // Nothing to buy while the clock is stopped: a timeout cannot be banked.
  g.clockRunning = false;
  assert.equal(timeoutLegal(g, 0), false);
  assert.equal(callTimeout(g, 0), false);
  assert.deepEqual(g.timeouts, [3, 3]);

  g.clockRunning = true;
  assert.equal(timeoutLegal(g, 0), true);
  const logged = g.log.length;
  assert.equal(callTimeout(g, 0), true);
  assert.equal(g.timeouts[0], 2);
  assert.equal(g.clockRunning, false, 'a timeout stops the clock');
  assert.equal(g.log.at(-1).type, 'timeout');
  assert.equal(g.log.length, logged + 1);
  assert.equal(typeof g.log.at(-1).wp, 'number', 'the curve should show what it bought');

  g.timeouts[0] = 0;
  g.clockRunning = true;
  assert.equal(timeoutLegal(g, 0), false, 'none left');
  assert.equal(callTimeout(g, 0), false);

  g.timeouts[0] = 3;
  g.final = true;
  assert.equal(timeoutLegal(g, 0), false, 'the game is over');
});

test('a timeout buys back the play clock the next snap would burn', () => {
  // Same seed either side, so the only difference is the timeout.
  const spend = (take) => {
    const g = mk(78);
    while (!g.final && !(g.phase === 'play' && g.clockRunning && g.clock > 0)) step(g);
    if (g.final) return null;
    const before = g.clock;
    if (take) callTimeout(g, g.possession);
    step(g);
    return before - g.clock;
  };
  const burned = spend(false);
  const saved = spend(true);
  assert.ok(burned != null && saved != null);
  assert.ok(saved < burned, `timeout burned ${saved}s, no timeout ${burned}s`);
});

test('holding the clock stops the AI spending that club', () => {
  assert.equal(wantsTimeout(takeClock(mk(79), 0), 0), false, 'never, whatever the situation');
  // Whether the AI would have spent any in a given game is a coin flip, so
  // count over seeds. Stepped by hand, because every skip-ahead path delegates.
  let heldSpent = 0, autoSpent = 0, heldOpp = 0, autoOpp = 0;
  for (let seed = 79; seed < 99; seed++) {
    const held = takeClock(mk(seed), 0);
    const auto = mk(seed);
    for (let i = 0; i < 300 && !held.final && !auto.final; i++) {
      // Stop at halftime, which hands everybody three fresh ones.
      if (held.quarter > 2) break;
      step(held); step(auto);
      heldSpent += held.timeouts[0] < 3 ? 1 : 0;
      autoSpent += auto.timeouts[0] < 3 ? 1 : 0;
      // Counted inside the loop too: halftime hands back three fresh ones, so
      // reading the total afterwards reads zero however many were spent.
      heldOpp += held.timeouts[1] < 3 ? 1 : 0;
      autoOpp += auto.timeouts[1] < 3 ? 1 : 0;
    }
  }
  assert.equal(heldSpent, 0, 'the AI left the coach\'s timeouts alone in every game');
  assert.ok(autoSpent > 0, `and would otherwise have spent some (${autoSpent})`);
  assert.ok(heldOpp > 0 && autoOpp > 0, 'the other club stays the AI\'s to manage');
});

test('skipping ahead hands the clock back, and takes it again afterwards', () => {
  // A sim with the clock held must come out exactly as one without it: the
  // point of delegating is that Sim to end is managed as it always was.
  let held = 0, auto = 0;
  for (let seed = 79; seed < 99; seed++) {
    const h = takeClock(mk(seed), 0);
    simulateGame(h);
    assert.equal(h.userClock, 0, 'the clock comes back after the skip');
    const a = mk(seed);
    simulateGame(a);
    assert.deepEqual(h.score, a.score, `seed ${seed} diverged`);
    held += 3 - h.timeouts[0];
    auto += 3 - a.timeouts[0];
  }
  assert.equal(held, auto, 'the AI managed the sim either way');
});

test('a forced tempo overrides what the situation would have chosen', () => {
  const late = (tempo) => {
    const g = mk(81);
    g.quarter = 4; g.clock = 120; g.phase = 'play'; g.possession = 0;
    g.ballOn = 25; g.down = 1; g.toGo = 10; g.score = [17, 21];
    g.clockRunning = false; g.timeouts = [3, 3]; g.drive = null; g.drives = [];
    takeClock(g, 0);
    if (tempo) setTempo(g, 0, tempo);
    return g;
  };
  // Trailing by four with two minutes left is the textbook hurry-up, and the
  // heuristic reads it that way on its own.
  assert.equal(isHurryUp(late(null), 0), true);
  assert.equal(isClockKill(late(null), 0), false);
  assert.equal(isHurryUp(late('kill'), 0), false, 'a coach may bleed the clock anyway');
  assert.equal(isClockKill(late('kill'), 0), true);
  assert.equal(isHurryUp(late('normal'), 0), false, 'normal forces both off');
  assert.equal(isClockKill(late('normal'), 0), false);
  // And clearing it reads the situation again.
  const g = late('kill');
  setTempo(g, 0, null);
  assert.equal(isHurryUp(g, 0), true);
  // The other club is never touched by one club's choice.
  assert.equal(isHurryUp(late('kill'), 1), false);

  // Bleeding the clock really does run it out: the whole point of handing the
  // lever over is that it can be pulled the wrong way. Counted over a fixed
  // number of snaps, because running to the end of the quarter leaves both at
  // zero and compares nothing.
  const burn = (tempo) => {
    const x = late(tempo);
    x.clock = 600; x.clockRunning = true;
    for (let i = 0; i < 8 && !x.final && x.quarter === 4 && x.clock > 0; i++) step(x);
    return 600 - x.clock;
  };
  assert.ok(burn('kill') > burn('hurry'), `kill burned ${burn('kill')}s, hurry ${burn('hurry')}s`);
});
