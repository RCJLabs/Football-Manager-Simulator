// Runs six 8-team auction leagues for four seasons each with AI keepers on
// every club, and reports how many players clubs keep, what they commit of
// the cap, and how much of a roster carries over. Usage: node scripts/dynasty-sim.mjs

import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek, userTeamIndex } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { enterOffseason, aiKeepers, confirmKeepers, keeperCost } from '../src/engine/offseason.js';
import { overall } from '../src/engine/ratings.js';

let keptCounts = [], committed = [], churnOverall = [], champs = new Set(), turnover = [];
for (let seed = 1; seed <= 6; seed++) {
  const league = createLeague({ name: 'D', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction', injuries: 'normal' });
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(seed), byId);
  startSeason(league, byId);
  let prevRosters = null;
  for (let season = 1; season <= 4; season++) {
    while (league.phase === 'season' || league.phase === 'playoffs') { simulateWeekAi(league, byId, { includeUser: true }); advanceWeek(league); }
    champs.add(`${seed}:${league.champion}`);
    const rosters = league.teams.map((t) => new Set(ROSTER_SLOTS.map((s) => t.slots[s.id]).filter(Boolean)));
    if (prevRosters) turnover.push(...rosters.map((r, i) => 1 - [...r].filter((id) => prevRosters[i].has(id)).length / r.size));
    prevRosters = rosters;
    enterOffseason(league, PLAYERS, byId);
    const u = userTeamIndex(league);
    const off = league.offseason;
    for (const [ti, ids] of Object.entries(off.keepers)) {
      keptCounts.push(ids.length);
      committed.push(ids.reduce((s, id) => s + keeperCost(league.contracts[id]), 0));
      churnOverall.push(...ids.map((id) => overall(byId.get(id))));
    }
    confirmKeepers(league, aiKeepers(league, u, PLAYERS, byId, null), PLAYERS, byId);
    autoCompleteAll(league.auction, league, PLAYERS, new RNG(seed * 10 + season), byId);
    startSeason(league, byId);
  }
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
console.log(`AI keepers: ${mean(keptCounts).toFixed(1)} of 6 kept on average, costing $${mean(committed).toFixed(0)} of $200; kept players average ${mean(churnOverall).toFixed(1)} overall`);
console.log(`Roster turnover season to season: ${(100 * mean(turnover)).toFixed(0)}% of a roster is new`);
console.log(`Distinct champions across ${champs.size} title runs in 6 leagues x 4 seasons: ${[...champs].length}`);
