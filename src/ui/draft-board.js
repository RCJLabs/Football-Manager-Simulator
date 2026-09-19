// The draft board: every club's picks, side by side, as they happen.
//
// Before this, a draft was a list of the last twelve picks in a ticker and
// nothing else. Seven or thirty-one AI clubs picked between your turns, all of
// it applied in one silent burst inside a state update, and the only trace was
// the ticker scrolling. The board is the thing a draft is actually watched on,
// so it is the thing the screen is built around.
//
// One component covers both rooms, because the shape is the same: clubs across
// the top, what they have taken stacked underneath. In a snake draft a row is a
// round, and it lines up exactly because every club picks once per round. In an
// auction clubs buy at different rates, so a row is just the Nth man that club
// bought and the column is read down rather than across.
//
// It renders as a table inside a scroller. A 32-club pro board is 27 rounds by
// 32 clubs and cannot fit a phone, so it scrolls sideways and `scrollToPick`
// keeps the live pick on screen. The first column is sticky, so you never lose
// which round you are looking at.

import { esc } from '../util.js';
import { overall } from '../engine/ratings.js';
import { shownOverall } from '../engine/scouting.js';
import { ovrClass } from './components.js';

/** How a club's column is headed: colour dot, abbreviation, and whose it is. */
function head(team, onClock) {
  return `<th class="bt ${team.isUser ? 'me' : ''} ${onClock ? 'clock' : ''}" title="${esc(team.name)}">
    <span class="dot" style="background:${esc(team.color)}"></span>${esc(team.abbr)}</th>`;
}

/**
 * One cell. `fresh` marks the pick that just landed so it can animate; the
 * caller passes it only for the newest pick, never on a full repaint, or every
 * cell on the board would flash at once.
 */
function cell(entry, { fresh = false, onClock = false, mine = false, byId, league, observer } = {}) {
  if (!entry) {
    return `<td class="bc empty ${onClock ? 'clock' : ''} ${mine ? 'mine' : ''}">${onClock ? '<span class="onclock">on the clock</span>' : ''}</td>`;
  }
  const p = byId.get(entry.playerId);
  if (!p) return '<td class="bc empty"></td>';
  // Shown, not true: a rookie nobody has scouted must not have his real rating
  // printed on the board when the rest of the app is hiding it.
  const o = league ? shownOverall(league, p, observer) : overall(p);
  const price = entry.price != null ? `<span class="bp">$${entry.price}</span>` : '';
  return `<td class="bc ${fresh ? 'fresh' : ''} ${mine ? 'mine' : ''}" data-show="${esc(p.id)}" title="${esc(p.name)}">
    <span class="bo ${ovrClass(o)}">${o}</span>
    <span class="bn">${esc(lastName(p.name))}</span>
    <span class="bm">${esc(p.pos)}${price}</span>
  </td>`;
}

/** Boards are narrow. A surname carries the man; a full name wraps to three lines. */
export function lastName(name) {
  const bits = String(name).trim().split(/\s+/);
  if (bits.length < 2) return name;
  const last = bits[bits.length - 1];
  // Keep a suffix attached to the name it belongs to.
  if (/^(jr\.?|sr\.?|i{1,3}|iv|v)$/i.test(last) && bits.length > 2) return `${bits[bits.length - 2]} ${last}`;
  return last;
}

/**
 * The whole board.
 *   rows      array of arrays: rows[r][teamIdx] is that club's entry, or null
 *   labels    what to call each row ("R1", or "" for the auction)
 *   onClock   { row, team } for the pick being waited on, or null
 *   freshKey  `${row}:${team}` of the pick that just landed, or null
 */
/**
 * `order` is the sequence the columns are laid out in, as team indices. It
 * matters more than it sounds: laid out by team index instead, a snake draft
 * twenty picks in shows those twenty scattered across the board with gaps
 * between them, because the draft order is a shuffle of the team list. In draft
 * order the filled cells run left to right and the board reads the way a draft
 * board is supposed to.
 */
