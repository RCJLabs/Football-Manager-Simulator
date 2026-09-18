// In-season roster moves: the free-agent pool, weekly waiver claims, and
// position-matched trades with AI clubs.
//
// Rosters are exactly 26 slots, one per position group entry, so every move is
// a swap: a claim names the player coming in and the player going out at the
// same position, and a trade exchanges equal position sets. That keeps every
// roster valid without a separate bench-management screen.
//
// Waivers resolve when the week advances. In a fantasy league the order rolls
// (a successful claim sends you to the back); in the pro league it is reverse
// standings each week. AI clubs file their own claims at the same moment, so
// the human never gets first pick of the pool for free.

import { ROSTER_SLOTS } from '../data/positions.js';
import { GM_PERSONALITIES } from '../data/teams.js';
import { overall } from './ratings.js';
import { TRUE_LEVERAGE } from './auction.js';
import { standings, isPro, sortDepthCharts } from './season.js';
import { availability, weeksLeft, SEASON_ENDING } from './injuries.js';

export const DEFAULT_WAIVER_LIMIT = 2;
export const MAX_TRADE_SIDE = 3;

/** How keen each GM personality is to work the wire. */
const ACTIVITY = { analytics: 0.9, gambler: 0.75, balanced: 0.6, defense: 0.55, trenches: 0.55, airraid: 0.5, ground: 0.45, oldschool: 0.3 };

const STARTERS = {};
for (const s of ROSTER_SLOTS) if (s.starter) STARTERS[s.pos] = (STARTERS[s.pos] || 0) + 1;
const BENCH_WEIGHT = 0.25;

export function ownerMap(league) {
  const m = new Map();
  league.teams.forEach((t, i) => { for (const s of ROSTER_SLOTS) if (t.slots[s.id]) m.set(t.slots[s.id], i); });
  return m;
}

export function freeAgents(league, pool) {
  const owned = ownerMap(league);
  return pool.filter((p) => !owned.has(p.id));
}

export function slotOf(team, playerId) {
  if (!playerId) return null;
  return ROSTER_SLOTS.find((s) => team.slots[s.id] === playerId)?.id || null;
}

/** An unfilled slot at a position, if the roster has one (older saves, or a bench slot left open). */
export function emptySlotAt(team, pos) {
  return ROSTER_SLOTS.find((s) => s.pos === pos && !team.slots[s.id])?.id || null;
}

export function waiverLimit(league) {
  return league.settings?.waiverLimit ?? DEFAULT_WAIVER_LIMIT;
}

export function tradeDeadlineWeek(league) {
  return Math.ceil((league.schedule?.length || 14) * 0.65);
}

export function tradesOpen(league) {
  return league.phase === 'season' && league.week <= tradeDeadlineWeek(league);
}

export function movesOpen(league) {
  return league.phase === 'season';
}

/**
 * Leverage-weighted roster strength: starters at full weight, bench at a
 * quarter. Position groups are sorted by overall first, so a trade is judged
 * by the lineup it produces rather than by whoever happens to sit in slot one.
 */
export function lineupStrength(slots, byId, league = null) {
  const groups = {};
  for (const s of ROSTER_SLOTS) {
    const p = byId.get(slots[s.id]);
    // A hurt player counts for the share of the remaining season he will play.
    if (p) (groups[s.pos] ??= []).push(overall(p) * (league ? availability(league, p.id) : 1));
  }
  let total = 0;
  for (const [pos, arr] of Object.entries(groups)) {
    arr.sort((a, b) => b - a);
    const lev = TRUE_LEVERAGE[pos] ?? 1;
    arr.forEach((o, i) => { total += o * lev * (i < (STARTERS[pos] || 1) ? 1 : BENCH_WEIGHT); });
  }
  return Math.round(total * 10) / 10;
}

function withSwap(slots, slotId, newId) {
  return { ...slots, [slotId]: newId };
}

// ---------------------------------------------------------------------------
// Waivers
// ---------------------------------------------------------------------------

export function initWaivers(league) {
  league.claims ??= [];
  league.transactions ??= [];
  if (!league.waiverOrder || league.waiverOrder.length !== league.teams.length) {
    const order = (league.draft?.order || league.auction?.order || league.teams.map((_, i) => i)).slice().reverse();
    league.waiverOrder = order;
  }
}

export function claimsThisWeek(league, teamIdx) {
  return (league.claims || []).filter((c) => c.team === teamIdx && c.week === league.week);
}

