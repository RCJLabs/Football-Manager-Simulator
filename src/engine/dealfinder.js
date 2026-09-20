// Who would say yes.
//
// The trade room was a guessing game. It listed every roster in the league and
// told you who was on the block, and then you picked two players, pressed
// Propose and were refused — because a deal has to clear the club's greed
// *and* improve your own lineup, and eyeballing two rosters will not tell you
// when both are true.
//
// Meanwhile the market underneath it is busy. Sampling sixteen weeks across
// four leagues, **14.4 deals a week exist that a club would accept and that
// improve the human's lineup**, spread over about seven clubs, and there was
// never a week with none — the spread ran from 1 to 40. The human saw eleven
// offers a *season*. This is a search over the same shapes `makeAiOffers`
// already enumerates, pointed the other way.
//
// **It runs the whole sweep rather than a budgeted sample, and that is
// measured rather than lazy.** Ranking candidates for free and stopping early
// is the pattern draftpicks.js uses, and it was tried here first: of 4,464
// candidates only 9 were good, and the best free estimate — the lesser of the
// two sides' marginal gains — found 3 of them in the first 300 against 1 for
// no ranking at all. Better than nothing and nowhere near enough; the other
// orderings (the sum, either side alone) found one or none. A finder that
// reports three deals when nine exist is worse than no finder, because you
// cannot tell which case you are in. So the ranking survives only to order the
// results, and the search is complete.
//
// The full sweep measures 717 ms on a desktop, which is about 2.9 s on a
// mid-range phone, so it cannot be one task: `dealPlan` does the cheap half
// and `scanClub` does one club at a time, leaving the caller to yield between
// them. Thirty-one chunks of about 23 ms each, and a progress readout that
// says which club it is on.

import { ROSTER_SLOTS } from '../data/positions.js';
import { overall, TRUE_LEVERAGE } from './ratings.js';
import {
  validateTrade, evaluateTrade, lineupStrength, slotsAfterTrade, tradesOpen, slotOf, aiGreed,
} from './transactions.js';
import {
  futureHand, futurePicksOpen, futurePickValue, projectedSlots, futureOwner,
} from './futurepicks.js';

/** The positions a trade can be built around. Kickers and punters are not a market. */
const POS = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S'];

/** How much better than nothing a deal has to leave the human before it is worth showing. */
export const DEAL_FLOOR = 0.1;

const group = (team, pos, byId) => ROSTER_SLOTS.filter((s) => s.pos === pos)
  .map((s) => ({ slot: s, id: team.slots[s.id], p: byId.get(team.slots[s.id]) }))
  .filter((x) => x.p);
const bestBench = (team, pos, byId) => group(team, pos, byId).filter((x) => !x.slot.starter)
  .sort((a, b) => overall(b.p) - overall(a.p))[0] || null;
const worstStarter = (team, pos, byId) => group(team, pos, byId).filter((x) => x.slot.starter)
  .sort((a, b) => overall(a.p) - overall(b.p))[0] || null;

/**
 * What a club gains or loses by a man arriving or leaving, for nothing.
 *
 * Leverage times how much better he is than the man he would displace — or,
 * going the other way, than the man who would step up. It is the same shape
 * `lineupStrength` measures and a fraction of the cost, which is why it can be
 * run over every candidate and `lineupStrength` cannot.
 */
function marginal(team, id, joining, byId) {
  const p = byId.get(id);
  if (!p) return 0;
  const lev = TRUE_LEVERAGE[p.pos] ?? 1;
  const ref = joining ? worstStarter(team, p.pos, byId) : bestBench(team, p.pos, byId);
  if (!ref) return joining ? overall(p) * lev : 0;
  return lev * (overall(p) - overall(ref.p));
}

const estimate = (team, gives, gets, byId) =>
  gets.reduce((s, id) => s + Math.max(0, marginal(team, id, true, byId)), 0)
  - gives.reduce((s, id) => s + Math.max(0, marginal(team, id, false, byId)), 0);

/**
 * The cheap half: every shape worth asking about, grouped by club so the
 * caller can spend one club per task.
 *
 * The shapes are the ones AI clubs already offer each other — surplus for
 * need, matched two-for-two, and the one-for-one across positions that only
 * exists because uneven deals carry their own paperwork. Anything wider is a
 * combinatorial explosion for deals the model cannot price any better.
 */
