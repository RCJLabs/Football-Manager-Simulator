// The two markets where the screen showed everything except the answer.
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
// Both are pure reads of the league. No random numbers, so a redraw never moves
// a number under the cursor.

import { ROSTER_SLOTS } from '../data/positions.js';
import { overall, TRUE_LEVERAGE } from './ratings.js';
import { freeAgents, waiverLimit } from './transactions.js';
import { groupValue } from './tradeblock.js';
import { availability, weeksLeft, SEASON_ENDING } from './injuries.js';
import { keeperCost, keeperEligible, keeperLimit, freshGuide } from './offseason.js';

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
function roomsOf(league, team, byId) {
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

/**
 * What a free agent adds to a roster: his rating replaces the weakest man in
 * his room, and the room is re-valued. The difference is in lineup points —
 * the same currency a trade is judged in, so the two screens agree.
 */
export function joinValue(rooms, player) {
  const room = rooms[player.pos] || [];
  const before = room.map((x) => x.ovr);
  const after = before.slice(0, Math.max(0, before.length - 1)).concat(overall(player));
  return Math.round((groupValue(after, player.pos) - groupValue(before, player.pos)) * 10) / 10;
}

/** Who he would replace, which is the name the claim dialog has to put up. */
export function wouldReplace(rooms, player) {
  const room = rooms[player.pos] || [];
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
  const auction = league.draftType === 'auction';
  const guide = auction ? freshGuide(league, pool) : null;
  const rows = [];
  for (const s of ROSTER_SLOTS) {
    const id = team.slots[s.id];
    const p = id && byId.get(id);
    if (!p) continue;
    const c = league.contracts?.[id] || {};
    const cost = keeperCost(c);
    const market = guide ? Math.max(1, Math.round(guide.prices.get(id) ?? 1)) : null;
    rows.push({
      id,
      pos: p.pos,
      ovr: overall(p),
      slot: s.id,
      eligible: keeperEligible(c),
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
