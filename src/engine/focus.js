// Development focus: which men a club's staff spends the season on.
//
// Careers already give every man hidden traits — `pace` scales how fast he
// climbs, `wear` how fast he declines — and nothing a club did could touch
// either. This is the lever: name a few men, and they climb faster if they are
// still climbing and decline slower if they are past it.
//
// It is not free, and deliberately so. A boost with no cost is a choice with
// one right answer (always use it), and applied by every club it would inflate
// the league: ratings are what salaries, the draft and the whole cap are
// priced from. So the staff's time is a budget, not a bonus — every focus a
// club spends makes everybody else on its roster develop a little slower and
// decline a little faster. What a club gains is concentration: the men who
// matter most, at the ages where the season moves them most. Chosen well it is
// worth something; chosen blindly it is worth about nothing, which is the
// shape a decision should have. Sized by measurement — see DESIGN.md.
//
// A club that names nobody gets its staff's picks, the same rule every AI club
// uses, so leaving it alone is never worse than the league around you. Named
// picks last the season they are made in and are cleared when it is applied,
// so a stale choice cannot quietly carry into a year it no longer fits.

import { ROSTER_SLOTS } from '../data/positions.js';
import { primeAge, expectedChange, startCareer } from './careers.js';
import { teamContractIds } from './cap.js';
import { TRUE_LEVERAGE } from './auction.js';
import { scoutReport } from './scouting.js';
import { overall } from './ratings.js';

/** How many men a club can focus on in a season. */
export const FOCUS_SLOTS = 3;
/** A focused man climbs this much faster... */
export const FOCUS_CLIMB = 1.0;
/** ...and declines this much slower. */
export const FOCUS_EASE = 0.6;
/**
 * What each focus costs every unfocused teammate, as a share of his climb and
 * of his decline. Set so a league where every club focuses develops the same
 * total as one where none does — see DESIGN.md, "Development focus".
 */
export const FOCUS_COST = 0.028;

/** Only where players develop, and only where the league has it switched on. */
export function focusOn(league) {
  return !!league?.settings?.careers && !!league?.settings?.focus;
}

/** Everybody a club develops: the roster, injured reserve and practice squad. */
function members(league, teamIdx) {
  return new Set(teamContractIds(league, teamIdx));
}

/** The men this club has named itself, still on it, or null if it has named nobody. */
export function namedFocus(league, teamIdx) {
  const list = league.focus?.[teamIdx];
  if (!Array.isArray(list)) return null;
  const on = members(league, teamIdx);
  return list.filter((id) => on.has(id)).slice(0, FOCUS_SLOTS);
}

/**
 * How old a man is, for focus. A career starts lazily — at the first offseason
 * a man spends on a roster — so in a league's first season nobody has an age
 * yet, and the staff could pick nobody while a human could still name anyone.
 * The age his career will start at is fixed by the league seed and his id, so
 * it is read here and shown on the screen, and it is exactly what the first
 * offseason then records.
 */
export function ageOf(league, p) {
  if (!p) return null;
  if (p.age != null) return p.age;
  return startCareer(league, p.base || p).age;
}

/**
 * What focusing on this man is worth to the club this season, in
 * leverage-weighted overall points: the expected season at his age, the share
 * of it focus changes, and how much his position and role matter. Built only
 * from what every club can see — age, position, role and, for a rookie, the
 * scouting range — never from the hidden traits it acts on.
 */
export function focusValue(league, p, teamIdx, starter = true) {
  const age = ageOf(league, p);
  if (age == null) return 0;
  const { climb, decline } = expectedChange(p.pos, age + 1 - primeAge(p.pos));
  let up = climb * FOCUS_CLIMB;
  // A rookie's range caps what climbing can buy: focus hurries a man toward
  // his ceiling and cannot lift it.
  if (p.generated && up > 0) {
    const rep = scoutReport(league, p, teamIdx);
    if (!rep.known) up = Math.min(up, Math.max(0, rep.high - overall(p)) * FOCUS_CLIMB);
  }
  const held = -decline * FOCUS_EASE;
  return (up + held) * (TRUE_LEVERAGE[p.pos] ?? 1) * (starter ? 1 : 0.5);
}

/** A club's staff's picks: the men focus is worth most on, by `focusValue`. */
export function staffFocus(league, teamIdx, byId) {
  const team = league.teams[teamIdx];
  if (!team) return [];
  const starters = new Set(ROSTER_SLOTS.filter((s) => s.starter).map((s) => team.slots[s.id]).filter(Boolean));
  return [...members(league, teamIdx)]
    .map((id) => ({ id, v: focusValue(league, byId.get(id), teamIdx, starters.has(id)) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1))
    .slice(0, FOCUS_SLOTS)
    .map((x) => x.id);
}

/** Who a club is focusing on this season: its own picks if it made any, else its staff's. */
export function focusOf(league, teamIdx, byId) {
  if (!focusOn(league)) return [];
  return namedFocus(league, teamIdx) ?? staffFocus(league, teamIdx, byId);
}

/**
 * Name a man, or take him off. The first change replaces the staff's picks
 * with the club's own, starting from what the staff had chosen, so taking one
 * man off does not silently drop the other two.
 */
export function toggleFocus(league, teamIdx, id, byId) {
  if (!focusOn(league)) return { ok: false, reason: 'Development focus is switched off in this league' };
  if (!members(league, teamIdx).has(id)) return { ok: false, reason: 'He is not on your club' };
  const list = [...focusOf(league, teamIdx, byId)];
  const at = list.indexOf(id);
  if (at >= 0) list.splice(at, 1);
  else if (list.length >= FOCUS_SLOTS) return { ok: false, reason: `${FOCUS_SLOTS} at most — take somebody off first` };
  else list.push(id);
  league.focus ??= {};
  league.focus[teamIdx] = list;
  return { ok: true, focused: at < 0 };
}

/** Back to the staff's picks. */
export function resetFocus(league, teamIdx) {
  if (league.focus) delete league.focus[teamIdx];
}

/**
 * The season's development plan, for `advanceCareers`: a multiplier for every
 * man on every club that is focusing on anybody. Focused men climb and hold on
 * better; their teammates pay for it, by `FOCUS_COST` for each man focused.
 */
export function focusPlan(league, byId) {
  const plan = new Map();
  if (!focusOn(league)) return plan;
  league.teams.forEach((_, team) => {
    const chosen = new Set(focusOf(league, team, byId));
    if (!chosen.size) return;
    const cost = FOCUS_COST * chosen.size;
    for (const id of members(league, team)) {
      plan.set(id, chosen.has(id)
        ? { focused: true, team, climb: 1 + FOCUS_CLIMB, decline: 1 - FOCUS_EASE }
        : { focused: false, team, climb: 1 - cost, decline: 1 + cost });
    }
  });
  return plan;
}

/** A season applied: clear every club's own picks so next season starts fresh. */
export function clearFocus(league) {
  delete league.focus;
}
