// The three markets where the screen showed everything except the answer.
//
// **Free agency** had filters, an era tab and a search box, and the one number
// a claim turns on was missing: what this man would actually add to your
// lineup. A 96-overall kicker is the best free agent in the pool by rating and
// worth about a point; an 88 cornerback behind two 90s is worth nothing at all.
// `faBoard` computes the gain for every free agent on the same yardstick the AI
// clubs use to decide their own claims, and — because the wire is contested and
// one claim a week is precious — how many of them would file for the same man.
//
// **Keepers** showed last year's price and the raised price, which is the cost
// side of the decision with no value side. The auction's own price guide knows
// what the market would charge for that player if he went back into it, so
// `keeperBoard` prints the difference: keep the bargains, let the market buy
// back the rest. The AI clubs have always weighed that trade-off (`aiKeepers`
// in offseason.js, through a GM's taste and a bird-in-hand premium); the human
// was shown the price and left to guess at the value.
//
// **The auction room** was the best-equipped of the three — it already had a
// price guide, a search, position tabs and an affordability cap — and it still
// left out the question an auction actually turns on, which is not "what is he
// worth" but "what happens if I lose him". `lotAdvice` answers that: the next
// man at his position, the gap down to him, and how many clubs are still in the
// market for one. Paying over the odds for a scarce position is correct; paying
// it for a deep one is how a budget disappears by round three.
//
// All three are pure reads of the league. No random numbers, so a redraw never
// moves a number under the cursor. In particular the auction advice never
// reports what a rival would actually bid — `aiMaxBid` is stochastic, and a
// screen that printed it would turn every lot into a snipe at their maximum
// plus one.

import { ROSTER_SLOTS } from '../data/positions.js';
import { overall, TRUE_LEVERAGE } from './ratings.js';
import { freeAgents, waiverLimit } from './transactions.js';
import { groupValue } from './tradeblock.js';
import { availability, weeksLeft, SEASON_ENDING } from './injuries.js';
import { keeperCost, keeperEligible, keeperLimit, freshGuide } from './offseason.js';
import { capOn } from './cap.js';
import {
  availablePlayers, openSlotsByPos, slotsLeft, canRoster, maxAffordable, MIN_BID,
} from './auction.js';

// ---------------------------------------------------------------------------
// Free agency
// ---------------------------------------------------------------------------

/**
 * The bar an AI club sets before spending one of its two claims a week, copied
 * from `aiFileClaims` so the "who else wants him" count is the same question
 * those clubs will actually be asked, not a guess at it.
 */
export const AI_CLAIM_GAIN = 6;
export const AI_CLAIM_EDGE = 2;

/** A club's rooms as plain rating arrays, built once and reused across the pool. */
export function roomsOf(league, team, byId) {
  const rooms = {};
  for (const s of ROSTER_SLOTS) {
    const id = team.slots[s.id];
    const p = id && byId.get(id);
    if (!p) continue;
    (rooms[p.pos] ??= []).push({ id, ovr: overall(p) * availability(league, id) });
  }
  for (const arr of Object.values(rooms)) arr.sort((a, b) => b.ovr - a.ovr);
  return rooms;
}

/** How many slots a roster has at each position. */
const SLOTS_AT = {};
for (const s of ROSTER_SLOTS) SLOTS_AT[s.pos] = (SLOTS_AT[s.pos] || 0) + 1;

/**
 * What a player adds to a roster.
 *
 * If the room is full he replaces the weakest man in it, which is the free
 * agency case — a claim always costs a release. If the room has space he is
 * simply added, which is the auction and draft case. Getting that wrong is not
 * cosmetic: replacing into a room with an empty slot scored a perfectly good
 * backup quarterback at minus fifty-four, because it charged the roster for a
 * man it was not actually losing.
 *
 * The answer is in lineup points, the same currency a trade is judged in, so
 * every screen in the game agrees about what a player is worth.
 */
export function joinValue(rooms, player) {
  const room = rooms[player.pos] || [];
  const before = room.map((x) => x.ovr);
  const full = before.length >= (SLOTS_AT[player.pos] || 1);
  const after = (full ? before.slice(0, Math.max(0, before.length - 1)) : before).concat(overall(player));
  return Math.round((groupValue(after, player.pos) - groupValue(before, player.pos)) * 10) / 10;
}

