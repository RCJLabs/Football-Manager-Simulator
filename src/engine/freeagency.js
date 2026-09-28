// The free-agent market, between the keeper round and the draft.
//
// The men on offer are veterans: cut, let go when a deal ran out, never
// re-signed. This year's rookies are not among them — `signablePool` keeps
// them for the draft, or for a pro league's auction. This used to say they were
// the same men who would be in the draft an hour later, so that a bid bought
// only the certainty of a man a pick could have had for rookie money; that
// stopped being true when the draft became the rookie class, and the question
// is plainer now: is this man worth his price, and a pick.
//
// A pick, because nothing had to be written to make signing cost one.
// `settlePointer` skips a club that is already full, so a club drafts once a
// round only while it has a slot open, and once its open slots are no more
// than the draft's rounds — measured, about three clubs in four when the
// market opens — every man it signs here is a pick it does not make. Buy now,
// draft less. A man nobody signs is not lost to the league straight away: a
// slot still empty after the draft is filled from whoever is left at kickoff,
// on the minimum. Whoever is still unsigned after that leaves the league,
// bar a floor of journeymen kept for injuries (`drainAtKickoff`).
//
// Bids are sealed. Everyone puts in an offer, the market settles in one step,
// and the best players settle first — which matters, because a club that wins
// a bidding war has less money for the next man, and that cascade is most of
// what makes the order interesting.

import { ROSTER_SLOTS } from '../data/positions.js';
import { overall, TRUE_LEVERAGE } from './ratings.js';
import { standings } from './season.js';
import { freeAgents, ownerMap, lineupStrength, aiGreed } from './transactions.js';
import { capOn, capHit, capSpace, marketSalary, letGo, deadCharge, teamContractIds, MIN_SALARY, VET_YEARS, SLOT_RESERVE, PRO_CAP } from './cap.js';
import { proPools, signablePool, classYear } from './proleague.js';
import { canStash, stash } from './squad.js';
import { scoutReport } from './scouting.js';
// Not from offseason.js, which imports this file: see the head of terms.js.
import { FA_TERM, aiTerm, termsOpen, termsFor, priceOf } from './terms.js';

/** How long a deal signed in free agency runs when nobody says otherwise. */
export const FA_YEARS = VET_YEARS;

/**
 * An offer is a salary and a length.
 *
 * Every deal signed here used to run `FA_YEARS`, so an offer was a bare
 * number, and a league saved in the middle of its market still holds those.
 * A bare number was always a three-year deal and still reads as one, so
 * nothing needs rewriting on load.
 */
export function offerSalary(offer) {
  return typeof offer === 'number' ? offer : (offer?.salary ?? 0);
}

export function offerYears(offer) {
  if (typeof offer === 'number') return FA_YEARS;
  return FA_TERM[offer?.years] ? offer.years : FA_YEARS;
}

/**
 * What a man asks a year to sign for this long, given what he asks for three.
 *
 * The re-signing curve with the re-signing premium taken out, because nobody
 * here has an exclusive window to charge for: `FA_TERM` is `TERM_PRICE` over
 * its own three-year figure. So three years is market exactly, as it always
 * was, two is about 8% more a year and five about 12% less.
 *
 * Rounded up, like every other price in the game, so a cheap man gets no
 * discount for length — five years at a $5 market is still $5 — and pays a
 * whole dollar more for two. `priceOf` keeps float error off the ceiling.
 */
export function askAt(market, years = FA_YEARS) {
  return priceOf(market, FA_TERM[years] ?? 1);
}

/** The same, from the player. */
export function askFor(player, years = FA_YEARS) {
  return askAt(marketSalary(player), years);
}

/**
 * How good an offer is from where HE sits: how far it clears what he asked
 * for that length.
 *
 * Comparing salaries would hand every contested man to whoever offered two
 * years, since a short deal costs more a year by construction. Comparing each
 * offer to its own asking price makes every offer at the asking price exactly
 * as good as every other, whatever its length, and ranks the rest by how far
 * over they go. It has to be the rounded ask rather than the curve itself:
 * against the curve, a five-year offer at a $5 ask reads as 13% over a
 * three-year one at the same ask and wins a tie it should have split — the
 * ceiling would be deciding contested signings.
 */
