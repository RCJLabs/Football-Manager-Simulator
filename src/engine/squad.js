// The practice squad: somewhere for a young player to sit.
//
// Three changes in a row established what was *not* pushing drafted rookies
// off rosters. Contracts were not: a man under term is kept by default now and
// first-year retention roughly doubled, but most of a class still went. Cutting
// being free was not: dead money is real money and the churn did not move.
// Draft order was not. What is left is the roster itself.
//
// Twenty-seven slots, every one of them a starter or the first man off the
// bench, and every one of them must be filled. A club's twenty-seventh best
// player is genuinely worse than the best of a three-hundred-man free-agent
// market, so a fifth-round rookie is genuinely the man to replace — and being
// right about that every week is what strips a draft class. There is nowhere
// for somebody to be young.
//
// This is that somewhere. A club may hold a few players outside its twenty-
// seven: they do not play, they cost the minimum, and they age and develop
// like anybody else. It is the injured-reserve shape — a parallel list beside
// the slots — because that shape already works and everything that walks a
// roster already knows to walk `ir` beside it.
//
// Pro leagues only. A fantasy league drafts the all-time pool every year and
// has nobody to develop; a squad there would just be a deeper bench, which is
// a different game and not this one's problem.

import { ROSTER_SLOTS } from '../data/positions.js';
import { overall } from './ratings.js';
import { classYear } from './proleague.js';
import { letGo } from './cap.js';

/** Places on the squad, per club. */
export const SQUAD_SLOTS = 6;

/**
 * How long a man stays squad-eligible, counted from his draft class.
 *
 * Long enough for a pick to become a player and short enough that a club
 * cannot warehouse one. The real game counts accrued seasons; a class year is
 * the same idea and is already stamped on every generated player.
 */
export const SQUAD_SEASONS = 3;

export function squadOn(league) {
  return league?.mode === 'pro';
}

export function squadList(team) {
  return (team && team.squad) || [];
}

export function squadCapacity(league) {
  return league?.settings?.squadSlots ?? SQUAD_SLOTS;
}

/**
 * Whether this man may sit on a squad.
 *
 * Generated players only, and only while their class is recent. An all-time
 * great is not developing and cannot be stashed: the squad is a place to grow,
 * not a place to hide a roster you could not otherwise afford.
 */
export function squadEligible(league, player, season = league?.season) {
  if (!squadOn(league) || !player?.generated) return false;
  const cls = player.draftClass;
  if (cls == null) return false;
  return classYear(season) - cls < SQUAD_SEASONS;
}

const slotHolding = (team, id) => ROSTER_SLOTS.find((s) => team.slots[s.id] === id)?.id || null;

/** Why this player cannot be sent down, or null if he can. */
export function squadBlocker(league, teamIdx, id, byId) {
  const team = league?.teams?.[teamIdx];
  if (!team) return 'No such club';
  if (!squadOn(league)) return 'Only a pro league has a practice squad';
  if (squadList(team).length >= squadCapacity(league)) return `Only ${squadCapacity(league)} places on the practice squad`;
  if (!slotHolding(team, id)) return 'He is not on your roster';
  const p = byId?.get(id);
  if (!p) return 'Unknown player';
  if (!squadEligible(league, p)) return `${p.name} has been in the league too long for the practice squad`;
  return null;
}

export function canStash(league, teamIdx, id, byId) {
  return squadBlocker(league, teamIdx, id, byId) === null;
}

/** Send a man down, emptying his slot. Throws with a readable reason. */
export function stash(league, teamIdx, id, byId) {
  const blocker = squadBlocker(league, teamIdx, id, byId);
  if (blocker) throw new Error(blocker);
  const team = league.teams[teamIdx];
  team.squad ??= [];
  team.slots[slotHolding(team, id)] = null;
  team.squad.push(id);
  (league.transactions ??= []).push({ week: league.week, season: league.season, type: 'stash', team: teamIdx, add: null, drop: id });
  return id;
}

/**
 * Bring a man up. Into an open slot at his position, or over somebody named.
 * The man dropped for him goes nowhere in particular — that is the caller's
 * business, and on the wire it is a release.
 */
