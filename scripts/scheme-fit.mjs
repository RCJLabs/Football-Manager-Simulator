// Would a coordinator's scheme re-sort who is good?
//
//   node scripts/scheme-fit.mjs
//
// A coordinator with a scheme is only a decision if players suit one scheme
// more than another, and the audit already records that the pool is collinear
// enough that almost any sensible weighting of a position ranks it about the
// same. That is true of a whole position and it is the wrong population: a
// scheme is for the men who start. So each position gets two schemes, each a
// weighting of its attributes tilted toward one side of a real football choice,
// and the pool is ranked under both — every rated man, and then the top
// quarter by the shipped weights, which is roughly who starts.
//
// This measures the pool only. Whether the ENGINE plays those axes differently
// is a separate question, answered by reading `resolveRun` and `resolvePass` in
// game/plays.js, and for most of them it does not (DESIGN.md, "Why there are no
// coordinators").
import { PLAYERS } from '../src/data/db.js';
import { POSITIONS } from '../src/data/positions.js';

const real = PLAYERS.filter((p) => !p.generated);
const corr = (xs, ys) => {
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};
const ranks = (xs) => { const r = new Array(xs.length); xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).forEach(([, i], k) => { r[i] = k; }); return r; };
const spearman = (xs, ys) => corr(ranks(xs), ranks(ys));
const score = (p, w) => Object.entries(w).reduce((s, [a, x]) => s + (p.r[a] ?? 60) * x, 0);

// Each pair sums to the same total weight, so neither scheme is "better", only
// different. Corners have no second attribute worth a scheme, which the table
// shows rather than hides.
const SCHEMES = {
  QB: [['pocket passer', { tha: 0.45, awr: 0.35, thp: 0.2, mob: 0 }], ['mobile, vertical', { tha: 0.25, awr: 0.2, thp: 0.3, mob: 0.25 }]],
  RB: [['power', { pow: 0.35, car: 0.15, awr: 0.2, spd: 0.2, elu: 0.05, rec: 0.05 }], ['zone and space', { elu: 0.3, spd: 0.3, rec: 0.2, awr: 0.15, pow: 0.03, car: 0.02 }]],
  WR: [['vertical', { spd: 0.5, cth: 0.2, rte: 0.1, rac: 0.2 }], ['timing', { rte: 0.45, cth: 0.4, spd: 0.05, rac: 0.1 }]],
  TE: [['in-line', { blk: 0.55, cth: 0.2, rte: 0.1, rac: 0.1, spd: 0.05 }], ['move', { cth: 0.3, rte: 0.3, rac: 0.2, spd: 0.2, blk: 0 }]],
  OL: [['pass protection', { pbk: 0.75, rbk: 0.15, awr: 0.1 }], ['run blocking', { rbk: 0.75, pbk: 0.15, awr: 0.1 }]],
  DL: [['penetrate', { prs: 0.8, rsd: 0.05, tck: 0.1, awr: 0.05 }], ['two-gap', { rsd: 0.5, tck: 0.3, prs: 0.1, awr: 0.1 }]],
  CB: [['press man', { cov: 0.55, spd: 0.25, bal: 0.15, awr: 0.05, tck: 0 }], ['zone', { cov: 0.45, awr: 0.3, tck: 0.15, bal: 0.05, spd: 0.05 }]],
  S: [['centre field', { cov: 0.5, spd: 0.3, bal: 0.1, awr: 0.1, tck: 0, rsd: 0 }], ['box', { tck: 0.4, rsd: 0.35, cov: 0.15, awr: 0.1, spd: 0, bal: 0 }]],
};

console.log('Every rated man at a position ranked under two schemes; rank correlation across all of them and across the top quarter,');
console.log('and how many of one scheme\'s top quarter fall out of the other\'s');
console.log('  pos    men   schemes                               all    top quarter   leave the top quarter');
for (const [pos, [[na, wa], [nb, wb]]] of Object.entries(SCHEMES)) {
  const ps = real.filter((p) => p.pos === pos);
  const base = ps.map((p) => score(p, POSITIONS[pos].weights));
  const q = Math.floor(ps.length / 4);
  const cut = [...base].sort((x, y) => y - x)[q];
  const top = ps.filter((_, i) => base[i] >= cut);
  const a = ps.map((p) => score(p, wa)), b = ps.map((p) => score(p, wb));
  const qa = [...a].sort((x, y) => y - x)[q], qb = [...b].sort((x, y) => y - x)[q];
  const inA = ps.filter((_, i) => a[i] >= qa).map((p) => p.id);
  const inB = new Set(ps.filter((_, i) => b[i] >= qb).map((p) => p.id));
  const out = inA.filter((id) => !inB.has(id)).length;
  console.log(`  ${pos.padEnd(3)} ${String(ps.length).padStart(5)}   ${`${na} / ${nb}`.padEnd(36)} ${spearman(a, b).toFixed(2).padStart(5)}   ${spearman(top.map((p) => score(p, wa)), top.map((p) => score(p, wb))).toFixed(2).padStart(11)}   ${`${out} of ${inA.length} (${Math.round(100 * out / inA.length)}%)`.padStart(21)}`);
}
