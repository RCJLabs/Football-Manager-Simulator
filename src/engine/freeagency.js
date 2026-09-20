// The free-agent market, between the keeper round and the draft.
//
// What makes this a decision rather than a shopping list is that the men on
// offer here are the *same* men who will be in the draft an hour later. Signing
// one costs market money now; letting him go and taking him with a pick costs
// rookie-scale money, which is a fraction of it — if he lasts that long, and
// the good ones do not. So the question every club is asked is not "can I
// afford him" but "will he still be there, and what is certainty worth".
//
// It costs a pick, too, and nothing had to be written to make that true. A
// club's picks equal its open slots, and `settlePointer` skips anybody already
// full, so a club that signs four free agents simply never makes four of its
// picks. Buy now, draft less.
//
// Bids are sealed. Everyone puts in an offer, the market settles in one step,
// and the best players settle first — which matters, because a club that wins
// a bidding war has less money for the next man, and that cascade is most of
// what makes the order interesting.

import { ROSTER_SLOTS } from '../data/positions.js';
import { overall } from './ratings.js';
import { standings } from './season.js';
import { freeAgents, ownerMap, lineupStrength, aiGreed } from './transactions.js';
import { capOn, capHit, capSpace, marketSalary, MIN_SALARY, VET_YEARS, SLOT_RESERVE, PRO_CAP } from './cap.js';

/** How long a deal signed in free agency runs. */
export const FA_YEARS = VET_YEARS;

/**
 * How many of its open slots a club will fill here rather than in the draft.
 *
 * A club that spent every slot in free agency would forfeit every pick, which
 * is legal and almost never right — rookie money is a fraction of market and
 * the draft is where a cap-squeezed club finds value. Half is the AI's rule of
 * thumb; the human is not held to it, because choosing to mortgage a draft for
 * a win now is exactly the sort of decision this is for.
 *
 * Set when free agency shipped and left alone through the two-pool split, the
 * contract rules, dead money and the practice squad, so it was finally swept:
 * four values over four seeds and twelve offseasons each, watching where a
 * roster comes from and what the league looks like afterwards.
 *
 *   share   FA / draft / scraped     cap    spread
 *   0.25      13 / 75 / 13          156      756
 *   0.50      25 / 63 / 12          166      759
 *   0.75      29 / 61 / 12          169      781
 *   1.00      38 / 52 /  9          171      829
 *
 * Half stays, and now for a measured reason rather than an untested one. Above
 * it the gap between the best and worst roster opens up — clubs that are
 * already good buy the market — and the draft stops being where most of a
 * roster comes from, which is the thing the two-pool split was for. Below it
 * the market is vestigial at an eighth of all signings and the cap goes slack
 * at 156 of 200. Between 0.25 and 0.5 the spread is flat, so this is not a
 * knife-edge optimum; it is the top of the range before the cliff.
 */
export const AI_FA_SHARE = 0.5;

/** How far over the asking price a club will go, by how badly it wants him. */
export const MAX_PREMIUM = 0.6;

/**
 * How many times the market settles before it closes.
 *
 * One pass is not a market, it is a lottery. Every club ranks the board by what
 * a man would add to *its* lineup, and since an empty quarterback slot is worth
 * six times an empty punter to anybody, they all crowd the same dozen names:
 * measured, a single pass drew about fourteen bidders a player and produced 13
 * signings across 32 clubs, with most clubs getting nothing and falling back to
 * the draft having wasted the round. Settling in waves lets the clubs that lost
 * turn to who is left, which is what actually happens when a free agent signs
 * somewhere and everybody else moves on.
 */
export const FA_ROUNDS = 4;

/** Open slots a club still has. */
export function openCount(team) {
  return ROSTER_SLOTS.filter((s) => !team.slots[s.id]).length;
}

/**
 * Everyone unsigned, dearest first, with what each is asking.
 *
 * The asking price is the floor, not a suggestion: a player will not sign for
 * less than he is worth. Without that floor an uncontested star goes for a
 * dollar, which is not a market, it is an oversight.
 */
export function askingBoard(league, pool, { limit = 200 } = {}) {
  const free = freeAgents(league, pool);
  return free
    .map((p) => ({ id: p.id, pos: p.pos, ovr: overall(p), ask: marketSalary(p) }))
    .sort((a, b) => b.ask - a.ask || b.ovr - a.ovr)
    .slice(0, limit);
}

/** What a club already owes, plus everything it has bid for. */
export function committed(league, teamIdx) {
  const offers = league.freeAgency?.offers?.[teamIdx] || {};
  let bid = 0;
  for (const salary of Object.values(offers)) bid += salary;
  return capHit(league, teamIdx) + bid;
}

