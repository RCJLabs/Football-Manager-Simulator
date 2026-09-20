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

import { ROSTER_SLOTS } from '../data/positions.js';
import { keeperPickValue, usableRounds } from './pickvalue.js';
import { lineupStrength } from './transactions.js';
import { capOn } from './cap.js';

/** How far ahead a pick may be traded. */
export const FUTURE_YEARS = 1;

/** How deep into next year's draft a pick is worth owning. */
export const FUTURE_ROUNDS = 3;

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

/**
 * Whether next year's picks may be traded yet.
 *
 * Not in a league's first draft, and the reason is the measurement above: the
 * estimate runs off the roster a club is about to field, and during the
 * opening draft nobody has one. Every club is a blank sheet with the same
 * twenty-seven empty slots, so every future pick would price identically and
 * the whole market would be a coin toss. One season played is the entry fee.
 */
export function futurePicksOpen(league) {
  return !!league && (league.history?.length || 0) > 0 && (league.teams?.length || 0) > 1;
}

/** The season a future pick belongs to. */
export function futureSeason(league) {
  return (league?.season ?? 1) + FUTURE_YEARS;
}

/** The owed-picks table, created on demand. Empty in every league where nobody has traded. */
function table(league) {
  league.owedPicks ??= [];
  return league.owedPicks;
}

/** Who owns the pick club `from` would naturally make in this round. */
export function futureOwner(league, season, round, from) {
  const row = (league.owedPicks || []).find((p) => p.season === season && p.round === round && p.from === from);
  return row ? row.to : from;
}

/**
 * Hand ownership over, collapsing the row when a pick finds its way home.
 *
 * Chains matter here: a pick can be traded on, and on again, and the club it
 * started with never sees it. Rewriting `to` in place rather than appending
 * means a pick that comes back to its original club leaves no trace, which is
 * what `futureOwner` falling through to `from` already assumes.
 */
function setFutureOwner(league, season, round, from, to) {
  const rows = table(league);
  const i = rows.findIndex((p) => p.season === season && p.round === round && p.from === from);
  if (to === from) { if (i >= 0) rows.splice(i, 1); return; }
  if (i >= 0) rows[i].to = to;
  else rows.push({ season, round, from, to });
}

/**
 * Every future pick a club holds: its own, minus what it has sent, plus what
 * it has been sent. Sorted by round and then by whose pick it is, so a club's
 * own comes before one it acquired.
 */
export function futureHand(league, teamIdx, { season = null } = {}) {
  if (!futurePicksOpen(league)) return [];
  const s = season ?? futureSeason(league);
  const out = [];
  for (let round = 1; round <= FUTURE_ROUNDS; round++) {
    for (let from = 0; from < league.teams.length; from++) {
      if (futureOwner(league, s, round, from) !== teamIdx) continue;
      out.push({ future: true, season: s, round, from, to: teamIdx, key: `f${s}:${round}:${from}` });
    }
  }
  return out.sort((a, b) => a.round - b.round || (a.from === teamIdx ? -1 : b.from === teamIdx ? 1 : a.from - b.from));
}

/**
 * Where every club is guessed to pick next year, worst first.
 *
 * Reverse standings by the roster each club is about to field — the one
 * predictor that measured worth anything. Returns slot numbers, 1 being the
 * first pick of the round.
 */
export function projectedSlots(league, byId) {
  const n = league.teams.length;
  const ranked = league.teams
    .map((t, i) => ({ i, s: lineupStrength(t.slots, byId, null) }))
    .sort((a, b) => b.s - a.s || a.i - b.i);
  const slots = new Array(n);
  ranked.forEach((e, k) => { slots[e.i] = n - k; });   // strongest picks last
  return slots;
}

/** Where a slot lands in a snake's round. */
export function snakeOverall(round, slot, teams) {
  const within = round % 2 === 1 ? slot : teams + 1 - slot;
  return (round - 1) * teams + within;
}

/**
 * What a future pick is worth, in the same lineup points every other trade
 * here is judged in: the curve at the guessed slot, docked for the odds the
 * pick is never made and for it being a year away.
 */
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

/** Structural checks on a future-pick side. Returns { ok, reason }. */
export function validateFuturePicks(league, teamIdx, picks) {
  if (!picks?.length) return { ok: true };
  if (!futurePicksOpen(league)) {
    return { ok: false, reason: 'Next year’s picks cannot be traded until a season has been played' };
  }
  const s = futureSeason(league);
  const seen = new Set();
  for (const p of picks) {
    if (p.season !== s) return { ok: false, reason: `Only ${s} picks are on the table` };
    if (p.round < 1 || p.round > FUTURE_ROUNDS) return { ok: false, reason: `Only the first ${FUTURE_ROUNDS} rounds of ${s} can be traded` };
    if (futureOwner(league, p.season, p.round, p.from) !== teamIdx) {
      return { ok: false, reason: `That ${s} pick is not ${league.teams[teamIdx].abbr}’s to trade` };
    }
    if (seen.has(p.key)) return { ok: false, reason: 'A pick is listed twice' };
    seen.add(p.key);
  }
  return { ok: true };
}

/** Move future picks across. Assumes both sides have already been validated. */
export function applyFutureTrade(league, aIdx, bIdx, aGives, bGives) {
  for (const p of aGives || []) setFutureOwner(league, p.season, p.round, p.from, bIdx);
  for (const p of bGives || []) setFutureOwner(league, p.season, p.round, p.from, aIdx);
}

/**
 * Fold what is owed into a freshly built draft.
 *
 * Called once, from `createDraft`, because that is the first moment the order
 * exists and so the first moment a round and a club can be turned into an
 * overall pick number. Rows for the season being drafted are consumed;
 * anything further out is left alone.
 */
export function applyOwedPicks(league, draft) {
  const rows = league?.owedPicks;
  if (!rows?.length || !draft) return draft;
  const n = draft.order.length;
  const season = league.season;
  draft.traded ??= {};
  for (const row of rows) {
    if (row.season !== season) continue;
    const j = draft.order.indexOf(row.from);
    if (j < 0) continue;
    const i = row.round % 2 === 1 ? j : n - 1 - j;
    const overall = (row.round - 1) * n + i + 1;
    if (row.round > ROSTER_SLOTS.length) continue;
    draft.traded[overall] = row.to;
  }
  league.owedPicks = rows.filter((r) => r.season !== season);
  return draft;
}

/**
 * "S3 R1 · via BUF" — what a drafter calls a future pick.
 *
 * A season here is a count, not a year: leagues start at season 1. Printing it
 * bare read as "3 R1" on the screen, which is a pick number and a round to
 * anybody who drafts, so it carries the S.
 */
export function futureLabel(league, pick) {
  const own = pick.from === pick.to;
  return `S${pick.season} R${pick.round}${own ? '' : ` · via ${league.teams[pick.from]?.abbr ?? '?'}`}`;
}
