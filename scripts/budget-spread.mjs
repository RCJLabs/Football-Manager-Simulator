// What unequal cap room is worth, in points a game.
//
//   node scripts/budget-spread.mjs [leagues] [teams]
//
// The claim this feature was built on was measured before the player pool was
// rewritten, before awareness and power reached the field and before the rating
// weights were refitted, so it is measured again here rather than trusted.
//
// The reading is the best-to-worst differential: run a full season, take each
// club's average point margin, and report the gap between the strongest and the
// weakest. That is the number a player feels as "does it matter who I am".
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { RNG } from '../src/engine/rng.js';
import { buildLineup, teamPower } from '../src/engine/ratings.js';

const L = Number(process.argv[2] || 24);
const N = Number(process.argv[3] || 10);

function season(spread, seed) {
  const lg = createLeague({ name: 's', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: N, seed, draftType: 'auction', budgetSpread: spread });
  const rng = new RNG(lg.rngState);
  autoCompleteAll(lg.auction, lg, PLAYERS, rng, byId);
  lg.rngState = rng.state;
  startSeason(lg, byId);
  while (lg.phase === 'season') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  const margins = lg.teams.map((t) => (t.record.pf - t.record.pa) / Math.max(1, t.record.w + t.record.l + t.record.t));
  // Roster strength carries no season variance, so it answers "did the money
  // buy a better squad" without thirteen games of luck on top. A point of power
  // is worth about 3.25 points of margin — the constant winprob.js uses — so
  // the two columns are comparable once scaled.
  const powers = lg.teams.map((t) => teamPower(buildLineup(t.slots, byId, lg.injuries)));
  const budgets = lg.auction.startBudgets;
  return { margins, powers, budgets };
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
console.log(`${L} leagues of ${N}, full seasons, auction-built.\n`);
console.log('spread   power gap  as margin   season gap (noisy)   corr(budget, power)');
for (const spread of [0, 0.1, 0.2, 0.4]) {
  const gaps = [], pgaps = [], corrs = [];
  for (let i = 0; i < L; i++) {
    const { margins, powers, budgets } = season(spread, 900 + i);
    gaps.push(Math.max(...margins) - Math.min(...margins));
    pgaps.push(Math.max(...powers) - Math.min(...powers));
    const mb = mean(budgets), mp = mean(powers);
    const cov = budgets.reduce((s, b, k) => s + (b - mb) * (powers[k] - mp), 0);
    const sb = Math.sqrt(budgets.reduce((s, b) => s + (b - mb) ** 2, 0));
    const sp = Math.sqrt(powers.reduce((s, x) => s + (x - mp) ** 2, 0));
    if (sb > 0 && sp > 0) corrs.push(cov / (sb * sp));
  }
  const seOf = (a) => Math.sqrt(a.reduce((s, g) => s + (g - mean(a)) ** 2, 0) / (a.length * (a.length - 1)));
  console.log(`  ${String(spread).padEnd(5)}  ${mean(pgaps).toFixed(2).padStart(7)} ±${seOf(pgaps).toFixed(2)}  ${(mean(pgaps) * 3.25).toFixed(1).padStart(7)}   ${mean(gaps).toFixed(1).padStart(10)} ±${seOf(gaps).toFixed(1)}   ${corrs.length ? mean(corrs).toFixed(2) : '—'}`);
}
