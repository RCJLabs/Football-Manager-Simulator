// Trading draft picks, and knowing what one is worth.
//
// A pick was never an object here. `currentPicker` worked the snake out of
// `draft.order`, the round and the position in it, so there was nothing to
// hand over. `draft.traded` is that missing table: overall pick number to the
// club that now owns it, consulted by `pickOwner` and empty in every league
// where nobody has traded.
//
// One rule governs every deal: **slots for slots**. Rosters are twenty-seven
// slots and `TOTAL_ROUNDS` is twenty-seven, so a club's remaining picks always
// equal its open slots exactly, and `settlePointer` skips anyone already full.
// That means draft capital cannot be accumulated the way it is in the real
// game — three picks for one leaves one club unable to use its last pick and
// the other unable to fill its last slot. Trades therefore move *order*, not
// quantity: n picks for n picks, and a player counts as a pick, because a man
// on the roster and a pick still to come occupy the same slot.
//
// What a pick is worth is not a number off a chart. A static curve was fitted
// and thrown away: mean overall by pick number runs 96 down to 86 and then
// back *up* to 95 in the last rounds, because that is where kickers and
// punters go — high ratings, a leverage of 0.79. The value of a pick is what
// the club holding it can do with it, so `projectPickTrade` simulates the
// draft forward under both ownerships and compares the rosters that result.

import { ROSTER_SLOTS } from '../data/positions.js';
import { overall } from './ratings.js';
import { lineupStrength, aiGreed } from './transactions.js';
import {
  TOTAL_ROUNDS, openSlots, currentPicker, settlePointer, availablePlayers,
  rankForTeam, aiChoose, makePick,
} from './draft.js';
import { RNG } from './rng.js';

/** Overall pick number from a round and a position in it. */
export function overallOf(draft, round, pickInRound) {
  return (round - 1) * draft.order.length + pickInRound + 1;
}

/** Whose pick this is: the snake, unless it has been traded away. */
export function pickOwner(draft, round, pickInRound) {
  const n = draft.order.length;
  const idx = round % 2 === 1 ? pickInRound : n - 1 - pickInRound;
  const base = draft.order[idx];
  const t = draft.traded?.[overallOf(draft, round, pickInRound)];
  return t == null ? base : t;
}

/** The club the snake would have given this pick to, before any trade. */
export function originalOwner(draft, round, pickInRound) {
  const n = draft.order.length;
  return draft.order[round % 2 === 1 ? pickInRound : n - 1 - pickInRound];
}

/**
 * Every pick a club still holds, this one included if it is on the clock.
 * Its length is always its number of open slots, which is the invariant every
 * trade here has to preserve.
 */
export function remainingPicks(draft, teamIdx) {
  const n = draft.order.length;
  const out = [];
  if (draft.complete) return out;
  for (let r = draft.round; r <= TOTAL_ROUNDS; r++) {
    for (let i = 0; i < n; i++) {
      if (r === draft.round && i < draft.pickInRound) continue;
      if (pickOwner(draft, r, i) !== teamIdx) continue;
      out.push({ round: r, pickInRound: i, overall: overallOf(draft, r, i), from: originalOwner(draft, r, i) });
    }
  }
  return out;
}

/** The next pick a club is due, or null if it has none left. */
export function nextPickFor(draft, teamIdx) {
  return remainingPicks(draft, teamIdx)[0] || null;
}

/** How many picks separate a club from its next turn. */
export function picksUntil(draft, teamIdx) {
  const next = nextPickFor(draft, teamIdx);
  if (!next) return Infinity;
  return next.overall - overallOf(draft, draft.round, draft.pickInRound);
}

// ---------------------------------------------------------------------------
// Rolling the draft forward
// ---------------------------------------------------------------------------

/**
 * A throwaway copy to draft in. Everything is shared except the two things a
 * pick writes to: each club's slots, and the draft itself.
 */
function sandbox(league, draft) {
  const teams = league.teams.map((t) => ({ ...t, slots: { ...t.slots } }));
  return {
    league: { ...league, teams },
    draft: { ...draft, taken: { ...draft.taken }, picks: draft.picks.slice(), traded: { ...(draft.traded || {}) } },
  };
}

/** Run the AI's draft forward to a pick number, or to the end. */
function rollForward(lg, d, pool, rng, untilOverall) {
  let guard = 0;
  while (!d.complete && guard++ < TOTAL_ROUNDS * d.order.length + 5) {
    if (untilOverall != null && overallOf(d, d.round, d.pickInRound) > untilOverall) break;
    const t = pickOwner(d, d.round, d.pickInRound);
    if (t == null) break;
    const p = aiChoose(lg, d, pool, t, rng);
    if (!p) break;
    makePick(lg, d, p);
  }
}

