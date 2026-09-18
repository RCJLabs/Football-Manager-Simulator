// Measures the trade-offer market: how often AI clubs ring the human, how many
// offers a season brings, and what they are worth on the lineup-strength
// yardstick. Usage: node scripts/offer-sim.mjs

import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { makeAiOffers, liveOffers, advanceWeekWithMoves } from '../src/engine/transactions.js';

let week1 = 0, seeds = 20, totalOffers = 0, weeksWith = 0, weeks = 0, deltas = [];
for (let seed = 1; seed <= seeds; seed++) {
  const lg = createLeague({ name: 'O', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction', injuries: 'normal' });
  autoCompleteAll(lg.auction, lg, PLAYERS, new RNG(seed), byId);
  startSeason(lg, byId);
  if (makeAiOffers(lg, byId, null, { max: 8 }).length) week1++;
  lg.offers = [];
  const rng = new RNG(seed * 5);
  while (lg.phase === 'season') {
    const live = liveOffers(lg);
    weeks++; if (live.length) weeksWith++;
    totalOffers += live.length;
    for (const o of live) deltas.push(o.userDelta);
    simulateWeekAi(lg, byId, { includeUser: true });
    advanceWeekWithMoves(lg, byId, PLAYERS, rng, advanceWeek);
  }
}
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
console.log(`week-1 offers exist in ${week1}/${seeds} leagues`);
console.log(`over a season: ${(totalOffers / seeds).toFixed(1)} offers per league, ${(100 * weeksWith / weeks).toFixed(0)}% of weeks have one`);
console.log(`what they are worth to the human (lineup strength): mean ${mean(deltas).toFixed(1)}, positive ${deltas.filter((d) => d > 0).length}/${deltas.length}`);
