// Salary-cap auction draft.
//
// Why this exists: a snake draft hands every team 26 players from the same pool
// in alternating order, so total talent equalizes and the draft stops mattering.
// A budget forces trade-offs. You can buy Brady, Rice and Nacua, but then your
// line is replacement level and the pass rush gets home.
//
// Flow: teams take turns nominating a player they have room for. The nominator
// automatically opens at $1, so every nomination sells. Each team states a
// maximum (an eBay-style proxy bid); the highest maximum wins and pays one
// dollar more than the runner-up. A team always keeps $1 per unfilled slot, so
// every roster is guaranteed to fill.

import { ROSTER_SLOTS, SLOT_COUNTS } from '../data/positions.js';
import { GM_PERSONALITIES } from '../data/teams.js';
import { savvyFor, bidBoldness } from './difficulty.js';
import { marketView, scoutReport } from './scouting.js';
import { overall, TRUE_LEVERAGE } from './ratings.js';
import { clamp } from './rng.js';

export const DEFAULT_BUDGET = 200;
export const MIN_BID = 1;
export const TOTAL_SLOTS = ROSTER_SLOTS.length;

/**
 * Two different numbers drive this auction, and the gap between them is the
 * whole game.
 *
 * TRUE_LEVERAGE is measured by `scripts/leverage-sim.mjs`: boost one position
 * group by 8 points on an otherwise equal synthetic team, take the extra point
 * margin, divide by the number of starters at that position. It is what a
 * player is actually worth, and only the ratios matter — the price guide
 * normalises by the sum, so the scale is pinned to the quarterback.
 *
 * Re-measured over 10,000 games per reading against a mirrored opponent. The
 * first version of these numbers had the tight end second only to the
 * quarterback and nearly double the back; he measures a shade *below* the back.
 * Everything else came back within about a tenth of where it was, so the table
 * was sound and one number in it was not.
 *
 * It has gone stale twice since, silently, both times from run-game work that
 * nobody re-measured after. The second time backs' elusiveness and power were
 * wired into play, so a table pricing the back at 0.6 of a quarterback sat over
 * an engine that plays him at 0.97 where starters sit. Re-set on 2026-09-24 as
 * the mean of six rosters rather than one (DESIGN.md, "The back is worth nearly
 * a quarterback now"), and the audit now replays it.
 *
 * The absolute scale is not free, even though the price guide normalises it
 * away. `lineupStrength` in transactions.js sums overall × leverage raw, and
 * `aiGreed` compares the result against fixed thresholds, so shrinking this
 * table quietly makes AI clubs stop trading — which is exactly what happened
 * on the first pass, and the offers test caught it. The measured ratios are
 * therefore scaled so the starter-weighted total matches what it was before
 * (86.45), which leaves trade behaviour untouched and every ratio corrected.
 *
 * GLAMOUR is what the room pays. Quarterbacks, backs and receivers carry the
 * headlines; guards and safeties do not. A market priced purely on true value
 * would be efficient, and an efficient market with equal budgets hands every
 * team the same quality of roster, which is exactly the parity problem the
 * auction is meant to solve. Pricing on reputation instead leaves real bargains
 * on the board for a manager who knows where games are won.
 *
 * Which bargains, exactly, is not what it looks like, and `positionValue()`
 * below is the honest answer rather than the intuition. Cheap is not the same
 * as underpriced: linemen have low glamour and low leverage together, and come
 * out overpaid. Normalised against each other the underpaid positions are the
 * back, the quarterback and the corner; the traps are the receiver and the
 * defensive line. The strategy table in DESIGN.md agrees — the buyer who bids
 * off this table finishes first.
 */
// Lives in ratings.js so `teamPower` can weight a lineup by it without this
// file and that one importing each other; re-exported here because this is
// where it is documented and where everything that uses it looks for it.
export { TRUE_LEVERAGE } from './ratings.js';
export const GLAMOUR = { QB: 2.3, RB: 1.6, WR: 1.5, TE: 0.95, DL: 0.95, LB: 0.75, CB: 0.7, S: 0.6, OL: 0.5, K: 0.22, P: 0.14 };
const LEVERAGE = Object.fromEntries(Object.entries(TRUE_LEVERAGE).map(([k, v]) => [k, Math.pow(v, 0.72)]));

