#!/usr/bin/env node
/**
 * Re-measure CALL_GRID in src/engine/playcall.js.
 *
 * The grid is what each pairing of an offensive and a defensive call is worth
 * in yards per play, measured from outside the engine rather than read off the
 * coefficients in game/plays.js. Run it whenever that matrix changes, and paste
 * the printed literal back into playcall.js.
 *
 *   node scripts/call-grid.mjs [snapsPerCell]
 *
 * Every snap is a neutral 1st & 10 at our own 25 between two evenly matched
 * 84-rated clubs, with penalties off: a flag before the snap decides the play
 * without the two calls ever meeting, and would only add noise.
 */
import { syntheticTeam } from './synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, step } from '../src/engine/game.js';
import { CALL_GRID } from '../src/engine/playcall.js';

const N = Number(process.argv[2] || 3000);
const OFF = Object.keys(CALL_GRID);
const DEF = ['base', 'run_stop', 'blitz', 'deep'];
const A = syntheticTeam('alpha', 84, 3, 1);
const B = syntheticTeam('bravo', 84, 3, 2);
const LA = buildLineup(A.slots, A.byId);
const LB = buildLineup(B.slots, B.byId);

function measure(off, def) {
  // Neutral site: HOME_EDGE adds to the home side's blocking, rush, coverage and
  // tackling, and a league-average reference should not carry it.
  const g = createGame({ ...A, lineup: LA }, { ...B, lineup: LB }, { seed: 4242, penalties: false, homeAdvantage: false });
  step(g); // clear the opening kickoff
  let yards = 0, plays = 0, success = 0, turnovers = 0;
  while (plays < N && !g.final) {
    g.quarter = 1; g.clock = 900; g.phase = 'play'; g.down = 1; g.toGo = 10;
    g.ballOn = 25; g.score = [0, 0]; g.clockRunning = false; g.drive = null;
    // Pin the offence. Without this a single fumble hands the ball over and
    // every snap after it is measured from the other side: in the first
    // published grid, 2,388 of 3,000 snaps in one cell were taken by the wrong
    // club, and each cell was a different mixture, so the whole table was
    // depressed by an amount that varied per row.
    g.possession = 0;
    const from = g.log.length;
    step(g, { off, def });
    const e = g.log.slice(from).find((x) => x.from != null);
    if (!e) continue;
    plays++;
    yards += e.yards || 0;
    if ((e.yards || 0) >= 4) success++;
    if (e.type === 'int' || e.type === 'fumble') turnovers++;
  }
  return { ypp: yards / plays, success: success / plays, to: turnovers / plays };
}

const grid = {};
console.log(`${N} snaps per cell\n`);
console.log('yards per play'.padEnd(15) + DEF.map((d) => d.padStart(10)).join('') + '     spread');
for (const off of OFF) {
  grid[off] = Object.fromEntries(DEF.map((d) => [d, measure(off, d)]));
  const y = DEF.map((d) => grid[off][d].ypp);
  console.log(off.padEnd(15) + y.map((v) => v.toFixed(2).padStart(10)).join('') + (Math.max(...y) - Math.min(...y)).toFixed(2).padStart(11));
}
console.log('\nsuccess rate (gained 4+)'.padEnd(15) + DEF.map((d) => d.padStart(10)).join(''));
for (const off of OFF) console.log(off.padEnd(15) + DEF.map((d) => `${(grid[off][d].success * 100).toFixed(0)}%`.padStart(10)).join(''));
console.log('\nturnover rate'.padEnd(15) + DEF.map((d) => d.padStart(10)).join(''));
for (const off of OFF) console.log(off.padEnd(15) + DEF.map((d) => `${(grid[off][d].to * 100).toFixed(1)}%`.padStart(10)).join(''));

console.log('\n--- paste into src/engine/playcall.js ---\n');
console.log('export const CALL_GRID = {');
for (const off of OFF) {
  console.log(`  ${(off + ':').padEnd(12)}{ ${DEF.map((d) => `${d}: ${grid[off][d].ypp.toFixed(2)}`).join(', ')} },`);
}
console.log('};');

// A call with no decision behind it is worth saying out loud rather than
// leaving for somebody to find in the numbers. Yards per play is not the whole
// value of a call — it ignores the turnovers and what an incompletion does to
// the clock — so read this as a flag to go and look, not a verdict.
const mean = (off) => DEF.reduce((a, d) => a + grid[off][d].ypp, 0) / DEF.length;
const floors = OFF.map((o) => [o, Math.min(...DEF.map((d) => grid[o][d].ypp)), mean(o)]).sort((a, b) => b[1] - a[1]);
console.log('\nworst case per call, best floor first:');
for (const [o, f, m] of floors) console.log(`  ${o.padEnd(12)} floor ${f.toFixed(2)}  mean ${m.toFixed(2)}  turnovers ${(DEF.reduce((a, d) => a + grid[o][d].to, 0) / DEF.length * 100).toFixed(1)}%`);
// A margin, because a cell that wins by a hundredth won by nothing: at 400
// snaps a bare >= comparison claims dominances that do not survive 3,000.
const MARGIN = 0.15;
console.log(`\ndominance (a call at least ${MARGIN} better against every defence):`);
let any = false;
for (const a of OFF) {
  const beaten = OFF.filter((b) => a !== b && DEF.every((d) => grid[a][d].ypp >= grid[b][d].ypp + MARGIN));
  if (beaten.length) { any = true; console.log(`  ! ${a} beats ${beaten.join(', ')} against every defence`); }
}
if (!any) console.log('  none');
