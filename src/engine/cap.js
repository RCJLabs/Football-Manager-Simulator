// Money in the pro league.
//
// A fantasy league has had an economy since the auction shipped: every player
// carries a price he was bought for, keepers cost that price plus a raise, and
// a $200 budget across twenty-seven slots forces the trade-offs. The pro league
// had none of it. `contracts[id]` there stored a draft *round* and no money at
// all, `keeperCost` fell through to the minimum bid, and clubs kept eighteen of
// twenty-seven men a year for free. A good pro roster therefore stayed good
// forever: nothing ever made you choose.
//
// The cap is that missing constraint. It is deliberately the same $200 over
// twenty-seven slots as the auction, so the price guide the auction already
// calibrates — what a player is worth, in those units — prices a veteran here
// without a second valuation model being invented.
//
// The shape of the thing is a rookie scale. A drafted player is cheap for four
// years and then costs what he is worth, which is what makes a draft pick an
// asset rather than a formality, and what gives the uneven pick trades in
// draftpicks.js a second currency: moving up costs cap space as well as picks.

import { ROSTER_SLOTS } from '../data/positions.js';
import { overall } from './ratings.js';
import { TRUE_LEVERAGE } from './auction.js';
import { irList } from './injuries.js';
import { squadList } from './squad.js';

/** The cap, in the same dollars the auction's price guide speaks. */
export const PRO_CAP = 200;

/** What the cheapest possible contract costs. Twenty-seven of these is 27. */
export const MIN_SALARY = 1;

/** How long a drafted player stays on his rookie deal. */
export const ROOKIE_YEARS = 4;

/** How long a contract signed off the street runs. */
export const VET_YEARS = 3;

/**
 * The rookie scale: what the first pick costs, and how fast it decays.
 *
 * Tuned against one requirement — a roster of nothing but rookies has to leave
 * room for veterans, or no club can ever re-sign anybody and the cap is
 * decoration. At these numbers a full drafted roster costs about 101 of the
 * 200, near enough half, and that holds at eight, twelve and thirty-two clubs
 * because the curve is over the *fraction* of the draft rather than the pick
 * number. The first pick costs 20, a tenth of everything a club has; round
 * four costs 10; from round fifteen on it is the minimum. Steeper curves were
 * tried and are worse at the top (TOP=14 makes the first pick worth 13, which
 * is not a decision), and shallower ones spend the whole cap on rookies.
 */
export const ROOKIE_TOP = 20;
export const ROOKIE_CURVE = 5;

/**
 * What an established player costs on the open market.
 *
 * Leverage times rating over a replacement level, which is the same shape the
 * auction's price guide has — this is not a second valuation model, it is that
 * one arithmetic rather than simulated, so it can be asked cheaply wherever a
 * contract is written.
 *
 * Calibrated against one number: a drafted roster priced entirely at market
 * costs 104% to 114% of the cap. That is deliberately just over. A club cannot
 * field a side of men all paid what they are worth, so every roster is part
 * bargain and part rookie deal, which is the whole point of having a cap. A
 * star quarterback at 87 costs 44, a fifth of everything a club has; an
 * 88-rated kicker costs 2, because leverage says he is worth about that.
 */
export const MARKET_RATE = 0.09;
export const REPLACEMENT_OVR = 60;
export const MAX_SALARY = 50;

export function marketSalary(player, slot = null) {
  if (!player) return MIN_SALARY;
  const lev = TRUE_LEVERAGE[player.pos] ?? 1;
  const over = Math.max(0, overall(player) - REPLACEMENT_OVR);
  const bench = slot && !slot.starter ? 0.4 : 1;
  return Math.max(MIN_SALARY, Math.min(MAX_SALARY, Math.round(MARKET_RATE * lev * over * bench)));
}

/**
 * What a club must leave for each slot it has not filled.
 *
 * The keeper round happens before the draft, so it has to hold money back for
 * the picks still to come. Reserving the minimum was the first guess and it is
 * too little: a drafted roster averages about 101 over 27 slots, so a pick
 * costs nearer four than one, and clubs that kept right up to the line arrived
 * at kickoff a point or two over with nothing left worth cutting.
 */
export const SLOT_RESERVE = 4;

/** Whether this league counts money. The fantasy league has the auction instead. */
export function capOn(league) {
  return league?.mode === 'pro';
}

/**
 * Total picks in the draft the scale is measured against.
 *
 * It has to be the draft actually being held, not the roster. A founding draft
 * stocks every slot and runs the full twenty-seven rounds, but a pro league's
 * rookie draft is a handful of rounds over one class, and pricing those picks
 * as though they were the first few of 864 put the whole class in the
 * expensive top eleventh of the curve. Measured on a second-season draft: a
 * 49-rated punter taken in the last round was paid 12 of a 200 cap against a
 * market value of 1, and the class cost its clubs 1,040 against the 151 it was
 * worth — near enough seven times over. Measured against its own draft the
 * same punter costs the minimum and the class costs 324 against 165, which is
 * the premium a pick is supposed to carry rather than a penalty for having one.
 */
