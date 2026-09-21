// Scouting: a rookie arrives as a range, not a number.
//
// Everything in this game was arithmetic. Every rating of all 1,269 players was
// exact and permanent, so once you knew the leverage table you won auctions
// forever and the economy stopped being a puzzle. Real general-manager games
// run on fog.
//
// What is fogged, and what deliberately is not:
//
// **Real players are never fogged.** They are the content. Somebody playing
// all-time fantasy football wants to know they are bidding on Jerry Rice at 97;
// hiding that turns the marquee feature into a guessing game rather than a
// decision. The fog goes on generated rookies, who nobody has seen play.
//
// **A rookie is fogged until he has played.** One season of real games and he
// is a known quantity, because you watched him. That is `league.careers`, the
// statistical record awards.js already keeps, so no new bookkeeping.
//
// **The width of the range is the information.** A range that is merely a
// noisier number changes nothing: you would still take the highest midpoint.
// So the range runs from what a rookie is now to what he could become — his
// career ceiling, which careers.js already derives deterministically from the
// league seed and his id, before he is ever signed. A safe prospect reads
// 70-74 and a boom-or-bust reads 58-86, and choosing between them at the same
// price is the decision this exists to create. A bust's ceiling is barely above
// his floor, so his range is narrow and low all by itself.
//
// **Everyone scouts, not just the human.** Fog on one side only is a handicap,
// not a mechanic. Each club reads the same rookie differently, seeded from the
// observer, with the error scaled by the GM's savvy — the same table that
// decides who chases value and who chases names in the auction room. You can
// win a player because you rated him higher than the room, and be wrong.

import { hashSeed, RNG } from './rng.js';
import { overall } from './ratings.js';
import { startCareer } from './careers.js';
import { savvyFor } from './difficulty.js';
import { POSITIONS } from '../data/positions.js';

/** Scouting error in rating points for a GM who knows nothing. */
export const BASE_ERROR = 8;
/** How accurately the human's own staff reads a prospect. */
export const USER_ACCURACY = 0.4;
/** How much of a prospect's upside a club pays for today. */
export const UPSIDE_WEIGHT = 0.35;
/**
 * No projection is ever narrower than this. A range that collapses to a single
 * number reads as certainty, and a confident wrong number is worse than an
 * honest wide one — the whole point is that nobody knows yet.
 */
export const MIN_WIDTH = 5;

/** Seasons an average developer takes to reach his ceiling. Measured, not chosen. */
export const ARRIVE_AT_PACE_1 = 5.2;
/** How much of the rating error carries into the arrival read, in years per point. */
export const PACE_ERROR = 0.16;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function scoutingOn(league) {
  return !!(league && league.settings && league.settings.scouting);
}

/**
 * Has this player been seen? Real players always have been. A generated rookie
 * is known once he has been on a roster through a completed season.
 *
 * The marker is his career entry in `league.dev`, which careers.js creates for
 * everyone under contract at the offseason — so having one means he has played
 * a season for somebody. Statistics count as well, and they count for every
 * club: season totals accumulate for every player in every game, computer sides
 * included. Only per-game box scores are dropped for AI regular-season games,
 * and a season total is the thing this wants anyway.
 *
 * This comment used to claim the reverse — that a rookie could start three
 * years for a computer club with no games to his name, measured at 50 rookies
 * on rosters and not one with a recorded game. The measurement was real and the
 * reading of it was wrong. The zeroes came from the record books being written
 * through a stale module-level player index that had no generated players in
 * it, so rookies were skipped in silence; `bookIndex` in season.js fixes that,
 * and the same league now shows about half its rookies with a career record
 * after one season, the rest being the ones who genuinely did not play.
 *
 * The career entry stays the marker regardless, because it is the honest test
 * of "has been somewhere for a season" — a rookie who sat all year has still
 * been watched in practice for twelve months.
 */
export function isScouted(league, p) {
  const src = (p && p.base) || p;
  if (!src || !src.generated) return true;
  if (league && league.dev && league.dev[src.id]) return true;
  const rec = league && league.careers && league.careers[src.id];
  return !!(rec && rec.games > 0);
}