/**
 * Whether a player is still on the board when a club next picks.
 *
 * Estimated by running the rest of the draft the way the AI actually drafts
 * it, several times, and counting. That is slower than a heuristic and it is
 * the same model that will really make those picks, so the number does not
 * have to be believed on faith. One run settles every player at once, which
 * is why it is worth doing properly.
 */
export function survivalOdds(league, draft, pool, teamIdx, { trials = 8, seed = 1 } = {}) {
  const out = new Map();
  if (draft.complete) return { odds: out, trials: 0, untilPick: null };
  const here = overallOf(draft, draft.round, draft.pickInRound);
  const picks = remainingPicks(draft, teamIdx);
  // A club on the clock is asking about the pick *after* this one — whether a
  // man it passes on now will still be there when it comes round again. That
  // is the only version of the question worth answering, because the board is
  // only ever read while you are on the clock. The roll-forward lets the model
  // make this club's own pick, so one of the men who disappears is the one it
  // would have taken itself.
  const next = picks[0] && picks[0].overall <= here ? picks[1] : picks[0];
  if (!next) return { odds: out, trials: 0, untilPick: null };
  const watch = availablePlayers(draft, pool);
  const counts = new Map(watch.map((p) => [p.id, 0]));
  let ran = 0;
  for (let k = 0; k < trials; k++) {
    const { league: lg, draft: d } = sandbox(league, draft);
    rollForward(lg, d, pool, new RNG(seed + k * 7919), next.overall - 1);
    for (const p of watch) if (d.taken[p.id] == null) counts.set(p.id, counts.get(p.id) + 1);
    ran++;
  }
  for (const [id, c] of counts) out.set(id, c / ran);
  return { odds: out, trials: ran, untilPick: next.overall };
}

/** What a club's roster is worth, on the same yardstick trades use. */
function rosterValue(lg, teamIdx, byId) {
  return lineupStrength(lg.teams[teamIdx].slots, byId, null);
}

/**
 * What a pick swap is worth to each side.
 *
 * Both worlds are drafted **to the end** and the finished rosters compared.
 * Stopping early was tried first, at the last pick involved, and it is wrong:
 * lineup strength weights by position leverage, so a part-built roster holding
 * one quarterback scores 96 x 18 against 96 x 3.3 for one holding a receiver,
 * and a club that slid eight places read as *gaining* three hundred points
 * because the man who fell to it happened to play a dearer position. Only
 * finished rosters compare. A whole draft runs in about two hundred
 * milliseconds, so this costs roughly four hundred, which is an on-demand
 * price, not a per-keystroke one.
 *
 * **Both worlds are drafted with the noise switched off**, and that is the
 * other reason this number is worth printing. `rankForTeam` adds N(0, 1.6) to
 * every valuation, and which particular star falls to which club swings a
 * roster by tens of leverage-weighted points. Sampling it was measured: at
 * four runs the standard deviation of the answer *equalled the answer*, and
 * sixteen runs took 1.4 seconds to get it down to eighty per cent of the
 * answer. A number whose error bar is its own size is not worth showing to
 * anybody. Running both worlds deterministically removes the variance instead
 * of averaging it away — the only difference between the two runs is the swap,
 * which is the question being asked. What it gives up is the spread: this is
 * the modal draft, not the mean of every draft.
 */
export function projectPickTrade(league, draft, pool, byId, aIdx, bIdx, aGives, bGives) {
  const before = sandbox(league, draft);
  rollForward(before.league, before.draft, pool, null, null);
  const after = sandbox(league, draft);
  applySwap(after.draft, aIdx, bIdx, aGives, bGives);
  rollForward(after.league, after.draft, pool, null, null);
  const round1 = (x) => Math.round(x * 10) / 10;
  return {
    a: round1(rosterValue(after.league, aIdx, byId) - rosterValue(before.league, aIdx, byId)),
    b: round1(rosterValue(after.league, bIdx, byId) - rosterValue(before.league, bIdx, byId)),
    horizon: null,
  };
}

function applySwap(draft, aIdx, bIdx, aGives, bGives) {
  draft.traded ??= {};
  for (const p of aGives) draft.traded[p.overall] = bIdx;
  for (const p of bGives) draft.traded[p.overall] = aIdx;
}

