// How well does `overall` predict what a player produces?
//
// The other half of the yardstick question: not "are equals equal" but "does
// the number track reality at all". Samples a position across its whole rating
// range, plays each man in the same team, and correlates points produced
// against `overall` and against each attribute on its own. Cited in DESIGN.md
// under "Is the yardstick sound".
//
//   node scripts/yardstick-fit.mjs QB 160 24
//   node scripts/yardstick-fit.mjs OL 140 18
// Resolved from this file rather than written down. It used to be the absolute
// path of one particular checkout, which meant a copy of this script running
// anywhere else — a git worktree at an older commit, a clone in another
// directory, CI — silently measured THAT tree's engine instead of its own and
// reported the answer as though it were the local one. It cost a whole
// experiment: four runs against a 59-commit-old checkout, every one of them
// quietly importing today's engine and agreeing with it to three decimals.
const R = new URL('..', import.meta.url).href.replace(/\/$/, '');
const { syntheticTeam } = await import(`${R}/scripts/synthetic.mjs`);
const { createGame, simulateGame } = await import(`${R}/src/engine/game.js`);
const { buildLineup, overall } = await import(`${R}/src/engine/ratings.js`);
const { PLAYERS } = await import(`${R}/src/data/db.js`);
const { POSITIONS, ROSTER_SLOTS } = await import(`${R}/src/data/positions.js`);

const tf = (t) => ({ id: t.id, name: t.name, abbr: t.abbr, color: t.color, strategy: t.strategy, lineup: buildLineup(t.slots, t.byId) });
const BASE = syntheticTeam('a', 85, 2, 1), OPP = syntheticTeam('b', 85, 2, 2);
const POS = process.argv[2] || 'QB';
const N = Number(process.argv[3] || 160);
const K = Number(process.argv[4] || 24);
const slot = ROSTER_SLOTS.find((s) => s.pos === POS && s.starter).id;
const attrs = POSITIONS[POS].attrs;

const pool = PLAYERS.filter((p) => p.pos === POS && !p.retired).sort((a, b) => overall(b) - overall(a));
// Spread across the rating range so the fit has something to work with.
const step = Math.max(1, Math.floor(pool.length / K));
const men = [];
for (let i = 0; i < pool.length && men.length < K; i += step) men.push(pool[i]);

const rows = [];
for (const p of men) {
  const t = { ...BASE, slots: { ...BASE.slots }, byId: new Map(BASE.byId) };
  t.byId.set(p.id, p); t.slots[slot] = p.id;
  let pf = 0, pa = 0;
  for (let i = 0; i < N; i++) { const g = createGame(tf(t), tf(OPP), { seed: 31000 + i, homeAdvantage: false }); simulateGame(g); pf += g.score[0]; pa += g.score[1]; }
  rows.push({ p, pf: pf / N, pa: pa / N, ovr: overall(p) });
}
const corr = (xs, ys) => {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) { n += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return n / Math.sqrt(dx * dy || 1);
};
const pf = rows.map((r) => r.pf);
const pa = rows.map((r) => r.pa);
// A defender does not score points, he stops them, and this used to score every
// man by what his own team put up. On that measure a cornerback looked like a
// weak spot in `overall` — r = 0.720 over a 2.6-point spread — which was not a
// fact about corners but about reading the echo instead of the effect. The same
// men, scored on what the OPPONENT puts up, correlate at -0.976 over 5.1 points.
// The headline is the differential, which is right for both halves of the team:
// for a quarterback it is almost the same number it always was, and for a corner
// it is the difference between measuring him and not.
const diff = rows.map((r) => r.pf - r.pa);
const ovrs = rows.map((r) => r.ovr);
const span = (a) => Math.max(...a) - Math.min(...a);
console.log(`${POS}: ${rows.length} men across the rating range, ${N} games each\n`);
console.log(`  overall vs point differential:  r = ${corr(ovrs, diff).toFixed(3)}   over ${span(diff).toFixed(1)} points, worst to best`);
console.log(`    of which, points his team scores:   r = ${corr(ovrs, pf).toFixed(3).padStart(6)}   over ${span(pf).toFixed(1)}`);
console.log(`              points the opponent scores: r = ${corr(ovrs, pa).toFixed(3).padStart(6)}   over ${span(pa).toFixed(1)}`);
console.log('\n  each attribute on its own, against the differential:');
const byR = attrs.map((a) => ({ a, r: corr(rows.map((x) => x.p.r[a] ?? 0), diff) })).sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
for (const { a, r } of byR) console.log(`    ${a.padEnd(5)} r = ${r.toFixed(3)}`);
console.log(`\n  rating range covered: ${Math.min(...ovrs)} to ${Math.max(...ovrs)}`);
console.log(`  differential range:   ${Math.min(...diff).toFixed(1)} to ${Math.max(...diff).toFixed(1)}`);
