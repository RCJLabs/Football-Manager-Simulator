// Measures injured reserve: how often clubs use it at each injury setting,
// how long a player sits there, and how many are let go at the offseason
// because their slot was filled behind them. Usage: node scripts/ir-sim.mjs
import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek, registerPlayers } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { advanceWeekWithMoves } from '../src/engine/transactions.js';
import { enterOffseason } from '../src/engine/offseason.js';
import { irList, IR_MIN_WEEKS } from '../src/engine/injuries.js';

registerPlayers(byId);
const SEEDS = 12;
console.log(`injured reserve: ${IR_MIN_WEEKS}-week minimum, 2 places a club, 8-team auction leagues, ${SEEDS} seasons each setting\n`);
for (const setting of ['low', 'normal', 'high']) {
  let parked = 0, activated = 0, released = 0, clubWeeksWithIr = 0, clubWeeks = 0, longOut = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const lg = createLeague({ name: 'I', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction', injuries: setting });
    autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), byId);
    startSeason(lg, byId);
    const rng = new RNG(seed * 11);
    while (lg.phase === 'season') {
      for (const t of lg.teams) { clubWeeks++; if (irList(t).length) clubWeeksWithIr++; }
      longOut += Object.values(lg.injuries).filter((x) => x.weeks >= IR_MIN_WEEKS).length;
      simulateWeekAi(lg, byId, { includeUser: true });
      advanceWeekWithMoves(lg, byId, PLAYERS, rng, advanceWeek);
    }
    while (lg.phase !== 'complete') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg); }
    parked += lg.transactions.filter((t) => t.type === 'ir').length;
    activated += lg.transactions.filter((t) => t.type === 'activate').length;
    const off = enterOffseason(lg, PLAYERS, byId);
    released += off.releasedFromIr.length;
  }
  console.log(`  ${setting.padEnd(6)} ${(parked / SEEDS).toFixed(1)} placements a season, ${(activated / SEEDS).toFixed(1)} activations, ${(100 * clubWeeksWithIr / clubWeeks).toFixed(0)}% of club-weeks have somebody on it, ${(released / SEEDS).toFixed(1)} let go at the offseason`);
}
void ROSTER_SLOTS;
