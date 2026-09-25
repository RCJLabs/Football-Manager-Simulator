// Position changes: a club moving one of its own men to a position his
// skills translate to.
//
// translate.js decides which moves exist and what a man would be after one.
// This is the club's side: whose man he is, where he goes on the depth chart,
// what it costs, and what it does to his career.
//
// WHAT IT COSTS. Measured over the pool, 95% of safeties are worth more at
// corner than where they are: the same rating, near enough, at a position the
// market prices half as high again per point (leverage 4.39 against 2.87).
// Charged nothing, buying safeties to play corner would be a choice with one
// right answer, which is not a choice. So a move to a position the market pays
// more for raises his salary by the difference for the rest of his deal —
// what he is worth there against what he was worth where he was, both at the
// rating he settles at. A move down costs nothing and refunds nothing: a
// contract is a contract. By the market's own arithmetic a move is then worth
// what it costs, the seasons spent learning the job make it slightly worse
// than signing an equal man, and what is left is the situation it was always
// for: a hole the market cannot fill well, and a man of your own who can.
//
// Pro leagues only, because the premium needs a cap to mean anything.

import { ROSTER_SLOTS } from '../data/positions.js';
import { CONVERSIONS, fillFor, movedBase, settle } from './translate.js';
import { developed, positionPeak, rootOf } from './careers.js';
import { overall } from './ratings.js';
import { capOn, capSpace, marketSalary, MAX_SALARY } from './cap.js';
import { isScouted } from './scouting.js';
import { squadList } from './squad.js';

/** Whether this league has position changes at all. */
export function movesOn(league) {
  return capOn(league) && !!league?.settings?.positions;
}

/**
 * Whether a club can move anybody right now: in season, once it is over, and
 * in the offseason's keeper round and market. Not while the draft is on — it
 * has already counted every club's open slots — and not during the playoffs.
 */
export function movesOpen(league) {
  if (!movesOn(league)) return false;
  if (league.phase === 'season' || league.phase === 'complete') return true;
  return league.phase === 'offseason' && ['keepers', 'freeagency'].includes(league.offseason?.step);
}

/**
 * The season a move made now is first played in. Between a season's last game
 * and the keeper round turning the calendar that is next season, so a move
 * made in the offseason does not spend its first year learning the job in a
 * season that is already over.
 */
export function firstSeason(league) {
  const between = league.phase === 'complete' || (league.phase === 'offseason' && ['jobs', 'keepers'].includes(league.offseason?.step));
  return league.season + (between ? 1 : 0);
}

/** Every position this man can play: his own, and each one it translates to. */
export function positionsFor(p) {
  const home = rootOf(p)?.pos;
  return home ? [home, ...(CONVERSIONS[home] || [])] : [];
}

/** What he is now where he plays, without what the job is still costing him. */
function unsettled(league, p) {
  const src = p.base || p;
  const c = league.dev?.[src.id];
  return c ? developed(src, c) : src;
}

/**
 * The man as he would be at `pos` once settled, and the move record that
 * would put him there — `null` for his own position, since going home is not
 * a move but the end of one.
 *
 * The estimated skill is read from what he is now at his own position rather
 * than from the pool's record of him, so a safety who has spent four years
 * getting better is estimated as the player he became. It is stored as a base
 * rating with his career's delta for that skill taken out, so the career
 * adds it back exactly once. A man who moves from one new position to another
 * keeps the estimate he already had, and whatever he has learned on top of it.
 */
export function asAt(league, p, pos) {
  const root = rootOf(p);
  const c = league.dev?.[root.id];
  const home = c ? developed(root, c) : root;
  if (pos === root.pos) return { view: home, move: null };
  const held = league.moves?.[root.id]?.fill || {};
  const fill = {};
  for (const [a, v] of Object.entries(fillFor(home.r, root.pos, pos))) {
    fill[a] = a in held ? held[a] : v - (c?.d?.[a] || 0);
  }
  const move = { to: pos, season: firstSeason(league), fill };
  const base = movedBase(root, move);
  return { view: c ? developed(base, c) : base, move };
}

/** What moving him to `pos` adds to his salary each year: never below zero. */
export function movePremium(league, p, pos) {
  return Math.max(0, marketSalary(asAt(league, p, pos).view) - marketSalary(unsettled(league, p)));
}

/** Where a man is on his club: 'slot', 'squad', 'ir', or null if he is not on it. */
function placeOf(team, id) {
  if (ROSTER_SLOTS.some((s) => team.slots[s.id] === id)) return 'slot';
  if (squadList(team).includes(id)) return 'squad';
  if ((team.ir || []).includes(id)) return 'ir';
  return null;
}

/**
 * Why this man cannot play `pos` for his club right now, whatever the slots
 * say: the league, the calendar, where he is, whether his skills translate and
 * whether anybody knows what he is. Null if nothing about him stands in the way.
 */
