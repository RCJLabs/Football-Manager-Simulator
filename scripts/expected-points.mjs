// What a drive is actually worth from each spot on the field.
//
//   node scripts/expected-points.mjs [games]
//
// Expected points is the number every fourth-down decision and the whole
// win-probability prior rest on, and the curve in winprob.js was a straight
// line written by hand: `(ballOn - 20) / 12 + 0.6`, which puts midfield at 3.1
// points where real football is nearer 2. As a small correction inside a
// probability model that passed unnoticed; used to decide whether to punt it
// says go for it on fourth and five from your own forty.
//
// So it is measured instead, the way the real number is: take every drive, find
// the next score by anybody, and credit it to the side with the ball — plus if
// they scored it, minus if the other side did. Averaged by where the drive
// started, that is expected points.

import { syntheticTeam } from './synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, simulateGame } from '../src/engine/game.js';

const N = Number(process.argv[2] || 600);
const BUCKET = 5;
const buckets = new Map();

for (let i = 0; i < N; i++) {
  const a = syntheticTeam(`ea${i}`, 82, 4, 21000 + i);
  const b = syntheticTeam(`eb${i}`, 82, 4, 21500 + i);
  const g = createGame({ ...a, lineup: buildLineup(a.slots, a.byId) }, { ...b, lineup: buildLineup(b.slots, b.byId) }, { seed: 21000 + i });
  simulateGame(g);
  const drives = g.drives || [];
  for (let d = 0; d < drives.length; d++) {
    const me = drives[d].team;
    // Walk forward to the next score; a half that ends first is worth nothing.
    let points = null;
    for (let k = d; k < drives.length; k++) {
      const r = drives[k].result || '';
      if (/end of (half|game|regulation)/.test(r)) { points = 0; break; }
      if (r === 'TD') { points = drives[k].team === me ? 7 : -7; break; }
      if (r === 'FG') { points = drives[k].team === me ? 3 : -3; break; }
      if (r === 'safety') { points = drives[k].team === me ? -2 : 2; break; }
    }
    if (points === null) points = 0;
    const key = Math.min(95, Math.max(5, Math.round(drives[d].startBallOn / BUCKET) * BUCKET));
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(points);
  }
}

const rows = [...buckets.entries()].sort((x, y) => x[0] - y[0])
  .map(([spot, vals]) => ({ spot, n: vals.length, ep: vals.reduce((s, v) => s + v, 0) / vals.length }))
  .filter((r) => r.n >= 40);

console.log('own goal line is 0, opponent goal line is 100\n');
console.log('  spot   drives      measured EP    the old straight line');
for (const r of rows) {
  const old = (r.spot - 20) / 12 + 0.6;
  console.log(`  ${String(r.spot).padStart(4)}   ${String(r.n).padStart(6)}   ${r.ep.toFixed(2).padStart(12)}   ${old.toFixed(2).padStart(20)}`);
}

// A straight line through the measured points, weighted by how many drives are
// behind each: the far end of the field is thin, and an unweighted fit lets a
// handful of drives from the opponent's ten drag the whole curve.
const W = rows.reduce((s, r) => s + r.n, 0);
const mx = rows.reduce((s, r) => s + r.spot * r.n, 0) / W;
const my = rows.reduce((s, r) => s + r.ep * r.n, 0) / W;
let sxy = 0, sxx = 0;
for (const r of rows) { sxy += r.n * (r.spot - mx) * (r.ep - my); sxx += r.n * (r.spot - mx) ** 2; }
const slope = sxy / sxx;
const intercept = my - slope * mx;
const at = (x) => slope * x + intercept;
console.log(`\nweighted fit: ep = ballOn * ${slope.toFixed(4)} ${intercept >= 0 ? '+' : '-'} ${Math.abs(intercept).toFixed(3)}`);
console.log(`  own 20 ${at(20).toFixed(2)} (real ~0.6) · midfield ${at(50).toFixed(2)} (~2.0) · opp 20 ${at(80).toFixed(2)} (~4.2) · opp 5 ${at(95).toFixed(2)} (~5.2)`);
let err = 0, tot = 0;
for (const r of rows) { err += r.n * Math.abs(r.ep - at(r.spot)); tot += r.n; }
console.log(`  mean error against the measured buckets: ${(err / tot).toFixed(2)} points`);