/**
 * What a club may still bid.
 *
 * Offers are speculative — you might win none of them — but a club is held to
 * the worst case, as if every bid landed. Anything looser lets a club bid the
 * same dollar on six players and field whichever it wins, which is not a
 * budget. Slots it has not filled still need somebody in them, so the reserve
 * comes off the top.
 */
export function biddingRoom(league, teamIdx) {
  if (!capOn(league)) return 0;
  const cap = league.cap ?? PRO_CAP;
  const team = league.teams[teamIdx];
  const bids = Object.keys(league.freeAgency?.offers?.[teamIdx] || {}).length;
  const unfilled = Math.max(0, openCount(team) - bids);
  return cap - committed(league, teamIdx) - unfilled * SLOT_RESERVE;
}

/** Open the market. Clubs that are not the user put their bids in at once. */
export function openFreeAgency(league, pool, byId, rng = null) {
  league.freeAgency = { season: league.season, offers: {}, results: null, closed: false };
  aiBid(league, pool, byId, rng);
  return league.freeAgency;
}

/**
 * Put an offer in, or raise one. Returns { ok, reason }.
 *
 * A withdrawal is an offer of nothing, which is how the screen's "pull out"
 * button works without a second entry point.
 */
export function submitOffer(league, teamIdx, playerId, salary, byId) {
  if (!league.freeAgency || league.freeAgency.closed) return { ok: false, reason: 'The market is closed' };
  const fa = league.freeAgency;
  fa.offers[teamIdx] ??= {};
  const player = byId?.get(playerId);
  if (!player) return { ok: false, reason: 'No such player' };
  if (ownerMap(league).has(playerId)) return { ok: false, reason: `${player.name} is on a roster` };
  if (salary == null || salary <= 0) { delete fa.offers[teamIdx][playerId]; return { ok: true, withdrawn: true }; }
  const ask = marketSalary(player);
  if (salary < ask) return { ok: false, reason: `${player.name} is asking $${ask}` };
  const team = league.teams[teamIdx];
  if (!ROSTER_SLOTS.some((s) => s.pos === player.pos && !team.slots[s.id])) {
    return { ok: false, reason: `No open ${player.pos} slot` };
  }
  const previous = fa.offers[teamIdx][playerId] ?? 0;
  delete fa.offers[teamIdx][playerId];
  const room = biddingRoom(league, teamIdx);
  if (salary > room) {
    if (previous) fa.offers[teamIdx][playerId] = previous;
    return { ok: false, reason: `That leaves you $${room} to bid, and the rest of the roster still to fill` };
  }
  fa.offers[teamIdx][playerId] = salary;
  return { ok: true };
}

/** What a club thinks a free agent is worth to *its* lineup, in leverage points. */
function gainFor(league, teamIdx, player, byId) {
  const team = league.teams[teamIdx];
  const slot = ROSTER_SLOTS.find((s) => s.pos === player.pos && !team.slots[s.id]);
  if (!slot) return 0;
  const before = lineupStrength(team.slots, byId, null);
  const after = lineupStrength({ ...team.slots, [slot.id]: player.id }, byId, null);
  return after - before;
}

/**
 * AI clubs bid, worst record first so the clubs that need help shop first.
 *
 * A club bids on what would improve it most, pays the asking price plus a
 * premium scaled by how much it wants him, and stops when it runs out of room
 * or has filled its share. The premium is what wins contested men, and it is
 * the only thing here that is not arithmetic: a club that wants somebody badly
 * pays over the odds for him, which is the whole of free agency.
 */