function manBlocker(league, teamIdx, id, pos, byId) {
  if (!movesOn(league)) return 'Position changes are switched off in this league';
  if (!movesOpen(league)) return league.phase === 'draft' ? 'Not while the draft is on' : 'Not now';
  const team = league.teams?.[teamIdx];
  const p = byId?.get(id);
  if (!team || !p) return 'Unknown player';
  const place = placeOf(team, id);
  if (!place) return `${p.name} is not on your club`;
  if (place === 'ir') return `${p.name} is on injured reserve`;
  if (p.pos === pos) return `${p.name} already plays ${pos}`;
  if (!positionsFor(p).includes(pos)) return `A ${rootOf(p).pos}'s skills do not translate to ${pos}`;
  // A rookie still behind the fog has no known rating at his own position,
  // and his rating at a new one would read it straight off the screen.
  if (!isScouted(league, p)) return `Nobody knows yet what ${p.name} is at his own position`;
  return null;
}

/** In season a premium has to fit under the cap; out of it the cap is settled at the next kickoff. */
function capBlocker(league, teamIdx, premium) {
  if (league.phase !== 'season' || premium <= capSpace(league, teamIdx)) return null;
  return `The move adds $${premium} a year and you have $${Math.max(0, capSpace(league, teamIdx))} under the cap`;
}

/** Why this man cannot be moved into this slot, or null if he can. */
export function moveBlocker(league, teamIdx, id, slotId, byId) {
  if (!movesOn(league)) return 'Position changes are switched off in this league';
  if (!movesOpen(league)) return league.phase === 'draft' ? 'Not while the draft is on' : 'Not now';
  const team = league.teams?.[teamIdx];
  const slot = ROSTER_SLOTS.find((s) => s.id === slotId);
  if (!team || !slot) return 'No such slot';
  if (team.slots[slot.id]) return `${slot.id} is not open`;
  const why = manBlocker(league, teamIdx, id, slot.pos, byId);
  if (why) return why;
  return capBlocker(league, teamIdx, movePremium(league, byId.get(id), slot.pos));
}

/**
 * Why these two men cannot trade places, each moving to the other's position,
 * or null if they can. Only two men on the depth chart, at two positions that
 * translate both ways — a safety and a corner — and the premiums of both moves
 * together have to fit under the cap in season.
 */
export function swapBlocker(league, teamIdx, idA, idB, byId) {
  if (!movesOn(league)) return 'Position changes are switched off in this league';
  if (!movesOpen(league)) return league.phase === 'draft' ? 'Not while the draft is on' : 'Not now';
  const team = league.teams?.[teamIdx];
  if (!team) return 'No such club';
  const sa = ROSTER_SLOTS.find((s) => team.slots[s.id] === idA);
  const sb = ROSTER_SLOTS.find((s) => team.slots[s.id] === idB);
  if (!sa || !sb) return 'Both men have to be on the depth chart';
  if (sa.pos === sb.pos) return 'They already play the same position';
  const why = manBlocker(league, teamIdx, idA, sb.pos, byId) || manBlocker(league, teamIdx, idB, sa.pos, byId);
  if (why) return why;
  return capBlocker(league, teamIdx, movePremium(league, byId.get(idA), sb.pos) + movePremium(league, byId.get(idB), sa.pos));
}

/**
 * Everybody on a club who could fill this open slot by changing position, with
 * what it would make him: `now` where he plays, `first` in his first season at
 * the new position, `settled` after that, and the premium. Best settled first.
 */
export function candidatesFor(league, teamIdx, slotId, byId) {
  const team = league.teams?.[teamIdx];
  const slot = ROSTER_SLOTS.find((s) => s.id === slotId);
  if (!team || !slot || !movesOpen(league)) return [];
  const ids = [...ROSTER_SLOTS.map((s) => team.slots[s.id]).filter(Boolean), ...squadList(team)];
  const out = [];
  for (const id of ids) {
    if (moveBlocker(league, teamIdx, id, slotId, byId)) continue;
    const p = byId.get(id);
    const { view, move } = asAt(league, p, slot.pos);
    const first = move ? settle(view, move, move.season, view.base || view) : view;
    out.push({
      id, p,
      from: ROSTER_SLOTS.find((s) => team.slots[s.id] === id)?.id || 'practice squad',
      home: !move,
      now: overall(p),
      first: overall(first),
      settled: overall(view),
      premium: movePremium(league, p, slot.pos),
    });
  }
  return out.sort((a, b) => b.settled - a.settled || b.first - a.first);
}

/**
 * Move him. His old slot opens (or he comes up from the practice squad), his
 * salary takes the premium, and his career's ceiling moves by what the move
 * did to his rating, so the room he had left to grow is the room he keeps.
 */
export function convertPlayer(league, teamIdx, id, slotId, byId) {
  const why = moveBlocker(league, teamIdx, id, slotId, byId);
  if (why) return { ok: false, reason: why };
  const team = league.teams[teamIdx];
  const slot = ROSTER_SLOTS.find((s) => s.id === slotId);
  const { premium, home } = recordMove(league, teamIdx, byId.get(id), slot.pos);
  const held = ROSTER_SLOTS.find((s) => team.slots[s.id] === id);
  if (held) team.slots[held.id] = null;
  else team.squad = squadList(team).filter((x) => x !== id);
  team.slots[slot.id] = id;
  return { ok: true, premium, from: byId.get(id).pos, to: slot.pos, opened: held?.id ?? null, home };
}

