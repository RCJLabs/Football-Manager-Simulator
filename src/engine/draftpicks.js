// Trading draft picks, and knowing what one is worth.
//
// A pick was never an object here. `currentPicker` worked the snake out of
// `draft.order`, the round and the position in it, so there was nothing to
// hand over. `draft.traded` is that missing table: overall pick number to the
// club that now owns it, consulted by `pickOwner` and empty in every league
// where nobody has traded.
//
// Rosters are twenty-seven slots and `TOTAL_ROUNDS` is twenty-seven, so a club
// starts with exactly as many picks as slots. Deals need not keep that balance,
// and what happens when they do not is the whole shape of the feature, because
// the two sides of an uneven deal are not symmetrical:
//
//   - A club that **sends more than it takes** drafts that many times fewer and
//     finishes short. It signs the difference off the board when the season
//     starts (`fillOpenSlots`), which is a real price, because what is left
//     after a draft is what nobody wanted. `MAX_SHORT` caps how much of a
//     roster may arrive that way.
//   - A club that **takes more than it sends** cannot use the surplus at all:
//     `settlePointer` skips anybody already full, so its *latest* picks are
//     never made. Those are the cheapest ones it holds, which is why taking
//     three for one is not the disaster it sounds like.
//
// That asymmetry is what makes the market. Measured over six leagues against
// the same league drafted without the trade, sending your next three picks for
// somebody's first costs 37 points of finished roster — they are premium picks
// and two free agents replace them. Sending your last two gains 23, because a
// twenty-fifth-round pick is barely better than the best man left unsigned. So
// late picks are the currency of moving up, and moving *down* for quantity is a
// loss of 72: you cannot use what you cannot slot.
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
import { fillOpenSlots } from './season.js';

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
function rollForward(lg, d, pool, rng, untilOverall, landed = null) {
  let guard = 0;
  while (!d.complete && guard++ < TOTAL_ROUNDS * d.order.length + 5) {
    if (untilOverall != null && overallOf(d, d.round, d.pickInRound) > untilOverall) break;
    const t = pickOwner(d, d.round, d.pickInRound);
    if (t == null) break;
    const ov = landed ? overallOf(d, d.round, d.pickInRound) : 0;
    const p = aiChoose(lg, d, pool, t, rng);
    if (!p) break;
    if (landed) landed.set(ov, p);
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
  return pickTradeProjector(league, draft, pool, byId).project(aIdx, bIdx, aGives, bGives);
}

/**
 * The same projection, with the half of it that never changes done once.
 *
 * Every projection drafts two worlds: the one where nothing happens and the
 * one where the swap does. The first is *identical* for every candidate swap,
 * and it was being rebuilt for each one — so asking about nine swaps ran
 * eighteen drafts where ten would do. That was half of a much larger problem:
 * `makePickOffers` asked about up to ninety-nine of them on the render path,
 * which measured as a single nine-and-a-half-second block of the main thread
 * on a desktop, and several times that on a phone. The player's report was
 * that pressing a button froze the game for a moment; this was the moment.
 *
 * A projector holds the untouched world and the roster values that come out of
 * it, so each further question costs one draft instead of two. It also exposes
 * `slotValue`, which is what the free half buys: the before-world knows which
 * player every pick slot actually produced, so a club's own board prices a
 * swap without simulating anything. Measured against the real projection where
 * it is used it correlates about 0.7, which is enough to sort candidates and
 * nowhere near enough to price one — the projection still decides.
 */
export function pickTradeProjector(league, draft, pool, byId) {
  const before = sandbox(league, draft);
  const landed = new Map();
  rollForward(before.league, before.draft, pool, null, null, landed);
  fillOpenSlots(before.league, pool, byId, { log: false });
  const baseline = league.teams.map((_, i) => rosterValue(before.league, i, byId));
  const boards = new Map();
  const boardFor = (i) => {
    let b = boards.get(i);
    if (!b) {
      b = new Map();
      for (const r of rankForTeam(league, draft, pool, i, null)) {
        const id = r.player ? r.player.id : r.id;
        if (id != null) b.set(id, r.score ?? r.value ?? 0);
      }
      boards.set(i, b);
    }
    return b;
  };
  const round1 = (x) => Math.round(x * 10) / 10;
  return {
    baseline,
    /** Who each pick slot produced when nobody traded. */
    landed,
    /** What club `i` thinks swapping away `give` for `get` is worth, for free. */
    slotValue(i, give, get) {
      const b = boardFor(i);
      const pg = landed.get(get.overall), pv = landed.get(give.overall);
      return (pg ? (b.get(pg.id) ?? 0) : 0) - (pv ? (b.get(pv.id) ?? 0) : 0);
    },
    project(aIdx, bIdx, aGives, bGives) {
      const after = sandbox(league, draft);
      applySwap(after.draft, aIdx, bIdx, aGives, bGives);
      rollForward(after.league, after.draft, pool, null, null);
      // A club that sent more picks than it got finishes short, and signs the
      // difference off the board. Scoring those slots as zero instead is the
      // partial-roster trap again, and it would make every move up look like a
      // loss: measured, the mover finished 279 points down on a club that
      // stood pat purely because two slots sat empty.
      fillOpenSlots(after.league, pool, byId, { log: false });
      return {
        a: round1(rosterValue(after.league, aIdx, byId) - baseline[aIdx]),
        b: round1(rosterValue(after.league, bIdx, byId) - baseline[bIdx]),
        horizon: null,
      };
    },
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

/**
 * How many slots a club may leave for free agency by trading picks away.
 *
 * Trading three picks for one is the whole point of trading up, but a club
 * that did it repeatedly could arrive at kickoff with half a roster of
 * leftovers, which is neither fun nor a decision — it is just a club that has
 * stopped playing the draft. Three is one bad idea's worth.
 */
export const MAX_SHORT = 3;

/** Structural checks. Returns { ok, reason }. */
export function validatePickTrade(league, draft, aIdx, bIdx, aGives, bGives) {
  if (draft.complete) return { ok: false, reason: 'The draft is over' };
  if (aIdx === bIdx) return { ok: false, reason: 'Pick another club' };
  if (!aGives.length || !bGives.length) return { ok: false, reason: 'Both sides have to give something' };
  if (aGives.length > MAX_PICK_SIDE || bGives.length > MAX_PICK_SIDE) return { ok: false, reason: `At most ${MAX_PICK_SIDE} picks a side` };
  const mineA = remainingPicks(draft, aIdx), mineB = remainingPicks(draft, bIdx);
  const has = (list, p) => list.some((x) => x.overall === p.overall);
  for (const p of aGives) if (!has(mineA, p)) return { ok: false, reason: `Pick ${p.overall} is not ${league.teams[aIdx].abbr}'s to trade` };
  for (const p of bGives) if (!has(mineB, p)) return { ok: false, reason: `Pick ${p.overall} is not ${league.teams[bIdx].abbr}'s to trade` };
  const dupe = (list) => new Set(list.map((p) => p.overall)).size !== list.length;
  if (dupe(aGives) || dupe(bGives)) return { ok: false, reason: 'A pick is listed twice' };
  // Uneven deals are allowed, and the club that sends more than it gets simply
  // drafts fewer times than it has slots — it signs the difference off the
  // board when the season starts. That is the price of moving up, and it is a
  // real one, because what is left after a draft is what nobody wanted. The
  // limit is on how much of a roster may arrive that way.
  const shortfall = (idx, gives, gets) => {
    const open = openSlots(league.teams[idx]).length;
    const picks = remainingPicks(draft, idx).length - gives.length + gets.length;
    return open - picks;
  };
  for (const [idx, gives, gets] of [[aIdx, aGives, bGives], [bIdx, bGives, aGives]]) {
    const short = shortfall(idx, gives, gets);
    if (short > MAX_SHORT) {
      return { ok: false, reason: `${league.teams[idx].abbr} would finish the draft ${short} men short, and only ${MAX_SHORT} can be signed off the board` };
    }
  }
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

/**
 * How many swaps this will simulate before giving up for the turn.
 *
 * It used to simulate every one it could think of — every other club against
 * three of its picks and three of yours, ninety-nine drafted twice — to find
 * the *best* offer. That is the wrong target. An offer only has to clear two
 * bars, the club's own greed and not costing you more than
 * `PICK_OFFER_FAIR_MARGIN`, and those are checked by the real projection
 * whichever candidate is put through it. So the candidates are ranked for free
 * off the before-world and tried in that order until one clears, and the
 * budget caps what a turn can cost when none of them do.
 */
export const OFFER_BUDGET = 4;

/**
 * The candidate swaps for the player's turn, ranked, with the shared world
 * built. Split out from `makePickOffers` so a caller can spend the budget one
 * question at a time: each `tryPickOffer` is a single draft, which is the
 * smallest piece this can be cut into, and the screen stays alive between
 * them. Doing all of them in one go measured a two-second block on a throttled
 * phone even after the count came down.
 */
export function pickOfferCandidates(league, draft, pool, byId, rng, { projector = null } = {}) {
  if (draft.complete) return null;
  const u = league.teams.findIndex((t) => t.isUser);
  if (u < 0) return null;
  const mine = remainingPicks(draft, u);
  if (!mine.length) return null;
  const others = league.teams.map((_, i) => i).filter((i) => i !== u && remainingPicks(draft, i).length > 0);
  if (!others.length) return null;
  if (rng) for (let i = others.length - 1; i > 0; i--) { const j = rng.int(0, i); [others[i], others[j]] = [others[j], others[i]]; }

  // One for one only, and only the near picks: a club does not ring about
  // round nineteen, and the projection cannot see that far anyway.
  const candidates = [];
  for (const a of others) {
    const theirs = remainingPicks(draft, a);
    for (const mp of mine.slice(0, 3)) for (const tp of theirs.slice(0, 3)) {
      if (mp.overall === tp.overall) continue;
      if (!validatePickTrade(league, draft, a, u, [tp], [mp]).ok) continue;
      candidates.push({ a, mp, tp });
    }
  }
  if (!candidates.length) return null;

  const proj = projector || pickTradeProjector(league, draft, pool, byId);
  // Try the likelier candidates first. The before-world already knows who each
  // slot produced, so the club's own board prices a swap for nothing.
  //
  // How much this is worth was measured over ninety-eight turns, at a budget
  // of four: ordering by the club's gain finds an offer on 30% of turns
  // against 22% for leaving the candidates in the order they were built. Two
  // plausible-looking alternatives are worse — ordering by the worse of the two
  // sides, on the theory that only near-even swaps can pass both bars, managed
  // 7%, and ordering by the player's side 14%.
  //
  // An earlier version of this comment claimed the estimate correlates r =
  // -0.05 with the real projection, and that was wrong. It came from one
  // narrow slice — three twelve-club leagues against five opponents — and does
  // not survive contact with any other sample: the same measurement reads 0.66
  // to 0.73 at six seeds, at eleven opponents, and at thirty-two clubs. It is a
  // decent ranker. It still does not decide anything; the projection does.
  for (const c of candidates) c.guess = proj.slotValue(c.a, c.tp, c.mp);
  candidates.sort((x, y) => y.guess - x.guess);
  return { user: u, round: draft.round, projector: proj, candidates };
}

/** Put one candidate through the real projection. Returns an offer, or null. */
export function tryPickOffer(league, plan, c) {
  const u = plan.user;
  const v = plan.projector.project(c.a, u, [c.tp], [c.mp]);
  if (v.a < aiGreed(league.teams[c.a], league)) return null;
  if (v.b < -PICK_OFFER_FAIR_MARGIN) return null;
  const up = c.tp.overall > c.mp.overall;
  return {
    id: `pk-${league.season}-${plan.round}-${c.a}-${c.mp.overall}`,
    season: league.season, round: plan.round, from: c.a,
    gives: [c.tp], wants: [c.mp], aiGain: v.a, userDelta: v.b,
    note: `${league.teams[c.a].abbr} want to move ${up ? 'up' : 'down'}: their #${c.tp.overall} for your #${c.mp.overall}.`,
  };
}

export function makePickOffers(league, draft, pool, byId, rng, { max = 1, budget = OFFER_BUDGET, projector = null } = {}) {
  const plan = pickOfferCandidates(league, draft, pool, byId, rng, { projector });
  if (!plan) return [];
  const made = [];
  let spent = 0;
  for (const c of plan.candidates) {
    if (made.length >= max || spent >= budget) break;
    if (made.some((o) => o.from === c.a)) continue;
    spent++;
    const o = tryPickOffer(league, plan, c);
    if (o) made.push(o);
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
  // Built on first use and dropped after a deal, because a deal changes the
  // world the untouched draft was rolled from.
  let projector = null;
  for (let n = 0; n < pairs; n++) {
    const a = ai[rng.int(0, ai.length - 1)], b = ai[rng.int(0, ai.length - 1)];
    if (a === b) continue;
    const pa = remainingPicks(draft, a).slice(0, 2), pb = remainingPicks(draft, b).slice(0, 2);
    const pairs = [];
    for (const x of pa) for (const y of pb) {
      if (x.overall === y.overall) continue;
      if (!validatePickTrade(league, draft, a, b, [x], [y]).ok) continue;
      pairs.push({ x, y });
    }
    if (!pairs.length) continue;
    // Same economy as the offers: rank for free, simulate the best one only.
    // Each club has to gain, so rank on the pair rather than on either side.
    const proj = projector || (projector = pickTradeProjector(league, draft, pool, byId));
    for (const q of pairs) q.guess = proj.slotValue(a, q.x, q.y) + proj.slotValue(b, q.y, q.x);
    pairs.sort((p, q) => q.guess - p.guess);
    const top = pairs[0];
    const v = proj.project(a, b, [top.x], [top.y]);
    const best = (v.a >= aiGreed(league.teams[a], league) && v.b >= aiGreed(league.teams[b], league)) ? top : null;
    if (best) { done.push(executePickTrade(league, draft, a, b, [best.x], [best.y])); projector = null; }
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
