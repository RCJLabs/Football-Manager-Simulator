// Does the auction actually make roster building matter? Drafts full leagues
// both ways, plays the seasons, and reports how much team quality varies and
// how strongly it predicts wins. Usage: node scripts/auction-sim.mjs [leagues]
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek, standings, powerRankings } from '../src/engine/season.js';
import { autoDraftAll, RNG } from '../src/engine/draft.js';
import { autoCompleteAll, spendByPos } from '../src/engine/auction.js';
import { overall, buildLineup } from '../src/engine/ratings.js';

const L = Number(process.argv[2] || 12);

// Leverage-weighted roster quality: what the simulation actually rewards.
// Plain team power averages every starter equally, which rates an elite-QB /
// weak-line roster the same as a balanced one, so it cannot see whether an
// auction roster is well built.
const LEV = { QB: 16.6, TE: 9.3, RB: 5.0, WR: 4.4, CB: 4.2, S: 3.0, LB: 2.7, DL: 2.45, OL: 1.9, K: 0.35, P: 0.2 };
const STARTERS = { QB: 1, RB: 1, WR: 3, TE: 1, OL: 5, DL: 4, LB: 3, CB: 2, S: 2, K: 1, P: 1 };
function trueStrength(lineup) {
  let total = 0;
  for (const [pos, n] of Object.entries(STARTERS)) {
    const arr = (lineup[pos] || []).slice(0, n);
    if (!arr.length) continue;
    const avg = arr.reduce((s, p) => s + overall(p), 0) / arr.length;
    total += (avg - 80) * LEV[pos] * n;
  }
  return Math.round(total * 10) / 10;
}

function corr(a, b) {
  const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(sa * sb || 1);
}

function run(draftType) {
  const rows = [];
  const spreads = [];
  let sample = null;
  for (let i = 0; i < L; i++) {
    const league = createLeague({ name: 'x', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 3000 + i, draftType });
    const rng = new RNG(league.rngState);
    if (draftType === 'auction') autoCompleteAll(league.auction, league, PLAYERS, rng, PLAYERS_BY_ID);
    else autoDraftAll(league, league.draft, PLAYERS, rng);
    league.rngState = rng.state;
    startSeason(league);
    const power = powerRankings(league, PLAYERS_BY_ID);
    spreads.push(power[0].power - power[power.length - 1].power);
    if (!sample && draftType === 'auction') {
      const a = league.auction;
      const top = a.sold.slice().sort((x, y) => y.price - x.price).slice(0, 8);
      sample = {
        top: top.map((s) => `${PLAYERS_BY_ID.get(s.playerId).name} $${s.price}`).join(', '),
        spend: league.teams.map((t, ti) => {
          const sp = spendByPos(a, league, PLAYERS_BY_ID, ti);
          const biggest = Object.entries(sp).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} $${v}`).join('/');
          return `${t.abbr} left $${a.budgets[ti]} · ${biggest}`;
        }),
        cheap: a.sold.filter((s) => s.price <= 2).length,
      };
    }
    let guard = 0;
    while (league.phase !== 'complete' && guard++ < 60) { simulateWeekAi(league, PLAYERS_BY_ID, { includeUser: true }); advanceWeek(league); }
    for (const r of standings(league)) rows.push({ w: r.w, diff: r.diff, power: power.find((p) => p.idx === r.idx).power, str: trueStrength(buildLineup(r.team.slots, PLAYERS_BY_ID)) });
  }
  const strs = rows.map((r) => r.str);
  const mean = strs.reduce((s, x) => s + x, 0) / strs.length;
  const sd = Math.sqrt(strs.reduce((s, x) => s + (x - mean) ** 2, 0) / strs.length);
  const byLeague = [];
  for (let i = 0; i < rows.length; i += 8) {
    const grp = rows.slice(i, i + 8).sort((a, b) => b.str - a.str);
    byLeague.push([grp[0].w, grp[grp.length - 1].w]);
  }
  return {
    spread: spreads.reduce((s, x) => s + x, 0) / spreads.length,
    sd,
    corrPower: corr(strs, rows.map((r) => r.w)),
    corrDiff: corr(strs, rows.map((r) => r.diff)),
    bestWins: byLeague.reduce((s, x) => s + x[0], 0) / byLeague.length,
    worstWins: byLeague.reduce((s, x) => s + x[1], 0) / byLeague.length,
    sample,
  };
}

for (const type of ['snake', 'auction']) {
  const r = run(type);
  console.log(`\n=== ${type.toUpperCase()} (${L} leagues, ${L * 8} team-seasons) ===`);
  console.log(`roster quality (leverage-weighted): sd ${r.sd.toFixed(1)}   flat team-power spread ${r.spread.toFixed(2)}`);
  console.log(`quality vs wins: r=${r.corrPower.toFixed(2)}   quality vs point diff: r=${r.corrDiff.toFixed(2)}`);
  console.log(`best-built team wins ${r.bestWins.toFixed(1)} of 14, worst-built ${r.worstWins.toFixed(1)}`);
  if (r.sample) {
    console.log('priciest:', r.sample.top);
    console.log('minimum-price buys:', r.sample.cheap, 'of 208');
    for (const line of r.sample.spend) console.log('  ', line);
  }
}