// ---------------------------------------------------------------------------
// The deal itself
// ---------------------------------------------------------------------------

/** Most picks either side may put in one deal. */
export const MAX_PICK_SIDE = 3;

/** Structural checks. Returns { ok, reason }. */
export function validatePickTrade(league, draft, aIdx, bIdx, aGives, bGives) {
  if (draft.complete) return { ok: false, reason: 'The draft is over' };
  if (aIdx === bIdx) return { ok: false, reason: 'Pick another club' };
  if (!aGives.length || !bGives.length) return { ok: false, reason: 'Both sides have to give something' };
  if (aGives.length !== bGives.length) {
    return { ok: false, reason: `Picks trade one for one: a club drafts as many times as it has slots, so ${aGives.length} for ${bGives.length} would leave somebody unable to fill a roster` };
  }
  if (aGives.length > MAX_PICK_SIDE) return { ok: false, reason: `At most ${MAX_PICK_SIDE} picks a side` };
  const mineA = remainingPicks(draft, aIdx), mineB = remainingPicks(draft, bIdx);
  const has = (list, p) => list.some((x) => x.overall === p.overall);
  for (const p of aGives) if (!has(mineA, p)) return { ok: false, reason: `Pick ${p.overall} is not ${league.teams[aIdx].abbr}'s to trade` };
  for (const p of bGives) if (!has(mineB, p)) return { ok: false, reason: `Pick ${p.overall} is not ${league.teams[bIdx].abbr}'s to trade` };
  const dupe = (list) => new Set(list.map((p) => p.overall)).size !== list.length;
  if (dupe(aGives) || dupe(bGives)) return { ok: false, reason: 'A pick is listed twice' };
  return { ok: true };
}

/** Do the deal. Throws if it does not hold up. */
export function executePickTrade(league, draft, aIdx, bIdx, aGives, bGives) {
  const v = validatePickTrade(league, draft, aIdx, bIdx, aGives, bGives);
  if (!v.ok) throw new Error(v.reason);
  applySwap(draft, aIdx, bIdx, aGives, bGives);
  // A swap can move the club that is on the clock, and can hand a pick to a
  // club whose roster is already full.
  settlePointer(league, draft);
  league.transactions ??= [];
  league.transactions.push({
    week: 0, season: league.season, type: 'picks', team: aIdx, other: bIdx,
    gives: aGives.map((p) => p.overall), gets: bGives.map((p) => p.overall),
    round: draft.round,
  });
  return league.transactions[league.transactions.length - 1];
}

/**
 * The AI's answer. It judges the roster the draft would leave it with, and
 * asks for its usual greed margin on top — the same number it wants from a
 * player trade, so a club is not suddenly generous because the currency
 * changed.
 */
export function evaluatePickTrade(league, draft, pool, byId, aiIdx, aiGives, aiGets, otherIdx) {
  const proj = projectPickTrade(league, draft, pool, byId, aiIdx, otherIdx, aiGives, aiGets);
  const team = league.teams[aiIdx];
  const greed = aiGreed(team, league);
  const delta = proj.a;
  const accept = delta >= greed;
  let reason;
  if (accept) reason = delta >= greed * 3 ? 'They take it at once.' : 'They weigh it up, then agree.';
  else if (delta < 0) reason = `${team.abbr} would draft worse. They pass.`;
  else reason = `Not enough in it for ${team.abbr} — they want about ${Math.ceil(greed - delta)} more points of draft value.`;
  return { accept, delta, greed, reason, projection: proj };
}

/** Ask an AI club, and do the deal if it agrees. */
export function proposePickTrade(league, draft, pool, byId, userIdx, aiIdx, userGives, aiGives) {
  const v = validatePickTrade(league, draft, userIdx, aiIdx, userGives, aiGives);
  if (!v.ok) return { ok: false, accepted: false, reason: v.reason };
  const ev = evaluatePickTrade(league, draft, pool, byId, aiIdx, aiGives, userGives, userIdx);
  if (!ev.accept) return { ok: true, accepted: false, reason: ev.reason, delta: ev.delta };
  const tx = executePickTrade(league, draft, userIdx, aiIdx, userGives, aiGives);
  return { ok: true, accepted: true, reason: ev.reason, delta: ev.delta, tx };
}

/**
 * Clubs ringing the human about picks. A club calls when it wants to move up
 * on somebody it has its eye on, or down because the board has nothing for it
 * where it sits — and only when the swap is no worse than a point or two
 * below even for the human, the same courtesy the in-season market shows.
 */
