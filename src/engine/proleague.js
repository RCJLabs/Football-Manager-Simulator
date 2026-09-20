// Pro mode as a closed league: a draft of rookies, a market of veterans.
//
// The fantasy league is an all-time draft and should stay one. The pro league
// was the same thing wearing a cap, and the measurements say how badly that
// worked. In a thirty-two club league 864 slots are filled from a pool of
// 1,269, so **about four hundred all-time players sit permanently unsigned** —
// and a generated rookie has to beat them to be picked. Measured over a
// twelve-season save: the second-season draft made 102 picks and **nine of
// them were rookies**, the third made 203 and twenty-one were, and free agency
// still held 415 all-time players in season nine and 124 in season thirteen.
// For years the best free agent in the league was a kicker — Martin Gramatica,
// then Phil Dawson, then Robbie Gould — because leverage says no club should
// spend a roster slot on one, so nobody ever did.
//
// So the two pools are split the way the real thing splits them:
//
//   - **The draft is this year's rookie class and nothing else.** It runs as
//     many rounds as the class needs rather than one per roster slot — 176
//     rookies over 32 clubs is five rounds, not twenty-seven.
//   - **Free agency is players who were in the league and are not on a roster
//     now**: cut, let go when a deal ran out, or never re-signed. Not this
//     year's rookies, who are in the draft.
//   - **The all-time players nobody drafted drain away.** Year one they are
//     the free-agent market, which keeps the opening season of an all-time
//     league feeling like one. They are never replenished, and each offseason
//     another tranche goes.
//
// The same save measured again after the split: every pick from season two on
// is a rookie, and the all-time share of free agency falls 496, 445, 356, 279,
// 150, 109, 75, 49, 24, 20, 15 and then nothing. From about season eight the
// best player in the draft class outrates the best player on the market, which
// is the whole point — the draft becomes the way a club gets better.
//
// The opening draft is untouched: that is how the league gets populated, and
// there are no rookies in season one to draft anyway.

import { ROSTER_SLOTS, SLOT_COUNTS } from '../data/positions.js';
import { overall } from './ratings.js';
import { BASE_YEAR } from './rookies.js';

/** How long the undrafted all-timers take to clear out. */
export const DRAIN_SEASONS = 4;

/**
 * How long a veteran who loses his place stays on the market.
 *
 * Counted in offseasons rather than in seasons, because that is when the drain
 * runs: a man unrostered when one offseason opens is signable through the year
 * that follows and gone at the next. In practice it is a season or two — the
 * drain schedules at the *start* of an offseason, so somebody who loses his
 * place later in the same one (in the keeper round, in free agency, at the
 * cap) is not noticed until the following year and gets that year as well.
 * That is a little generous and deliberately not tightened: the supply is the
 * binding constraint here, not the demand, and taking a year off the market
 * makes the league thinner rather than more realistic.
 */
export const MARKET_SEASONS = 1;

/** Whether this league runs the closed pro shape. Never in season one. */
export function proPools(league) {
  return league?.mode === 'pro' && (league.season ?? 1) > 1;
}

/** The draft class a season's draft is for. */
export function classYear(season) {
  return BASE_YEAR + (season ?? 1) - 1;
}

/** This season's rookies — the whole draft pool, in a pro league. */
export function rookieClass(league, season = league?.season) {
  const year = classYear(season);
  return (league?.rookies || []).filter((p) => p.draftClass === year);
}

/**
 * How deep a rookie draft runs: enough rounds to get through the class, and
 * never more than a roster has slots.
 *
 * Not seven, which is what the real thing uses, because a roster here is
 * twenty-seven men rather than fifty-three and the class is sized to match.
 * Whatever the draft does not place is signed off the veteran market, which is
 * what undrafted free agency is.
 */
export function proDraftRounds(league) {
  const teams = league?.teams?.length || 1;
  const size = rookieClass(league).length;
  if (!size) return 1;
  // Floor, not ceiling: a round every club can actually fill. The remainder of
  // the class goes undrafted and joins the veteran market next year, which is
  // what undrafted free agency is. Rounding up instead leaves the tail of the
  // last round with nobody to pick.
  return Math.max(1, Math.min(ROSTER_SLOTS.length, Math.floor(size / teams)));
}

/**
 * Who the league is leaving behind, and when.
 *
 * Called at the end of the opening draft and again every offseason, and the
 * two calls mean different things. The first is the all-time surplus: 864
 * slots out of a pool of 1,269 leaves 405 men who were never going to be
 * signed, and they are spread over `DRAIN_SEASONS` so the market thins rather
 * than falls off a cliff. Every call after that is ordinary attrition — whoever
 * is off a roster now gets `MARKET_SEASONS` to find another one.
 *
 * Scheduling only once was the first version of this and it does not work. The
 * unrostered *set* churns even though its size cannot: a club cuts a man to
 * make cap room and he is unsigned from then on, never having been on the
 * original list. So the 405 leave and a fresh 405 take their place, and the
 * market a rookie has to beat never actually thins.
 *
 * Nothing is written to the player objects themselves — those are shipped data
 * shared by every league in the browser, and a league that retired Jerry Rice
 * for the others would be a bug nobody could find.
 */