/** Who he would replace — nobody, when the room still has a slot free. */
export function wouldReplace(rooms, player) {
  const room = rooms[player.pos] || [];
  if (room.length < (SLOTS_AT[player.pos] || 1)) return null;
  return room.length ? room[room.length - 1].id : null;
}

/**
 * Every free agent, with what he is worth to you and how contested he is.
 *
 * `rivals` counts the AI clubs that would clear their own claim bar on him, so
 * a man nobody else wants can wait a week and a man five clubs want cannot.
 * It is deterministic: the per-club activity roll that decides whether a GM
 * bothers to look at the wire at all is left out, because a probability of
 * being outbid is not something a screen can usefully print.
 */
export function faBoard(league, pool, byId, teamIdx, { q = '', pos = '', era = '', limit = 60, rivalsFor = 60 } = {}) {
  const inj = league.injuries || {};
  const left = weeksLeft(league);
  const mine = roomsOf(league, league.teams[teamIdx], byId);
  const needle = String(q || '').toLowerCase().trim();
  const rows = [];
  for (const p of freeAgents(league, pool)) {
    if (pos && p.pos !== pos) continue;
    if (era && `${Math.floor(p.season / 10) * 10}s` !== era) continue;
    if (needle && !p.name.toLowerCase().includes(needle) && String(p.team || '').toLowerCase() !== needle) continue;
    rows.push({ id: p.id, pos: p.pos, ovr: overall(p), gain: joinValue(mine, p), hurt: !!inj[p.id], drop: wouldReplace(mine, p) });
  }
  rows.sort((a, b) => b.gain - a.gain || b.ovr - a.ovr);
  const shown = rows.slice(0, limit);

  // Rivals cost a room rebuild per club, so only the rows on screen get it.
  const others = league.teams.map((t, i) => i).filter((i) => i !== teamIdx && !league.teams[i].isUser);
  const theirRooms = new Map(others.map((i) => [i, roomsOf(league, league.teams[i], byId)]));
  for (const r of shown.slice(0, rivalsFor)) {
    const p = byId.get(r.id);
    if (!p || r.hurt) { r.rivals = 0; continue; }
    let n = 0;
    for (const i of others) {
      const rooms = theirRooms.get(i);
      const room = rooms[p.pos] || [];
      const weakest = room[room.length - 1];
      if (weakest) {
        const cur = byId.get(weakest.id);
        const hurt = inj[weakest.id];
        const doneForYear = hurt && (hurt.weeks >= SEASON_ENDING || hurt.weeks >= left);
        if (!doneForYear && overall(p) < overall(cur) + AI_CLAIM_EDGE) continue;
      }
      if (joinValue(rooms, p) >= AI_CLAIM_GAIN) n++;
    }
    r.rivals = n;
  }
  return { total: rows.length, players: shown, claims: waiverLimit(league) };
}

// ---------------------------------------------------------------------------
// Keepers
// ---------------------------------------------------------------------------

/**
 * Each of your players, with what keeping him costs against what the market
 * would charge to buy him back.
 *
 * `surplus` is the whole decision in one number: positive means keeping him is
 * cheaper than winning him at auction, negative means let him go and bid.
 *
 * It is deliberately *not* quite the number `aiKeepers` ranks on. That one
 * multiplies the market price by the club's positional taste and by
 * `BIRD_IN_HAND`, the premium a GM pays to skip the auction's risk. Those model
 * a personality; they are not facts about the market. A human reading a price
 * wants the price.
 *
 * `worth` puts the surplus on the lineup-points scale by weighting the player's
 * rating with his position's leverage, which is what breaks ties between two
 * equally priced bargains: a $4 saving on a quarterback is not a $4 saving on a
 * punter.
 */
