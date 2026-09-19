// Finding a trade, as opposed to making one.
//
// The trade screen used to open on a club dropdown and two lists of
// twenty-seven. To find out whether anybody would part with a cornerback you
// picked a club, read its roster, picked the next club, and read that one. In
// a thirty-two club league that is eight hundred and sixty-four rows and no
// way to sort them.
//
// This module answers the two questions that were being asked by hand: who is
// available, and who has what I need. Both are pure functions of the league —
// no random numbers, so a redraw never changes the answer under the cursor.

import { ROSTER_SLOTS } from '../data/positions.js';
import { overall, TRUE_LEVERAGE } from './ratings.js';
import { ownerMap, slotOf } from './transactions.js';
import { availability } from './injuries.js';

const STARTERS = {};
for (const s of ROSTER_SLOTS) if (s.starter) STARTERS[s.pos] = (STARTERS[s.pos] || 0) + 1;
const SLOTS_AT = {};
for (const s of ROSTER_SLOTS) SLOTS_AT[s.pos] = (SLOTS_AT[s.pos] || 0) + 1;
const BENCH_WEIGHT = 0.25;

/** What one position group is worth, on the same yardstick as `lineupStrength`. */
function groupValue(overalls, pos) {
  const lev = TRUE_LEVERAGE[pos] ?? 1;
  const starters = STARTERS[pos] || 1;
  return overalls.slice().sort((a, b) => b - a)
    .reduce((t, o, i) => t + o * lev * (i < starters ? 1 : BENCH_WEIGHT), 0);
}

/** A club's players at one position, as ids, in roster order. */
function roomIds(team, pos) {
  return ROSTER_SLOTS.filter((s) => s.pos === pos).map((s) => team.slots[s.id]).filter(Boolean);
}

/**
 * The best free agent at each position, once, so the block does not re-sort
 * the pool twenty-seven times a club.
 */
export function bestAvailable(league, pool) {
  const owned = ownerMap(league);
  const best = {};
  for (const p of pool) {
    if (p.retired || owned.has(p.id)) continue;
    const cur = best[p.pos];
    if (!cur || overall(p) > overall(cur)) best[p.pos] = p;
  }
  return best;
}

/**
 * What it would cost a club, in lineup points, to give a player up and replace
 * him from free agency. This is the number that decides what goes on the block:
 * a fourth receiver behind three good ones costs almost nothing, a starting
 * quarterback costs a fortune, and the difference is mostly leverage.
 */
export function partingCost(team, playerId, byId, best, league = null) {
  const p = byId.get(playerId);
  if (!p) return Infinity;
  const av = (id) => (league ? availability(league, id) : 1);
  const before = roomIds(team, p.pos).map((id) => overall(byId.get(id)) * av(id));
  const rest = roomIds(team, p.pos).filter((id) => id !== playerId).map((id) => overall(byId.get(id)) * av(id));
  const fa = best[p.pos];
  // The room has one slot per body, so giving a man up means signing one.
  const after = fa ? rest.concat(overall(fa)) : rest;
  return Math.round((groupValue(before, p.pos) - groupValue(after, p.pos)) * 10) / 10;
}

/**
 * Where a club is thin, measured against the rest of the league rather than
 * against an absolute, because a league of all-time greats has no bad rooms in
 * absolute terms and still has worst ones.
 */
export function teamNeeds(league, byId, { count = 3 } = {}) {
  const positions = Object.keys(SLOTS_AT);
  const values = positions.map((pos) => ({
    pos,
    per: league.teams.map((t) => groupValue(roomIds(t, pos).map((id) => overall(byId.get(id))), pos)),
  }));
  return league.teams.map((_, i) => values
    .map(({ pos, per }) => {
      const sorted = per.slice().sort((a, b) => a - b);
      const rank = sorted.indexOf(per[i]);
      // Shortfall against the league median, which is what a GM feels.
      const median = sorted[Math.floor(sorted.length / 2)];
      return { pos, rank, short: Math.round((median - per[i]) * 10) / 10 };
    })
    .filter((n) => n.short > 0)
    .sort((a, b) => b.short - a.short)
    .slice(0, count));
}

/**
 * Who every AI club would listen to offers on, and what each is thinking.
 *
 * A club shops the men it can replace cheaply: the deep end of a strong room,
 * and anyone whose position it is carrying more of than it needs. It does not
 * shop its best players, which is why the cheapest thing on any block is
 * usually a fourth receiver and never a quarterback.
 */
export function tradeBlock(league, byId, pool, { perTeam = 4, maxCost = 60 } = {}) {
  const best = bestAvailable(league, pool);
  const needs = teamNeeds(league, byId);
  return league.teams.map((team, i) => {
    if (team.isUser) return { team: i, needs: needs[i], players: [] };
    const players = ROSTER_SLOTS.map((s) => team.slots[s.id]).filter(Boolean)
      .map((id) => ({ id, pos: byId.get(id)?.pos, cost: partingCost(team, id, byId, best, league) }))
      .filter((x) => x.pos && Number.isFinite(x.cost) && x.cost <= maxCost)
      // A club never shops a position it is already short of.
      .filter((x) => !needs[i].some((n) => n.pos === x.pos && n.rank < league.teams.length / 3))
      .sort((a, b) => a.cost - b.cost)
      .slice(0, perTeam);
    return { team: i, needs: needs[i], players };
  });
}

/** Flattened and sorted by how cheaply the owner would part, for one league-wide list. */
export function openBlock(league, byId, pool, opts = {}) {
  return tradeBlock(league, byId, pool, opts)
    .flatMap((b) => b.players.map((p) => ({ ...p, team: b.team })))
    .sort((a, b) => a.cost - b.cost);
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Every rostered player in the league, filtered. This is the other half of the
 * answer: the block says who is going cheap, the search says where a named man
 * or a whole position actually plays.
 */
export function findPlayers(league, byId, { q = '', pos = '', team = null, minOvr = 0, exclude = null, limit = 60 } = {}) {
  const needle = norm(q).trim();
  const out = [];
  league.teams.forEach((t, i) => {
    if (exclude != null && i === exclude) return;
    if (team != null && i !== team) return;
    for (const s of ROSTER_SLOTS) {
      const id = t.slots[s.id];
      const p = id && byId.get(id);
      if (!p) continue;
      if (pos && p.pos !== pos) continue;
      const ovr = overall(p);
      if (ovr < minOvr) continue;
      if (needle && !norm(p.name).includes(needle) && !norm(t.name).includes(needle) && !norm(t.abbr).includes(needle)) continue;
      out.push({ id, team: i, pos: p.pos, ovr, slot: s.id, starter: !!s.starter });
    }
  });
  out.sort((a, b) => b.ovr - a.ovr);
  return { total: out.length, players: out.slice(0, limit) };
}

/** Which club holds a player, for the search result's "target" button. */
export function holderOf(league, playerId) {
  return league.teams.findIndex((t) => slotOf(t, playerId));
}