export function draftSize(league) {
  const rounds = league?.draft?.rounds ?? ROSTER_SLOTS.length;
  return Math.max(2, rounds * (league?.teams?.length || 1));
}

/** What a player drafted at `overallPick` costs on his rookie deal. */
export function rookieSalary(overallPick, totalPicks) {
  if (!Number.isFinite(overallPick) || !Number.isFinite(totalPicks) || totalPicks < 2) return MIN_SALARY;
  const frac = Math.min(1, Math.max(0, (overallPick - 1) / (totalPicks - 1)));
  return Math.max(MIN_SALARY, Math.round(ROOKIE_TOP * (1 - frac) ** ROOKIE_CURVE));
}

/**
 * What a club keeps paying for a man it cut.
 *
 * Without this a cut is free: the contract is simply deleted and the money
 * comes straight back. That is the one thing that stopped contracts from
 * meaning anything on the wire. With the keeper round fixed so a man under
 * contract is kept by default, the churn did not stop, it moved — of 105
 * rookies on rosters at one kickoff, 51 were gone a year later and 36 of those
 * went on in-season waivers, because `aiFileClaims` will drop anyone for a free
 * agent two points better and it costs the club nothing to do it.
 *
 * Half the money follows him, for the years that were left. It is the real
 * game's shape without the real game's machinery: there is no signing bonus
 * here to prorate and accelerate, so half a deal is the plain stand-in for the
 * guaranteed part of one.
 *
 * Floored rather than rounded, so a minimum deal leaves no bill at all. That
 * matters for more than tidiness: `cutToCap` sheds salary until a club fits,
 * and a cut that freed nothing would let it loop without ever converging. At
 * half, a cut always frees at least as much as it costs.
 */
export const DEAD_SHARE = 0.5;

/** The bill for cutting this man, or null if walking away costs nothing. */
export function deadCharge(contract) {
  if (!contract || contract.expiring || (contract.years ?? 0) <= 0) return null;
  const amount = Math.floor((contract.salary ?? MIN_SALARY) * DEAD_SHARE);
  if (amount <= 0) return null;
  return { amount, years: contract.years };
}

/**
 * Book what a club owes a man it is letting go.
 *
 * Called at the three places a roster actually loses somebody it was still
 * paying: the cap shed at kickoff, a drop on the waiver wire, and the keeper
 * round. Retirement is not one of them — a man who stops playing stops being
 * owed — and neither is a trade, where the contract goes with him.
 */
export function bookDead(league, teamIdx, id, contract) {
  if (!capOn(league)) return null;
  const charge = deadCharge(contract);
  if (!charge) return null;
  league.dead ??= {};
  (league.dead[teamIdx] ??= []).push({ id, amount: charge.amount, years: charge.years });
  return charge;
}

/** What a club is still paying men who are no longer on it. */
export function deadHit(league, teamIdx) {
  if (!capOn(league)) return 0;
  let total = 0;
  for (const d of league.dead?.[teamIdx] || []) total += d.amount;
  return total;
}

/**
 * Run the dead money down a year alongside the live contracts, and forget
 * whatever has finished being paid.
 */
export function tickDead(league) {
  if (!capOn(league) || !league.dead) return 0;
  let cleared = 0;
  for (const [team, list] of Object.entries(league.dead)) {
    const left = [];
    for (const d of list) {
      const years = (d.years ?? 1) - 1;
      if (years > 0) left.push({ ...d, years }); else cleared += d.amount;
    }
    if (left.length) league.dead[team] = left; else delete league.dead[team];
  }
  return cleared;
}

/** Every contract a club is paying, roster and injured reserve alike. */
export function teamContractIds(league, teamIdx) {
  const t = league.teams[teamIdx];
  if (!t) return [];
  return [...ROSTER_SLOTS.map((s) => t.slots[s.id]), ...irList(t), ...squadList(t)].filter(Boolean);
}

/** What a club is spending. A man on IR is still on the books. */
export function capHit(league, teamIdx) {
  if (!capOn(league)) return 0;
  const c = league.contracts || {};
  let total = 0;
  // A man on the practice squad is paid the minimum while he is down there,
  // whatever his deal says. That is what makes stashing a first-round pick
  // affordable rather than a second way of paying him not to play — and his
  // contract is untouched, so it costs what it says again the day he comes up.
  const down = new Set(squadList(league.teams?.[teamIdx]));
  for (const id of teamContractIds(league, teamIdx)) {
    total += down.has(id) ? MIN_SALARY : (c[id]?.salary ?? MIN_SALARY);
  }
  // Men a club is no longer playing but is still paying count against it, which
  // is the whole point of them.
  return total + deadHit(league, teamIdx);
}