/**
 * The two tables above, side by side and on one scale, which is the only form
 * in which they are any use to a person.
 *
 * Both are per player of equal rating: TRUE_LEVERAGE is what he is worth,
 * GLAMOUR is what the room will pay. Normalising each to a share of its own
 * total makes them comparable, and the ratio is the whole strategy — above 1 is
 * a position the market underpays for, below 1 one it overpays for.
 *
 * `starters` is carried too, because the per-player number is the right unit
 * when bidding on one man and the wrong one when deciding where a budget goes:
 * a lineman is worth under half a tight end and you have to buy five of him.
 */
/**
 * Below this share of a club's total win impact, a position cannot decide a
 * season whatever it costs, and calling it a bargain is bad advice. The
 * re-measured punter came out at better value-for-money than the quarterback,
 * which is arithmetically true and would have had the value board telling a new
 * manager to go and buy punters. Measured on the whole position rather than per
 * player, so five cheap linemen are not mistaken for a specialist.
 */
export const MATTERS_AT = 0.05;

export function positionValue() {
  const levSum = Object.values(TRUE_LEVERAGE).reduce((a, b) => a + b, 0);
  const glamSum = Object.values(GLAMOUR).reduce((a, b) => a + b, 0);
  return Object.keys(TRUE_LEVERAGE).map((pos) => {
    const wins = TRUE_LEVERAGE[pos] / levSum;
    const price = GLAMOUR[pos] / glamSum;
    const ratio = wins / price;
    return {
      pos,
      leverage: TRUE_LEVERAGE[pos],
      starters: STARTERS_AT[pos] || 0,
      wins,
      price,
      ratio,
      group: TRUE_LEVERAGE[pos] * (STARTERS_AT[pos] || 0),
      // What the whole position is worth to a club, which is what decides
      // whether its value-for-money is worth acting on at all.
      stake: wins * (STARTERS_AT[pos] || 0),
      verdict: wins * (STARTERS_AT[pos] || 0) < MATTERS_AT ? 'barely matters'
        : ratio >= 1.35 ? 'underpaid' : ratio >= 0.95 ? 'about right' : ratio >= 0.7 ? 'overpaid' : 'badly overpaid',
    };
  }).sort((a, b) => {
    // A position nobody can win with sorts to the bottom however cheap it is.
    const trivial = (r) => (r.verdict === 'barely matters' ? 1 : 0);
    return trivial(a) - trivial(b) || b.ratio - a.ratio;
  });
}

/** How much of a GM's valuation comes from real win impact rather than hype. */
/**
 * How much one rating point of misjudgement moves a bid. Prices scale roughly
 * with the square of talent above replacement, so a point is worth more than a
 * point; this is the linear approximation, bounded hard either way.
 */
const PERCEPTION_PER_POINT = 0.055;

// SAVVY lives with the GM definitions in data/teams.js: it is a trait of the
// general manager, and keeping it there lets the scout read it without the
// auction and the scouting code importing each other.

/**
 * Once a club has its starters at a position, the next man is a bench player:
 * RB2 still shares carries and WR4 sees a few targets, but a second
 * quarterback only plays if the first one is hurt.
 */
const STARTERS_AT = {};
for (const s of ROSTER_SLOTS) if (s.starter) STARTERS_AT[s.pos] = (STARTERS_AT[s.pos] || 0) + 1;
const BENCH_VALUE = { QB: 0.3, RB: 0.75, WR: 0.7 };


export function openSlots(team) {
  return ROSTER_SLOTS.filter((s) => !team.slots[s.id]);
}

export function openSlotsByPos(team) {
  const out = {};
  for (const s of openSlots(team)) out[s.pos] = (out[s.pos] || 0) + 1;
  return out;
}

export function slotsLeft(team) {
  return openSlots(team).length;
}

/** Most a team can bid while still keeping $1 for every other unfilled slot. */
export function maxAffordable(auction, teamIdx, league) {
  const left = slotsLeft(league.teams[teamIdx]);
  if (left <= 0) return 0;
  return Math.max(0, auction.budgets[teamIdx] - (left - 1) * MIN_BID);
}

