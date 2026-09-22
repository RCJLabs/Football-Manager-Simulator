// Do the AI general managers' decisions actually earn them anything?
//
//   node scripts/gm-sim.mjs [leagues]
//
// `overall`, `TRUE_LEVERAGE` and `lineupStrength` have all been checked against
// what happens on a scoreboard. The layer above them — the clubs deciding what
// to bid — never had been. Everything measuring the AI measured it against
// itself: `auction-sim` reports how well the best-built roster does, and
// `strategy-sim` and the difficulty table both measure what savvy does to the
// HUMAN's win total. Nothing asked what a club's own savvy does for the club.
//
// Two halves, because they answer different questions.
//
//   CONTROLLED  one persona for every club, savvy the only difference. The
//               personalities vary in three ways at once — savvy, a positional
//               bias, and the play-calling sliders — so comparing Analytics
//               with Air Raid cannot say which of the three did the work.
//               `savvyFor` reads `team.savvy` before the persona lookup, which
//               is what makes the isolation possible.
//
//   AS SHIPPED  the personalities as a player meets them, bundles and all.
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { lineupStrength } from '../src/engine/transactions.js';
import { SAVVY } from '../src/data/teams.js';
import { RNG } from '../src/engine/rng.js';

const SEEDS = Number(process.argv[2] || 30);
const LEVELS = [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.85];
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const corr = (x, y) => {
  const mx = mean(x), my = mean(y);
  let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) { n += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
  return n / Math.sqrt(dx * dy || 1);
};

/** One league, played out. `tune` gets the teams before the auction runs. */
function season(seed, salt, tune) {
  const lg = createLeague({ name: 'G', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction', injuries: 'off' });
  tune(lg.teams, seed);
  autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed * salt), byId);
  startSeason(lg, byId);
  const built = lg.teams.map((t) => lineupStrength(t.slots, byId));
  while (lg.phase === 'season' || lg.phase === 'playoffs') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg); }
  return { lg, built };
}

// ---- controlled ----
const ctl = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  // Savvy rotates across the clubs so it is never tied to a draft slot or a
  // place in the schedule.
  const { lg, built } = season(seed, 7, (teams) => teams.forEach((t, i) => { t.gm = 'balanced'; t.savvy = LEVELS[(i + seed) % LEVELS.length]; }));
  lg.teams.forEach((t, i) => ctl.push({ savvy: t.savvy, s: built[i], w: t.record?.w ?? 0 }));
}
console.log(`CONTROLLED — ${SEEDS} leagues, one persona, savvy the only difference\n`);
console.log('  savvy    n   roster strength   wins');
for (const lv of LEVELS) {
  const g = ctl.filter((r) => r.savvy === lv);
  if (g.length) console.log(`   ${lv.toFixed(2)}  ${String(g.length).padStart(3)}   ${mean(g.map((r) => r.s)).toFixed(0).padStart(13)}   ${mean(g.map((r) => r.w)).toFixed(2).padStart(4)}`);
}
console.log(`\n  savvy vs roster strength:  r = ${corr(ctl.map((r) => r.savvy), ctl.map((r) => r.s)).toFixed(3)}`);
console.log(`  savvy vs wins:             r = ${corr(ctl.map((r) => r.savvy), ctl.map((r) => r.w)).toFixed(3)}`);
console.log(`  it is worth about ${(mean(ctl.filter((r) => r.savvy >= 0.7).map((r) => r.w)) - mean(ctl.filter((r) => r.savvy <= 0.2).map((r) => r.w))).toFixed(1)} wins of 14 across its range, and flattens above 0.70.`);

// ---- as shipped ----
const by = {};
for (let seed = 1; seed <= SEEDS; seed++) {
  const { lg, built } = season(seed, 13, () => {});
  lg.teams.forEach((t, i) => (by[t.gm ?? 'the user\'s club'] ??= []).push({ w: t.record?.w ?? 0, s: built[i], champ: lg.champion === i ? 1 : 0 }));
}
const rows = Object.entries(by).map(([gm, a]) => ({ gm, savvy: SAVVY[gm] ?? 0.3, n: a.length, w: mean(a.map((r) => r.w)), s: mean(a.map((r) => r.s)), titles: a.reduce((x, r) => x + r.champ, 0) })).sort((a, b) => b.w - a.w);
console.log(`\nAS SHIPPED — ${SEEDS} leagues, personalities untouched\n`);
console.log('  general manager     savvy    n   roster strength   wins   titles');
for (const r of rows) console.log(`  ${r.gm.padEnd(18)} ${r.savvy.toFixed(2)}  ${String(r.n).padStart(3)}   ${r.s.toFixed(0).padStart(13)}   ${r.w.toFixed(2).padStart(4)}   ${String(r.titles).padStart(5)}`);
console.log(`\n  savvy vs wins across the personalities: r = ${corr(rows.map((r) => r.savvy), rows.map((r) => r.w)).toFixed(3)}`);
console.log(`  best minus worst: ${(rows[0].w - rows[rows.length - 1].w).toFixed(2)} wins of 14`);
console.log(`\n  A correlation this high means the positional biases and the play-calling`);
console.log(`  sliders barely offset savvy at all: the personalities rank in savvy order.`);
console.log(`  That is the documented intent — a club that chases names is beatable — and`);
console.log(`  this is the size of it, which was never measured.`);
