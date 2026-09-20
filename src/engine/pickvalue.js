// What a draft pick is worth, without drafting to find out.
//
// This exists for one job the simulation cannot do: pricing a pick in a draft
// that has not happened yet. `projectPickTrade` values a pick by drafting the
// rest of the season twice and comparing the finished rosters, which is only
// possible for the draft in front of you. A pick in *next* year's draft has no
// board to roll forward, so it needs a curve.
//
// **It is not a replacement for the simulation, and that was measured rather
// than assumed.** The plan was to replace it: the simulation is slow and its
// error bar on a single deal is ±20 against a signal of ±13, which looked
// damning. Validated against the truth — the real change to a finished roster,
// averaged over six draws so the chaos cancels — the simulation scores r =
// 0.97 with a mean error of 7.8, and this curve r = 0.81 with 15.7. The noise
// is real but it is small next to the spread *between* deals, and the curve
// pays for its speed by knowing nothing about what a club actually needs.
// Correcting its scale fixed the bias (regression slope 1.00) and barely
// touched the error, which is the tell: the gap is not calibration.
//
// So the curve prices future picks and the simulation prices present ones.
//
// v(k) was measured directly — what a club loses when its pick at slot k is
// swapped for the last pick in the draft — over eight leagues and three draws
// each, at twelve clubs and at thirty-two. `scripts/pickcurve.mjs` runs both
// that and the validation above. Two things about the shape matter, and both
// correct what the earlier delta measurements looked like:
//
//   - It is steep at the top and then very flat. In a thirty-two club league
//     the first pick is worth 304 and pick 32 is worth 102 — a third of it,
//     gone inside one round — and by pick 160 it is 46. That is why moving a
//     pick *within* the tail measured as worth nothing.
//   - It does not reach zero. The last pick of all is still worth 9, and pick
//     250 is 38. A late pick is not worthless in absolute terms — it fetches a
//     player — it is only worthless to *move*. Reading those flat deltas as a
//     floor of zero is the mistake that made a late pick look like free money.
//
// A static curve was tried and thrown out once before, and the note is still in
// draftpicks.js: mean overall by pick number runs 96 down to 86 and back *up*
// to 95, because the last rounds are where kickers go. That curve measured the
// rating of the man taken weighted by his position's leverage, which is
// dominated by *which* position rather than by how good the pick is. This one
// measures what a club's finished roster loses, which is the question.

import { ROSTER_SLOTS } from '../data/positions.js';

/**
 * The shape, in fractions of the draft rather than pick numbers, so one curve
 * serves every league size. Fitted to the pooled measurements at twelve and
 * thirty-two clubs: rms 0.054, worst residual 0.19, which is inside the error
 * bar on the measurements themselves.
 *
 * Two exponentials because one will not do it. A single decay fast enough to
 * match the top of the draft predicts nothing at all past the first round,
 * where the truth is still a seventh of the first pick; a single decay slow
 * enough to match the tail flattens the top, and the top is where every
 * decision is. So: a fast component for the scramble over the best few dozen
 * players, and a slow one for the long grind of the rest.
 */
export const PICK_FAST = 0.020;
export const PICK_SLOW = 0.50;
export const PICK_SLOW_SHARE = 0.22;

/**
 * Lineup points the first pick is worth, per club in the league.
 *
 * The raw v(1) came in at 109 over twelve clubs and 258 over thirty-two — 9.1
 * and 8.1 a club, near enough linear to treat as such, because the more clubs
 * there are the more of the pool is taken and so the more every pick matters.
 *
 * 9.5 is above both of those on purpose, and it is not the raw number. What
 * gets priced is never one pick but `handValue` of a whole hand, capped at the
 * club's open slots, and that cap and the filler term both bleed value off the
 * total. The constant that makes the *hand* deltas line up with the truth is
 * what matters, so it was fitted by regressing truth on curve rather than read
 * off v(1): `scripts/pickcurve.mjs` prints that slope, and at these numbers it
 * comes back 1.00.
 */