export function canRoster(team, pos) {
  return (openSlotsByPos(team)[pos] || 0) > 0;
}

export function availablePlayers(auction, pool) {
  return pool.filter((p) => auction.taken[p.id] == null && !p.retired);
}

/** League-wide unfilled slots per position. */
function demandByPos(league) {
  const d = {};
  for (const t of league.teams) for (const [pos, n] of Object.entries(openSlotsByPos(t))) d[pos] = (d[pos] || 0) + n;
  return d;
}

/**
 * Replacement level per position: the overall of the last player who would still
 * find a roster spot if demand were filled purely by rating.
 */
function replacementLevels(available, demand, rate = overall) {
  const byPos = {};
  for (const p of available) (byPos[p.pos] ??= []).push(p);
  const out = {};
  for (const [pos, arr] of Object.entries(byPos)) {
    arr.sort((a, b) => rate(b) - rate(a));
    const need = Math.max(1, demand[pos] || 1);
    const idx = Math.min(arr.length - 1, need - 1);
    out[pos] = rate(arr[idx]);
  }
  return out;
}

/** What the room pays: star power, convex in rating, glamour by position. */
function marketRaw(p, rate = overall) {
  return Math.pow(Math.max(2, rate(p) - 68), 2.1) * (GLAMOUR[p.pos] ?? 1);
}

/** What the player is actually worth: talent above replacement times leverage. */
function trueRaw(p, repl, rate = overall) {
  const above = rate(p) - (repl[p.pos] ?? 60);
  return Math.max(0.35, above + 1.5) * (LEVERAGE[p.pos] ?? 1);
}

/**
 * A live price guide: what each remaining player should cost if the money left
 * in the league is spent on the slots left to fill. Recomputed as teams buy, so
 * prices rise when a position runs short and fall when money dries up.
 */
export function priceGuide(auction, league, pool) {
  const available = availablePlayers(auction, pool);
  const demand = demandByPos(league);
  // An unscouted rookie is priced on what the room believes, not on what he is.
  const rate = (p) => marketView(league, p);
  const repl = replacementLevels(available, demand, rate);
  const totalSlots = Object.values(demand).reduce((s, n) => s + n, 0);
  if (!totalSlots) return { prices: new Map(), repl, totalSlots: 0 };

  // The players most likely to actually be bought, by position demand.
  const byPos = {};
  for (const p of available) (byPos[p.pos] ??= []).push(p);
  const contenders = [];
  for (const [pos, arr] of Object.entries(byPos)) {
    arr.sort((a, b) => rate(b) - rate(a));
    for (const p of arr.slice(0, demand[pos] || 0)) contenders.push(p);
  }
  const moneyLeft = auction.budgets.reduce((s, b, i) => s + (slotsLeft(league.teams[i]) > 0 ? b : 0), 0);
  // Every bought player costs at least $1; the rest of the money chases stars.
  const discretionary = Math.max(0, moneyLeft - totalSlots * MIN_BID);
  const mScale = discretionary / (contenders.reduce((s, p) => s + marketRaw(p, rate), 0) || 1);
  const tScale = discretionary / (contenders.reduce((s, p) => s + trueRaw(p, repl, rate), 0) || 1);

  const prices = new Map();
  const worth = new Map();
  for (const p of available) {
    prices.set(p.id, Math.max(MIN_BID, Math.round(MIN_BID + marketRaw(p, rate) * mScale)));
    worth.set(p.id, Math.max(MIN_BID, Math.round(MIN_BID + trueRaw(p, repl, rate) * tScale)));
  }
  return { prices, worth, repl, totalSlots, moneyLeft };
}

/** The spreads the setup screen offers, as a fraction either side of the cap. */
export const BUDGET_SPREADS = { even: 0, mild: 0.1, wide: 0.2 };

/**
 * Unequal cap room, handed out evenly across the range and then shuffled.
 *
 * Measured before it was built: a spread of a fifth either way takes the
 * best-to-worst differential in a league from 6.4 points a game to about ten,
 * where widening the spread of GM savvy instead is worth under a point. Forty
 * per cent adds nothing over twenty, so `wide` is where the ladder stops.
 *
 * Evenly spaced rather than drawn at random, for two reasons: the advertised
 * range is then exactly what clubs get instead of whatever the dice said, and
 * the money in the room is unchanged, so this redistributes buying power rather
 * than inflating or deflating the whole market. Whose club is rich is the part
 * left to the shuffle, and yours is in it — that is the variety being bought.
 */