/** Every club reads a prospect differently. How well depends on the GM. */
export function accuracyOf(league, observerIdx) {
  const team = league.teams && league.teams[observerIdx];
  if (!team) return USER_ACCURACY;
  // Your own staff read a prospect the same however good the opposition is. A
  // harder league is one where the other clubs are better, not one where you
  // are suddenly worse at your own job.
  if (team.isUser) return USER_ACCURACY;
  return clamp(savvyFor(league, team), 0, 0.85);
}

/**
 * What a club believes about a rookie.
 *
 * It is a projection, not a guarantee. `floor` is what he is today and
 * `ceiling` what his career could reach, but both are then read through this
 * observer's error, which cuts both ways: a club can have him a few points
 * high as easily as a few low, and the published range can sit entirely above
 * or below the truth. `estimate` is the single number a bid or a draft board
 * needs, and it sits above the low end because a club does pay something for
 * upside — which is what makes chasing a prospect a risk rather than a free
 * option.
 */
export function scoutReport(league, p, observerIdx = -1, { force = false } = {}) {
  const src = (p && p.base) || p;
  const truth = overall(p);
  if (!scoutingOn(league) || (!force && isScouted(league, src)) || !src.generated) {
    return { known: true, floor: truth, ceiling: truth, low: truth, high: truth, mid: truth, estimate: truth, width: 0,
      soon: 0, late: 0, ready: 0 };
  }
  const arc = startCareer(league, src);
  const floor = truth;
  const ceiling = Math.max(truth, arc.ceiling ?? truth);
  const err = BASE_ERROR * (1 - accuracyOf(league, observerIdx));
  const rng = new RNG(hashSeed(`scout:${league.seed >>> 0}:${src.id}:${observerIdx}`));
  // The low end leans conservative on purpose: a band that does not even
  // contain what a player is today tells you nothing about him. The genuine
  // uncertainty is how far up his own band he climbs, and that is the high end.
  const low = clamp(Math.round(floor - Math.abs(rng.normal(0, err)) * 0.5), 40, 95);
  const high = clamp(Math.round(ceiling + rng.normal(0, err) * 0.7), low + MIN_WIDTH, 99);
  const estimate = clamp(Math.round(low + (high - low) * UPSIDE_WEIGHT), 40, 99);
  // HOW SOON, fogged the same way as how high.
  //
  // The band above says where he ends up and has never said when he gets
  // there, because until `pace` existed he got there in about five seasons
  // whoever he was — measured flat at 5.0, 4.8, 5.0, 4.5, 5.1 across the whole
  // range of development. There was no second question to ask.
  //
  // Now there is, and it is the one a dynasty actually turns on: a prospect
  // four years away is worth something quite different to a club contending
  // now than to one building. Years scale as the reciprocal of pace, measured
  // at 5.2 seasons for an average developer and running 3.3 to 6.7 across the
  // draw. Widened by the same scouting error as the rating, so a poor scout
  // reads "two to seven" and a good one "three to four".
  const yrs = clamp(Math.round(ARRIVE_AT_PACE_1 / (arc.pace ?? 1)), 1, 9);
  const slip = Math.abs(rng.normal(0, err * PACE_ERROR)) + 0.4;
  const soon = clamp(Math.round(yrs - slip), 1, 9);
  const late = clamp(Math.round(yrs + slip), soon + 1, 10);
  return { known: false, floor, ceiling, low, high, mid: Math.round((low + high) / 2), estimate, width: high - low,
    soon, late, ready: Math.round((soon + late) / 2) };
}

/**
 * What the room as a whole thinks a player is worth, with nobody's private
 * error in it. The auction's asking price is built from this rather than from
 * the truth, because a price derived from the true rating would let anyone read
 * a rookie's real number straight off the board and the fog would be theatre.
 *
 * It is the average view rather than an average of views: the observational
 * errors are mean-zero, so they cancel, and computing it directly saves a
 * scouting pass per club on every price the guide rebuilds.
 */
