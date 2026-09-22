// Do two players the markets price identically actually play the same?
//
// Every market in the game — trades, the wire, keepers, the auction advice —
// values a man as `overall` weighted by his position's leverage. This puts one
// man into an otherwise identical synthetic team, plays a few hundred games
// against a fixed opponent, and reports the spread across a band of players who
// all carry the same rating. The last line is the noise floor: the same man
// replayed on different seeds. Cited in DESIGN.md under "Is the yardstick
// sound".
//
//   node scripts/yardstick.mjs WR 300
//   node scripts/yardstick.mjs QB 250
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
const { ROSTER_SLOTS } = await import(`${R}/src/data/positions.js`);

const tf = (t) => ({ id: t.id, name: t.name, abbr: t.abbr, color: t.color, strategy: t.strategy, lineup: buildLineup(t.slots, t.byId) });
const BASE = syntheticTeam('a', 85, 2, 1), OPP = syntheticTeam('b', 85, 2, 2);
const N = Number(process.argv[3] || 300);

function withPlayer(base, slotId, p) {
  const t = { ...base, slots: { ...base.slots }, byId: new Map(base.byId) };
  t.byId.set(p.id, p);
  t.slots[slotId] = p.id;
  return t;
}
function scoreOf(team, seedBase) {
  let pf = 0, pa = 0;
  for (let i = 0; i < N; i++) {
    const g = createGame(tf(team), tf(OPP), { seed: seedBase + i, homeAdvantage: false });
    simulateGame(g);
    pf += g.score[0]; pa += g.score[1];
  }
  return { pf: pf / N, pa: pa / N };
}

const POS = process.argv[2] || 'WR';
const slot = ROSTER_SLOTS.find((s) => s.pos === POS && s.starter).id;
const pool = PLAYERS.filter((p) => p.pos === POS && !p.retired);
const byOvr = new Map();
for (const p of pool) { const o = overall(p); if (!byOvr.has(o)) byOvr.set(o, []); byOvr.get(o).push(p); }
// The most crowded rating band, so the comparison is same-overall by construction.
const band = [...byOvr.entries()].sort((a, b) => b[1].length - a[1].length)[0];
const men = band[1].slice(0, 8);
console.log(`${POS}, every man rated ${band[0]} — ${band[1].length} of them in the pool, testing ${men.length} over ${N} games each\n`);
const out = [];
for (const p of men) {
  const r = scoreOf(withPlayer(BASE, slot, p), 20000);
  out.push({ p, ...r });
}
out.sort((a, b) => b.pf - a.pf);
console.log('  pts for   name');
for (const o of out) console.log(`   ${o.pf.toFixed(2).padStart(6)}   ${o.p.name}`);
const pfs = out.map((o) => o.pf);
const spread = Math.max(...pfs) - Math.min(...pfs);
const mean = pfs.reduce((a, b) => a + b, 0) / pfs.length;
const sd = Math.sqrt(pfs.reduce((s, x) => s + (x - mean) ** 2, 0) / pfs.length);
// Noise floor: the same team played twice with different seeds.
const a1 = scoreOf(withPlayer(BASE, slot, men[0]), 40000).pf;
const a2 = scoreOf(withPlayer(BASE, slot, men[0]), 70000).pf;
console.log(`\n  spread across identical ratings: ${spread.toFixed(2)} points (sd ${sd.toFixed(2)})`);
console.log(`  same man, different seeds:        ${Math.abs(a1 - a2).toFixed(2)} points  <- the noise floor`);
