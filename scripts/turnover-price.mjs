// What a giveaway is actually worth, in yards.
//
//   node scripts/turnover-price.mjs [snaps]
//
// `playbook-equilibrium.mjs` scores a play as its yards less its turnover rate
// times a price, and that price was asserted rather than measured: "a giveaway
// is worth about four points and four points is about forty yards". The second
// half of that does not survive contact with the model it is talking about —
// EP_PER_YARD is 0.0539, so four points is seventy-four yards, not forty. And
// the first half is low too: under a linear expected-points curve the swing is
//
//     EP(x) + EP(100 - x) = (0.0539x - 0.215) + (5.175 - 0.0539x) = 4.96
//
// constant in field position, because what you lose and what the other side
// gains move in opposite directions at the same rate.
//
// Rather than trust either arm of that, this fits the price from the engine's
// own behaviour. For every snap it takes the whole position value from the
// offence's perspective — score plus expected points, the same quantity
// `winProbability` reads — before and after, then:
//
//   * regresses that change on yards gained, over plays that kept the ball,
//     which gives what a yard is really worth once downs convert;
//   * averages it over plays that lost the ball, returns and pick-sixes and all;
//   * reports the gap between them in yards.
//
// Down conversion is why this is a fit and not arithmetic: a yard on third and
// one is worth far more than a yard on first and ten, and only the engine knows
// the mixture.
import { syntheticTeam } from './synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, step } from '../src/engine/game.js';
import { expectedPoints } from '../src/engine/winprob.js';
import { RNG } from '../src/engine/rng.js';

const N = Number(process.argv[2] || 60000);
// `playbook-equilibrium.mjs` pins every snap at first and ten from the 25, so
// that is the situation whose price its grid needs — not the average over a
// down tree it never visits.
const GRID_SPOT = { down: 1, toGo: 10, ballOn: 25 };
const A = syntheticTeam('alpha', 84, 3, 1);
const B = syntheticTeam('bravo', 84, 3, 2);
const LA = buildLineup(A.slots, A.byId);
const LB = buildLineup(B.slots, B.byId);

/** Everything the offence owns right now, in points, from team 0's side. */
function value(g) {
  let v = g.score[0] - g.score[1];
  if (g.phase === 'play') v += (g.possession === 0 ? 1 : -1) * expectedPoints(g.ballOn, g.down, g.toGo);
  else if (g.phase === 'pat') v += (g.patTeam === 0 ? 1 : -1) * 1.0;
  else if (g.phase === 'kickoff') v += (g.kickingTeam === 0 ? -1 : 1) * 0.4;
  return v;
}

const rng = new RNG(20240);
const keep = [];          // { yards, dv } for plays that kept the ball
const lost = [];          // dv for plays that gave it away
const byDown = {};

const g = createGame({ ...A, lineup: LA }, { ...B, lineup: LB }, { seed: 4242, penalties: false, homeAdvantage: false });
step(g);
let snaps = 0;
while (snaps < N && !g.final) {
  // Spread the sample over the field and the down tree rather than pinning one
  // spot: the whole question is whether the price depends on the situation.
  const pinned = snaps % 2 === 0;   // half the sample on the grid's own snap
  const down = pinned ? GRID_SPOT.down : rng.int(1, 4);
  const toGo = pinned ? GRID_SPOT.toGo : (down === 1 ? 10 : rng.int(1, 15));
  const ballOn = pinned ? GRID_SPOT.ballOn : rng.int(5, 90);
  g.quarter = 1; g.clock = 900; g.phase = 'play'; g.possession = 0;
  g.down = down; g.toGo = Math.min(toGo, 100 - ballOn); g.ballOn = ballOn;
  g.score = [0, 0]; g.clockRunning = false; g.drive = null;
  const before = value(g);
  const from = g.log.length;
  step(g);
  const e = g.log.slice(from).find((x) => x.from != null);
  if (!e || e.type === 'punt' || e.type === 'fg' || e.type === 'kickoff') continue;
  snaps++;
  const dv = value(g) - before;
  const turned = e.type === 'int' || e.type === 'fumble';
  const bucket = (byDown[down] ??= { lost: [], keep: [] });
  const grid = (byDown.grid ??= { lost: [], keep: [] });
  if (turned) { lost.push(dv); bucket.lost.push(dv); if (pinned) grid.lost.push(dv); }
  else {
    const row = { yards: e.yards || 0, dv };
    keep.push(row); bucket.keep.push(row); if (pinned) grid.keep.push(row);
  }
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
/** Least squares of dv on yards: slope is what a yard is worth. */
function fit(rows) {
  const mx = mean(rows.map((r) => r.yards)), my = mean(rows.map((r) => r.dv));
  let num = 0, den = 0;
  for (const r of rows) { num += (r.yards - mx) * (r.dv - my); den += (r.yards - mx) ** 2; }
  const slope = den ? num / den : 0;
  return { slope, intercept: my - slope * mx };
}

const f = fit(keep);
const t = mean(lost);
const price = (f.intercept - t) / f.slope;
console.log(`${snaps} scrimmage snaps, ${lost.length} of them giveaways (${(100 * lost.length / snaps).toFixed(1)}%)\n`);
console.log(`a yard is worth            ${f.slope.toFixed(4)} points   (the model's own EP_PER_YARD is 0.0539)`);
console.log(`a play that keeps the ball ${f.intercept.toFixed(3)} points at zero yards`);
console.log(`a play that loses it       ${t.toFixed(3)} points`);
console.log(`\nso a giveaway costs        ${(f.intercept - t).toFixed(2)} points = ${price.toFixed(0)} YARDS`);
console.log('\nby down (does the price move with the situation?)');
console.log('  down   giveaways   cost in points   in yards');
for (const d of [1, 2, 3, 4, 'grid']) {
  const r = byDown[d];
  if (!r || r.lost.length < 30 || r.keep.length < 200) continue;
  const fd = fit(r.keep), td = mean(r.lost);
  const label = d === 'grid' ? '1&10@25' : String(d);
  console.log(`  ${label.padEnd(7)}${String(r.lost.length).padStart(6)}        ${(fd.intercept - td).toFixed(2).padStart(7)}       ${((fd.intercept - td) / fd.slope).toFixed(0).padStart(6)}`);
}
