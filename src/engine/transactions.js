// In-season roster moves: the free-agent pool, weekly waiver claims, and
// trades with AI clubs.
//
// Rosters are exactly 27 slots, one per position group entry, and every slot
// holds a player of that position. A waiver claim is therefore a straight swap
// at one position. A trade may be a straight swap too, or it may be uneven —
// a quarterback for a wide receiver — in which case both clubs are left with a
// hole at one position and a crowd at another, and the deal carries the moves
// that fix both: a free agent signed into the hole, the weakest man in the
// crowded room released. See `backfillPlan`.
//
// Waivers resolve when the week advances. In a fantasy league the order rolls
// (a successful claim sends you to the back); in the pro league it is reverse
// standings each week. AI clubs file their own claims at the same moment, so
// the human never gets first pick of the pool for free.

import { ROSTER_SLOTS } from '../data/positions.js';
import { GM_PERSONALITIES } from '../data/teams.js';
import { overall } from './ratings.js';
import { TRUE_LEVERAGE } from './auction.js';
import { greedFor } from './difficulty.js';
import { standings, isPro, sortDepthCharts, playoffFieldSize } from './season.js';
import { availability, weeksLeft, SEASON_ENDING, irList, aiManageIr, irCapacity } from './injuries.js';
import { aiAdjustStrategies } from './gm.js';

import {
  futureOwner, applyFutureTrade, validateFuturePicks, futureLabel,
} from './owedpicks.js';
import { signablePool } from './proleague.js';
import { bookDead } from './cap.js';

export const DEFAULT_WAIVER_LIMIT = 2;
export const MAX_TRADE_SIDE = 3;
/**
 * How many positions a club may be left short in one deal. A trade is allowed
 * to change the shape of a roster; it is not allowed to rebuild it, and a deal
 * nobody can read is a deal nobody will make.
 */
export const MAX_TRADE_IMBALANCE = 2;
/** Most live offers the human is shown at once. */
export const MAX_LIVE_OFFERS = 3;
/** How far below even, on the lineup-strength yardstick, a club will still ask. Past this a GM knows the phone gets hung up. */
export const OFFER_FAIR_MARGIN = 2;

/** How keen each GM personality is to work the wire. */
const ACTIVITY = { modern: 0.9, gambler: 0.75, balanced: 0.6, defense: 0.55, trenches: 0.55, airraid: 0.5, ground: 0.45, oldschool: 0.3 };

const STARTERS = {};
for (const s of ROSTER_SLOTS) if (s.starter) STARTERS[s.pos] = (STARTERS[s.pos] || 0) + 1;
const BENCH_WEIGHT = 0.25;

/** Who owns whom. A player on injured reserve is still owned and cannot be claimed. */
export function ownerMap(league) {
  const m = new Map();
  league.teams.forEach((t, i) => {
    for (const s of ROSTER_SLOTS) if (t.slots[s.id]) m.set(t.slots[s.id], i);
    for (const id of irList(t)) m.set(id, i);
  });
  return m;
}

/**
 * Who is out there to be signed.
 *
 * `signablePool` is where the pro league narrows: this year's rookies belong
 * to the draft, and the all-time players nobody ever signed are on their way
 * out. Every path that hands somebody a contract comes through here, so the
 * wire, the market and the kickoff fill cannot disagree about who exists.
 */
