// Team chemistry: how well a squad already knows itself.
//
// Chemistry in sports games is usually an invisible multiplier that either does
// nothing you can feel or quietly decides your season. This one is neither: it
// is a number on the team screen with its two inputs shown, and it is worth at
// most a couple of points on a 40-99 scale, which is roughly two home-field
// edges. You can see where it comes from and you can see what it is worth.
//
// Two inputs, and only one of them is ordinary.
//
// **Continuity** is the familiar one: starters who were here last year, and the
// year before. It rewards keeping a core rather than re-buying a roster every
// offseason, which is the same thing the keeper rules reward, so the dynasty
// loop pulls in one direction instead of two.
//
// **Era cohesion** is particular to this game. A squad drawn from 1948 to 2024
// is the whole fantasy, and it is also eleven men who have never played the
// same football. A tight era band gels immediately; a scattered one takes a
// couple of seasons. It is a first-season tax, not a permanent penalty — the
// spread stops mattering as the squad plays together, so an all-time team is
// rough in year one and fine by year three. Building era-themed is a real
// alternative rather than the only right answer.
//
// Chemistry only touches execution: blocking together, coverage handoffs,
// awareness, a quarterback's timing with receivers he knows. It never moves
// speed or arm strength, because knowing each other does not make anyone faster.

import { ROSTER_SLOTS } from '../data/positions.js';

/** The most chemistry can be worth, in rating points, in either direction. */
export const MAX_BONUS = 1.8;
/** Seasons together after which a wide era spread has stopped mattering. */
export const GEL_SEASONS = 3;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** The starters a chemistry reading is taken from. */
export function starterIds(team) {
  return ROSTER_SLOTS.filter((s) => s.starter).map((s) => team.slots[s.id]).filter(Boolean);
}

/**
 * Seasons this club has had this player, 0 for someone who arrived this year.
 * Read straight off `league.tenure`, which season.js maintains, rather than
 * imported from there — chemistry is used inside season.js and the cycle is not
 * worth having.
 */
export function seasonsTogether(league, teamIdx, playerId) {
  const held = league.tenure && league.tenure[teamIdx];
  return Math.max(0, ((held && held[playerId]) || 1) - 1);
}

/** Population standard deviation of the years a squad's starters come from. */
export function eraSpread(seasons) {
  if (seasons.length < 2) return 0;
  const mean = seasons.reduce((s, x) => s + x, 0) / seasons.length;
  return Math.sqrt(seasons.reduce((s, x) => s + (x - mean) ** 2, 0) / seasons.length);
}

/**
 * A reading for one club. Returns the score out of 100, both inputs, and the
 * rating points it is worth. Tenure counts seasons on this roster, not contract
 * age, so a player re-bought at auction by the club he already played for keeps
 * his continuity while a waiver claim in week 9 counts as a newcomer.
 */
export function chemistry(league, teamIdx, byId) {
  const team = league.teams[teamIdx];
  const ids = starterIds(team);
  if (!ids.length) return { score: 50, continuity: 0, cohesion: 0, together: 0, spread: 0, bonus: 0, starters: 0 };

  const seasons = [];
  let tenure = 0;
  for (const id of ids) {
    const p = byId.get(id);
    if (p) seasons.push((p.base || p).season);
    tenure += seasonsTogether(league, teamIdx, id);
  }
  const together = tenure / ids.length;

  // Continuity saturates at three seasons: a core that has been together longer
  // than that is as settled as it is going to get.
  const continuity = clamp(together / GEL_SEASONS, 0, 1);

  // A single-decade squad sits near 4; an all-time scatter runs past 25.
  const spread = eraSpread(seasons);
  const fit = clamp(1 - (spread - 5) / 22, 0, 1);
  // The era penalty decays as the squad plays together; the bonus does not.
  const cohesion = fit + (1 - fit) * continuity;

  const raw = 0.55 * continuity + 0.45 * cohesion;
  return {
    score: Math.round(raw * 100),
    continuity: Math.round(continuity * 100),
    cohesion: Math.round(cohesion * 100),
    together: Math.round(together * 10) / 10,
    spread: Math.round(spread),
    starters: ids.length,
  };
}

/** How far above the league a club has to be for the full bonus. */
export const SPREAD_SCALE = 25;

/**
 * What a club's chemistry is worth on the field.
 *
 * Measured against the rest of the league rather than against 100, because the
 * absolute number is not the thing: every club in a league is unsettled in
 * season one and most are settled by season four, and an effect everybody gets
 * at once is no effect at all. What matters is being more settled than the
 * clubs you play. Centring on the league mean also cancels a scaling artifact —
 * a fantasy league re-auctions most of its rosters every year and so never
 * climbs past the thirties, while the pro league keeps eighteen and reaches the
 * seventies. Both should still hand their best club roughly the same edge.
 */
export function chemistryBonuses(league, byId) {
  // Absent means the league predates chemistry and keeps playing without it.
  if (!(league.settings && league.settings.chemistry)) return league.teams.map(() => 0);
  const scores = league.teams.map((_, i) => chemistry(league, i, byId).score);
  const mean = scores.reduce((s, x) => s + x, 0) / scores.length;
  return scores.map((sc) => Math.round(clamp((sc - mean) / SPREAD_SCALE, -1, 1) * MAX_BONUS * 100) / 100);
}

/** A club's reading with the bonus it earns, for the team screen. */
export function chemistryFor(league, teamIdx, byId) {
  const reading = chemistry(league, teamIdx, byId);
  const scores = league.teams.map((_, i) => chemistry(league, i, byId).score);
  const mean = scores.reduce((s, x) => s + x, 0) / scores.length;
  const off = !(league.settings && league.settings.chemistry);
  return {
    ...reading,
    leagueMean: Math.round(mean),
    rank: 1 + scores.filter((x) => x > reading.score).length,
    bonus: off ? 0 : Math.round(clamp((reading.score - mean) / SPREAD_SCALE, -1, 1) * MAX_BONUS * 100) / 100,
  };
}

/** A sentence for the team screen. */
export function describeChemistry(c) {
  const rel = c.leagueMean == null ? c.score : c.score - c.leagueMean;
  const band = rel >= 12 ? 'Settled' : rel >= 4 ? 'Coming together' : rel >= -8 ? 'About league average' : 'Strangers';
  const why = c.spread >= 26 ? 'a squad spread across the whole history of the game'
    : c.spread >= 14 ? 'a fairly wide era mix'
      : 'a tight era band';
  const held = c.together >= 2.5 ? 'a core that has been together a while'
    : c.together >= 1 ? 'a core into its second year'
      : 'almost nobody here last season';
  return `${band}: ${held}, ${why}.`;
}
