// The offseason: contracts expire, each club keeps a few players at a raised
// price, everyone else goes back into the pool, and a market (auction or draft)
// fills the open slots under the same $200 cap. Then a new season starts.
//
// Keeper rules, deliberately the common fantasy ones:
//   - keep up to `settings.keepers` players
//   - an auction keeper costs last year's price plus the greater of $3 or 15%
//   - a player can be kept three seasons running, then he must return to the pool
//   - in a draft league keepers simply hold their slots; the draft runs worst to first
// The pool is one snapshot per player, so there is no aging: the churn these
// rules force is what makes one season feel different from the next.

import { ROSTER_SLOTS } from '../data/positions.js';
import { GM_PERSONALITIES } from '../data/teams.js';
import { overall } from './ratings.js';
import { RNG } from './rng.js';
import { emptyTeamStats } from './stats.js';
import { createAuction, priceGuide, DEFAULT_BUDGET, MIN_BID } from './auction.js';
import { createDraft } from './draft.js';
import { standings, syncContracts, userTeamIndex } from './season.js';
import { clearIr } from './injuries.js';

export const MAX_KEEPS = 3;
export const KEEPER_RAISE_MIN = 3;
export const KEEPER_RAISE_PCT = 0.15;
/** How far over market an AI club will go to keep a player rather than bid for him again. */
export const BIRD_IN_HAND = 1.15;

/** What keeping a player costs next season. */
export function keeperCost(contract) {
  const salary = contract?.salary ?? MIN_BID;
  return Math.max(salary + KEEPER_RAISE_MIN, Math.ceil(salary * (1 + KEEPER_RAISE_PCT)));
}

export function keeperLimit(league) {
  return league.settings?.keepers ?? (league.mode === 'pro' ? 18 : 6);
}

export function keeperEligible(contract) {
  return (contract?.kept ?? 0) < MAX_KEEPS;
}

/**
 * Check a keeper list for one club: count, eligibility, ownership, and in an
 * auction league the cap (keepers plus $1 for every open slot must fit).
 */
export function validateKeepers(league, teamIdx, ids) {
  const team = league.teams[teamIdx];
  const limit = keeperLimit(league);
  if (new Set(ids).size !== ids.length) return { ok: false, reason: 'A player is listed twice' };
  if (ids.length > limit) return { ok: false, reason: `At most ${limit} keepers` };
  const owned = new Set(ROSTER_SLOTS.map((s) => team.slots[s.id]).filter(Boolean));
  for (const id of ids) {
    if (!owned.has(id)) return { ok: false, reason: `${id} is not on the roster` };
    if (!keeperEligible(league.contracts[id])) return { ok: false, reason: `${id} has been kept ${MAX_KEEPS} years and must return to the pool` };
  }
  if (league.draftType === 'auction') {
    const cap = league.auction?.budget ?? DEFAULT_BUDGET;
    const committed = ids.reduce((s, id) => s + keeperCost(league.contracts[id]), 0);
    const open = ROSTER_SLOTS.length - ids.length;
    if (committed + open * MIN_BID > cap) return { ok: false, reason: `Keepers cost $${committed}; that leaves less than $1 a slot for the other ${open}`, committed };
    return { ok: true, committed, budget: cap - committed };
  }
  return { ok: true, committed: 0 };
}

/**
 * Open the offseason after a season is complete: contracts are synced (waiver
 * pickups land on $1 deals), and the AI clubs choose their keepers now so the
 * human can see the whole picture before choosing theirs.
 */
export function enterOffseason(league, pool, byId) {
  if (league.phase !== 'complete') throw new Error('The season is not over');
  // Injured reserve empties: anyone whose slot was filled behind him is let go.
  const released = clearIr(league, byId);
  syncContracts(league);
  const rng = new RNG(league.rngState);
  const keepers = {};
  league.teams.forEach((t, i) => { if (!t.isUser) keepers[i] = aiKeepers(league, i, pool, byId, rng); });
  league.rngState = rng.state;
  league.offseason = { season: league.season, step: 'keepers', keepers, user: null, releasedFromIr: released };
  league.phase = 'offseason';
  return league.offseason;
}

/**
 * What the market would say a player is worth at a fresh auction, before
 * anyone has bought anything: the same price guide the auction uses, run over
 * empty rosters. `worth` is real value; `prices` is reputation.
 */
export function freshGuide(league, pool) {
  const blankLeague = { teams: league.teams.map(() => ({ slots: {} })) };
  const blankAuction = { taken: {}, budgets: league.teams.map(() => league.auction?.budget ?? DEFAULT_BUDGET) };
  return priceGuide(blankAuction, blankLeague, pool);
}

/**
 * AI keepers: rank the roster by surplus (what the player is worth minus what
 * keeping him costs), through the GM's taste and savvy, and keep the best
 * bargains that fit under the cap. In a draft league it is simply the best
 * players by overall, with the same taste.
 */