export function draftBoard(league, rows, { labels = [], onClock = null, freshKey = null, byId, observer = -1, order = null } = {}) {
  const cols = (order && order.length ? order : league.teams.map((_, i) => i)).filter((i) => league.teams[i]);
  const body = rows.map((row, r) => {
    const cells = cols.map((ti) => {
      const live = !!onClock && onClock.row === r && onClock.team === ti;
      return cell(row[ti], { fresh: freshKey === `${r}:${ti}`, onClock: live, mine: !!league.teams[ti].isUser, byId, league, observer });
    }).join('');
    return `<tr><th class="bl">${esc(labels[r] ?? String(r + 1))}</th>${cells}</tr>`;
  }).join('');
  return `<table class="board">
    <thead><tr><th class="bl"></th>${cols.map((ti) => head(league.teams[ti], !!onClock && onClock.team === ti)).join('')}</tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

/**
 * The board as its own screen. A 32-club board is 27 rounds by 32 clubs and was
 * being asked to live in a banner a few centimetres tall; here it gets the
 * whole viewport and the draft carries on behind it.
 */
export function boardOverlay(inner, { title = 'Draft board', sub = '' } = {}) {
  return `<div class="board-full" id="boardFull" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="board-full-head">
      <div><b>${esc(title)}</b>${sub ? ` <span class="muted">${esc(sub)}</span>` : ''}</div>
      <button class="btn sm" id="boardClose" aria-label="Close the board">Close ✕</button>
    </div>
    <div class="board-scroll board-full-body" id="boardScroll">${inner}</div>
    <div class="board-full-foot"><small class="muted">Tap a pick for his card. Pinch or drag to move around.</small></div>
  </div>`;
}

/**
 * Keep the live pick in view without yanking the page around: only the board's
 * own scroller moves, and only when the cell is actually outside it.
 */
export function scrollToPick(root, { onlyFresh = false } = {}) {
  const scroller = root.querySelector('#boardScroll');
  if (!scroller) return;
  // Opening the board deliberately should not fling you into the middle of it
  // with no context; following the action is for when a pick actually lands.
  const target = scroller.querySelector(onlyFresh ? '.bc.fresh' : '.bc.clock, .bc.fresh');
  if (!target) return;
  const sr = scroller.getBoundingClientRect(), tr = target.getBoundingClientRect();
  if (tr.left < sr.left + 8) scroller.scrollLeft -= (sr.left + 8 - tr.left);
  else if (tr.right > sr.right - 8) scroller.scrollLeft += (tr.right - (sr.right - 8));
  if (tr.top < sr.top + 8) scroller.scrollTop -= (sr.top + 8 - tr.top);
  else if (tr.bottom > sr.bottom - 8) scroller.scrollTop += (tr.bottom - (sr.bottom - 8));
}

/**
 * Snake picks, arranged into rounds × clubs.
 *
 * The row count comes from the picks, plus the round being played while one
 * still is. Reading `draft.round` alone adds a phantom round to a finished
 * board: makePick increments it and only then notices the draft is over, so a
 * complete 27-round draft leaves the counter on 28.
 */
export function snakeRows(league, draft) {
  const teams = league.teams.length;
  let rounds = draft.complete ? 0 : Math.max(draft.round, 1);
  for (const pk of draft.picks) rounds = Math.max(rounds, pk.round || 1);
  const rows = [];
  for (let r = 0; r < Math.max(rounds, 1); r++) rows.push(new Array(teams).fill(null));
  for (const pk of draft.picks) rows[(pk.round || 1) - 1][pk.team] = pk;
  return rows;
}

/** Auction buys, stacked per club in the order they were won. */
export function auctionRows(league, auction) {
  const per = league.teams.map(() => []);
  for (const s of auction.sold || []) if (per[s.team]) per[s.team].push(s);
  const depth = per.reduce((m, a) => Math.max(m, a.length), 0);
  const rows = [];
  for (let i = 0; i < depth; i++) rows.push(per.map((a) => a[i] || null));
  return rows;
}