export function offerValue(market, offer) {
  const ask = askAt(market, offerYears(offer));
  return ask > 0 ? offerSalary(offer) / ask : 0;
}

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
 * How much better a man left over by the market has to be than a starter for
 * an AI club to take him at kickoff (`kickoffUpgrades`). The wire asked two
 * points and a lineup gain of six, week after week; this happens once, so it
 * asks for a real improvement, and five is the margin the holes it closes were
 * measured at (DESIGN.md, "How even is the league, really").
 */
export const UPGRADE_MARGIN = 5;

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
    // `ask` is the three-year price, which is what the board sorts and shows;
    // `askAt` turns it into any other length.
    .map((p) => ({ id: p.id, pos: p.pos, ovr: overall(p), ask: marketSalary(p) }))
    .sort((a, b) => b.ask - a.ask || b.ovr - a.ovr)
    .slice(0, limit);
}

/**
 * What a club already owes, plus everything it has bid for. This season's
 * money only: a longer deal is cheaper this year, and next year's cap is next
 * year's keeper round.
 */
export function committed(league, teamIdx) {
  const offers = league.freeAgency?.offers?.[teamIdx] || {};
  let bid = 0;
  for (const offer of Object.values(offers)) bid += offerSalary(offer);
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
 * button works without a second entry point. The length defaults to the old
 * flat three years, so a caller that has never heard of lengths offers what it
 * always did.
 */
export function submitOffer(league, teamIdx, playerId, salary, byId, years = FA_YEARS) {
  if (!league.freeAgency || league.freeAgency.closed) return { ok: false, reason: 'The market is closed' };
  const fa = league.freeAgency;
  fa.offers[teamIdx] ??= {};
  const player = byId?.get(playerId);
  if (!player) return { ok: false, reason: 'No such player' };
  if (ownerMap(league).has(playerId)) return { ok: false, reason: `${player.name} is on a roster` };
  if (salary == null || salary <= 0) { delete fa.offers[teamIdx][playerId]; return { ok: true, withdrawn: true }; }
  if (!termsFor(league).includes(years)) {
    return { ok: false, reason: termsOpen(league) ? `No ${years}-year deals` : `Every deal here runs ${FA_YEARS} years` };
  }
  const ask = askFor(player, years);
  if (salary < ask) return { ok: false, reason: `${player.name} is asking $${ask} a year for ${years} years` };
  const team = league.teams[teamIdx];
  if (!ROSTER_SLOTS.some((s) => s.pos === player.pos && !team.slots[s.id])) {
    return { ok: false, reason: `No open ${player.pos} slot` };
  }
  const previous = fa.offers[teamIdx][playerId];
  delete fa.offers[teamIdx][playerId];
  const room = biddingRoom(league, teamIdx);
  if (salary > room) {
    if (previous != null) fa.offers[teamIdx][playerId] = previous;
    return { ok: false, reason: `That leaves you $${room} to bid, and the rest of the roster still to fill` };
  }
  fa.offers[teamIdx][playerId] = { salary, years };
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
 * How a club would make room at kickoff for a man the market left over, at a
 * position it has filled: he takes the weakest starter's slot, the starter
 * drops to the bench in place of the position's weakest backup if he is better
 * than him, and whoever is left spare goes. Null when the club has an open
 * slot for him, which the fill takes care of, or nobody he beats by
 * `UPGRADE_MARGIN`. Only quarterback, back and receiver have a bench slot, so
 * everywhere else the old starter is the man who goes.
 *
 * This year's draft class is never the man who makes way, as the starter or
 * as the backup let go: a club does not cut or bury a pick it made weeks ago
 * for a veteran on a one-year minimum. Allowed to, the top-up took rookie
 * starters from two to four a club to under one, filled every practice squad
 * by the fourth season, and by the eighth had half of a club's roster signed
 * off the scrap heap (DESIGN.md, "The kickoff top-up").
 */
export function upgradePlan(league, teamIdx, player, byId) {
  const team = league.teams[teamIdx];
  const at = ROSTER_SLOTS.filter((s) => s.pos === player.pos);
  if (at.some((s) => !team.slots[s.id])) return null;
  const holder = (s) => byId.get(team.slots[s.id]);
  const pick = (p) => !!p.generated && p.draftClass === classYear(league.season);
  const starters = at.filter((s) => s.starter && holder(s) && !pick(holder(s)));
  if (!starters.length) return null;
  const weakest = starters.reduce((w, s) => (overall(holder(s)) < overall(holder(w)) ? s : w));
  const starter = holder(weakest);
  if (overall(player) < overall(starter) + UPGRADE_MARGIN) return null;
  const bench = at.filter((s) => !s.starter && holder(s));
  const worst = bench.length ? bench.reduce((w, s) => (overall(holder(s)) < overall(holder(w)) ? s : w)) : null;
  const demote = worst && overall(holder(worst)) < overall(starter) && !pick(holder(worst)) ? worst : null;
  const slots = { ...team.slots, [weakest.id]: player.id };
  if (demote) slots[demote.id] = starter.id;
  const gain = lineupStrength(slots, byId, null) - lineupStrength(team.slots, byId, null);
  return { gain, slot: weakest.id, starter: starter.id, demote: demote ? demote.id : null, release: demote ? team.slots[demote.id] : starter.id };
}

/**
 * Carry out a replacement: the spare man goes to the practice squad if he is
 * young enough, as a waiver claim's drop does, and is let go otherwise; the
 * old starter takes his place on the bench. The caller puts the new man in
 * the starter's slot.
 */
export function makeRoom(league, teamIdx, plan, byId) {
  const team = league.teams[teamIdx];
  if (canStash(league, teamIdx, plan.release, byId)) stash(league, teamIdx, plan.release, byId);
  else {
    const held = ROSTER_SLOTS.find((s) => team.slots[s.id] === plan.release);
    letGo(league, teamIdx, plan.release);
    if (held) team.slots[held.id] = null;
    (league.transactions ??= []).push({ week: 0, season: league.season, type: 'release', team: teamIdx, add: null, drop: plan.release });
  }
  if (plan.demote) team.slots[plan.demote] = plan.starter;
}

/** Who the market left over, by position and best first, as they stand now. */
function leftovers(league, pool, byId) {
  const owned = new Set(league.teams.flatMap((_, i) => teamContractIds(league, i)));
  const left = new Map();
  for (const raw of signablePool(league, pool)) {
    if (owned.has(raw.id)) continue;
    const p = byId.get(raw.id) || raw;
    if (p.retired) continue;
    if (!left.has(p.pos)) left.set(p.pos, []);
    left.get(p.pos).push(p);
  }
  for (const list of left.values()) list.sort((a, b) => overall(b) - overall(a));
  return left;
}

/** Sign a leftover into the place `plan` made for him, on the minimum for a year. */
function takeLeftover(league, teamIdx, man, plan, byId) {
  makeRoom(league, teamIdx, plan, byId);
  league.teams[teamIdx].slots[plan.slot] = man.id;
  if (capOn(league)) {
    league.contracts ??= {};
    league.contracts[man.id] = { salary: MIN_SALARY, years: 1, round: ROSTER_SLOTS.length, kept: 0, since: league.season };
  }
  (league.transactions ??= []).push({ week: 0, season: league.season, type: 'fill', team: teamIdx, add: man.id, drop: plan.release });
  return { team: teamIdx, add: man.id, drop: plan.release };
}

/**
 * The market's last word, just before the kickoff drain: a club takes a man
 * the market left over who beats one of its starters by `UPGRADE_MARGIN`, on
 * the minimum for a year, which is what the fill signs anybody on.
 *
 * Before the drain these men sat on the waiver wire all season and clubs
 * claimed them there on the same terms. That topped the league up, but it did
 * it during the season, worst club first, and scrambled the table. Draining
 * them at kickoff without this took the top-up away, and the league shed
 * talent it had nowhere to put: the average club's power fell four to five
 * points further by the seventh season. Here the same top-up happens before a
 * game is played, clubs in waiver order, after the fill has seen to every
 * empty slot.
 *
 * The human's club takes its turn in the same order, under the same rule and
 * on the same terms, but only for the men marked on the market's last screen
 * (`league.kickoffWants`; see `kickoffChoices`), because nobody else decides
 * who joins it. `staff` puts the human's club on the computer's rule when
 * nothing is marked, which is what simulating through an offseason means: the
 * draft was run for you, and so is this. The marks are spent here either way.
 */
export function kickoffUpgrades(league, pool, byId, { staff = false } = {}) {
  const wants = league.kickoffWants || [];
  delete league.kickoffWants;
  if (!proPools(league) || !pool || !byId) return [];
  const left = leftovers(league, pool, byId);
  const worth = (pos) => TRUE_LEVERAGE[pos] ?? 1;
  const positions = [...left.keys()].sort((a, b) => worth(b) - worth(a));
  const order = league.waiverOrder?.length === league.teams.length ? league.waiverOrder : league.teams.map((_, i) => i);
  const signed = [];
  for (const ti of order) {
    const team = league.teams[ti];
    if (!team) continue;
    if (team.isUser && (wants.length || !staff)) {
      // Best first, so two men marked at one position take its two weakest
      // places in the right order whichever was marked first.
      const marked = wants.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => overall(b) - overall(a));
      for (const p of marked) {
        const list = left.get(p.pos) || [];
        const at = list.findIndex((x) => x.id === p.id);
        if (at < 0) continue;
        const plan = upgradePlan(league, ti, list[at], byId);
        if (!plan || plan.gain <= 0) continue;
        signed.push(takeLeftover(league, ti, list.splice(at, 1)[0], plan, byId));
      }
      continue;
    }
    for (const pos of positions) {
      const list = left.get(pos);
      while (list.length) {
        const plan = upgradePlan(league, ti, list[0], byId);
        if (!plan || plan.gain <= 0) break;
        signed.push(takeLeftover(league, ti, list.shift(), plan, byId));
      }
    }
  }
  return signed;
}

/**
 * What the market's last screen offers the human: every leftover who beats one
 * of the club's starters by `UPGRADE_MARGIN` as things stand, the biggest gain
 * first, with the place he would take and what becomes of the man in it — the
 * practice squad, or released with whatever is still owed him.
 *
 * As things stand, because kickoff moves them: clubs fill their empty slots
 * first and then take these men in waiver order, so a man on the list can be
 * gone by the human's turn, and a second man marked at a position is measured
 * against whoever is weakest once the first has been signed.
 *
 * Only men the club can see: a generated man nobody has had through a season
 * is still a projection, and offering him only if he truly beats a starter by
 * five would tell the human what the projection is hiding.
 */
export function kickoffChoices(league, pool, byId, teamIdx) {
  if (!proPools(league) || !pool || !byId || !league.teams[teamIdx]) return [];
  const out = [];
  for (const list of leftovers(league, pool, byId).values()) {
    for (const p of list) {
      const plan = upgradePlan(league, teamIdx, p, byId);
      // Every man at a position is measured against the same starter, and
      // the list is best first, so the first who falls short ends it.
      if (!plan) break;
      if (plan.gain <= 0 || !scoutReport(league, p, teamIdx).known) continue;
      const squad = canStash(league, teamIdx, plan.release, byId);
      out.push({ player: p, plan, squad, dead: squad ? null : deadCharge(league.contracts?.[plan.release]) });
    }
  }
  return out.sort((a, b) => b.plan.gain - a.plan.gain);
}

/** Mark a leftover for the human's club to take at kickoff, or unmark him. */
export function markKickoffWant(league, id, on = true) {
  const wants = (league.kickoffWants || []).filter((x) => x !== id);
  if (on) wants.push(id);
  if (wants.length) league.kickoffWants = wants;
  else delete league.kickoffWants;
  return wants;
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
      // The length first, because it sets the asking price the premium is
      // put on: the rule the keeper round uses, so a club buys a man the same
      // way whichever door he comes in by. Three years wherever nobody ages.
      const years = termsOpen(league) ? aiTerm(league, p) : FA_YEARS;
      const ask = askAt(row.ask, years);
      // The more he adds, the further over the asking price this club will go.
      const eagerness = Math.min(1, gain / 60) + (rng ? rng.normal(0, 0.06) : 0);
      const bid = Math.round(ask * (1 + Math.max(0, Math.min(MAX_PREMIUM, eagerness * MAX_PREMIUM))));
      const r = submitOffer(league, ti, p.id, Math.max(ask, bid), byId, years);
      if (r.ok) taken++;
    }
  }
}