export function spreadBudgets(base, n, spread, rng) {
  if (!spread || n < 2) return Array.from({ length: n }, () => base);
  const raw = Array.from({ length: n }, (_, i) => base * (1 - spread + (2 * spread * i) / (n - 1)));
  const out = raw.map((v) => Math.max(1, Math.round(v)));
  // Rounding eleven or thirteen ways does not land on the total; give the
  // difference to the middle club so the extremes stay exactly as advertised.
  let drift = base * n - out.reduce((a, b) => a + b, 0);
  for (let i = 0; drift !== 0; i = (i + 1) % n) {
    const mid = Math.floor(n / 2);
    const k = (mid + Math.ceil(i / 2) * (i % 2 ? 1 : -1) + n) % n;
    const step = drift > 0 ? 1 : -1;
    out[k] += step; drift -= step;
  }
  return rng ? rng.shuffle(out) : out;
}

export function createAuction(league, rng, { budget = DEFAULT_BUDGET, budgets = null, order = null, taken = {} } = {}) {
  const start = budgets ? budgets.slice() : league.teams.map(() => budget);
  const a = {
    type: 'auction',
    budget,
    startBudgets: start.slice(),
    budgets: start,
    order: order ? order.slice() : rng.shuffle([...Array(league.teams.length).keys()]),
    nomIndex: 0,
    current: null,
    sold: [],
    taken: { ...taken },
    complete: false,
  };
  if (currentNominator(a, league) == null) a.complete = true;
  return a;
}

export function currentNominator(auction, league) {
  const n = auction.order.length;
  for (let i = 0; i < n; i++) {
    const t = auction.order[(auction.nomIndex + i) % n];
    if (slotsLeft(league.teams[t]) > 0) return t;
  }
  return null;
}

function advanceNominator(auction) {
  auction.nomIndex = (auction.nomIndex + 1) % auction.order.length;
}

/** Everyone the nominating team is allowed to put up: positions it still needs. */
export function nominatable(auction, league, pool, teamIdx) {
  const team = league.teams[teamIdx];
  const open = openSlotsByPos(team);
  return availablePlayers(auction, pool).filter((p) => open[p.pos] > 0);
}

/**
 * What an AI team will pay at most. Combines the price guide with the GM's
 * taste, how badly the roster needs the position, and budget pressure: a team
 * sitting on money relative to its remaining slots bids up, a team that already
 * splurged drops out. That pressure is what produces stars-and-scrubs rosters
 * next to balanced ones instead of eight identical teams.
 */
