// Measures the in-season transaction layer: how busy AI clubs are on the waiver
// wire over a season, and whether the trade evaluator can be talked into a bad
// deal. Usage: node scripts/moves-sim.mjs

import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, simulateWeekAi, advanceWeek } from '../src/engine/season.js';
import { autoCompleteAll } from '../src/engine/auction.js';
import { lineupStrength, advanceWeekWithMoves, validateTrade, evaluateTrade, ownerMap } from '../src/engine/transactions.js';
import { overall } from '../src/engine/ratings.js';

// 1. A season of AI waivers: how many claims land, how much lineup strength they add.
let claims = 0, gain = 0, seasons = 0;
for (let seed = 1; seed <= 12; seed++) {
  const league = createLeague({ name: 'M', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'auction' });
  autoCompleteAll(league.auction, league, PLAYERS, new RNG(seed), byId);
  startSeason(league, byId);
  const before = league.teams.map((t) => lineupStrength(t.slots, byId));
  const rng = new RNG(seed * 7);
  while (league.phase === 'season') {
    simulateWeekAi(league, byId, { includeUser: true });
    advanceWeekWithMoves(league, byId, PLAYERS, rng, advanceWeek);
  }
  claims += league.transactions.filter((t) => t.type === 'waiver').length;
  league.teams.forEach((t, i) => { if (!t.isUser) gain += lineupStrength(t.slots, byId) - before[i]; });
  seasons++;
}
console.log(`AI waivers: ${(claims / seasons).toFixed(1)} claims per 8-team season, +${(gain / (seasons * 7)).toFixed(1)} lineup strength per AI club`);

// 2. Trade evaluator: random one-for-one, position-matched offers from the user.
const league = createLeague({ name: 'M', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed: 99, draftType: 'auction' });
autoCompleteAll(league.auction, league, PLAYERS, new RNG(99), byId);
startSeason(league, byId);
const rng = new RNG(5);
const u = league.teams.findIndex((t) => t.isUser);
let offers = 0, accepted = 0, userGainOnAccept = 0, aiGainOnAccept = 0, acceptedWhereUserLoses = 0, acceptedUserBetterPlayer = 0, acceptedUserWorsePlayer = 0;
for (let i = 0; i < 4000; i++) {
  const ai = 1 + Math.floor(rng.next() * 7);
  const aiIdx = ai === u ? 0 : ai;
  const slot = ROSTER_SLOTS[Math.floor(rng.next() * ROSTER_SLOTS.length)];
  const same = ROSTER_SLOTS.filter((s) => s.pos === slot.pos);
  const other = same[Math.floor(rng.next() * same.length)];
  const give = league.teams[u].slots[slot.id], get = league.teams[aiIdx].slots[other.id];
  const v = validateTrade(league, u, aiIdx, [give], [get], byId);
  if (!v.ok) continue;
  offers++;
  const ev = evaluateTrade(league, aiIdx, [get], [give], byId);
  if (!ev.accept) continue;
  accepted++;
  aiGainOnAccept += ev.delta;
  // What the user would gain on the same yardstick.
  const me = league.teams[u];
  const beforeMe = lineupStrength(me.slots, byId);
  const after = { ...me.slots, [slot.id]: get };
  const d = lineupStrength(after, byId) - beforeMe;
  userGainOnAccept += d;
  if (d < 0) acceptedWhereUserLoses++;
  if (overall(byId.get(give)) > overall(byId.get(get))) acceptedUserBetterPlayer++; else acceptedUserWorsePlayer++;
}
console.log(`Trades: ${offers} random 1-for-1 offers, ${accepted} accepted (${(100 * accepted / offers).toFixed(1)}%). On accepted deals the AI gains +${(aiGainOnAccept / accepted).toFixed(1)}, the user ${(userGainOnAccept / accepted).toFixed(1)} lineup strength; user loses on ${acceptedWhereUserLoses} of them; user gave the higher-overall player in ${acceptedUserBetterPlayer}, the lower in ${acceptedUserWorsePlayer}.`);