/**
 * Settle the market: dearest man first, best offer wins.
 *
 * Order matters and is not arbitrary. Settling the best players first means a
 * club that wins a bidding war is poorer for the next one, which is what makes
 * overpaying for a star a real choice rather than a free one. "Best" is
 * `offerValue` — furthest over his asking price for that length — and ties go
 * to the worse record, the same priority the waiver wire uses.
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
      const offer = offers[row.id];
      const salary = offerSalary(offer);
      if (!salary) continue;
      const team = league.teams[ti];
      const slot = ROSTER_SLOTS.find((s) => s.pos === row.pos && !team.slots[s.id]);
      if (!slot) continue;
      // The money has to still be there: an earlier win may have spent it.
      if (capSpace(league, ti) - salary < (openCount(team) - 1) * SLOT_RESERVE) continue;
      bids.push({ ti, salary, years: offerYears(offer), value: offerValue(row.ask, offer), slot });
    }
    if (!bids.length) continue;
    bids.sort((a, b) => b.value - a.value || (rank.get(a.ti) ?? 99) - (rank.get(b.ti) ?? 99));
    const win = bids[0];
    league.teams[win.ti].slots[win.slot.id] = row.id;
    league.contracts ??= {};
    league.contracts[row.id] = { salary: win.salary, years: win.years, round: ROSTER_SLOTS.length, kept: 0, since: league.season };
    league.transactions ??= [];
    league.transactions.push({ week: 0, season: league.season, type: 'sign', team: win.ti, add: row.id, drop: null });
    signed.push({
      // `ask` is his price for the length he signed, so `salary >= ask` holds
      // for a five-year deal that is under his three-year market.
      team: win.ti, id: row.id, salary: win.salary, years: win.years, ask: askAt(row.ask, win.years), market: row.ask,
      bidders: bids.length, round,
      // Who missed out, and for how much. Recorded here rather than worked out
      // afterwards from leftover offers, because the losing offers are about to
      // be torn up — which is why the report used to say a club had lost
      // nothing on a night it had been outbid four times. The length rides
      // along because a bigger salary can now lose to a smaller one, and a
      // report that showed only the money would read as the market cheating.
      underbid: bids.slice(1).map((b) => ({ team: b.ti, salary: b.salary, years: b.years, tie: b.value === win.value })),
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
    // Results written before lengths existed carry neither field: every deal
    // was three years, and a tie was two equal salaries.
    if (mine) {
      lost.push({
        id: r.id, bid: mine.salary, years: mine.years ?? FA_YEARS, to: r.team, at: r.salary, atYears: r.years ?? FA_YEARS,
        tie: mine.tie ?? mine.salary === r.salary,
      });
    }
  }
  return { won, lost };
}

/** A club with nothing left to bid and no slots is done; the screen says so. */
export function userDone(league, teamIdx) {
  return openCount(league.teams[teamIdx]) === 0 || biddingRoom(league, teamIdx) < MIN_SALARY;
}
