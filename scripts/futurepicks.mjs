// The half of the future-pick market that works: what an AI club will take
// when the human offers next year for this year. Usage:
//
//   node scripts/futurepicks.mjs
//
// AI clubs never propose these — three shapes were built and all three measure
// as unsignable, because the curve that prices a future pick is need-blind and
// so the future half of any deal sums to exactly zero. The note in
// draftpicks.js has the numbers. What is left is a market the human drives,
// and the thing worth checking about it is that *who you ask changes the
// price*: a club chasing a title discounts next year hard, a rebuilding one
// values it in full, so the same pick fetches different answers around the
// league. If that spread is not there the feature is a formality.

import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import {
  createLeague, startSeason, registerPlayers, simulateWeekAi, advanceWeek, userTeamIndex,
} from '../src/engine/season.js';
import { autoDraftAll, runAiPicks, currentPicker } from '../src/engine/draft.js';
import { enterOffseason, confirmKeepers, aiKeepers, takeJob, closeFreeAgency } from '../src/engine/offseason.js';
import { remainingPicks, validatePickTrade, pickTradeProjector, PICK_OFFER_FAIR_MARGIN } from '../src/engine/draftpicks.js';
import { aiGreed } from '../src/engine/transactions.js';
import { futureHand, futurePickValue, projectedSlots, futureDiscount, FUTURE_ROUNDS } from '../src/engine/futurepicks.js';

registerPlayers(byId);
const SEEDS = Number(process.env.SEEDS || 4);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/** A capped league taken through one season and part way into its second draft. */
function secondDraft(seed) {
  const lg = createLeague({ name: 'FT', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 12, seed, mode: 'pro', draftType: 'snake' });
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, byId);
  while (lg.phase === 'season') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  while (lg.phase === 'playoffs') { simulateWeekAi(lg, byId, { includeUser: true }); advanceWeek(lg, byId); }
  const off = enterOffseason(lg, PLAYERS, byId);
  if (off.step === 'jobs') takeJob(lg, off.carousel.offers[0].team, PLAYERS, byId);
  confirmKeepers(lg, aiKeepers(lg, userTeamIndex(lg), PLAYERS, byId, new RNG(seed + 1)), PLAYERS, byId);
  closeFreeAgency(lg, PLAYERS, byId);
  return lg;
}

const rows = [];
let leagues = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
  const lg = secondDraft(seed);
  const d = lg.draft, u = userTeamIndex(lg);
  runAiPicks(lg, d, PLAYERS, new RNG(seed * 7));
  if (d.complete || currentPicker(d) !== u) continue;
  leagues++;
  const proj = pickTradeProjector(lg, d, PLAYERS, byId);
  const slots = projectedSlots(lg, byId);
  const sell = futureHand(lg, u).find((p) => p.round === 1);
  if (!sell) continue;
  const mineNow = remainingPicks(d, u)[0];
  // Both directions. The human shops next year's first around the league, and
  // then tries to buy each club's next year's first with its best pick now.
  for (const a of lg.teams.map((_, i) => i).filter((i) => i !== u)) {
    const theirs = remainingPicks(d, a)[0];
    if (theirs && validatePickTrade(lg, d, a, u, [theirs], [sell]).ok) {
      const v = proj.project(a, u, [theirs], [sell]);
      rows.push({
        dir: 'sell', seed, club: a, disc: futureDiscount(lg, a, slots),
        worth: futurePickValue(lg, byId, sell, slots, a), aiGain: v.a, userDelta: v.b,
        offerable: v.a >= aiGreed(lg.teams[a], lg) && v.b >= -PICK_OFFER_FAIR_MARGIN,
      });
    }
    const buy = futureHand(lg, a).find((p) => p.round === 1);
    if (buy && mineNow && validatePickTrade(lg, d, a, u, [buy], [mineNow]).ok) {
      const v = proj.project(a, u, [buy], [mineNow]);
      rows.push({
        dir: 'buy', seed, club: a, disc: futureDiscount(lg, a, slots),
        worth: futurePickValue(lg, byId, buy, slots, u), aiGain: v.a, userDelta: v.b,
        offerable: v.a >= aiGreed(lg.teams[a], lg) && v.b >= -PICK_OFFER_FAIR_MARGIN,
      });
    }
  }
}
console.log(`${rows.length} answers from ${leagues} leagues\n`);
const sold = rows.filter((r) => r.dir === 'sell');
if (sold.length) {
  const contenders = sold.filter((r) => r.disc <= 0.85), rebuilding = sold.filter((r) => r.disc > 0.85);
  console.log(`selling next year's first for a club's best pick now (n=${sold.length})`);
  console.log(`  what it is worth on the buyer's books: ${Math.min(...sold.map((r) => r.worth)).toFixed(0)} to ${Math.max(...sold.map((r) => r.worth)).toFixed(0)}`);
  console.log(`    clubs chasing a title now (n=${contenders.length}): mean ${mean(contenders.map((r) => r.worth)).toFixed(0)}`);
  console.log(`    clubs rebuilding          (n=${rebuilding.length}): mean ${mean(rebuilding.map((r) => r.worth)).toFixed(0)}`);
  console.log(`  clubs that would take it: ${sold.filter((r) => r.aiGain >= 4).length} of ${sold.length}`);
  console.log(`  the human's side: ${mean(sold.map((r) => r.userDelta)).toFixed(1)} on average, best ${Math.max(...sold.map((r) => r.userDelta)).toFixed(1)}`);
}
const bought = rows.filter((r) => r.dir === 'buy');
if (bought.length) {
  console.log(`\nbuying a club's next year's first with your best pick now (n=${bought.length})`);
  console.log(`  clubs that would sell: ${bought.filter((r) => r.aiGain >= 4).length} of ${bought.length}`);
  console.log(`  the human's side: ${mean(bought.map((r) => r.userDelta)).toFixed(1)} on average, best ${Math.max(...bought.map((r) => r.userDelta)).toFixed(1)}`);
}
// Deep into a keeper draft everything left is cheap, so a first a year out
// dwarfs it in both directions. That is the honest answer, not a defect: this
// is what mortgaging a future first costs, and what buying one costs too.
console.log(`\n  deals good for the human and acceptable to the club: ${rows.filter((r) => r.aiGain >= 4 && r.userDelta > 0).length} of ${rows.length}`);
// The bar an AI club would have to clear to *propose* one: its own greed, and
// no worse than PICK_OFFER_FAIR_MARGIN for the human.
console.log(`  deals a club could ring you about: ${rows.filter((r) => r.offerable).length} of ${rows.length}`);
void FUTURE_ROUNDS;