export function aiBid(league, pool, byId, rng = null) {
  if (!capOn(league)) return;
  const board = askingBoard(league, pool, { limit: 120 });
  const order = standings(league).map((r) => r.idx).reverse();
  for (const ti of order) {
    const team = league.teams[ti];
    if (team.isUser) continue;
    // Floored, so a club with a single hole sits the market out entirely. That
    // looks like an off-by-one and is not: measured, it shuts out 8% of club
    // offseasons, and they are the *good* clubs — a club with one hole is one
    // that kept everybody. Letting them shop with `Math.max(1, …)` was tried
    // and widens the gap between the best and worst roster from 759 to 821,
    // well outside the spread between seeds. A contender buying its last piece
    // every year is how a league stops being competitive.
    const want = Math.floor(openCount(team) * AI_FA_SHARE);
    if (want <= 0) continue;
    const greed = aiGreed(team, league);
    const scored = board
      .map((row) => {
        const p = byId.get(row.id);
        if (!p) return null;
        const gain = gainFor(league, ti, p, byId);
        return gain > greed ? { row, p, gain } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.gain - a.gain)
      .slice(0, want * 2);
    let taken = 0;
    for (const { row, p, gain } of scored) {
      if (taken >= want) break;
      // The more he adds, the further over the asking price this club will go.
      const eagerness = Math.min(1, gain / 60) + (rng ? rng.normal(0, 0.06) : 0);
      const bid = Math.round(row.ask * (1 + Math.max(0, Math.min(MAX_PREMIUM, eagerness * MAX_PREMIUM))));
      const r = submitOffer(league, ti, p.id, Math.max(row.ask, bid), byId);
      if (r.ok) taken++;
    }
  }
}

/**
 * Settle the market: dearest man first, highest offer wins.
 *
 * Order matters and is not arbitrary. Settling the best players first means a
 * club that wins a bidding war is poorer for the next one, which is what makes
 * overpaying for a star a real choice rather than a free one. Ties go to the
 * worse record, the same priority the waiver wire uses.
 */
export function resolveFreeAgency(league, pool, byId, rng = null) {
  if (!league.freeAgency) return [];
  const fa = league.freeAgency;
  const signed = [];
  for (let round = 0; round < FA_ROUNDS; round++) {
    const took = settleOnce(league, pool, byId, signed, round);
    // Nothing moved and nobody can move: the market is done early.
    if (!took && round > 0) break;
    if (round < FA_ROUNDS - 1) {
      // Whoever lost turns to who is left. The human's outstanding bids stand
      // as placed — they are only spent when they win.
      clearAiBids(league);
      aiBid(league, pool, byId, rng);
    }
  }
  fa.results = signed;
  fa.closed = true;
  return signed;
}

/** Drop AI offers that did not land, so they can be re-aimed at the next wave. */
function clearAiBids(league) {
  for (const [tStr] of Object.entries(league.freeAgency.offers)) {
    const ti = Number(tStr);
    if (league.teams[ti]?.isUser) continue;
    league.freeAgency.offers[ti] = {};
  }
}

/** One wave: every player with a bid on him settles, dearest first. */
function settleOnce(league, pool, byId, signed, round) {
  const fa = league.freeAgency;
  const priority = standings(league).map((r) => r.idx).reverse();
  const rank = new Map(priority.map((idx, i) => [idx, i]));
  const board = askingBoard(league, pool, { limit: 400 });
  let took = 0;
  for (const row of board) {
    const bids = [];
    for (const [tStr, offers] of Object.entries(fa.offers)) {
      const ti = Number(tStr);
      const salary = offers[row.id];
      if (!salary) continue;
      const team = league.teams[ti];
      const slot = ROSTER_SLOTS.find((s) => s.pos === row.pos && !team.slots[s.id]);
      if (!slot) continue;
      // The money has to still be there: an earlier win may have spent it.
      if (capSpace(league, ti) - salary < (openCount(team) - 1) * SLOT_RESERVE) continue;
      bids.push({ ti, salary, slot });
    }
    if (!bids.length) continue;
    bids.sort((a, b) => b.salary - a.salary || (rank.get(a.ti) ?? 99) - (rank.get(b.ti) ?? 99));
    const win = bids[0];
    league.teams[win.ti].slots[win.slot.id] = row.id;
    league.contracts ??= {};
    league.contracts[row.id] = { salary: win.salary, years: FA_YEARS, round: ROSTER_SLOTS.length, kept: 0, since: league.season };
    league.transactions ??= [];
    league.transactions.push({ week: 0, season: league.season, type: 'sign', team: win.ti, add: row.id, drop: null });
    signed.push({
      team: win.ti, id: row.id, salary: win.salary, ask: row.ask, bidders: bids.length, round,
      // Who missed out, and for how much. Recorded here rather than worked out
      // afterwards from leftover offers, because the losing offers are about to
      // be torn up — which is why the report used to say a club had lost
      // nothing on a night it had been outbid four times.
      underbid: bids.slice(1).map((b) => ({ team: b.ti, salary: b.salary })),
    });
    // He is signed; nobody's outstanding offer for him means anything now.
    for (const offers of Object.values(fa.offers)) delete offers[row.id];
    took++;
  }
  return took;
}

/** What the market did, from one club's side, for the screen that reports it. */
export function freeAgencyReport(league, teamIdx) {
  const fa = league.freeAgency;
  if (!fa?.results) return { won: [], lost: [] };
  const won = fa.results.filter((r) => r.team === teamIdx);
  const lost = [];
  for (const r of fa.results) {
    const mine = (r.underbid || []).find((b) => b.team === teamIdx);
    if (mine) lost.push({ id: r.id, bid: mine.salary, to: r.team, at: r.salary });
  }
  return { won, lost };
}

/** A club with nothing left to bid and no slots is done; the screen says so. */
export function userDone(league, teamIdx) {
  return openCount(league.teams[teamIdx]) === 0 || biddingRoom(league, teamIdx) < MIN_SALARY;
}