export function promote(league, teamIdx, id, dropId, byId) {
  const team = league.teams[teamIdx];
  if (!squadList(team).includes(id)) throw new Error('He is not on the practice squad');
  const p = byId?.get(id);
  if (!p) throw new Error('Unknown player');
  let slotId;
  if (dropId) {
    slotId = slotHolding(team, dropId);
    if (!slotId) throw new Error('That player is not on your roster');
    const drop = byId.get(dropId);
    if (drop && drop.pos !== p.pos) throw new Error(`Release a ${p.pos} to bring up a ${p.pos}`);
  } else {
    slotId = ROSTER_SLOTS.find((s) => s.pos === p.pos && !team.slots[s.id])?.id;
    if (!slotId) throw new Error(`No open ${p.pos} slot; name a player to release`);
  }
  team.squad = squadList(team).filter((x) => x !== id);
  team.slots[slotId] = id;
  // The man making way is let go, as a cut is.
  if (dropId) letGo(league, teamIdx, dropId);
  (league.transactions ??= []).push({ week: league.week, season: league.season, type: 'promote', team: teamIdx, add: id, drop: dropId || null });
  return slotId;
}

/** Let a squad man go entirely. */
export function releaseFromSquad(league, teamIdx, id) {
  const team = league.teams[teamIdx];
  if (!squadList(team).includes(id)) return false;
  team.squad = squadList(team).filter((x) => x !== id);
  letGo(league, teamIdx, id);
  (league.transactions ??= []).push({ week: league.week, season: league.season, type: 'release', team: teamIdx, add: null, drop: id });
  return true;
}

/**
 * Drop whoever has outgrown the squad.
 *
 * Run in the offseason, after the classes have aged. A man who is no longer
 * eligible cannot sit there: he is promoted if his club has room for him at
 * his position, and let go if it does not. Returns what happened, for the
 * offseason summary.
 */
export function agedOutOfSquad(league, byId) {
  if (!squadOn(league)) return { promoted: [], released: [] };
  const promoted = [], released = [];
  league.teams.forEach((team, ti) => {
    for (const id of squadList(team)) {
      const p = byId?.get(id);
      if (p && squadEligible(league, p)) continue;
      const open = p && ROSTER_SLOTS.find((s) => s.pos === p.pos && !team.slots[s.id]);
      if (open) { promote(league, ti, id, null, byId); promoted.push({ team: ti, id }); }
      else { releaseFromSquad(league, ti, id); released.push({ team: ti, id }); }
    }
  });
  return { promoted, released };
}

/**
 * The AI's squad, once a week.
 *
 * Bring a man up when he is plainly better than what is in the slot, which is
 * the point of having watched him develop. Nothing else: sending men down is
 * decided where the cutting is decided, because that is the choice it replaces.
 */
export function aiManageSquad(league, byId) {
  if (!squadOn(league)) return [];
  const moves = [];
  league.teams.forEach((team, ti) => {
    if (team.isUser) return;
    for (const id of squadList(team)) {
      const p = byId?.get(id);
      if (!p) continue;
      const open = ROSTER_SLOTS.find((s) => s.pos === p.pos && !team.slots[s.id]);
      if (open) { promote(league, ti, id, null, byId); moves.push({ team: ti, id, type: 'promote' }); continue; }
      const worst = ROSTER_SLOTS.filter((s) => s.pos === p.pos && team.slots[s.id])
        .map((s) => ({ s, q: byId.get(team.slots[s.id]) })).filter((x) => x.q)
        .sort((a, b) => overall(a.q) - overall(b.q))[0];
      // Two points, the same bar the wire uses for an upgrade. Below that he is
      // better off getting another week of development than a roster spot.
      if (worst && overall(p) >= overall(worst.q) + 2) {
        promote(league, ti, id, worst.s.id ? team.slots[worst.s.id] : null, byId);
        moves.push({ team: ti, id, type: 'promote', over: worst.q.id });
      }
    }
  });
  return moves;
}