const marketCache = new Map();
export function marketView(league, p) {
  const src = (p && p.base) || p;
  const truth = overall(p);
  if (!scoutingOn(league) || isScouted(league, src)) return truth;
  const key = `${league.seed >>> 0}:${src.id}:${truth}`;
  let v = marketCache.get(key);
  if (v === undefined) {
    const ceiling = Math.max(truth, startCareer(league, src).ceiling ?? truth);
    v = Math.round(truth + (ceiling - truth) * UPSIDE_WEIGHT);
    if (marketCache.size > 20000) marketCache.clear();
    marketCache.set(key, v);
  }
  return v;
}

/** The number a club actually bids or drafts on. */
export function scoutedOverall(league, p, observerIdx = -1) {
  return scoutReport(league, p, observerIdx).estimate;
}

/**
 * The rating a list should sort and rank by. Sorting an unscouted rookie by his
 * true overall leaks it: his place in the table is the number. Sorting by what
 * the observer believes keeps the fog intact.
 */
export function shownOverall(league, p, observerIdx = -1) {
  return scoutReport(league, p, observerIdx).estimate;
}

/** How a range reads on screen: the shape of the bet, not just its size. */
export function scoutLabel(report) {
  if (report.known) return '';
  if (report.width >= 22) return 'boom or bust';
  if (report.width >= 12) return 'real upside';
  if (report.width >= 5) return 'some room';
  return 'what you see';
}

/**
 * When a scout thinks he arrives. '' once he is known.
 *
 * The RANGE is the answer, for the same reason it is on the rating: a phrase
 * that buckets him — "a long way off" — swallows exactly the variation this
 * exists to show. A first pass did that and read "a long way off" for seven
 * prospects in twelve, which is a label doing the opposite of its job.
 */
export function readyLabel(report) {
  if (!report || report.known || !report.late) return '';
  if (report.late <= 2) return 'ready now';
  return `${report.soon}-${report.late} yrs away`;
}

/**
 * A rookie's attributes, coarsened. The precise number is not scoutable but the
 * shape of the player is: fast hands-of-stone is a thing a scout can tell you,
 * and the rookie generator deliberately makes lopsided players, so hiding the
 * shape as well would throw away the most interesting part.
 */
export function coarseAttrs(league, p, observerIdx = -1) {
  const src = (p && p.base) || p;
  const step = 5;
  return POSITIONS[src.pos].attrs.map((a) => {
    const v = p.r[a] ?? 60;
    if (!scoutingOn(league) || isScouted(league, src)) return { attr: a, value: v, exact: true };
    const rng = new RNG(hashSeed(`attr:${league.seed >>> 0}:${src.id}:${a}:${observerIdx}`));
    const err = BASE_ERROR * (1 - accuracyOf(league, observerIdx)) * 0.5;
    const seen = clamp(v + rng.normal(0, err), 40, 99);
    return { attr: a, value: Math.round(seen / step) * step, exact: false };
  });
}

/**
 * Last year's class, one season on: what you projected against where they
 * actually are. The band is recomputed rather than stored, because it is
 * deterministic from the seed, the player and who was looking.
 *
 * This is the payoff. Fog is only worth having if you find out afterwards
 * whether you were right, and a hit and a miss should both be legible.
 */
export function scoutingHits(league, players, observerIdx, { season = league.season } = {}) {
  if (!scoutingOn(league) || !league.dev) return [];
  const out = [];
  for (const p of players) {
    const src = p.base || p;
    if (!src.generated || src.draftClass == null) continue;
    const c = league.dev && league.dev[src.id];
    if (!c || c.from == null || c.from !== season - 1) continue;
    const band = scoutReport(league, p, observerIdx, { force: true });
    const now = overall(p);
    // The band's top is a career ceiling, four to six seasons away. One year in,
    // the honest measure is how far he moved, not whether he has arrived.
    const moved = now - (c.entry ?? now);
    out.push({
      id: src.id,
      name: src.name,
      pos: src.pos,
      low: band.low,
      high: band.high,
      now,
      moved,
      room: Math.max(0, band.high - now),
      verdict: moved >= 6 ? 'a jump' : moved >= 3 ? 'coming on' : moved >= 1 ? 'inching up' : 'stood still',
    });
  }
  out.sort((a, b) => b.moved - a.moved);
  return out;
}