export const PICK_OFFER_FAIR_MARGIN = 2;

export function makePickOffers(league, draft, pool, byId, rng, { max = 1 } = {}) {
  if (draft.complete) return [];
  const u = league.teams.findIndex((t) => t.isUser);
  if (u < 0) return [];
  const mine = remainingPicks(draft, u);
  if (!mine.length) return [];
  const made = [];
  const others = league.teams.map((_, i) => i).filter((i) => i !== u && remainingPicks(draft, i).length > 0);
  if (rng) for (let i = others.length - 1; i > 0; i--) { const j = rng.int(0, i); [others[i], others[j]] = [others[j], others[i]]; }
  for (const a of others) {
    if (made.length >= max) break;
    const theirs = remainingPicks(draft, a);
    let best = null;
    // One for one only, and only the near picks: a club does not ring about
    // round nineteen, and the projection cannot see that far anyway.
    for (const mp of mine.slice(0, 3)) for (const tp of theirs.slice(0, 3)) {
      if (mp.overall === tp.overall) continue;
      const v = validatePickTrade(league, draft, a, u, [tp], [mp]);
      if (!v.ok) continue;
      const proj = projectPickTrade(league, draft, pool, byId, a, u, [tp], [mp]);
      if (proj.a < aiGreed(league.teams[a], league)) continue;
      if (proj.b < -PICK_OFFER_FAIR_MARGIN) continue;
      if (!best || proj.a > best.aiGain) best = { gives: [tp], wants: [mp], aiGain: proj.a, userDelta: proj.b };
    }
    if (!best) continue;
    const up = best.gives[0].overall > best.wants[0].overall;
    made.push({
      id: `pk-${league.season}-${draft.round}-${a}-${best.wants[0].overall}`,
      season: league.season, round: draft.round, from: a,
      gives: best.gives, wants: best.wants, aiGain: best.aiGain, userDelta: best.userDelta,
      note: `${league.teams[a].abbr} want to move ${up ? 'up' : 'down'}: their #${best.gives[0].overall} for your #${best.wants[0].overall}.`,
    });
  }
  return made;
}

/**
 * AI clubs swapping picks with each other. Kept deliberately rare — a draft
 * whose order churns every round is one nobody can follow, and the board on
 * screen is the thing the user is reading.
 */
export function aiPickTrades(league, draft, pool, byId, rng, { pairs = 2 } = {}) {
  if (draft.complete) return [];
  const ai = league.teams.map((t, i) => (t.isUser ? -1 : i)).filter((i) => i >= 0);
  if (ai.length < 2) return [];
  const done = [];
  for (let n = 0; n < pairs; n++) {
    const a = ai[rng.int(0, ai.length - 1)], b = ai[rng.int(0, ai.length - 1)];
    if (a === b) continue;
    const pa = remainingPicks(draft, a).slice(0, 2), pb = remainingPicks(draft, b).slice(0, 2);
    let best = null;
    for (const x of pa) for (const y of pb) {
      if (x.overall === y.overall) continue;
      if (!validatePickTrade(league, draft, a, b, [x], [y]).ok) continue;
      const proj = projectPickTrade(league, draft, pool, byId, a, b, [x], [y]);
      if (proj.a < aiGreed(league.teams[a], league) || proj.b < aiGreed(league.teams[b], league)) continue;
      if (!best || proj.a + proj.b > best.total) best = { x, y, total: proj.a + proj.b };
    }
    if (best) done.push(executePickTrade(league, draft, a, b, [best.x], [best.y]));
  }
  return done;
}

/** Board rows need to know who owns each pick now, and who it came from. */
export function pickGrid(draft) {
  const n = draft.order.length;
  const rows = [];
  for (let r = 1; r <= TOTAL_ROUNDS; r++) {
    const row = [];
    for (let i = 0; i < n; i++) {
      const owner = pickOwner(draft, r, i), from = originalOwner(draft, r, i);
      row.push({ round: r, pickInRound: i, overall: overallOf(draft, r, i), owner, from, traded: owner !== from });
    }
    rows.push(row);
  }
  return rows;
}

/** A club's open slots by position, for showing what a pick would be spent on. */
export function needSummary(team) {
  const open = {};
  for (const s of openSlots(team)) open[s.pos] = (open[s.pos] || 0) + 1;
  return open;
}

export { TOTAL_ROUNDS, currentPicker, availablePlayers, rankForTeam, overall, ROSTER_SLOTS };