export function keeperBoard(league, pool, byId, teamIdx) {
  const team = league.teams[teamIdx];
  // A fantasy auction's decision: keep at a raise, or buy him back. A pro
  // league that auctions keeps on its contracts, as one that drafts does.
  const auction = league.draftType === 'auction' && !capOn(league);
  const guide = auction ? freshGuide(league, pool) : null;
  const rows = [];
  for (const s of ROSTER_SLOTS) {
    const id = team.slots[s.id];
    const p = id && byId.get(id);
    if (!p) continue;
    const c = league.contracts?.[id] || {};
    const cost = keeperCost(c, p, league);
    const market = guide ? Math.max(1, Math.round(guide.prices.get(id) ?? 1)) : null;
    rows.push({
      id,
      pos: p.pos,
      ovr: overall(p),
      slot: s.id,
      eligible: keeperEligible(c, league),
      kept: c.kept || 0,
      salary: c.salary ?? 1,
      cost,
      market,
      surplus: market == null ? null : market - cost,
      worth: Math.round(overall(p) * (TRUE_LEVERAGE[p.pos] ?? 1) * 10) / 10,
    });
  }
  // Best keeps first: the biggest saving, and leverage breaks the ties.
  rows.sort((a, b) => (b.surplus ?? 0) - (a.surplus ?? 0) || b.worth - a.worth);
  return { rows, limit: keeperLimit(league), auction };
}

/**
 * What the board suggests, as a sentence. Naming the trade-off is the point:
 * the screen should say *why* a man is worth keeping, not just rank him.
 */
export function keeperAdvice(row) {
  if (!row.eligible) return 'Kept three years running — he has to go back to the pool.';
  if (row.surplus == null) return `Holds his slot; the draft fills the rest.`;
  if (row.surplus >= 8) return `A bargain: about $${row.surplus} under what the room would pay.`;
  if (row.surplus >= 3) return `Worth keeping — roughly $${row.surplus} cheaper than buying him back.`;
  if (row.surplus > -3) return 'About what he would cost at auction. Keeping him is neither here nor there.';
  return `Let him go: the market would price him about $${-row.surplus} under his keeper price.`;
}

// ---------------------------------------------------------------------------
// The auction room
// ---------------------------------------------------------------------------

/**
 * How tight each position is.
 *
 * Headcount was the obvious measure and it is the wrong one here. The pool is
 * over a thousand all-time greats for a few hundred slots, so *every* position
 * is deep by count — measured at between three and six available for every slot
 * needed, at every position, at the start of a twelve-club auction. A threshold
 * on that ratio never fires and tells nobody anything.
 *
 * What is actually scarce is quality. `drop` is the gap from the best man left
 * at that position down to replacement level — the rating of the last man who
 * would still find a roster if demand were filled purely by rating, which the
 * price guide already works out. A big gap means the top of that position is
 * genuinely worth paying for; a small one means wait, somebody almost as good
 * is coming round again.
 */
export function positionScarcity(auction, league, pool, guide = null) {
  const left = {}, needed = {}, best = {};
  for (const p of availablePlayers(auction, pool)) {
    left[p.pos] = (left[p.pos] || 0) + 1;
    const o = overall(p);
    if (!best[p.pos] || o > best[p.pos]) best[p.pos] = o;
  }
  for (const t of league.teams) for (const [pos, n] of Object.entries(openSlotsByPos(t))) needed[pos] = (needed[pos] || 0) + n;
  const out = {};
  for (const pos of new Set([...Object.keys(left), ...Object.keys(needed)])) {
    const l = left[pos] || 0, n = needed[pos] || 0;
    const repl = guide?.repl?.[pos];
    const drop = repl != null && best[pos] != null ? Math.round((best[pos] - repl) * 10) / 10 : null;
    out[pos] = { left: l, needed: n, ratio: n ? l / n : Infinity, best: best[pos] ?? null, repl: repl ?? null, drop, tight: false };
  }
  // Tight against the rest of the board, not against a fixed number. At the
  // opening every position drops seven to twelve points to replacement, so an
  // absolute threshold flags all eleven and says nothing; by the closing rounds
  // it flags none. What a bidder can use is which positions are tighter than
  // the others *right now*.
  const drops = Object.values(out).map((x) => x.drop).filter((d) => d != null).sort((a, b) => a - b);
  if (drops.length) {
    const median = drops[Math.floor(drops.length / 2)];
    for (const x of Object.values(out)) x.tight = x.drop != null && x.drop > median;
  }
  return out;
}

