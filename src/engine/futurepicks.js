// Next year's picks.
//
// A pick in the draft in front of you is priced by drafting it: `projectPickTrade`
// rolls the board forward under both ownerships and compares the rosters that
// come out. A pick in *next* year's draft has no board — the order is not set,
// the pool is not known, and the club that owes it has not played the season
// that decides where it falls. So it is priced off the curve in pickvalue.js,
// and the whole feature stands or falls on one question: can you guess where a
// club will finish?
//
// **Not from how it did last year, which is what I expected and what I was
// asked for.** Over 512 club-seasons of the pro league, last season's finish
// predicts next season's draft slot at r = 0.15, mean error nine and a half
// slots of thirty-two. The draft order is reverse standings, about nine slots
// a club turn over every offseason and free agency runs before the draft, so
// the league is its own equaliser: finishing last is most of a cure for
// finishing last. Pricing a future pick off a club's record would be pricing
// it off noise.
//
// What does predict it is the roster the club is about to field: r = 0.59,
// mean error six slots of thirty-two. What that is worth, on the curve a
// keeper draft actually has:
//
//   - **Next year's first is the only one worth much, and only from the right
//     club.** Across the league it averages 15 points, but that average spans
//     56 from a club guessed to pick first down to under a point from one
//     guessed to pick last. Priced off the roster guess it is out by 9.4;
//     priced off last year's record, 14.6, which is most of the thing.
//   - **Rounds two and three are throw-ins.** Under a point each, priced to
//     within a fifth of a point. They are tradeable because a real general
//     manager throws one in, not because either side should care.
//
// The number that matters more than any of those is the bias: **-0.0 points**
// on a round-1 pick. Both sides of a deal use this same estimate, so a wide
// error bar makes a future pick a gamble rather than a robbery.
//
// **A pick in a keeper draft is worth a fraction of one in an opening draft,
// and getting that wrong killed the whole feature once.** The curve in
// pickvalue.js was fitted on a first draft, where the entire pool is on the
// board; a second draft has eighteen of twenty-seven already signed, and the
// top pick measures 56 points there against the 304 that curve predicts. On
// those numbers a future first priced at 304 against present picks correctly
// priced at 2 to 12 is not a trade anybody can construct, and three separate
// shapes of AI offer measured as unsignable. I wrote "AI clubs never ring
// about next year" into three files as a structural finding before checking
// the scale. It was a scale error: `keeperPickValue` prices these, and the
// same measurement then reads 21 of 248 pairings clearing both bars against
// 14% for a straight swap. AI clubs do ring.
//
// Two hard limits, both measured:
//
//   - **One year out.** Two years needs a guess at a roster that has not been
//     assembled, and there is nothing to make it from.
//   - **Three rounds.** A keeper draft does not reach round twenty-seven: a pro
//     league turns over about nine slots a club, so the draft ends when
//     everybody is full. Over 960 club-drafts a round-1 pick is made 100% of
//     the time, round 2 95%, round 3 93%, round 7 only 77%. Past round three a
//     future pick is mostly a promise that quietly never comes due, which is a
//     miserable thing to have traded for. A fantasy league keeps six and so
//     drafts twenty-one rounds every year, and never voids one at all.

import { keeperPickValue, usableRounds } from './pickvalue.js';
import { lineupStrength } from './transactions.js';
import { capOn } from './cap.js';
import {
  FUTURE_ROUNDS, futureSeason, futureHand, futureOwner, futurePicksOpen, snakeOverall,
} from './owedpicks.js';

// The bookkeeping half lives in owedpicks.js, which imports nothing that could
// come back around. Re-exported so nobody outside has to know there are two.
export * from './owedpicks.js';

/**
 * How much of next year a club will trade for this year — and why it has to
 * differ from club to club.
 *
 * A flat discount was the first attempt. The curve is need-blind, so on a flat
 * discount the club sending a future pick loses exactly what the club
 * receiving it gains — the future half of a deal sums to zero by construction,
 * and nothing that sums to zero clears two greed bars. It is worth a real
 * number rather than a rule.
 *
 * The asymmetry available is the one every general manager actually has: **a
 * contender wants this year and a rebuilding club wants next year**. A club
 * the estimator puts near the top of the table discounts the future hard; one
 * near the bottom values it in full. Measured, the same future first fetches
 * 24 from a club chasing a title and 28 from one rebuilding, so who you ask
 * changes the price — which is the whole reason shopping a pick around is
 * worth doing rather than taking the first answer.
 *
 * The band is a design choice and the code should say so. The midpoint is
 * where the flat version sat, so nothing else shifts.
 */
export const FUTURE_DISCOUNT_LOW = 0.70;    // a club guessed to pick last
export const FUTURE_DISCOUNT_HIGH = 1.00;   // a club guessed to pick first
export const FUTURE_DISCOUNT = (FUTURE_DISCOUNT_LOW + FUTURE_DISCOUNT_HIGH) / 2;

/**
 * What a year of waiting costs this particular club, from where it is guessed
 * to pick. Slot 1 is the worst club in the league and values next year in
 * full; the slot furthest back is the best and discounts it most.
 */
export function futureDiscount(league, teamIdx, slots) {
  const n = league?.teams?.length || 1;
  if (n < 2 || !slots) return FUTURE_DISCOUNT;
  const slot = slots[teamIdx];
  if (!Number.isFinite(slot)) return FUTURE_DISCOUNT;
  const frac = (slot - 1) / (n - 1);          // 0 = worst club, 1 = best
  return FUTURE_DISCOUNT_HIGH + frac * (FUTURE_DISCOUNT_LOW - FUTURE_DISCOUNT_HIGH);
}