export function scheduleDrain(league, pool, rostered) {
  if (league?.mode !== 'pro') return 0;
  const founding = !league.drain;
  league.drain ??= {};
  const gone = departedSet(league);
  const season = league.season ?? 1;
  let n = 0;
  for (const p of pool || []) {
    if (p.generated || rostered.has(p.id) || gone.has(p.id)) continue;
    if (league.drain[p.id] != null) continue;
    // Spread the founding intake by a stable hash of the id rather than by
    // order, so the market does not lose every quarterback in the same year.
    let h = 0;
    for (let i = 0; i < p.id.length; i++) h = (h * 31 + p.id.charCodeAt(i)) >>> 0;
    league.drain[p.id] = founding ? season + 1 + (h % DRAIN_SEASONS) : season + MARKET_SEASONS;
    n++;
  }
  return n;
}

/**
 * How much spare a position must keep on the market.
 *
 * The drain has to be allowed to starve nobody, and it very nearly did. Run
 * blind over a thirty-two club league it took the market down to no kickers
 * and no punters at all, and clubs came out of the offseason unable to field
 * one — the invariant this game holds above all others is that nobody starts a
 * season a man short.
 *
 * A share of what the position is actually for, not a flat count. One spare a
 * club was the first guess and it is the wrong shape: a club fields one kicker
 * and five offensive linemen, so a flat floor demanded as much cover for the
 * kicker as the whole league uses kickers, and across eleven positions it held
 * 352 men off the drain's reach — most of a market that settles near four
 * hundred. The drain could then only ever remove the few dozen above that
 * line, which is not a drain.
 */
export const DRAIN_FLOOR_SHARE = 0.15;

/** The smallest market a position may be left with, whatever the share says. */
export const DRAIN_FLOOR_MIN = 3;

export function drainFloor(league, pos) {
  const teams = league?.teams?.length || 1;
  const need = (SLOT_COUNTS[pos] || 1) * teams;
  return Math.max(DRAIN_FLOOR_MIN, Math.ceil(need * DRAIN_FLOOR_SHARE));
}

/**
 * Retire whoever's time is up, and forget anybody who found a club.
 *
 * A man who was signed at some point is a league member and stops draining: he
 * can be cut later and go back on the market like anybody else.
 *
 * `available` is every unrostered player still signable, by position, so the
 * drain can stop short of emptying one. Without it this leaves a league that
 * cannot punt. Returns the ids that left, for the offseason summary.
 */
export function drainVeterans(league, rostered, available = null) {
  scheduleDrain(league, available, rostered);
  if (!league?.drain) return [];
  const left = new Map();
  const byIdHere = new Map();
  for (const p of available || []) {
    byIdHere.set(p.id, p);
    if (rostered.has(p.id)) continue;
    left.set(p.pos, (left.get(p.pos) || 0) + 1);
  }
  const due = [];
  for (const [id, season] of Object.entries(league.drain)) {
    if (rostered.has(id)) { delete league.drain[id]; continue; }
    if (season > (league.season ?? 1)) continue;
    due.push(id);
  }
  // Best first, so that when a position is down to its floor the men who stay
  // are the fringe ones. That is the right way round: a great player nobody
  // will sign retires rather than sit on the market, and the journeyman is the
  // one still taking calls in August.
  due.sort((a, b) => {
    const pa = byIdHere.get(a), pb = byIdHere.get(b);
    return (pb ? overall(pb) : 0) - (pa ? overall(pa) : 0) || (a < b ? -1 : 1);
  });
  const gone = [];
  for (const id of due) {
    const pos = byIdHere.get(id)?.pos;
    if (pos && (left.get(pos) || 0) <= drainFloor(league, pos)) continue;   // the last of a position stays
    if (pos) left.set(pos, left.get(pos) - 1);
    delete league.drain[id];
    gone.push(id);
  }
  if (gone.length) league.departed = [...(league.departed || []), ...gone];
  return gone;
}

/** Everyone this league has shown the door. */
export function departedSet(league) {
  return new Set(league?.departed || []);
}

/**
 * The pool a pro draft draws from: this season's rookies, nobody else.
 *
 * Outside a pro league, or in the opening season, the caller's pool is handed
 * straight back — the all-time draft is the point of a fantasy league and the
 * only way a pro league gets started.
 */
export function draftablePool(league, pool) {
  if (!proPools(league)) return pool;
  const ids = new Set(rookieClass(league).map((p) => p.id));
  return pool.filter((p) => ids.has(p.id));
}

/**
 * The pool anyone may sign from: league veterans who are not on a roster.
 *
 * Excludes this year's rookies, who belong to the draft, and anyone the drain
 * has shown out. Used by free agency, the waiver wire and the fill that runs
 * at kickoff, so all three agree on who exists.
 */
export function signablePool(league, pool) {
  if (!proPools(league)) return pool;
  const draftees = new Set(rookieClass(league).map((p) => p.id));
  const gone = departedSet(league);
  return pool.filter((p) => !draftees.has(p.id) && !gone.has(p.id));
}