/**
 * What it would mean to lose this lot.
 *
 * The drop-off is the whole thing: the next man at that position, and the
 * rating gap down to him. A three-point gap at a position nine clubs still need
 * is worth paying for; a nought-point gap at one where eleven are left is not,
 * whatever the asking price says.
 *
 * `rivals` counts the clubs that could still roster the position and afford to
 * raise the current bid. It is deliberately a count and not a number of
 * dollars: what a club would actually go to is `aiMaxBid`, which carries a
 * thirteen per cent random factor, and printing an estimate of it would invite
 * bidding exactly one dollar over.
 *
 * There is no lineup-points-per-dollar figure here, and that is on purpose. It
 * was built, measured and thrown away: it is a ratio with a denominator that
 * can be one, so it ranks the cheapest man at the most valuable unfilled
 * position above everybody else. Sorting the room by it put a 72-overall
 * quarterback at $1 top of the board at 1,295 points to the dollar, ahead of
 * every star in the pool. A number that is only sane in the middle of its range
 * is not a number to put on a screen.
 */
export function lotAdvice(auction, league, pool, byId, teamIdx, player, guide, { currentBid = MIN_BID } = {}) {
  const team = league.teams[teamIdx];
  const rooms = roomsOf(league, team, byId);
  const avail = availablePlayers(auction, pool)
    .filter((p) => p.pos === player.pos && p.id !== player.id)
    .sort((a, b) => overall(b) - overall(a));
  const next = avail[0] || null;
  const scarcity = positionScarcity(auction, league, pool, guide)[player.pos] || { left: 0, needed: 0, ratio: Infinity, drop: null, tight: false };
  let rivals = 0;
  league.teams.forEach((t, i) => {
    if (i === teamIdx || t.isUser) return;
    if (!canRoster(t, player.pos)) return;
    if (maxAffordable(auction, i, league) <= currentBid) return;
    rivals++;
  });
  const openHere = openSlotsByPos(team)[player.pos] || 0;
  const ask = guide.prices.get(player.id) ?? MIN_BID;
  const gain = joinValue(rooms, player);
  return {
    pos: player.pos,
    ask,
    worth: guide.worth.get(player.id) ?? MIN_BID,
    gain,
    cap: maxAffordable(auction, teamIdx, league),
    next: next ? { id: next.id, ovr: overall(next), ask: guide.prices.get(next.id) ?? MIN_BID } : null,
    dropOff: next ? overall(player) - overall(next) : null,
    scarcity,
    rivals,
    // Down to the wire at a position still unfilled: the room stops being a
    // market and becomes a queue, and the price stops mattering.
    mustFill: openHere > 0 && openHere >= slotsLeft(team),
  };
}

/**
 * The advice as a sentence, because a number without its reason is a number.
 *
 * There is no branch here for "a real drop", and there used to be. Measured
 * across three whole twelve-club auctions — 1,320 snapshots of every position
 * still on the board — the gap from the best man left to the next was **never**
 * four points or more. It was zero on half of them and one on another third.
 * A pool of over a thousand all-time greats simply does not produce a scarce
 * individual, and a branch that cannot fire is worse than no branch: it implies
 * a situation the game never reaches.
 */
export function lotNote(a, nextName) {
  const bits = [];
  if (a.mustFill) bits.push('You have to fill this slot — there are no rounds left to wait.');
  else if (a.dropOff == null) bits.push('He is the last one in the pool at this position.');
  else if (a.dropOff >= 1) bits.push(`${nextName ? nextName : 'The next one'} is ${a.dropOff} point${a.dropOff === 1 ? '' : 's'} behind at $${a.next.ask}. Losing him is not a disaster.`);
  else bits.push(`${nextName ? nextName : 'The next one'} is just as good at $${a.next.ask}. Let this go.`);
  if (a.scarcity.drop != null) {
    bits.push(a.scarcity.tight
      ? `${a.pos} is one of the tighter positions on the board right now: ${a.scarcity.drop} points from the best left down to replacement.`
      : `${a.pos} is one of the deeper positions right now, ${a.scarcity.drop} points down to replacement. It will stay cheap.`);
  }
  return bits.join(' ');
}