export function aiMaxBid(auction, league, pool, teamIdx, player, guide, rng) {
  const team = league.teams[teamIdx];
  if (!canRoster(team, player.pos)) return 0;
  const cap = maxAffordable(auction, teamIdx, league);
  if (cap < MIN_BID) return 0;

  const gm = GM_PERSONALITIES.find((g) => g.id === team.gm) || GM_PERSONALITIES[0];
  // Each GM sees a blend of the asking price and what the player is really
  // worth. The shrewd ones chase value; the rest chase names.
  const savvy = savvyFor(league, team);
  const asking = guide.prices.get(player.id) ?? MIN_BID;
  const real = guide.worth.get(player.id) ?? asking;
  let v = asking * (1 - savvy) + real * savvy;
  // A prospect nobody has seen play is bid on this club's own read of him. The
  // guide already prices him at the room's consensus, so what moves the bid is
  // only how far this GM's view sits from that consensus — which is why a
  // shrewd room still produces disagreement rather than one agreed number.
  const view = scoutReport(league, player, teamIdx);
  if (!view.known) v *= clamp(1 + (view.estimate - marketView(league, player)) * PERCEPTION_PER_POINT, 0.45, 2.2);
  // Personalities bid distinctly, or every roster converges again.
  v *= Math.pow(gm.pos[player.pos] ?? 1, 2.5);
  if (gm.era) v *= Math.pow(gm.era(player.season), 2);

  const left = slotsLeft(team);
  const dollarsPerSlot = auction.budgets[teamIdx] / Math.max(1, left);
  const marketPerSlot = guide.totalSlots ? guide.moneyLeft / guide.totalSlots : dollarsPerSlot;
  v *= clamp(dollarsPerSlot / Math.max(1, marketPerSlot), 0.55, 1.75);

  // Running out of roster spots at a position it still must fill: pay up.
  const open = openSlotsByPos(team)[player.pos] || 0;
  if (open >= left) v *= 1.6;
  else if (open > 0 && left <= 4) v *= 1.15;

  // Starters are bought; this would be a bench player.
  if (SLOT_COUNTS[player.pos] - open >= (STARTERS_AT[player.pos] || 0)) v *= BENCH_VALUE[player.pos] ?? 0.5;

  // Kickers and punters are a last-rounds problem, not a budget item.
  if ((player.pos === 'K' || player.pos === 'P') && left > 3) v = Math.min(v, Math.max(MIN_BID, dollarsPerSlot * 0.5));

  // How hard the room is to outbid, which is the half of difficulty that savvy
  // does not cover: a club that values a player correctly and stops there is
  // still beaten by anyone willing to pay a premium.
  v *= bidBoldness(league);
  v *= rng.normal(1, 0.13);
  return clamp(Math.round(v), 0, cap);
}

/** Put a player up for bidding. The nominator opens at $1, so nothing stalls. */
export function nominate(auction, league, pool, playerId, byId) {
  if (auction.complete) throw new Error('The auction is over');
  if (auction.current) throw new Error('Bidding is already open');
  if (auction.taken[playerId] != null) throw new Error('That player is already sold');
  const teamIdx = currentNominator(auction, league);
  if (teamIdx == null) throw new Error('Every roster is full');
  const player = byId.get(playerId);
  if (!player) throw new Error('Unknown player');
  if (!canRoster(league.teams[teamIdx], player.pos)) throw new Error(`No open ${player.pos} slot`);
  auction.current = { playerId, nominator: teamIdx };
  return auction.current;
}

/** AI picks the best player it can afford at a position it still needs. */
export function aiNominate(auction, league, pool, rng, byId) {
  const teamIdx = currentNominator(auction, league);
  const guide = priceGuide(auction, league, pool);
  const cands = nominatable(auction, league, pool, teamIdx);
  if (!cands.length) return null;
  const cap = maxAffordable(auction, teamIdx, league);
  const gm = GM_PERSONALITIES.find((g) => g.id === league.teams[teamIdx].gm) || GM_PERSONALITIES[0];
  // Prefer players it can actually win, weighted by taste.
  const scored = cands.map((p) => {
    const price = guide.prices.get(p.id) ?? MIN_BID;
    const taste = Math.pow(gm.pos[p.pos] ?? 1, 2.5) * (gm.era ? gm.era(p.season) : 1);
    const reach = price <= cap ? 1 : 0.15;
    return { p, w: (overall(p) - 70) * taste * reach };
  });
  const best = scored.sort((a, b) => b.w - a.w).slice(0, 6);
  const choice = rng.weighted(best.map((x) => x.p), best.map((x) => Math.max(0.1, x.w)));
  return nominate(auction, league, pool, choice.id, byId);
}

/**
 * Close bidding on the open nomination.
 * `userMax` is the human team's maximum (0 to pass). Returns the sale.
 */