export function aiKeepers(league, teamIdx, pool, byId, rng = null) {
  const team = league.teams[teamIdx];
  const gm = GM_PERSONALITIES.find((g) => g.id === team.gm) || GM_PERSONALITIES[0];
  const limit = keeperLimit(league);
  const roster = ROSTER_SLOTS.map((s) => team.slots[s.id]).filter((id) => id && keeperEligible(league.contracts[id])).map((id) => byId.get(id)).filter(Boolean);
  const taste = (p) => (gm.pos[p.pos] ?? 1) * (gm.era ? gm.era(p.season) : 1);
  if (league.draftType !== 'auction') {
    return roster.map((p) => ({ p, v: overall(p) * taste(p) + (rng ? rng.normal(0, 1) : 0) })).sort((a, b) => b.v - a.v).slice(0, limit).map((x) => x.p.id);
  }
  const guide = freshGuide(league, pool);
  const savvy = { modern: 0.7, trenches: 0.62, defense: 0.5, balanced: 0.34, gambler: 0.26, ground: 0.16, oldschool: 0.18, airraid: 0.1 }[team.gm] ?? 0.3;
  const cap = league.auction?.budget ?? DEFAULT_BUDGET;
  const scored = roster.map((p) => {
    const cost = keeperCost(league.contracts[p.id]);
    const market = (guide.worth.get(p.id) ?? 1) * savvy + (guide.prices.get(p.id) ?? 1) * (1 - savvy);
    // A bird in hand: a club pays a little over market to skip the auction's risk.
    const surplus = market * taste(p) * BIRD_IN_HAND - cost + (rng ? rng.normal(0, 1.5) : 0);
    return { id: p.id, cost, surplus };
  }).filter((x) => x.surplus > 0).sort((a, b) => b.surplus - a.surplus);
  const keep = [];
  let committed = 0;
  for (const x of scored) {
    if (keep.length >= limit) break;
    const open = ROSTER_SLOTS.length - keep.length - 1;
    if (committed + x.cost + open * MIN_BID > cap) continue;
    keep.push(x.id);
    committed += x.cost;
  }
  return keep;
}

/**
 * Lock in the human's keepers and open the market. Keepers move to the front
 * of their position groups; everyone else goes back to the pool; contracts
 * of kept players are raised and their keep count ticks; the auction gets
 * each club's leftover cap and the draft runs worst to first. The league is
 * left in the draft phase with a new season number, exactly where the auction
 * and draft screens expect to find it.
 */
export function confirmKeepers(league, userIds, pool, byId) {
  if (league.phase !== 'offseason' || !league.offseason) throw new Error('Not in the offseason');
  const u = userTeamIndex(league);
  const v = validateKeepers(league, u, userIds);
  if (!v.ok) throw new Error(v.reason);
  const keepers = { ...league.offseason.keepers, [u]: userIds.slice() };
  const table = standings(league).map((r) => r.idx);

  const contracts = {};
  const taken = {};
  const budgets = [];
  league.teams.forEach((t, i) => {
    const ids = keepers[i] || [];
    const byPos = {};
    for (const id of ids) (byPos[byId.get(id).pos] ??= []).push(id);
    const slots = {};
    for (const s of ROSTER_SLOTS) slots[s.id] = (byPos[s.pos] || []).shift() || null;
    t.slots = slots;
    let committed = 0;
    for (const id of ids) {
      const c = league.contracts[id] || {};
      if (league.draftType === 'auction') {
        const cost = keeperCost(c);
        committed += cost;
        contracts[id] = { salary: cost, kept: (c.kept ?? 0) + 1, since: c.since ?? league.season };
      } else {
        contracts[id] = { round: c.round ?? ROSTER_SLOTS.length, kept: (c.kept ?? 0) + 1, since: c.since ?? league.season };
      }
      taken[id] = i;
    }
    budgets.push((league.auction?.budget ?? DEFAULT_BUDGET) - committed);
    t.record = { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
    t.seasonStats = { team: emptyTeamStats(), players: {} };
    t.depthSorted = false;
  });
  league.contracts = contracts;
  league.offseason = { ...league.offseason, step: 'market', user: userIds.slice(), keepers, budgets, fromSeason: league.season };
  league.season++;
  league.playoffs = null;
  league.champion = null;
  league.results = [];
  league.injuries = {};
  league.claims = [];
  league.week = 1;

  const rng = new RNG(league.rngState);
  // Worst club nominates or picks first.
  const order = table.slice().reverse();
  if (league.draftType === 'auction') {
    league.auction = createAuction(league, rng, { budget: league.auction?.budget ?? DEFAULT_BUDGET, budgets, order, taken });
    league.draft = null;
  } else {
    league.draft = createDraft(league, rng, { order, taken });
    league.auction = null;
  }
  league.rngState = rng.state;
  league.phase = 'draft';
  return league;
}

/** Skip contracts entirely: same rosters, next season. Kept for people who just want to run it back. */
export function skipOffseason(league) {
  league.offseason = null;
  league.phase = 'complete';
  return league;
}

/** Summary lines for the offseason screen: who won, where the human finished. */
export function seasonSummary(league) {
  const last = (league.history || []).find((h) => h.season === (league.offseason?.season ?? league.season)) || league.history?.[league.history.length - 1];
  if (!last) return null;
  const champ = league.teams[last.champion];
  return { season: last.season, champion: champ, user: last.user, teams: league.teams.length };
}