export const PICK_SCALE = 9.5;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The normalised curve: 1 at the first pick, falling to about 0.03 at the last. */
export function pickShape(overallPick, totalPicks) {
  if (!Number.isFinite(overallPick) || !Number.isFinite(totalPicks) || totalPicks < 2) return 0;
  const frac = clamp01((overallPick - 1) / (totalPicks - 1));
  return (1 - PICK_SLOW_SHARE) * Math.exp(-frac / PICK_FAST) + PICK_SLOW_SHARE * Math.exp(-frac / PICK_SLOW);
}

/** What a pick at `overallPick` is worth, in the same lineup points a trade is judged in. */
export function pickValue(overallPick, totalPicks, teams) {
  return PICK_SCALE * teams * pickShape(overallPick, totalPicks);
}

/** What a club signs off the board when it runs out of picks — the worst pick's worth. */
export function fillerValue(totalPicks, teams) {
  return pickValue(totalPicks, totalPicks, teams);
}

/**
 * What a club's whole hand of picks is worth to it.
 *
 * The two structural facts about this draft are both in here rather than in a
 * special case. A club cannot use more picks than it has slots, so the surplus
 * is dropped — which is why taking three picks for one gains nothing. And a
 * club with fewer picks than slots signs the difference off the board, so the
 * shortfall is valued at what that filler is worth, which the measurements put
 * at about the same as the last pick in the draft.
 */
export function handValue(picks, openSlots, totalPicks, teams) {
  const sorted = picks.slice().sort((a, b) => a.overall - b.overall);
  const used = sorted.slice(0, Math.max(0, openSlots));
  let total = 0;
  for (const p of used) total += pickValue(p.overall, totalPicks, teams);
  return total + Math.max(0, openSlots - used.length) * fillerValue(totalPicks, teams);
}

/** Total picks in a draft of this size. */
export function draftPickCount(teams) {
  return ROSTER_SLOTS.length * teams;
}

// ---------------------------------------------------------------------------
// The keeper draft, which is a different animal
// ---------------------------------------------------------------------------

/**
 * Everything above was fitted on an **opening** draft, where the whole pool is
 * on the board and a club has twenty-seven slots to fill. A keeper draft is
 * not that: eighteen of twenty-seven are already signed, the best man left is
 * nothing like the best man alive, and a club has about nine slots to use.
 * Applying the opening curve there is wrong by between five times and fifty:
 *
 * | slot | measured in a second draft | opening curve says | ratio |
 * | --- | --- | --- | --- |
 * | 1 | 56.1 | 304 | 0.18 |
 * | 5 | 33.5 | 254 | 0.13 |
 * | 12 | 11.7 | 191 | 0.06 |
 * | 48 | 1.8 | 76 | 0.02 |
 *
 * That error is what made every future-pick market measure as dead: a future
 * first priced at 304 against present picks correctly priced at 2 to 12 is not
 * a trade anybody can construct.
 *
 * The shape is different too, not just the scale. The opening curve needs a
 * slow second exponential for its tail because there are slots deep in the
 * draft worth filling; a keeper draft has no such tail, and a **single**
 * exponential fits as well as two (rms 0.056 against 0.059 — with six points
 * the extra parameters are not earned). Value collapses inside the first
 * round, because that is how many useful players are left.
 *
 * Measured in a thirty-two club pro league over six second drafts. Everything
 * else is extrapolation: the decay is held at a fraction of the *usable*
 * draft, so it moves with league size and with how many a league keeps, but
 * only the pro shape was measured.
 */
export const KEEPER_DECAY = 0.0285;   // in fractions of the usable draft
export const KEEPER_SCALE = 1.75;     // points the top pick is worth, per club

/** How many rounds a draft of this kind actually reaches before everyone is full. */
export function usableRounds(keepers) {
  return Math.max(1, ROSTER_SLOTS.length - Math.max(0, keepers || 0));
}

/**
 * What a pick is worth in a draft that only runs `rounds` deep.
 *
 * `overallPick` is counted in the full snake, so round 2 of a thirty-two club
 * league starts at 33 whatever the depth — which is what a pick number means
 * everywhere else in the code.
 */
export function keeperPickValue(overallPick, rounds, teams) {
  if (!Number.isFinite(overallPick) || !(rounds > 0) || !(teams > 0)) return 0;
  const usable = Math.max(2, rounds * teams);
  const frac = Math.max(0, overallPick - 1) / (usable - 1);
  return KEEPER_SCALE * teams * Math.exp(-frac / KEEPER_DECAY);
}
