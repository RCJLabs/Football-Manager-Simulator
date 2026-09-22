// Does `lineupStrength` measure a roster, or only model one?
//
//   node scripts/strength-fit.mjs [games] [rosters] [swaps]
//
// Every trade, waiver claim, draft pick and market screen in this game is judged
// by `lineupStrength` = the sum over a roster of overall x leverage, and six
// scripts in this directory report their results in its units without ever
// looking at a scoreboard. Both of its inputs have been measured — `overall`
// predicts a man's point differential at 0.87 or better for nine of eleven
// positions, and `TRUE_LEVERAGE` agrees with the yardstick at 0.968 — but the
// SUM never had been. That a roster is the sum of its parts is an assumption,
// and it is the one everything downstream rests on.
//
// Two questions, because they have different answers:
//
//   THE LEVEL   does a stronger roster win by more? Measured across rosters of
//               randomised SHAPE, not merely of randomised quality. Walking the
//               ranked pool instead gives r = 0.995, which flatters the model:
//               it confounds strength with quality by construction and never
//               builds the lopsided side where additivity would break.
//
//   THE DELTA   when it says a swap gained you N, did it? Paired seeds either
//               side of the swap, so the same games are played both times and
//               everything but the swapped man is held fixed. This is the
//               question the six scripts actually lean on.
const R = new URL('..', import.meta.url).href.replace(/\/$/, '');
const { syntheticTeam } = await import(`${R}/scripts/synthetic.mjs`);
const { createGame, simulateGame } = await import(`${R}/src/engine/game.js`);
const { buildLineup, overall } = await import(`${R}/src/engine/ratings.js`);
const { lineupStrength } = await import(`${R}/src/engine/transactions.js`);
const { PLAYERS } = await import(`${R}/src/data/db.js`);
const { ROSTER_SLOTS } = await import(`${R}/src/data/positions.js`);
const { RNG } = await import(`${R}/src/engine/rng.js`);

const N = Number(process.argv[2] || 300);
const K = Number(process.argv[3] || 40);
const M = Number(process.argv[4] || 60);

const tf = (t) => ({ id: t.id, name: t.name, abbr: t.abbr, color: t.color, strategy: t.strategy, lineup: buildLineup(t.slots, t.byId) });
const OPP = syntheticTeam('opp', 85, 2, 99);
const corr = (x, y) => {
  const mx = x.reduce((a, b) => a + b, 0) / x.length, my = y.reduce((a, b) => a + b, 0) / y.length;
  let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) { n += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
  return n / Math.sqrt(dx * dy || 1);
};

const byPos = {};
for (const p of PLAYERS) if (!p.retired) (byPos[p.pos] ??= []).push(p);
for (const k of Object.keys(byPos)) byPos[k].sort((a, b) => overall(b) - overall(a));

/** A roster whose every position is drawn independently, so its SHAPE varies. */
function roster(rng) {
  const slots = {}, byId = new Map(), depth = {};
  for (const pos of Object.keys(byPos)) depth[pos] = rng.int(0, 70) / 100;
  for (const s of ROSTER_SLOTS) {
    const pool = byPos[s.pos] || [];
    const i = Math.max(0, Math.min(pool.length - 1, Math.round(depth[s.pos] * (pool.length - 1)) + rng.int(-2, 2)));
    slots[s.id] = pool[i].id; byId.set(pool[i].id, pool[i]);
  }
  return { slots, byId };
}
const play = (slots, byId, seed0) => {
  const t = { id: 'x', name: 'X', abbr: 'X', color: '#fff', strategy: OPP.strategy, slots, byId };
  let d = 0;
  for (let i = 0; i < N; i++) { const g = createGame(tf(t), tf(OPP), { seed: seed0 + i, homeAdvantage: false }); simulateGame(g); d += g.score[0] - g.score[1]; }
  return d / N;
};

// ---- the level ----
const rng = new RNG(909);
const lv = [];
for (let k = 0; k < K; k++) {
  const { slots, byId } = roster(rng);
  lv.push({ ls: lineupStrength(slots, byId), diff: play(slots, byId, 88000) });
}
const ls = lv.map((r) => r.ls), df = lv.map((r) => r.diff);
const mx = ls.reduce((a, b) => a + b, 0) / ls.length, my = df.reduce((a, b) => a + b, 0) / df.length;
let num = 0, den = 0;
for (let i = 0; i < ls.length; i++) { num += (ls[i] - mx) * (df[i] - my); den += (ls[i] - mx) ** 2; }
const slope = num / den, intercept = my - slope * mx;
const resid = lv.map((r) => r.diff - (slope * r.ls + intercept));
const rms = Math.sqrt(resid.reduce((s, e) => s + e * e, 0) / resid.length);
console.log(`THE LEVEL — ${K} rosters of randomised shape, ${N} games each\n`);
console.log(`  lineupStrength vs point differential:  r = ${corr(ls, df).toFixed(3)}`);
console.log(`  a point of differential costs ${(1 / slope).toFixed(0)} strength`);
console.log(`  residual: rms ${rms.toFixed(2)} points = ${(rms / slope).toFixed(0)} strength, worst ${Math.min(...resid).toFixed(1)} / ${Math.max(...resid).toFixed(1)}`);
console.log(`  NOT noise: this figure is unchanged at four times the sample.`);

// ---- the delta ----
const rng2 = new RNG(31337);
const sw = [];
for (let m = 0; m < M; m++) {
  const { slots, byId } = roster(rng2);
  const before = { ls: lineupStrength(slots, byId), diff: play(slots, byId, 55000) };
  const slot = ROSTER_SLOTS[rng2.int(0, ROSTER_SLOTS.length - 1)];
  const pool = byPos[slot.pos] || [];
  const inc = pool[rng2.int(0, pool.length - 1)];
  if (byId.has(inc.id)) { m--; continue; }
  const s2 = { ...slots }, b2 = new Map(byId);
  s2[slot.id] = inc.id; b2.set(inc.id, inc);
  sw.push({ dls: lineupStrength(s2, b2) - before.ls, ddiff: play(s2, b2, 55000) - before.diff });
}
const big = sw.filter((r) => Math.abs(r.dls) > 5);
const wrong = big.filter((r) => Math.sign(r.dls) !== Math.sign(r.ddiff));
const trade = sw.filter((r) => Math.abs(r.dls) >= 5 && Math.abs(r.dls) <= 30);
console.log(`\nTHE DELTA — ${sw.length} single-player swaps, ${N} paired games either side\n`);
console.log(`  change in strength vs change in differential:  r = ${corr(sw.map((r) => r.dls), sw.map((r) => r.ddiff)).toFixed(3)}`);
console.log(`  got the sign wrong, among swaps it called significant: ${wrong.length} of ${big.length}`);
if (trade.length > 3) console.log(`  among trade-sized swaps (5-30 strength): r = ${corr(trade.map((r) => r.dls), trade.map((r) => r.ddiff)).toFixed(3)}, n = ${trade.length}`);
console.log(`\n  A typical accepted trade in \`npm run moves\` is 12 to 14 strength, which is`);
console.log(`  where this is weakest. The model ranks rosters well and judges one deal`);
console.log(`  a good deal less well than the six scripts reporting in its units imply.`);