/**
 * The odds a round-`r` future pick is ever actually made, measured over 960
 * club-drafts. A club that is full stops drafting — `settlePointer` skips it —
 * so a pick past a club's open slots is a pick that never happens. Only the
 * capped league keeps enough players for this to bite.
 */
const VOID_ODDS = [1, 0.95, 0.93];
export function madeOdds(league, round) {
  if (!capOn(league)) return 1;
  return VOID_ODDS[round - 1] ?? 0.75;
}

export const RECORD_WEIGHT = 4;

/**
 * Where every club is guessed to pick next, worst first. Slot 1 is the first
 * pick of a round.
 *
 * Reverse standings by whatever there is to go on: the roster a club fields,
 * and — once a season is under way — how that season has actually gone. With
 * no games played the record term weighs nothing, which is exactly the
 * offseason case, so a draft-room valuation is unchanged by any of this.
 */
export function projectedSlots(league, byId) {
  const n = league.teams.length;
  const rankOf = (vals) => {
    const order = vals.map((v, i) => ({ i, v })).sort((a, b) => b.v - a.v || a.i - b.i);
    const out = new Array(n);
    order.forEach((e, k) => { out[e.i] = k; });   // 0 = strongest
    return out;
  };
  const byRoster = rankOf(league.teams.map((t) => lineupStrength(t.slots, byId, null)));
  const played = Math.max(0, ...league.teams.map((t) => (t.record?.w || 0) + (t.record?.l || 0) + (t.record?.t || 0)));
  const w = played / (played + RECORD_WEIGHT);
  let blended = byRoster;
  if (w > 0) {
    const byRecord = rankOf(league.teams.map((t) => {
      const r = t.record || {};
      const g = (r.w || 0) + (r.l || 0) + (r.t || 0);
      return g ? ((r.w || 0) + 0.5 * (r.t || 0)) / g : 0.5;
    }));
    blended = rankOf(league.teams.map((_, i) => -(w * byRecord[i] + (1 - w) * byRoster[i])));
  }
  const slots = new Array(n);
  for (let i = 0; i < n; i++) slots[i] = n - blended[i];   // strongest picks last
  return slots;
}

export function futurePickValue(league, byId, pick, slots = null, holder = null) {
  const n = league.teams.length;
  const s = slots || projectedSlots(league, byId);
  const slot = s[pick.from] ?? Math.ceil(n / 2);
  const overall = snakeOverall(pick.round, slot, n);
  const disc = holder == null ? FUTURE_DISCOUNT : futureDiscount(league, holder, s);
  return keeperPickValue(overall, futureDepth(league), n) * madeOdds(league, pick.round) * disc;
}

/**
 * How many rounds next year's draft will reach.
 *
 * A keeper draft ends when every club is full, so its depth is the slots a
 * club has open — and the best guess at next year's is this league's keeper
 * setting. Measured, a pro league keeping eighteen averages 8.9 open slots a
 * club against the nine this predicts, which is close enough to use.
 */
export function futureDepth(league) {
  return usableRounds(league?.settings?.keepers ?? 0);
}

/**
 * What a whole side of future picks is worth **on one club's books**.
 *
 * `holder` is the club doing the valuing, not the club that owns the pick:
 * the same first-round pick is worth more to a rebuilding club than to the
 * contender holding it, and that difference is the only thing that makes a
 * future-pick market possible at all.
 */
export function futureHandValue(league, byId, picks, slots = null, holder = null) {
  if (!picks?.length) return 0;
  const s = slots || projectedSlots(league, byId);
  let total = 0;
  for (const p of picks) total += futurePickValue(league, byId, p, s, holder);
  return total;
}

/** A club's projected slot as a plain-English band, for a screen that should not pretend to precision. */
export function slotBand(league, byId, teamIdx, slots = null) {
  const n = league.teams.length;
  const s = slots || projectedSlots(league, byId);
  const slot = s[teamIdx] ?? Math.ceil(n / 2);
  const third = n / 3;
  if (slot <= third) return 'projected early';
  if (slot <= 2 * third) return 'projected mid';
  return 'projected late';
}

/**
 * What a swap of future picks is worth to one club, on its own books.
 *
 * The number `evaluateTrade` needs and cannot work out for itself. `holder` is
 * the club doing the judging: it gains what it receives and loses what it
 * sends, both priced at its own time preference, so a contender and a
 * rebuilding club put different numbers on the same pair of picks.
 *
 * In-season this is a better estimate than the same call in the draft room,
 * and by a lot. The slot it prices off comes from `projectedSlots`, which
 * blends the roster with the season's record; by the trade deadline — week 12
 * of a pro season, ten games in — that ranks clubs against their eventual
 * finish at about r = 0.86 where the offseason estimate manages 0.59. A pick
 * is simply worth more precisely at the deadline than in the spring, which is
 * also true of the real thing.
 */
export function pickTradeDelta(league, byId, holder, gives, gets, slots = null) {
  if (!gives?.length && !gets?.length) return 0;
  const s = slots || projectedSlots(league, byId);
  return futureHandValue(league, byId, gets, s, holder) - futureHandValue(league, byId, gives, s, holder);
}

/**
 * The handle `makeAiOffers` takes so it can price a pick without importing
 * this file — which it cannot, because this file imports it.
 *
 * Built once a week rather than once a deal: `projectedSlots` costs one
 * lineup valuation a club, and the answer does not change between two offers
 * made in the same week. Null when the league has no picks to trade yet, which
 * is the signal to behave exactly as before they existed.
 */
export function pickBroker(league, byId) {
  if (!futurePicksOpen(league)) return null;
  const slots = projectedSlots(league, byId);
  return {
    hand: (idx) => futureHand(league, idx).filter((p) => p.from === idx),
    value: (pick, holder) => futurePickValue(league, byId, pick, slots, holder),
  };
}