/** What a club has left. Negative means it is over and has to shed. */
export function capSpace(league, teamIdx) {
  if (!capOn(league)) return Infinity;
  return (league.cap ?? PRO_CAP) - capHit(league, teamIdx);
}

export function overCap(league, teamIdx) {
  return capOn(league) && capSpace(league, teamIdx) < 0;
}

/**
 * What a club will be paying once its empty slots are filled.
 *
 * `cutToCap` has to ask this rather than `capHit`, because it is cutting men
 * into empty slots that `fillOpenSlots` is about to put somebody in. Judging
 * on the hit alone let a club cut its way to exactly the cap and then go a
 * point or two over when the replacements signed — which is how one club in a
 * thirty-two club league sat at 201 of 200 at kickoff.
 */
export function projectedHit(league, teamIdx) {
  if (!capOn(league)) return 0;
  const t = league.teams[teamIdx];
  const empty = ROSTER_SLOTS.filter((s) => !t.slots[s.id]).length;
  return capHit(league, teamIdx) + empty * MIN_SALARY;
}

/**
 * Run every contract down a year and mark whoever's deal is up.
 *
 * The man is *not* released here, and that is the point. Emptying his slot was
 * the first attempt and it made the cap decoration: a star whose deal expired
 * simply went back in the pool and was re-drafted at rookie-scale money, so
 * keeping good players never cost anything and no club was ever squeezed.
 * Marking him expiring instead means he is still yours to keep — at what he is
 * now worth, through `keeperCost`. That is the only thing in a salary cap that
 * actually bites.
 */
export function expireContracts(league) {
  if (!capOn(league)) return [];
  league.contracts ??= {};
  const expiring = [];
  for (const [i, t] of league.teams.entries()) {
    for (const s of ROSTER_SLOTS) {
      const id = t.slots[s.id];
      if (!id) continue;
      const c = league.contracts[id];
      if (!c) continue;
      c.years = (c.years ?? VET_YEARS) - 1;
      if (c.years > 0) continue;
      c.years = 0;
      c.expiring = true;
      expiring.push({ team: i, id, slot: s.id });
    }
  }
  return expiring;
}

/**
 * What a club would miss least, per dollar it frees.
 *
 * Leverage-weighted rating over salary, so the man cut is the one paid most
 * for what he adds rather than simply the worst player — a minimum-salary
 * punter is poor value in the abstract and frees nothing at all.
 */
function worstValue(league, teamIdx, byId) {
  const t = league.teams[teamIdx];
  let worst = null;
  for (const s of ROSTER_SLOTS) {
    const id = t.slots[s.id];
    if (!id) continue;
    const salary = league.contracts?.[id]?.salary ?? MIN_SALARY;
    if (salary <= MIN_SALARY) continue;   // cutting him frees nothing
    const p = byId.get(id);
    if (!p) continue;
    const worth = overall(p) * (TRUE_LEVERAGE[p.pos] ?? 1) * (s.starter ? 1 : 0.25);
    const ratio = worth / salary;
    if (!worst || ratio < worst.ratio) worst = { id, slot: s.id, salary, ratio };
  }
  return worst;
}

/**
 * Release players until a club fits, cheapest loss first.
 *
 * The slot is left open on purpose: `fillOpenSlots` signs a minimum-salary
 * replacement off the board straight after, which is what makes this converge
 * — every cut trades a real salary for a dollar. A club with nothing but
 * minimum contracts cannot get under the cap by cutting, and that is not a
 * state the scale can produce, but the loop is bounded anyway.
 */
export function cutToCap(league, teamIdx, byId) {
  if (!capOn(league) || !byId) return [];
  const released = [];
  let guard = 0;
  const cap = league.cap ?? PRO_CAP;
  while (projectedHit(league, teamIdx) > cap && guard++ < ROSTER_SLOTS.length) {
    const cut = worstValue(league, teamIdx, byId);
    if (!cut) break;
    league.teams[teamIdx].slots[cut.slot] = null;
    // Book what is still owed before the contract goes, or the bill is lost
    // with it. A cut at half pay still frees half, so the loop converges.
    bookDead(league, teamIdx, cut.id, league.contracts?.[cut.id]);
    delete league.contracts?.[cut.id];
    released.push({ team: teamIdx, id: cut.id, slot: cut.slot, salary: cut.salary });
    league.transactions ??= [];
    league.transactions.push({ week: 0, season: league.season, type: 'cut', team: teamIdx, add: null, drop: cut.id });
  }
  return released;
}