export function settle(auction, league, pool, rng, byId, userMax = 0) {
  const cur = auction.current;
  if (!cur) throw new Error('Nothing is up for bidding');
  const player = byId.get(cur.playerId);
  const guide = priceGuide(auction, league, pool);

  const bids = [];
  for (let t = 0; t < league.teams.length; t++) {
    const team = league.teams[t];
    if (!canRoster(team, player.pos)) continue;
    const cap = maxAffordable(auction, t, league);
    if (cap < MIN_BID) continue;
    let max = team.isUser
      ? clamp(Math.floor(Number(userMax) || 0), 0, cap)
      : aiMaxBid(auction, league, pool, t, player, guide, rng);
    if (t === cur.nominator) max = Math.max(max, MIN_BID); // the opening bid
    if (max >= MIN_BID) bids.push({ team: t, max });
  }
  if (!bids.length) {
    // Only possible if the nominator somehow lost the slot; return him to the pool.
    auction.current = null;
    advanceNominator(auction);
    return null;
  }

  bids.sort((a, b) => b.max - a.max || rng.next() - 0.5);
  const winner = bids[0];
  const runnerUp = bids[1];
  const price = runnerUp ? Math.min(winner.max, runnerUp.max + 1) : MIN_BID;

  const team = league.teams[winner.team];
  const slot = openSlots(team).find((s) => s.pos === player.pos);
  team.slots[slot.id] = player.id;
  auction.budgets[winner.team] -= price;
  auction.taken[player.id] = winner.team;
  const sale = {
    playerId: player.id, team: winner.team, price, slot: slot.id,
    nominator: cur.nominator, bidders: bids.length,
    underbid: runnerUp ? runnerUp.max : 0,
  };
  auction.sold.push(sale);
  auction.current = null;
  advanceNominator(auction);
  if (currentNominator(auction, league) == null) auction.complete = true;
  return sale;
}

/**
 * Should the human be asked about this nomination? Skipped when they cannot
 * roster the player, cannot outbid the floor, or the player is below the
 * threshold they set, so the auction does not become 208 taps.
 */
export function shouldAskUser(auction, league, pool, byId, minOverall = 0) {
  const cur = auction.current;
  if (!cur) return false;
  const u = league.teams.findIndex((t) => t.isUser);
  if (u < 0) return false;
  const team = league.teams[u];
  const player = byId.get(cur.playerId);
  if (!canRoster(team, player.pos)) return false;
  if (maxAffordable(auction, u, league) <= MIN_BID) return false;
  if (cur.nominator === u) return true;
  return overall(player) >= minOverall;
}

/**
 * Run the auction forward until the human has to act: their nomination turn, or
 * a nomination worth asking them about. Returns why it stopped.
 */
export function advanceToUser(auction, league, pool, rng, byId, { minOverall = 0, maxSteps = 600 } = {}) {
  const u = league.teams.findIndex((t) => t.isUser);
  let steps = 0;
  while (!auction.complete && steps++ < maxSteps) {
    if (auction.current) {
      if (shouldAskUser(auction, league, pool, byId, minOverall)) return 'bid';
      settle(auction, league, pool, rng, byId, 0);
      continue;
    }
    const nom = currentNominator(auction, league);
    if (nom == null) { auction.complete = true; break; }
    if (nom === u && slotsLeft(league.teams[u]) > 0) return 'nominate';
    aiNominate(auction, league, pool, rng, byId);
  }
  return auction.complete ? 'complete' : 'stalled';
}

/** Fill every remaining roster without human input. */
export function autoCompleteAll(auction, league, pool, rng, byId, { maxSteps = 2000 } = {}) {
  let steps = 0;
  while (!auction.complete && steps++ < maxSteps) {
    if (auction.current) { settle(auction, league, pool, rng, byId, autoUserMax(auction, league, pool, rng, byId)); continue; }
    if (currentNominator(auction, league) == null) { auction.complete = true; break; }
    aiNominate(auction, league, pool, rng, byId);
  }
  return auction;
}

/** What the human team would bid if it were run by the AI. */
export function autoUserMax(auction, league, pool, rng, byId) {
  const u = league.teams.findIndex((t) => t.isUser);
  if (u < 0 || !auction.current) return 0;
  const player = byId.get(auction.current.playerId);
  const guide = priceGuide(auction, league, pool);
  const saved = league.teams[u].gm;
  league.teams[u].gm = saved || 'balanced';
  const bid = aiMaxBid(auction, league, pool, u, player, guide, rng);
  league.teams[u].gm = saved;
  return bid;
}

/** Spend summary per team, for the auction board and post-draft review. */
export function spendByPos(auction, league, byId, teamIdx) {
  const out = {};
  for (const s of auction.sold) {
    if (s.team !== teamIdx) continue;
    const p = byId.get(s.playerId);
    out[p.pos] = (out[p.pos] || 0) + s.price;
  }
  return out;
}