/** Validate and file a claim. Throws with a human-readable reason. */
export function fileClaim(league, teamIdx, addId, dropId, byId) {
  initWaivers(league);
  if (!movesOpen(league)) throw new Error('The waiver wire is closed until next season');
  const team = league.teams[teamIdx];
  const add = byId.get(addId);
  if (!add) throw new Error('Unknown player');
  if (ownerMap(league).has(addId)) throw new Error(`${add.name} is on a roster`);
  const mine = claimsThisWeek(league, teamIdx);
  if (mine.some((c) => c.add === addId)) throw new Error(`You already have a claim in for ${add.name}`);
  if (dropId) {
    const drop = byId.get(dropId);
    if (!drop) throw new Error('Unknown player');
    if (!slotOf(team, dropId)) throw new Error(`${drop.name} is not on your roster`);
    if (add.pos !== drop.pos) throw new Error(`Swap a ${add.pos} for a ${add.pos}; you offered a ${drop.pos}`);
    if (mine.some((c) => c.drop === dropId)) throw new Error(`${drop.name} is already the drop in another claim`);
  } else {
    // No drop named: the claim goes into an open slot at that position, one claim per open slot.
    const open = ROSTER_SLOTS.filter((s) => s.pos === add.pos && !team.slots[s.id]).length;
    const pending = mine.filter((c) => !c.drop && byId.get(c.add)?.pos === add.pos).length;
    if (!open) throw new Error(`No open ${add.pos} slot; name a player to release`);
    if (pending >= open) throw new Error(`You already have a claim for the open ${add.pos} slot`);
    dropId = null;
  }
  if (mine.length >= waiverLimit(league)) throw new Error(`Only ${waiverLimit(league)} claims a week`);
  const claim = { team: teamIdx, add: addId, drop: dropId, week: league.week, filed: league.claims.length };
  league.claims.push(claim);
  return claim;
}

export function cancelClaim(league, teamIdx, addId) {
  initWaivers(league);
  const before = league.claims.length;
  league.claims = league.claims.filter((c) => !(c.team === teamIdx && c.add === addId));
  return league.claims.length < before;
}

/** AI clubs look for the single best upgrade at each position and file for it. */
export function aiFileClaims(league, pool, byId, rng) {
  initWaivers(league);
  const inj = league.injuries || {};
  const left = weeksLeft(league);
  // Nobody claims a man who cannot play.
  const fa = freeAgents(league, pool).filter((p) => !inj[p.id]);
  const byPos = {};
  for (const p of fa) (byPos[p.pos] ??= []).push(p);
  for (const arr of Object.values(byPos)) arr.sort((a, b) => overall(b) - overall(a));
  league.teams.forEach((team, ti) => {
    if (team.isUser) return;
    const gm = GM_PERSONALITIES.find((g) => g.id === team.gm);
    const activity = ACTIVITY[team.gm] ?? 0.5;
    if (rng && !rng.chance(activity)) return;
    const before = lineupStrength(team.slots, byId, league);
    const options = [];
    for (const s of ROSTER_SLOTS) {
      const cur = byId.get(team.slots[s.id]);
      const best = (byPos[s.pos] || [])[0];
      if (!best) continue;
      if (cur) {
        const hurt = inj[cur.id];
        // A hurt player who will be back this season keeps his spot unless the
        // pickup is better anyway; one done for the year is fair game.
        const doneForYear = hurt && (hurt.weeks >= SEASON_ENDING || hurt.weeks >= left);
        if (!doneForYear && overall(best) < overall(cur) + 2) continue;
      }
      const after = lineupStrength(withSwap(team.slots, s.id, best.id), byId, league);
      const gain = after - before;
      if (gain >= 6) options.push({ slot: s.id, add: best.id, drop: cur ? cur.id : null, gain });
    }
    options.sort((a, b) => b.gain - a.gain);
    const used = new Set();
    let filed = 0;
    for (const o of options) {
      if (filed >= waiverLimit(league)) break;
      if (used.has(o.add) || (o.drop && used.has(o.drop))) continue;
      try { fileClaim(league, ti, o.add, o.drop, byId); used.add(o.add); if (o.drop) used.add(o.drop); filed++; } catch { /* limit or conflict */ }
    }
    void gm;
  });
}