export function freeAgents(league, pool) {
  const owned = ownerMap(league);
  return signablePool(league, pool).filter((p) => !owned.has(p.id) && !p.retired);
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
  league.lapsedClaims ??= [];
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
  // Claims a trade voided earlier in the week. They never reach priority, but
  // they belong in the report, because from the manager's side they are a
  // claim that did not land and the reason is not obvious.
  const lapsed = (league.lapsedClaims || []).filter((c) => c.week === league.week);
  league.lapsedClaims = (league.lapsedClaims || []).filter((c) => c.week !== league.week);
  const lapsedRows = lapsed.map((c) => ({ team: c.team, add: c.add, drop: c.drop, ok: false, reason: c.reason, lapsed: true }));
  if (!claims.length) { league.lastWaivers = { week: league.week, results: lapsedRows }; return lapsedRows; }
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
      // Dropping a man still under contract does not end what he is owed.
      // This is the one that matters: the wire is where most of the churn is.
      if (c.drop) bookDead(league, c.team, c.drop, league.contracts?.[c.drop]);
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
  results.push(...lapsedRows);
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

/**
 * The shape of an uneven deal, from one club's side: which positions it would
 * be short at, and which it would be holding more of than it has slots for.
 */
export function positionDelta(gives, gets, byId) {
  const net = {};
  for (const id of gives) { const p = byId.get(id); if (p) net[p.pos] = (net[p.pos] || 0) - 1; }
  for (const id of gets) { const p = byId.get(id); if (p) net[p.pos] = (net[p.pos] || 0) + 1; }
  const short = {}, long = {};
  for (const [pos, n] of Object.entries(net)) {
    if (n < 0) short[pos] = -n;
    else if (n > 0) long[pos] = n;
  }
  return { short, long };
}

/** Total positions a side is short, which is what MAX_TRADE_IMBALANCE caps. */
function imbalanceSize(delta) {
  return Object.values(delta.short).reduce((a, b) => a + b, 0);
}

/**
 * The moves that make an uneven trade legal, for one club.
 *
 * Short a position: sign the best free agent there. The pool is deep — the
 * best man available sits within a few points of a median starter all season,
 * measured — so the hole is cheap to plug in overall terms and expensive in
 * leverage terms, which is the whole economics of this feature. Vacating a
 * kicker costs about a point of overall against a leverage of 0.79; vacating a
 * quarterback costs about four against a leverage of 18.
 *
 * Long a position: release the weakest man in the room, counting the one
 * arriving. A club that trades for a better receiver drops its fourth, not the
 * one it just acquired.
 */
export function backfillPlan(league, teamIdx, gives, gets, pool, byId) {
  const delta = positionDelta(gives, gets, byId);
  if (!Object.keys(delta.short).length && !Object.keys(delta.long).length) return { ok: true, signs: [], releases: [] };
  if (imbalanceSize(delta) > MAX_TRADE_IMBALANCE) return { ok: false, reason: `At most ${MAX_TRADE_IMBALANCE} unmatched positions a side` };
  if (!pool) return { ok: false, reason: 'Positions must match on both sides' };
  const team = league.teams[teamIdx];
  const out = new Set(gives);
  const signs = [], releases = [];

  for (const [pos, n] of Object.entries(delta.long)) {
    const room = ROSTER_SLOTS.filter((s) => s.pos === pos).map((s) => team.slots[s.id])
      .filter((id) => id && !out.has(id))
      .concat(gets.filter((id) => byId.get(id)?.pos === pos));
    room.sort((x, y) => overall(byId.get(x)) - overall(byId.get(y)));
    for (let i = 0; i < n; i++) {
      if (!room[i]) return { ok: false, reason: `${team.abbr} has nowhere to put the extra ${pos}` };
      // If the weakest man in the crowded room is the one arriving, the deal
      // buys somebody only to cut him. Refuse it rather than let a mis-click
      // spend a player on nothing.
      if (gets.includes(room[i])) return { ok: false, reason: `${byId.get(room[i])?.name || room[i]} would not make ${team.abbr}'s roster` };
      releases.push(room[i]);
    }
  }

  const owned = ownerMap(league);
  for (const [pos, n] of Object.entries(delta.short)) {
    const avail = pool.filter((p) => p.pos === pos && !p.retired && !owned.has(p.id))
      .sort((a, b) => overall(b) - overall(a));
    for (let i = 0; i < n; i++) {
      if (!avail[i]) return { ok: false, reason: `No free agent ${pos} left to fill ${team.abbr}'s hole` };
      signs.push(avail[i].id);
    }
  }
  return { ok: true, signs, releases };
}

/**
 * A roster after players leave and arrive, without assuming the two sets match
 * position for position. Vacated slots are filled by whoever fits; everybody
 * else stays exactly where they were, so a user's depth chart survives a trade
 * that did not touch it.
 */
function slotsAfterMoves(team, outgoing, incoming, byId) {
  const slots = { ...team.slots };
  const out = new Set(outgoing);
  for (const s of ROSTER_SLOTS) if (slots[s.id] && out.has(slots[s.id])) slots[s.id] = null;
  // A man can arrive and leave in the same deal — when the player traded for
  // is the weakest in the room he joins, he is the one released. He never
  // takes a slot, so he is not looking for one.
  const left = incoming.filter((id) => !out.has(id));
  for (const s of ROSTER_SLOTS) {
    if (slots[s.id]) continue;
    const i = left.findIndex((id) => byId.get(id)?.pos === s.pos);
    if (i >= 0) { slots[s.id] = left[i]; left.splice(i, 1); }
  }
  return { slots, leftover: left, empty: ROSTER_SLOTS.filter((s) => !slots[s.id]).map((s) => s.id) };
}

/** One club's roster after an uneven deal and the moves that square it. */
export function slotsAfterTrade(league, teamIdx, gives, gets, pool, byId) {
  const plan = backfillPlan(league, teamIdx, gives, gets, pool, byId);
  if (!plan.ok) return null;
  const team = league.teams[teamIdx];
  const { slots, leftover, empty } = slotsAfterMoves(team, [...gives, ...plan.releases], [...gets, ...plan.signs], byId);
  if (leftover.length || empty.length) return null;
  return { slots, plan };
}

/** Structural checks only. Returns { ok, reason }. */
export function validateTrade(league, aIdx, bIdx, aGives, bGives, byId, pool = null, { aPicks = [], bPicks = [] } = {}) {
  if (!tradesOpen(league)) return { ok: false, reason: league.phase === 'season' ? `The trade deadline passed after week ${tradeDeadlineWeek(league)}` : 'Trades are open during the regular season only' };
  if (aIdx === bIdx) return { ok: false, reason: 'Pick another club' };
  // A pick counts as something given, which is the point of having them here:
  // a club can buy a player outright for next year's first and send nobody
  // back. That is the deal the deadline is actually for.
  if (!aGives.length && !aPicks.length) return { ok: false, reason: 'Both sides have to give something' };
  if (!bGives.length && !bPicks.length) return { ok: false, reason: 'Both sides have to give something' };
  if (aGives.length > MAX_TRADE_SIDE || bGives.length > MAX_TRADE_SIDE) return { ok: false, reason: `At most ${MAX_TRADE_SIDE} players a side` };
  for (const [idx, picks] of [[aIdx, aPicks], [bIdx, bPicks]]) {
    if (picks.length > MAX_TRADE_SIDE) return { ok: false, reason: `At most ${MAX_TRADE_SIDE} picks a side` };
    const pv = validateFuturePicks(league, idx, picks);
    if (!pv.ok) return pv;
  }
  if (new Set(aGives).size !== aGives.length || new Set(bGives).size !== bGives.length) return { ok: false, reason: 'A player is listed twice' };
  const a = league.teams[aIdx], b = league.teams[bIdx];
  for (const id of aGives) if (!slotOf(a, id)) return { ok: false, reason: `${byId.get(id)?.name || id} is not on ${a.abbr}` };
  for (const id of bGives) if (!slotOf(b, id)) return { ok: false, reason: `${byId.get(id)?.name || id} is not on ${b.abbr}` };
  const ca = posCounts(aGives, byId), cb = posCounts(bGives, byId);
  const keys = new Set([...Object.keys(ca), ...Object.keys(cb)]);
  const even = [...keys].every((k) => (ca[k] || 0) === (cb[k] || 0));
  // Picks are not players, so they never leave a roster crooked: the position
  // count is decided by the player halves alone, and a picks-for-picks swap is
  // as even as a like-for-like one.
  if (even) return { ok: true, picks: !!(aPicks.length || bPicks.length), fills: { a: { signs: [], releases: [] }, b: { signs: [], releases: [] } } };
  // Uneven. Legal only if both clubs can square their own roster afterwards,
  // which is a question about the free-agent pool, so it needs one.
  if (!pool) return { ok: false, reason: `Positions must match: ${a.abbr} offers ${fmtCounts(ca)}, ${b.abbr} offers ${fmtCounts(cb)}` };
  const fa = backfillPlan(league, aIdx, aGives, bGives, pool, byId);
  if (!fa.ok) return { ok: false, reason: fa.reason };
  const fb = backfillPlan(league, bIdx, bGives, aGives, pool, byId);
  if (!fb.ok) return { ok: false, reason: fb.reason };
  // Both clubs fish from the same pool, so the two plans must not name the
  // same free agent.
  const clash = fa.signs.find((id) => fb.signs.includes(id));
  if (clash) return { ok: false, reason: `Both clubs would need to sign ${byId.get(clash)?.name || clash}` };
  if (!slotsAfterTrade(league, aIdx, aGives, bGives, pool, byId)) return { ok: false, reason: `${a.abbr} cannot field a roster after that` };
  if (!slotsAfterTrade(league, bIdx, bGives, aGives, pool, byId)) return { ok: false, reason: `${b.abbr} cannot field a roster after that` };
  return { ok: true, uneven: true, picks: !!(aPicks.length || bPicks.length), fills: { a: fa, b: fb } };
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
export function evaluateTrade(league, aiIdx, aiGives, aiGets, byId, pool = null, { pickDelta = 0 } = {}) {
  const team = league.teams[aiIdx];
  const before = lineupStrength(team.slots, byId, league);
  // On an uneven deal the club judges the roster it would actually field —
  // free agent signed, spare man released. Judging it with a hole in it would
  // make every uneven trade look like a loss, and no club would ever take one.
  const shaped = posCounts(aiGives, byId), got = posCounts(aiGets, byId);
  const uneven = [...new Set([...Object.keys(shaped), ...Object.keys(got)])].some((k) => (shaped[k] || 0) !== (got[k] || 0));
  const outcome = uneven ? slotsAfterTrade(league, aiIdx, aiGives, aiGets, pool, byId) : { slots: slotsAfter(team, aiGives, aiGets, byId) };
  if (!outcome) return { accept: false, delta: 0, before, after: before, reason: `${team.abbr} could not field a roster after that.` };
  const after = lineupStrength(outcome.slots, byId, league);
  // `pickDelta` arrives already valued, in the same lineup points the rest of
  // this is in, because working it out needs the finish estimator and that
  // needs `lineupStrength` from this file. See owedpicks.js on the cycle.
  const delta = Math.round((after - before + pickDelta) * 10) / 10;
  const premium = Math.round(leveragePremium(aiGives, aiGets, byId) * 10) / 10;
  const greed = aiGreed(team, league) + premium;
  const accept = delta >= greed;
  let reason;
  if (accept) reason = delta >= greed * 3 ? 'They jump at it.' : 'They think about it, then agree.';
  else if (delta < 0) reason = `${team.abbr} would be worse off. They pass.`;
  else if (premium > 0 && delta >= greed - premium) reason = `${team.abbr} will not trade down in position for that. They want more back where it counts.`;
  else reason = `Not enough in it for ${team.abbr}. They want roughly ${Math.ceil((greed - delta) / 2)} more points of lineup value.`;
  return { accept, delta, before, after, reason, premium, uneven };
}

/**
 * What a club charges on top of its own greed for shipping out more leverage
 * than it takes in.
 *
 * Without it, a club with a bad kicker would hand over a starting receiver for
 * a good one, because its own arithmetic — a large gain at a position worth
 * 0.79, a small loss at one worth 3.30 — can come out positive. The lineup
 * model is right about that and a general manager still knows better: you do
 * not turn a receiver into a kicker. The premium is charged per point of
 * leverage shipped, so an even swap costs nothing and a quarterback-for-punter
 * enquiry is refused out of hand.
 */
export const LEVERAGE_PREMIUM = 1.6;
function leveragePremium(gives, gets, byId) {
  const lev = (ids) => ids.reduce((t, id) => t + (TRUE_LEVERAGE[byId.get(id)?.pos] ?? 1), 0);
  return Math.max(0, lev(gives) - lev(gets)) * LEVERAGE_PREMIUM;
}

/** How much a club must gain, in lineup strength, to agree to a deal. */
const BASE_GREED = { modern: 8, trenches: 6, defense: 5, balanced: 4, gambler: 2, airraid: 4, ground: 4, oldschool: 5 };

/**
 * What a club wants out of a trade before it will agree, in lineup-strength
 * points. `league` is optional so an older caller still works; passing it is
 * what lets the difficulty setting make clubs harder to fleece.
 */
export function aiGreed(team, league = null) {
  return greedFor(league, BASE_GREED[team.gm] ?? 4);
}

/**
 * AI clubs deal with each other: surplus for need. A club with a good bench
 * player at one position and a weak starter at another looks for a club in
 * the mirror-image situation and swaps two for two, positions matching, so
 * both lineups get better by at least their greed. A few pairs are tried a
 * week; deals are logged like any other.
 */
export function aiTrades(league, byId, rng, { pairs = 4, pool = null } = {}) {
  if (!tradesOpen(league)) return [];
  const ai = league.teams.map((t, i) => (t.isUser ? -1 : i)).filter((i) => i >= 0);
  if (ai.length < 2) return [];
  const done = [];
  const positions = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S'];
  const group = (team, pos) => ROSTER_SLOTS.filter((s) => s.pos === pos).map((s) => ({ slot: s, id: team.slots[s.id], p: byId.get(team.slots[s.id]) })).filter((x) => x.p);
  const bestBench = (team, pos) => group(team, pos).filter((x) => !x.slot.starter).sort((a, b) => overall(b.p) - overall(a.p))[0] || null;
  const worstStarter = (team, pos) => group(team, pos).filter((x) => x.slot.starter).sort((a, b) => overall(a.p) - overall(b.p))[0] || null;
  for (let n = 0; n < pairs; n++) {
    const a = ai[rng.int(0, ai.length - 1)];
    const b = ai[rng.int(0, ai.length - 1)];
    if (a === b) continue;
    const A = league.teams[a], B = league.teams[b];
    const baseA = lineupStrength(A.slots, byId, league), baseB = lineupStrength(B.slots, byId, league);
    let best = null;
    for (const P of positions) for (const Q of positions) {
      if (P === Q) continue;
      const aP = bestBench(A, P) || worstStarter(A, P), aQ = worstStarter(A, Q);
      const bP = worstStarter(B, P), bQ = bestBench(B, Q) || worstStarter(B, Q);
      if (!aP || !aQ || !bP || !bQ) continue;
      // Two shapes: the matched two-for-two that has always been here, and —
      // when a pool is to hand — the uneven one-for-one, surplus for need,
      // which is the deal a club actually wants and could never propose.
      const shapes = [[[aP.id, aQ.id], [bP.id, bQ.id]]];
      if (pool) shapes.push([[aP.id], [bQ.id]]);
      for (const [aGives, bGives] of shapes) {
        const v = validateTrade(league, a, b, aGives, bGives, byId, pool);
        if (!v.ok) continue;
        const outA = v.uneven ? slotsAfterTrade(league, a, aGives, bGives, pool, byId) : { slots: slotsAfter(A, aGives, bGives, byId) };
        const outB = v.uneven ? slotsAfterTrade(league, b, bGives, aGives, pool, byId) : { slots: slotsAfter(B, bGives, aGives, byId) };
        if (!outA || !outB) continue;
        const gainA = lineupStrength(outA.slots, byId, league) - baseA - leveragePremium(aGives, bGives, byId);
        const gainB = lineupStrength(outB.slots, byId, league) - baseB - leveragePremium(bGives, aGives, byId);
        if (gainA >= aiGreed(A, league) && gainB >= aiGreed(B, league) && (!best || gainA + gainB > best.total)) best = { aGives, bGives, total: gainA + gainB };
      }
    }
    if (best) done.push(executeTrade(league, a, b, best.aGives, best.bGives, byId, pool));
  }
  return done;
}

export function executeTrade(league, aIdx, bIdx, aGives, bGives, byId, pool = null, { aPicks = [], bPicks = [] } = {}) {
  const v = validateTrade(league, aIdx, bIdx, aGives, bGives, byId, pool, { aPicks, bPicks });
  if (!v.ok) throw new Error(v.reason);
  const a = league.teams[aIdx], b = league.teams[bIdx];
  const fa = v.fills.a, fb = v.fills.b;
  const outA = v.uneven ? slotsAfterTrade(league, aIdx, aGives, bGives, pool, byId) : { slots: slotsAfter(a, aGives, bGives, byId) };
  const outB = v.uneven ? slotsAfterTrade(league, bIdx, bGives, aGives, pool, byId) : { slots: slotsAfter(b, bGives, aGives, byId) };
  if (!outA || !outB) throw new Error('That deal cannot be squared on both rosters');
  a.slots = outA.slots;
  b.slots = outB.slots;
  initWaivers(league);
  applyFutureTrade(league, aIdx, bIdx, aPicks, bPicks);
  const tx = { week: league.week, season: league.season, type: 'trade', team: aIdx, other: bIdx, gives: aGives.slice(), gets: bGives.slice() };
  if (aPicks.length || bPicks.length) {
    tx.givesNext = aPicks.map((p) => futureLabel(league, p));
    tx.getsNext = bPicks.map((p) => futureLabel(league, p));
  }
  // An uneven deal carries its own paperwork, so the log reads as one move.
  if (v.uneven) {
    tx.signs = [fa.signs.slice(), fb.signs.slice()];
    tx.releases = [fa.releases.slice(), fb.releases.slice()];
  }
  league.transactions.push(tx);
  // Void any pending claim that named a traded, signed or released player — and
  // say so. Voiding is right: you cannot release a man you have just dealt
  // away, and you cannot claim one who has just been signed. Doing it in
  // silence was not. A claim filed on Tuesday and voided by Thursday's trade
  // simply stopped existing: it left the claims tab, never reached the wire,
  // and produced no line in the results, so the only way to notice was to
  // remember having filed it. These now surface as failed claims when the wire
  // runs, alongside the ones that lost on priority.
  const moved = new Set([...aGives, ...bGives, ...fa.signs, ...fb.signs, ...fa.releases, ...fb.releases]);
  const voided = (league.claims || []).filter((c) => moved.has(c.drop) || moved.has(c.add));
  league.claims = (league.claims || []).filter((c) => !moved.has(c.drop) && !moved.has(c.add));
  if (voided.length) {
    league.lapsedClaims = (league.lapsedClaims || []).concat(voided.map((c) => ({
      ...c,
      reason: moved.has(c.add)
        ? `${byId.get(c.add)?.name || 'The player'} was signed in a trade before the wire ran`
        : `${byId.get(c.drop)?.name || 'The player you named'} was traded before the wire ran`,
    })));
  }
  const saved = league.teams.map((t) => t.depthSorted);
  league.teams.forEach((t) => { if (t.isUser) t.depthSorted = true; });
  sortDepthCharts(league, byId);
  league.teams.forEach((t, i) => { t.depthSorted = saved[i]; });
  return league.transactions[league.transactions.length - 1];
}

/** Ask an AI club and, if it agrees, do the deal. */
export function proposeTrade(league, userIdx, aiIdx, userGives, aiGives, byId, pool = null, { userPicks = [], aiPicks = [], pickDelta = 0 } = {}) {
  const v = validateTrade(league, userIdx, aiIdx, userGives, aiGives, byId, pool, { aPicks: userPicks, bPicks: aiPicks });
  if (!v.ok) return { ok: false, accepted: false, reason: v.reason };
  // `pickDelta` is the club's side of the picks, which the caller values —
  // this file cannot, without importing the thing that imports it.
  const ev = evaluateTrade(league, aiIdx, aiGives, userGives, byId, pool, { pickDelta });
  if (!ev.accept) return { ok: true, accepted: false, reason: ev.reason, delta: ev.delta };
  const tx = executeTrade(league, userIdx, aiIdx, userGives, aiGives, byId, pool, { aPicks: userPicks, bPicks: aiPicks });
  return { ok: true, accepted: true, reason: ev.reason, delta: ev.delta, tx, fills: v.fills };
}

// ---------------------------------------------------------------------------
// Offers: the other direction, AI clubs asking the human
// ---------------------------------------------------------------------------

export function initOffers(league) {
  league.offers ??= [];
  league.refusedOffers ??= [];
}

/** Offers still on the table: made this week, in this season, not yet answered. */
export function liveOffers(league) {
  initOffers(league);
  return league.offers.filter((o) => o.season === league.season && o.week === league.week);
}

const offerSignature = (from, gives, wants) => `${from}:${gives.slice().sort().join(',')}>${wants.slice().sort().join(',')}`;

/**
 * AI clubs ring the human with surplus-for-need deals: a club with a good
 * bench player at one position and a weak starter at another asks for the
 * human's man at the position it needs. It only calls when the deal clears
 * its own greed and is not insulting on the same yardstick, because a GM
 * knows an insulting offer is a wasted call. The human decides; nothing is
 * executed here. An offer the human turns down is not made again this season.
 */
/**
 * Clubs ringing the human, and — when `picks` is supplied — closing the gap
 * with next year's.
 *
 * `picks` is handed in rather than imported, because valuing one needs the
 * finish estimator and that needs `lineupStrength` from this file. It is
 * `{ hand(teamIdx), value(pick, holderIdx) }`; without it this behaves exactly
 * as it did before picks existed.
 *
 * A pick only ever rescues a deal that already nearly worked. Measured over
 * 10,527 one-for-one pairings that failed a bar, a pick tipped 35 of them
 * over — and in 28 of those it was the *club* paying, which is the shape a
 * general manager recognises: you want the player, so you add a pick. Trying
 * picks on every candidate rather than on the near miss would triple the work
 * on a path that already runs 162 validations a club, for deals that were
 * never close.
 */
export function makeAiOffers(league, byId, rng, { max = 2, pool = null, picks = null } = {}) {
  initOffers(league);
  if (!tradesOpen(league)) return [];
  const u = league.teams.findIndex((t) => t.isUser);
  if (u < 0) return [];
  const U = league.teams[u];
  const baseU = lineupStrength(U.slots, byId, league);
  const refused = new Set(league.refusedOffers);
  const live = liveOffers(league);
  const positions = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S'];
  const group = (team, pos) => ROSTER_SLOTS.filter((s) => s.pos === pos).map((s) => ({ slot: s, id: team.slots[s.id], p: byId.get(team.slots[s.id]) })).filter((x) => x.p);
  const bestBench = (team, pos) => group(team, pos).filter((x) => !x.slot.starter).sort((a, b) => overall(b.p) - overall(a.p))[0] || null;
  const worstStarter = (team, pos) => group(team, pos).filter((x) => x.slot.starter).sort((a, b) => overall(a.p) - overall(b.p))[0] || null;
  const made = [];
  const order = league.teams.map((_, i) => i).filter((i) => i !== u);
  if (rng) for (let i = order.length - 1; i > 0; i--) { const j = rng.int(0, i); [order[i], order[j]] = [order[j], order[i]]; }
  for (const a of order) {
    if (live.length + made.length >= MAX_LIVE_OFFERS || made.length >= max) break;
    const A = league.teams[a];
    const activity = ACTIVITY[A.gm] ?? 0.5;
    if (rng && !rng.chance(activity * 0.8)) continue;
    const baseA = lineupStrength(A.slots, byId, league);
    let best = null, nearMiss = null;
    for (const P of positions) for (const Q of positions) {
      if (P === Q) continue;
      const aP = bestBench(A, P) || worstStarter(A, P), aQ = worstStarter(A, Q);
      const uP = worstStarter(U, P), uQ = bestBench(U, Q) || worstStarter(U, Q);
      if (!aP || !aQ || !uP || !uQ) continue;
      const shapes = [[[aP.id, aQ.id], [uP.id, uQ.id]]];
      if (pool) shapes.push([[aP.id], [uQ.id]]);
      for (const [gives, wants] of shapes) {
        const v = validateTrade(league, a, u, gives, wants, byId, pool);
        if (!v.ok) continue;
        if (refused.has(offerSignature(a, gives, wants))) continue;
        const outA = v.uneven ? slotsAfterTrade(league, a, gives, wants, pool, byId) : { slots: slotsAfter(A, gives, wants, byId) };
        const outU = v.uneven ? slotsAfterTrade(league, u, wants, gives, pool, byId) : { slots: slotsAfter(U, wants, gives, byId) };
        if (!outA || !outU) continue;
        const gainA = lineupStrength(outA.slots, byId, league) - baseA - leveragePremium(gives, wants, byId);
        const gainU = lineupStrength(outU.slots, byId, league) - baseU;
        const greed = aiGreed(A, league);
        if (gainA < greed || gainU < -OFFER_FAIR_MARGIN) {
          // Keep the closest thing to a deal, for the pick pass below.
          if (picks && gainA + gainU > (nearMiss?.total ?? -Infinity)) {
            nearMiss = { gives, wants, gainA, gainU, need: Q, surplus: P, uneven: !!v.uneven, fills: v.fills, total: gainA + gainU };
          }
          continue;
        }
        if (!best || gainA > best.aiGain) best = { gives, wants, aiGain: Math.round(gainA * 10) / 10, userDelta: Math.round(gainU * 10) / 10, need: Q, surplus: P, uneven: !!v.uneven, fills: v.fills };
      }
    }
    if (!best && picks && nearMiss) best = sweetenWithPick(league, a, u, nearMiss, picks, aiGreed(A, league));
    if (!best) continue;
    made.push({
      id: `${league.season}-${league.week}-${a}-${league.offers.length + made.length}`,
      season: league.season, week: league.week, from: a,
      gives: best.gives, wants: best.wants, aiGain: best.aiGain, userDelta: best.userDelta, uneven: best.uneven,
      givesNext: best.givesNext || [], wantsNext: best.wantsNext || [],
      // What accepting would cost the human in paperwork, so the card can say so.
      fills: best.uneven ? { signs: best.fills.b.signs.slice(), releases: best.fills.b.releases.slice() } : null,
      note: `${A.abbr} are thin at ${best.need} and deep at ${best.surplus}.${best.givesNext?.length ? ` They will add ${best.givesNext.map((p) => futureLabel(league, p)).join(' and ')} to get it done.` : ''}${best.wantsNext?.length ? ` They want ${best.wantsNext.map((p) => futureLabel(league, p)).join(' and ')} on top.` : ''}`,
    });
  }
  league.offers.push(...made);
  return made;
}

/**
 * One pick, on whichever side is behind, tried against a deal that nearly
 * worked. Returns an offer shape or null.
 */
function sweetenWithPick(league, a, u, near, picks, greed) {
  const tryOne = (pick, from) => {
    // The club pays: it loses the pick's worth on its own books and the human
    // gains it on theirs. The other way round when the human pays.
    const worth = { a: picks.value(pick, a), u: picks.value(pick, u) };
    const gainA = from === a ? near.gainA - worth.a : near.gainA + worth.a;
    const gainU = from === a ? near.gainU + worth.u : near.gainU - worth.u;
    if (gainA < greed || gainU < -OFFER_FAIR_MARGIN) return null;
    return {
      gives: near.gives, wants: near.wants, need: near.need, surplus: near.surplus,
      uneven: near.uneven, fills: near.fills,
      givesNext: from === a ? [pick] : [], wantsNext: from === a ? [] : [pick],
      aiGain: Math.round(gainA * 10) / 10, userDelta: Math.round(gainU * 10) / 10,
    };
  };
  for (const pick of picks.hand(a)) { const r = tryOne(pick, a); if (r) return r; }
  for (const pick of picks.hand(u)) { const r = tryOne(pick, u); if (r) return r; }
  return null;
}

/** Take a deal. Throws with a readable reason if it no longer stands. */
export function acceptOffer(league, offerId, byId, pool = null) {
  initOffers(league);
  const o = league.offers.find((x) => x.id === offerId);
  if (!o) throw new Error('That offer is no longer on the table');
  if (o.answered) throw new Error('You already answered that offer');
  const u = league.teams.findIndex((t) => t.isUser);
  // An uneven offer was built against the free-agent pool and cannot be squared
  // without it. Say so plainly rather than let validateTrade report a position
  // mismatch on a deal the game proposed itself.
  if (o.uneven && !pool) throw new Error('That offer is uneven; accepting it needs the free-agent pool');
  const sides = { aPicks: o.wantsNext || [], bPicks: o.givesNext || [] };
  const v = validateTrade(league, u, o.from, o.wants, o.gives, byId, pool, sides);
  if (!v.ok) throw new Error(v.reason);
  const tx = executeTrade(league, u, o.from, o.wants, o.gives, byId, pool, sides);
  o.answered = 'accepted';
  // Anything else that named a traded player is off.
  const moved = new Set([...o.gives, ...o.wants]);
  for (const x of league.offers) if (x !== o && !x.answered && [...x.gives, ...x.wants].some((id) => moved.has(id))) x.answered = 'stale';
  return tx;
}

export function declineOffer(league, offerId) {
  initOffers(league);
  const o = league.offers.find((x) => x.id === offerId);
  if (!o || o.answered) return false;
  o.answered = 'declined';
  league.refusedOffers.push(offerSignature(o.from, o.gives, o.wants));
  return true;
}

/** Keep the stored list small: answered offers and anything older than last week go. */
export function pruneOffers(league) {
  initOffers(league);
  league.offers = league.offers.filter((o) => !o.answered && o.season === league.season && o.week >= league.week - 1);
  if (league.refusedOffers.length > 200) league.refusedOffers = league.refusedOffers.slice(-200);
}

/** Everyone still owns exactly one player per slot and nobody is owned twice. */
/**
 * Every rostered player sits in a slot of his own position, nobody is owned
 * twice, and a starting slot is only left open because somebody is on
 * injured reserve.
 */
export function rostersValid(league, byId) {
  const seen = new Set();
  for (const t of league.teams) {
    const ir = irList(t);
    let emptyStarters = 0;
    for (const s of ROSTER_SLOTS) {
      const id = t.slots[s.id];
      if (!id) { if (s.starter) emptyStarters++; continue; }
      const p = byId.get(id);
      if (!p) return { ok: false, reason: `${t.abbr} ${s.id} unknown ${id}` };
      if (p.pos !== s.pos) return { ok: false, reason: `${t.abbr} ${s.id} holds a ${p.pos}` };
      if (seen.has(id)) return { ok: false, reason: `${p.name} on two rosters` };
      seen.add(id);
    }
    if (emptyStarters > ir.length) return { ok: false, reason: `${t.abbr} has ${emptyStarters} empty starting slots and ${ir.length} on injured reserve` };
    if (ir.length > irCapacity(league)) return { ok: false, reason: `${t.abbr} has ${ir.length} on injured reserve` };
    for (const id of ir) {
      if (!byId.get(id)) return { ok: false, reason: `${t.abbr} injured reserve holds unknown ${id}` };
      if (seen.has(id)) return { ok: false, reason: `${byId.get(id).name} on two rosters` };
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
export function advanceWeekWithMoves(league, byId, pool, rng, advance, { picks = null } = {}) {
  if (league.phase === 'season' && weekIsComplete(league)) {
    // The AI's week: read the table and drift the sliders, deal among themselves, then work the wire.
    const field = new Set(standings(league).slice(0, playoffFieldSize(league.teams.length)).map((r) => r.idx));
    aiAdjustStrategies(league, { inField: (i) => field.has(i) });
    aiManageIr(league, byId);
    aiTrades(league, byId, rng, { pool });
    aiFileClaims(league, pool, byId, rng);
    processWaivers(league, byId);
  }
  const moved = advance(league);
  // The new week's post: offers are waiting when the human opens the hub.
  if (moved && league.phase === 'season') {
    pruneOffers(league);
    makeAiOffers(league, byId, rng, { pool, picks });
  }
  return moved;
}

function weekIsComplete(league) {
  const wk = league.schedule[league.week - 1];
  return !!wk && wk.games.every((g) => g.result || g.bye);
}
