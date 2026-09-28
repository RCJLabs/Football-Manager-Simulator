// What a point of team power is worth in a league game, and how far a game
// lands from what power and home say.
//
//   node scripts/game-odds.mjs [seasons] [leagues]      (npm run game-odds)
//
// Plays pro dynasties week by week and, before every game, reads each side's
// team power as it takes the field (the injured out). A least-squares line of
// final margin on the power gap gives the points a power point is worth
// (`POINTS_PER_POWER` in winprob.js), its intercept the home edge, and what is
// left over the spread about them (`GAME_SD`). The chance at kickoff is
// Phi(prior / spread), and the calibration line says whether games predicted
// at 30% are won about 30% of the time. The audit re-runs this.
//
// The slope is lower than between synthetic rosters (3.3), where power is the
// whole difference between two sides: between league rosters it is a
// leverage-weighted average that misses some of what separates them.

import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers, simulateWeekAi, advanceWeek, currentWeek } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { advanceWeekWithMoves } from '../src/engine/transactions.js';
import { pickBroker } from '../src/engine/futurepicks.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { applyCareers, careerIndex } from '../src/engine/careers.js';
import { buildLineup, teamPower } from '../src/engine/ratings.js';
import { Phi, POINTS_PER_POWER, HOME_EDGE_POINTS, GAME_SD } from '../src/engine/winprob.js';

const SEASONS = Number(process.argv[2] || 6);
const LEAGUES = Number(process.argv[3] || 2);
registerPlayers(PLAYERS_BY_ID);
const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
const pool = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));

const games = [];
for (let n = 0; n < LEAGUES; n++) {
  const seed = 9400 + n * 29;
  const lg = createLeague({ name: 'G', user: {}, seed, mode: 'pro', numTeams: 32, franchise: 3, draftType: 'snake', injuries: 'normal' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, PLAYERS_BY_ID);
  for (let yr = 0; yr < SEASONS; yr++) {
    const byId = index(lg), pl = pool(lg);
    const rng = new RNG(seed * 13 + yr);
    while (lg.phase === 'season') {
      const wk = currentWeek(lg);
      const power = lg.teams.map((t) => teamPower(buildLineup(t.slots, byId, lg.injuries)));
      simulateWeekAi(lg, byId, { includeUser: true });
      for (const g of wk.games) {
        if (g.result) games.push({ gap: power[g.home] - power[g.away], m: g.result.score[0] - g.result.score[1] });
      }
      advanceWeekWithMoves(lg, byId, pl, rng, advanceWeek, { picks: pickBroker(lg, byId) });
    }
    if (yr < SEASONS - 1) simulateAhead(lg, index(lg), pool(lg), new RNG(seed * 11 + yr), 'nextSeason');
  }
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const xs = games.map((g) => g.gap), ys = games.map((g) => g.m);
const mx = mean(xs), my = mean(ys);
let sxy = 0, sxx = 0;
for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
const k = sxy / sxx, h = my - k * mx;
const sd = Math.sqrt(mean(ys.map((y, i) => (y - h - k * xs[i]) ** 2)));
console.log(`${games.length} regular-season games, ${LEAGUES} pro dynasties × ${SEASONS} seasons`);
console.log(`points per power: ${k.toFixed(2)} ± ${(sd / Math.sqrt(sxx)).toFixed(2)}`);
console.log(`home edge: ${h.toFixed(2)} ± ${(sd / Math.sqrt(games.length)).toFixed(2)}`);
console.log(`spread about the prior: ${sd.toFixed(2)}`);

// How the shipped constants call these games at kickoff.
const bins = Array.from({ length: 10 }, () => ({ p: 0, y: 0, n: 0 }));
let ll = 0, n = 0;
for (const g of games) {
  if (g.m === 0) continue;
  const p = Phi((g.gap * POINTS_PER_POWER + HOME_EDGE_POINTS) / GAME_SD);
  const y = g.m > 0 ? 1 : 0;
  ll -= y ? Math.log(p) : Math.log(1 - p);
  n++;
  const b = bins[Math.min(9, Math.floor(p * 10))];
  b.p += p; b.y += y; b.n++;
}
console.log(`log-loss at kickoff: ${(ll / n).toFixed(4)} (a coin is ${Math.log(2).toFixed(4)})`);
console.log(`calibration, predicted → won: ${bins.filter((b) => b.n >= 20).map((b) => `${Math.round(100 * b.p / b.n)}→${Math.round(100 * b.y / b.n)}`).join('  ')}`);