/** Resolve every claim for the week in priority order. Returns the results. */
export function processWaivers(league, byId) {
  initWaivers(league);
  const claims = league.claims.filter((c) => c.week === league.week);
  if (!claims.length) { league.lastWaivers = { week: league.week, results: [] }; return []; }
  let order;
  if (isPro(league)) order = standings(league).map((r) => r.idx).reverse();
  else order = league.waiverOrder.slice();
  const priority = (t) => order.indexOf(t);
  claims.sort((a, b) => priority(a.team) - priority(b.team) || a.filed - b.filed);
  const owned = ownerMap(league);
  const results = [];
  for (const c of claims) {
    const team = league.teams[c.team];
    const add = byId.get(c.add), drop = c.drop ? byId.get(c.drop) : null;
    const slotId = c.drop ? slotOf(team, c.drop) : add ? emptySlotAt(team, add.pos) : null;
    let ok = false, reason = '';
    if (!add || (c.drop && !drop)) reason = 'unknown player';
    else if (owned.has(c.add)) reason = `${add.name} went to ${league.teams[owned.get(c.add)].abbr} on priority`;
    else if (!slotId) reason = c.drop ? `${drop.name} was no longer on the roster` : `no open ${add.pos} slot was left`;
    else {
      team.slots[slotId] = c.add;
      if (c.drop) owned.delete(c.drop);
      owned.set(c.add, c.team);
      ok = true;
      league.transactions.push({ week: league.week, season: league.season, type: 'waiver', team: c.team, add: c.add, drop: c.drop });
      if (!isPro(league)) {
        league.waiverOrder = league.waiverOrder.filter((t) => t !== c.team).concat([c.team]);
      }
    }
    results.push({ team: c.team, add: c.add, drop: c.drop, ok, reason });
  }
  league.claims = league.claims.filter((c) => c.week !== league.week);
  league.lastWaivers = { week: league.week, results };
  // AI clubs put their new man where he belongs; the human arranges their own.
  const saved = league.teams.map((t) => t.depthSorted);
  league.teams.forEach((t) => { if (t.isUser) t.depthSorted = true; });
  sortDepthCharts(league, byId);
  league.teams.forEach((t, i) => { t.depthSorted = saved[i]; });
  return results;
}

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------

function posCounts(ids, byId) {
  const c = {};
  for (const id of ids) { const p = byId.get(id); if (p) c[p.pos] = (c[p.pos] || 0) + 1; }
  return c;
}

/** Structural checks only. Returns { ok, reason }. */
export function validateTrade(league, aIdx, bIdx, aGives, bGives, byId) {
  if (!tradesOpen(league)) return { ok: false, reason: league.phase === 'season' ? `The trade deadline passed after week ${tradeDeadlineWeek(league)}` : 'Trades are open during the regular season only' };
  if (aIdx === bIdx) return { ok: false, reason: 'Pick another club' };
  if (!aGives.length || !bGives.length) return { ok: false, reason: 'Both sides have to give something' };
  if (aGives.length > MAX_TRADE_SIDE || bGives.length > MAX_TRADE_SIDE) return { ok: false, reason: `At most ${MAX_TRADE_SIDE} players a side` };
  if (new Set(aGives).size !== aGives.length || new Set(bGives).size !== bGives.length) return { ok: false, reason: 'A player is listed twice' };
  const a = league.teams[aIdx], b = league.teams[bIdx];
  for (const id of aGives) if (!slotOf(a, id)) return { ok: false, reason: `${byId.get(id)?.name || id} is not on ${a.abbr}` };
  for (const id of bGives) if (!slotOf(b, id)) return { ok: false, reason: `${byId.get(id)?.name || id} is not on ${b.abbr}` };
  const ca = posCounts(aGives, byId), cb = posCounts(bGives, byId);
  const keys = new Set([...Object.keys(ca), ...Object.keys(cb)]);
  for (const k of keys) if ((ca[k] || 0) !== (cb[k] || 0)) return { ok: false, reason: `Positions must match: ${a.abbr} offers ${fmtCounts(ca)}, ${b.abbr} offers ${fmtCounts(cb)}` };
  return { ok: true };
}

function fmtCounts(c) {
  return Object.entries(c).map(([k, v]) => (v > 1 ? `${v} ${k}` : k)).join(' + ') || 'nothing';
}

/** What an AI club's roster would look like after the swap, by position. */
function slotsAfter(team, gives, gets, byId) {
  const slots = { ...team.slots };
  const incoming = gets.slice();
  for (const outId of gives) {
    const pos = byId.get(outId).pos;
    const i = incoming.findIndex((id) => byId.get(id).pos === pos);
    const slotId = slotOf(team, outId);
    slots[slotId] = incoming[i];
    incoming.splice(i, 1);
  }
  return slots;
}