/**
 * Two men trade places, each moving to the other's position: a safety to
 * corner and the corner to safety. Each is a move like any other, with its own
 * settling and its own premium; neither slot is ever empty, which is the point,
 * since a club's depth chart has no spare corner or safety slot to move into.
 */
export function swapPositions(league, teamIdx, idA, idB, byId) {
  const why = swapBlocker(league, teamIdx, idA, idB, byId);
  if (why) return { ok: false, reason: why };
  const team = league.teams[teamIdx];
  const sa = ROSTER_SLOTS.find((s) => team.slots[s.id] === idA);
  const sb = ROSTER_SLOTS.find((s) => team.slots[s.id] === idB);
  const a = byId.get(idA), b = byId.get(idB);
  const ra = recordMove(league, teamIdx, a, sb.pos);
  const rb = recordMove(league, teamIdx, b, sa.pos);
  team.slots[sa.id] = idB;
  team.slots[sb.id] = idA;
  return { ok: true, premium: ra.premium + rb.premium, a: { id: idA, from: sa.pos, to: sb.pos, slot: sb.id, ...ra }, b: { id: idB, from: sb.pos, to: sa.pos, slot: sa.id, ...rb } };
}

/**
 * Every position a man on this club could move to, with what he would be
 * there and how he would get there: into an open slot, by trading places with
 * a man whose skills translate back, or not until a slot there is opened. The
 * player's card reads this, so a move does not wait on somebody noticing an
 * empty slot on the depth chart — with every slot full after a draft, that
 * was the only way in, and a full chart never shows one.
 */
export function moveOptions(league, teamIdx, id, byId) {
  const team = league.teams?.[teamIdx];
  const p = byId?.get(id);
  if (!team || !p || !movesOn(league)) return [];
  const onChart = ROSTER_SLOTS.some((s) => team.slots[s.id] === id);
  return positionsFor(p).filter((pos) => pos !== p.pos).map((pos) => {
    const { view, move } = asAt(league, p, pos);
    const first = move ? settle(view, move, move.season, view.base || view) : view;
    const open = ROSTER_SLOTS.find((s) => s.pos === pos && !team.slots[s.id]) || null;
    const swaps = onChart && !open ? ROSTER_SLOTS.filter((s) => s.pos === pos && team.slots[s.id]).map((s) => {
      const q = byId.get(team.slots[s.id]);
      const back = q && positionsFor(q).includes(p.pos) ? asAt(league, q, p.pos) : null;
      return {
        slot: s.id, id: q?.id, name: q?.name,
        reason: q ? swapBlocker(league, teamIdx, id, q.id, byId) : 'Unknown player',
        theirs: back ? { now: overall(q), first: overall(back.move ? settle(back.view, back.move, back.move.season, back.view.base || back.view) : back.view), settled: overall(back.view), premium: movePremium(league, q, p.pos) } : null,
      };
    }) : [];
    return {
      pos, home: !move, now: overall(p), first: overall(first), settled: overall(view),
      premium: movePremium(league, p, pos),
      open: open?.id ?? null,
      reason: open ? moveBlocker(league, teamIdx, id, open.id, byId) : manBlocker(league, teamIdx, id, pos, byId),
      swaps,
    };
  });
}

/**
 * The move itself, everything but the depth chart: his estimate at the new
 * position, the career's ceiling shifted by what the move did to his rating,
 * the premium on his deal and the transaction. Read off the league as it was
 * before either slot changed, so a swap can record both men from one state.
 */
function recordMove(league, teamIdx, p, pos) {
  const root = rootOf(p);
  const premium = movePremium(league, p, pos);
  const before = overall(unsettled(league, p));
  const { view, move } = asAt(league, p, pos);
  const after = overall(view);

  const c = league.dev?.[root.id];
  if (c) {
    const shift = after - before;
    // Replaced rather than mutated, like everything else that touches
    // `league.dev`, so a pool cached by its identity is rebuilt.
    league.dev = { ...league.dev, [root.id]: {
      ...c,
      ceiling: c.ceiling == null ? c.ceiling : Math.min(Math.max(after, positionPeak(pos)), c.ceiling + shift),
      // The scouting desk reads "moved since he arrived" off this, which
      // should be development and not the change of position.
      entry: c.entry == null ? c.entry : c.entry + shift,
    } };
  }
  const moves = { ...(league.moves || {}) };
  if (move) moves[root.id] = move; else delete moves[root.id];
  league.moves = moves;

  const deal = league.contracts?.[p.id];
  if (premium > 0 && deal) league.contracts[p.id] = { ...deal, salary: Math.min(MAX_SALARY, (deal.salary ?? 0) + premium) };
  league.transactions ??= [];
  league.transactions.push({ week: league.phase === 'season' ? league.week : 0, season: league.season, type: 'position', team: teamIdx, add: p.id, from: p.pos, to: pos, premium });
  return { premium, home: !move };
}
