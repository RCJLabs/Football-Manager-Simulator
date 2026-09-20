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
  validateTrade, evaluateTrade, lineupStrength, slotsAfterTrade, tradesOpen, slotOf,
} from './transactions.js';

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
  return { user: u, base: lineupStrength(U.slots, byId, league), clubs };
}

/**
 * The expensive half, for one club. Every candidate is put through the real
 * pair of questions: would the club take it, and does it leave the human
 * better off. Returns the deals that pass, best for the human first.
 */
export function scanClub(league, byId, pool, plan, index) {
  const entry = plan?.clubs?.[index];
  if (!entry) return [];
  const u = plan.user;
  const found = [];
  for (const c of entry.candidates) {
    const v = validateTrade(league, entry.club, u, c.gives, c.wants, byId, pool);
    if (!v.ok) continue;
    const ev = evaluateTrade(league, entry.club, c.gives, c.wants, byId, pool);
    if (!ev.accept) continue;
    const out = slotsAfterTrade(league, u, c.wants, c.gives, pool, byId);
    if (!out) continue;
    const delta = Math.round((lineupStrength(out.slots, byId, league) - plan.base) * 10) / 10;
    if (delta < DEAL_FLOOR) continue;
    found.push({
      club: entry.club, gives: c.gives, wants: c.wants,
      userDelta: delta, aiGain: ev.delta, uneven: !!v.uneven,
      fills: v.uneven ? { signs: v.fills.b.signs.slice(), releases: v.fills.b.releases.slice() } : null,
      note: `${league.teams[entry.club].abbr} are thin at ${c.need} and deep at ${c.surplus}.`,
    });
  }
  found.sort((a, b) => b.userDelta - a.userDelta);
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
  return validateTrade(league, deal.club, userIdx, deal.gives, deal.wants, byId, pool).ok;
}
