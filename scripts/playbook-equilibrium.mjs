#!/usr/bin/env node
/**
 * Solve the play-call matrix for what it is actually worth.
 *
 *   node scripts/playbook-equilibrium.mjs [snapsPerCell] [turnoverYards]
 *
 * `scripts/call-grid.mjs` says what each pairing yields. That is not the same
 * as what the playbook is worth, because both sides call at the same time: the
 * question is not "what is the best answer to a two-high shell" but "what is
 * the game worth when neither side can be predicted". This runs fictitious play
 * over the matrix and prints the mixes both sides should use.
 *
 * Two lessons are baked in here because both were learned the hard way.
 *
 * The first is that a column's maximum — the offence's best answer to a look —
 * is not a measure of how good that look is. Reading the grid that way said the
 * two-high shell was far and away the strongest defensive call and needed
 * weakening. It is not: at equilibrium the defence mixes base and shell, which
 * are near-tied best replies to what the offence should be doing.
 *
 * The second is that yards are not the payoff. Priced in yards alone the
 * offence should throw deep on every snap and the defence should play the shell
 * on every snap, which is nonsense. A play is worth its yards less its turnover
 * rate times what a giveaway costs, and that price is now measured rather than
 * asserted: `npm run turnover` fits it from the engine's own behaviour and puts
 * it at 58 yards for this grid's situation — first and ten from the 25 — which
 * is where every snap here is taken.
 *
 * It used to say 40, on the reasoning that a giveaway is worth four points and
 * four points is forty yards. Both halves were out. The swing measures 4.32
 * points, and a yard is not worth EP_PER_YARD here: that constant prices field
 * position, while a yard gained on a play also converts downs, which the fit
 * puts at about 0.093 points a yard. Four points was therefore never forty
 * yards.
 *
 * The answer barely leans on it, which is the reassuring part. At 40 the
 * defence mixes base 17% with the shell 83% and the offence run_out 39% with
 * play action 61%; at 58 that is 27/73 and 37/63. Same two live defensive
 * calls, same two dead ones, deep ball out of the mix either way. Pass another
 * number to see for yourself.
 */
import { syntheticTeam } from './synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, step } from '../src/engine/game.js';
import { CALL_GRID, DEFENSE_CALLS } from '../src/engine/playcall.js';

const N = Number(process.argv[2] || 2500);
const TURNOVER_YDS = Number(process.argv[3] || 58);
const OFF = Object.keys(CALL_GRID);
const DEF = Object.keys(DEFENSE_CALLS);
const A = syntheticTeam('alpha', 84, 3, 1);
const B = syntheticTeam('bravo', 84, 3, 2);
const LA = buildLineup(A.slots, A.byId);
const LB = buildLineup(B.slots, B.byId);

function measure(off, def) {
  const g = createGame({ ...A, lineup: LA }, { ...B, lineup: LB }, { seed: 4242, penalties: false, homeAdvantage: false });
  step(g);
  let yards = 0, plays = 0, turnovers = 0;
  while (plays < N && !g.final) {
    g.quarter = 1; g.clock = 900; g.phase = 'play'; g.possession = 0; g.down = 1; g.toGo = 10;
    g.ballOn = 25; g.score = [0, 0]; g.clockRunning = false; g.drive = null;
    const from = g.log.length;
    step(g, { off, def });
    const e = g.log.slice(from).find((x) => x.from != null);
    if (!e) continue;
    plays++;
    yards += e.yards || 0;
    if (e.type === 'int' || e.type === 'fumble') turnovers++;
  }
  return { ypp: yards / plays, to: turnovers / plays };
}

/** Fictitious play: each side keeps answering the other's history until it settles. */
function solve(M, iters = 200000) {
  const oc = OFF.map(() => 0), dc = DEF.map(() => 0);
  const op = OFF.map(() => 0), dp = DEF.map(() => 0);
  for (let t = 0; t < iters; t++) {
    let bo = 0; for (let i = 1; i < OFF.length; i++) if (op[i] > op[bo]) bo = i;
    let bd = 0; for (let j = 1; j < DEF.length; j++) if (dp[j] < dp[bd]) bd = j;
    oc[bo]++; dc[bd]++;
    for (let i = 0; i < OFF.length; i++) op[i] += M[i][bd];
    for (let j = 0; j < DEF.length; j++) dp[j] += M[bo][j];
  }
  const om = oc.map((c) => c / iters), dm = dc.map((c) => c / iters);
  let v = 0;
  for (let i = 0; i < OFF.length; i++) for (let j = 0; j < DEF.length; j++) v += om[i] * dm[j] * M[i][j];
  return { om, dm, v };
}

const raw = {}, adj = {};
for (const o of OFF) {
  raw[o] = []; adj[o] = [];
  for (const d of DEF) { const m = measure(o, d); raw[o].push(m.ypp); adj[o].push(m.ypp - m.to * TURNOVER_YDS); }
}

console.log(`${N} snaps a cell, a giveaway priced at ${TURNOVER_YDS} yards\n`);
console.log('yards less turnovers'.padEnd(20) + DEF.map((d) => d.padStart(10)).join(''));
for (const o of OFF) console.log(o.padEnd(20) + adj[o].map((v) => v.toFixed(2).padStart(10)).join(''));

for (const [label, G] of [['raw yards', raw], ['yards less turnovers', adj]]) {
  const { om, dm, v } = solve(OFF.map((o) => G[o]));
  console.log(`\npayoff: ${label} — the playbook is worth ${v.toFixed(2)} a play`);
  console.log('  defence should call ' + DEF.map((d, j) => `${d} ${(dm[j] * 100).toFixed(0)}%`).join(', '));
  console.log('  offence should call ' + OFF.map((o, i) => `${o} ${(om[i] * 100).toFixed(0)}%`).filter((x) => !x.endsWith(' 0%')).join(', '));
}

// A call nobody should ever make at first down is a call doing no work there.
const { dm } = solve(OFF.map((o) => adj[o]));
const dead = DEF.filter((_, j) => dm[j] < 0.02);
if (dead.length) console.log(`\n! never worth calling at 1st & 10: ${dead.join(', ')} — they earn their place in their own situations, not here.`);

// Read the shape, not the percentages. Base and the shell are near-tied best
// replies, so the split between them swings by twenty points between a 1,200
// snap sample and a 2,500 one without anything having changed. What is stable
// across sample sizes and across any sane turnover price is the shape: the
// defence mixes base and shell and leaves the other two alone at first down,
// the offence mixes the outside run with a pass, and scoring it in raw yards
// gives a degenerate answer that is worth nothing.
console.log('\nThe split between base and the shell is noisy — they are near-tied, so it moves'
  + '\nwith the sample. The shape is what holds: two live defensive calls, two dead ones.');
