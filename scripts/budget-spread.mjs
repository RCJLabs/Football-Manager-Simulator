// What unequal cap room is worth, in points a game.
//
//   node scripts/budget-spread.mjs [leagues] [teams]            the founding season
//   node scripts/budget-spread.mjs fade [leagues] [teams] [seasons]
//                                                               how long it lasts
//
// The claim this feature was built on was measured before the player pool was
// rewritten, before awareness and power reached the field and before the rating
// weights were refitted, so it is measured again here rather than trusted.
//
// The reading is the best-to-worst differential: run a full season, take each
// club's average point margin, and report the gap between the strongest and the
// weakest. That is the number a player feels as "does it matter who I am".
import { fork } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek, registerPlayers } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { applyCareers, careerIndex } from '../src/engine/careers.js';
import { RNG } from '../src/engine/rng.js';
import { buildLineup, teamPower } from '../src/engine/ratings.js';

const FADE = process.argv[2] === 'fade';
const args = FADE ? process.argv.slice(3) : process.argv.slice(2);
const L = Number(args[0] || (FADE ? 20 : 24));
const N = Number(args[1] || 10);
const SEASONS = Number(args[2] || 5);

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
const corrOf = (xs, ys) => {
  const mx = mean(xs), my = mean(ys);
  const cov = xs.reduce((s, x, k) => s + (x - mx) * (ys[k] - my), 0);
  const sx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0)), sy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0));
  return sx > 0 && sy > 0 ? cov / (sx * sy) : null;
};
const seOf = (a) => Math.sqrt(a.reduce((s, g) => s + (g - mean(a)) ** 2, 0) / (a.length * (a.length - 1)));

// How long the head start lasts. The room is drawn once, for the founding
// auction; every offseason after hands each club the same money less its
// keepers, so whatever the draw bought has to survive on keepers alone. Read
// at every kickoff: the gap between the strongest and weakest roster, and how
// far a club's founding room still predicts its strength. The app's own path:
// AI keepers for every club, careers on, the default quota.
function dynasty(spread, seed) {
  const lg = createLeague({ name: 'f', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: N, seed, draftType: 'auction', budgetSpread: spread });
  const rng = new RNG(lg.rngState);
  autoCompleteAll(lg.auction, lg, PLAYERS, rng, byId);
  lg.rngState = rng.state;
  startSeason(lg, byId);
  const budgets = lg.auction.startBudgets.slice();
  const powers = [];
  for (let s = 1; s <= SEASONS; s++) {
    const idx = careerIndex(lg, leagueIndex(lg, byId));
    powers.push(lg.teams.map((t) => teamPower(buildLineup(t.slots, idx, lg.injuries))));
    if (s < SEASONS) simulateAhead(lg, idx, applyCareers(lg, leaguePool(lg, PLAYERS)), new RNG(seed * 7 + s), 'nextSeason');
  }
  return { budgets, powers };
}

if (FADE && process.env.FADE_PART) {
  registerPlayers(byId);
  const [k, n] = process.env.FADE_PART.split('/').map(Number);
  const jobs = [];
  for (const spread of [0, 0.1, 0.2]) for (let i = 0; i < L; i++) jobs.push({ spread, seed: 900 + i });
  for (const j of jobs.filter((_, i) => i % n === k)) await new Promise((sent) => process.send({ ...j, ...dynasty(j.spread, j.seed) }, sent));
  process.disconnect();
} else if (FADE) {
  const workers = Math.max(1, Math.min(cpus().length - 1, 6));
  console.log(`${L} leagues of ${N} a spread, ${SEASONS} seasons each, AI keepers, ${workers} worker(s).\n`);
  const runs = [];
  await Promise.all(Array.from({ length: workers }, (_, k) => new Promise((done, fail) => {
    const child = fork(fileURLToPath(import.meta.url), process.argv.slice(2), { env: { ...process.env, FADE_PART: `${k}/${workers}` } });
    child.on('message', (r) => runs.push(r));
    child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`worker ${k} exited ${code}`))));
  })));
  // Power per $10 of founding room: the within-league slope, pooled.
  const slope = (rs, s) => {
    let cov = 0, vb = 0;
    for (const r of rs) {
      const mb = mean(r.budgets), mp = mean(r.powers[s]);
      r.budgets.forEach((b, k) => { cov += (b - mb) * (r.powers[s][k] - mp); vb += (b - mb) ** 2; });
    }
    return vb > 0 ? (cov / vb) * 10 : null;
  };
  console.log('season  spread   power gap        corr(founding room, power)   power per $10 of room');
  for (let s = 0; s < SEASONS; s++) {
    for (const spread of [0, 0.1, 0.2]) {
      const rs = runs.filter((r) => r.spread === spread);
      const gaps = rs.map((r) => Math.max(...r.powers[s]) - Math.min(...r.powers[s]));
      const corrs = rs.map((r) => corrOf(r.budgets, r.powers[s])).filter((c) => c != null);
      const sl = slope(rs, s);
      console.log(`  ${String(s + 1).padEnd(5)} ${String(spread).padEnd(5)}  ${mean(gaps).toFixed(2).padStart(6)} ±${seOf(gaps).toFixed(2)}     ${corrs.length ? `${mean(corrs).toFixed(2).padStart(5)} ±${seOf(corrs).toFixed(2)}` : '    —      '}                ${sl == null ? '—' : sl.toFixed(2)}`);
    }
  }
} else {
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
}