export function dealPlan(league, byId, { userIdx = null } = {}) {
  if (!tradesOpen(league)) return null;
  const u = userIdx ?? league.teams.findIndex((t) => t.isUser);
  if (u < 0) return null;
  const U = league.teams[u];
  const clubs = [];
  for (let a = 0; a < league.teams.length; a++) {
    if (a === u) continue;
    const A = league.teams[a];
    const candidates = [];
    for (const P of POS) for (const Q of POS) {
      if (P === Q) continue;
      const aP = bestBench(A, P, byId) || worstStarter(A, P, byId);
      const aQ = worstStarter(A, Q, byId);
      const uP = worstStarter(U, P, byId);
      const uQ = bestBench(U, Q, byId) || worstStarter(U, Q, byId);
      if (!aP || !aQ || !uP || !uQ) continue;
      for (const [gives, wants] of [[[aP.id, aQ.id], [uP.id, uQ.id]], [[aP.id], [uQ.id]]]) {
        if (gives.some((id) => wants.includes(id))) continue;
        const club = estimate(A, gives, wants, byId);
        const human = estimate(U, wants, gives, byId);
        candidates.push({ gives, wants, need: Q, surplus: P, rank: Math.min(club, human) });
      }
    }
    candidates.sort((x, y) => y.rank - x.rank);
    if (candidates.length) clubs.push({ club: a, candidates });
  }
  return {
    user: u,
    base: lineupStrength(U.slots, byId, league),
    // One estimate for the whole sweep. It costs a lineup valuation a club and
    // does not change between two deals looked at in the same week.
    slots: futurePicksOpen(league) ? projectedSlots(league, byId) : null,
    clubs,
  };
}

/**
 * The expensive half, for one club. Every candidate is put through the real
 * pair of questions: would the club take it, and does it leave the human
 * better off. Returns the deals that pass, best for the human first.
 */
/**
 * A pick that would close this particular gap, or nothing.
 *
 * **This costs no simulation at all, which is the only reason it is here.**
 * A pick does not touch either roster, so `evaluateTrade`'s answer for the
 * player half is unchanged by adding one — the pick is a flat offset on each
 * side's ledger, in the same lineup points. The club's bar is `delta >= greed`
 * and the human's is `delta >= DEAL_FLOOR`, so both are arithmetic on numbers
 * the scan already has. Re-simulating each sweetened variant would have been
 * about 380 extra `evaluateTrade` calls a club — roughly doubling the per-club
 * cost the chunking was sized against — for answers that are subtraction.
 *
 * Only one side can ever be rescued: a pick moves the two ledgers in opposite
 * directions, so if the club is short the human pays and if the human is short
 * the club pays. The cheapest pick that works is the one taken, because
 * spending next year's first to close a two-point gap is not a deal anybody
 * should be shown.
 */
function closeWithPick(picks, clubShort, humanShort, clubGap, humanGap) {
  if (!picks) return null;
  if (clubShort && humanShort) return null;
  if (clubShort) {
    // The human pays: the club gains the pick's worth on its own books.
    for (const p of picks.human) if (p.toClub >= clubGap && p.toHuman <= -humanGap) return { from: 'human', pick: p };
    return null;
  }
  if (humanShort) {
    for (const p of picks.club) if (p.toHuman >= humanGap && p.toClub <= -clubGap) return { from: 'club', pick: p };
    return null;
  }
  return null;
}

/** The most a hand of picks could move a club's ledger. Zero when there are none. */
const best = (hand) => (hand?.length ? Math.max(...hand.map((p) => p.toClub)) : 0);

/** Both sides' tradeable picks, each priced on both sets of books, cheapest first. */
function pickTable(league, byId, club, u, slots) {
  if (!futurePicksOpen(league) || !slots) return null;
  const price = (hand) => hand
    .map((p) => ({ pick: p, toClub: futurePickValue(league, byId, p, slots, club), toHuman: futurePickValue(league, byId, p, slots, u) }))
    .sort((a, b) => (a.toClub + a.toHuman) - (b.toClub + b.toHuman));
  return { club: price(futureHand(league, club)), human: price(futureHand(league, u)) };
}