/**
 * The AI's answer. It judges the lineup it would field afterwards, so a
 * famous name at a position it is already strong at is worth less to it than
 * a plain starter where it is thin. Sharper GMs want more out of a deal.
 */
export function evaluateTrade(league, aiIdx, aiGives, aiGets, byId) {
  const team = league.teams[aiIdx];
  const before = lineupStrength(team.slots, byId, league);
  const after = lineupStrength(slotsAfter(team, aiGives, aiGets, byId), byId, league);
  const delta = Math.round((after - before) * 10) / 10;
  const greed = { analytics: 8, trenches: 6, defense: 5, balanced: 4, gambler: 2, airraid: 4, ground: 4, oldschool: 5 }[team.gm] ?? 4;
  const accept = delta >= greed;
  let reason;
  if (accept) reason = delta >= greed * 3 ? 'They jump at it.' : 'They think about it, then agree.';
  else if (delta < 0) reason = `${team.abbr} would be worse off. They pass.`;
  else reason = `Not enough in it for ${team.abbr}. They want roughly ${Math.ceil((greed - delta) / 2)} more points of lineup value.`;
  return { accept, delta, before, after, reason };
}

export function executeTrade(league, aIdx, bIdx, aGives, bGives, byId) {
  const v = validateTrade(league, aIdx, bIdx, aGives, bGives, byId);
  if (!v.ok) throw new Error(v.reason);
  const a = league.teams[aIdx], b = league.teams[bIdx];
  const newA = slotsAfter(a, aGives, bGives, byId);
  const newB = slotsAfter(b, bGives, aGives, byId);
  a.slots = newA;
  b.slots = newB;
  initWaivers(league);
  league.transactions.push({ week: league.week, season: league.season, type: 'trade', team: aIdx, other: bIdx, gives: aGives.slice(), gets: bGives.slice() });
  // Drop any pending claims that named a traded player.
  const moved = new Set([...aGives, ...bGives]);
  league.claims = (league.claims || []).filter((c) => !moved.has(c.drop) && !moved.has(c.add));
  const saved = league.teams.map((t) => t.depthSorted);
  league.teams.forEach((t) => { if (t.isUser) t.depthSorted = true; });
  sortDepthCharts(league, byId);
  league.teams.forEach((t, i) => { t.depthSorted = saved[i]; });
  return league.transactions[league.transactions.length - 1];
}

/** Ask an AI club and, if it agrees, do the deal. */
export function proposeTrade(league, userIdx, aiIdx, userGives, aiGives, byId) {
  const v = validateTrade(league, userIdx, aiIdx, userGives, aiGives, byId);
  if (!v.ok) return { ok: false, accepted: false, reason: v.reason };
  const ev = evaluateTrade(league, aiIdx, aiGives, userGives, byId);
  if (!ev.accept) return { ok: true, accepted: false, reason: ev.reason, delta: ev.delta };
  const tx = executeTrade(league, userIdx, aiIdx, userGives, aiGives, byId);
  return { ok: true, accepted: true, reason: ev.reason, delta: ev.delta, tx };
}

/** Everyone still owns exactly one player per slot and nobody is owned twice. */
export function rostersValid(league, byId) {
  const seen = new Set();
  for (const t of league.teams) {
    for (const s of ROSTER_SLOTS) {
      const id = t.slots[s.id];
      if (!id) { if (s.starter) return { ok: false, reason: `${t.abbr} ${s.id} empty` }; continue; }
      const p = byId.get(id);
      if (!p) return { ok: false, reason: `${t.abbr} ${s.id} unknown ${id}` };
      if (p.pos !== s.pos) return { ok: false, reason: `${t.abbr} ${s.id} holds a ${p.pos}` };
      if (seen.has(id)) return { ok: false, reason: `${p.name} on two rosters` };
      seen.add(id);
    }
  }
  return { ok: true };
}

/**
 * The week-advance the UI should call during the regular season: AI clubs
 * file their claims, the wire resolves, then the calendar moves. Rosters are
 * frozen in the playoffs, so this is a plain advance there.
 */
export function advanceWeekWithMoves(league, byId, pool, rng, advance) {
  if (league.phase === 'season' && weekIsComplete(league)) {
    aiFileClaims(league, pool, byId, rng);
    processWaivers(league, byId);
  }
  return advance(league);
}

function weekIsComplete(league) {
  const wk = league.schedule[league.week - 1];
  return !!wk && wk.games.every((g) => g.result || g.bye);
}