export function scanClub(league, byId, pool, plan, index) {
  const entry = plan?.clubs?.[index];
  if (!entry) return [];
  const u = plan.user;
  const found = [];
  const greedOf = aiGreed(league.teams[entry.club], league);
  const picks = pickTable(league, byId, entry.club, u, plan.slots);
  for (const c of entry.candidates) {
    const v = validateTrade(league, entry.club, u, c.gives, c.wants, byId, pool);
    if (!v.ok) continue;
    const ev = evaluateTrade(league, entry.club, c.gives, c.wants, byId, pool);
    // A club that says no and cannot be talked round is not worth costing out
    // the human's side for — `slotsAfterTrade` is the dear half of this loop.
    if (!ev.accept && !(picks && ev.delta + best(picks.human) >= greedOf + (ev.premium || 0))) continue;
    const out = slotsAfterTrade(league, u, c.wants, c.gives, pool, byId);
    if (!out) continue;
    let delta = Math.round((lineupStrength(out.slots, byId, league) - plan.base) * 10) / 10;
    let aiGain = ev.delta;
    let userPicks = [], aiPicks = [];
    if (!ev.accept || delta < DEAL_FLOOR) {
      const greed = greedOf + (ev.premium || 0);
      const close = closeWithPick(
        picks, !ev.accept, delta < DEAL_FLOOR,
        greed - ev.delta, DEAL_FLOOR - delta,
      );
      if (!close) continue;
      const { toClub, toHuman, pick } = close.pick;
      if (close.from === 'human') { userPicks = [pick]; aiGain += toClub; delta -= toHuman; }
      else { aiPicks = [pick]; aiGain -= toClub; delta += toHuman; }
      delta = Math.round(delta * 10) / 10;
      aiGain = Math.round(aiGain * 10) / 10;
      // The player half was validated without the picks. Picks cannot unbalance
      // a roster, so this should always hold — but a finder that offers a deal
      // the builder then refuses is the one failure it must not have.
      if (!validateTrade(league, entry.club, u, c.gives, c.wants, byId, pool, { aPicks: aiPicks, bPicks: userPicks }).ok) continue;
    }
    const abbr = league.teams[entry.club].abbr;
    found.push({
      club: entry.club, gives: c.gives, wants: c.wants, userPicks, aiPicks,
      userDelta: delta, aiGain, uneven: !!v.uneven,
      fills: v.uneven ? { signs: v.fills.b.signs.slice(), releases: v.fills.b.releases.slice() } : null,
      note: `${abbr} are thin at ${c.need} and deep at ${c.surplus}.`
        + (userPicks.length ? ' They want next year to go with it.' : '')
        + (aiPicks.length ? ' They will add next year to get it done.' : ''),
    });
  }
  // A deal that needs no pick beats one that does at the same lineup gain: the
  // pick is a real cost the number does not show twice.
  found.sort((a, b) => b.userDelta - a.userDelta
    || (a.userPicks.length + a.aiPicks.length) - (b.userPicks.length + b.aiPicks.length));
  return found;
}

/**
 * The whole sweep in one call. Fine for a script or a test; the screen drives
 * `scanClub` a club at a time instead, because three seconds of blocked main
 * thread is how the draft screen earned its reputation.
 */
export function findDeals(league, byId, pool, { max = 12 } = {}) {
  const plan = dealPlan(league, byId);
  if (!plan) return [];
  const all = [];
  for (let i = 0; i < plan.clubs.length; i++) all.push(...scanClub(league, byId, pool, plan, i));
  all.sort((a, b) => b.userDelta - a.userDelta);
  // One per club: five variations on the same swap is a list nobody reads.
  const seen = new Set();
  const out = [];
  for (const d of all) {
    if (seen.has(d.club)) continue;
    seen.add(d.club);
    out.push(d);
    if (out.length >= max) break;
  }
  return out;
}

/** Whether a found deal still stands — rosters move between finding and pressing. */
export function dealStillValid(league, byId, pool, deal, userIdx) {
  if (!deal || !tradesOpen(league)) return false;
  const A = league.teams[deal.club], U = league.teams[userIdx];
  if (!deal.gives.every((id) => slotOf(A, id)) || !deal.wants.every((id) => slotOf(U, id))) return false;
  // Picks change hands too, and a deal built on one the club has since traded
  // away is not a deal. `validateTrade` checks ownership, but only for the
  // picks it is told about.
  const owns = (picks, idx) => (picks || []).every((p) => futureOwner(league, p.season, p.round, p.from) === idx);
  if (!owns(deal.userPicks, userIdx) || !owns(deal.aiPicks, deal.club)) return false;
  // `validateTrade` takes the sides in the order of its first two arguments,
  // and the club is the first one here — so the club's picks are `aPicks`.
  // Swapped, every deal carrying a pick reported itself as no longer standing,
  // because each side was checked against the other's ownership.
  return validateTrade(league, deal.club, userIdx, deal.gives, deal.wants, byId, pool, {
    aPicks: deal.aiPicks || [], bPicks: deal.userPicks || [],
  }).ok;
}
