// Two players, side by side.
//
// The pool is fifteen hundred deep and every position rates on its own
// attributes, so choosing between two backs meant opening one modal, trying to
// hold six numbers in your head, closing it and opening another. This is that
// decision on one screen.
//
// It is deliberately not a new route. A compare button lives in `playerModal`,
// which means every place a player can be tapped — the pool, a roster, the
// draft board, the auction room, a box score — can start one for free.
//
// The fog is the constraint that shapes everything here. `attrList` coarsens an
// unscouted rookie's attributes on purpose and `ovrBadge` shows him as a range,
// because a precise number is not scoutable. A comparison that subtracted true
// ratings would hand back exactly what those two hide, so every number on this
// screen comes through the same scouting path and a delta is computed from what
// is SHOWN rather than from what is true. Where either side is an estimate the
// delta is marked as one.
import { html, raw, esc } from '../util.js';
import { POSITIONS } from '../data/positions.js';
import { TRUE_LEVERAGE } from '../engine/ratings.js';
import { coarseAttrs } from '../engine/scouting.js';
import { modal, ovrBadge, posBadge, scoutView, ATTR_NAMES } from './components.js';

/**
 * What a player's attributes look like to the observer, as a map.
 *
 * `view` is injectable so the fog is testable; left out it is the live one,
 * which is what every caller in the app wants.
 */
function shownAttrs(p, view = scoutView()) {
  const rows = view ? coarseAttrs(view.league, p, view.observer)
    : POSITIONS[p.pos].attrs.map((a) => ({ attr: a, value: p.r[a], exact: true }));
  return new Map(rows.map((r) => [r.attr, r]));
}

/**
 * Attribute rows aligned across two players.
 *
 * Same position and every row is shared. Different positions and the union is
 * taken in each position's own declared order, so a row a player does not carry
 * reads as absent rather than as a zero — a tight end has no pass rush, which
 * is not the same as being bad at it.
 */
export function alignAttrs(a, b, view = scoutView()) {
  const av = shownAttrs(a, view), bv = shownAttrs(b, view);
  const order = [...POSITIONS[a.pos].attrs];
  for (const x of POSITIONS[b.pos].attrs) if (!order.includes(x)) order.push(x);
  return order.map((attr) => {
    const ar = av.get(attr), br = bv.get(attr);
    const both = !!ar && !!br;
    return {
      attr,
      name: ATTR_NAMES[attr] || attr,
      a: ar ? ar.value : null,
      b: br ? br.value : null,
      exact: (!ar || ar.exact) && (!br || br.exact),
      delta: both ? ar.value - br.value : null,
    };
  });
}

// Below this many shared attributes a tally is noise wearing a verdict's
// clothes: a back and a quarterback share only awareness, and "right leads 1-0
// of 1" reads like a finding while saying nothing. The leverage note carries
// that case instead.
export const MIN_SHARED = 3;

/** A one-line verdict, or '' when there is not enough overlap to have one. */
export function edgeLine(rows) {
  const shared = rows.filter((r) => r.delta != null);
  if (shared.length < MIN_SHARED) return '';
  const aWins = shared.filter((r) => r.delta > 0).length;
  const bWins = shared.filter((r) => r.delta < 0).length;
  if (aWins === bWins) return `Level on ${shared.length} shared attributes.`;
  return `${aWins > bWins ? 'Left' : 'Right'} leads ${Math.max(aWins, bWins)}–${Math.min(aWins, bWins)} of ${shared.length}.`;
}

const bar = (v, side) => (v == null ? '<i class="none"></i>' : `<i class="${side}" style="width:${Math.max(0, Math.min(100, v))}%"></i>`);
const cell = (v, exact) => (v == null ? '<span class="na">—</span>' : `${exact ? '' : '~'}${v}`);

// Overall first, then the name. Putting it last meant a name that wrapped to
// two lines pushed its badge a line below the other player's, so the one pair
// of numbers most worth reading together did not line up.
function headline(p) {
  return `<div class="cmp-who">
    <div class="ovr-wrap">${ovrBadge(p).__raw}</div>
    <div class="nm">${esc(p.name)}</div>
    <div class="meta">${posBadge(p.pos).__raw}<span>${p.generated ? `class of ${p.season}` : `${esc(String(p.season))} ${esc(p.team)}`}</span></div>
  </div>`;
}

/** Side by side. Returns the modal handle so a caller can close it. */
export function compareModal(a, b) {
  const rows = alignAttrs(a, b);
  // Deltas come off the SHOWN values above, so a rookie the observer has not
  // scouted cannot be read by subtracting him from somebody known.
  const crossPos = a.pos !== b.pos;
  const anyEstimate = rows.some((r) => !r.exact);
  const body = rows.map((r) => {
    const lead = r.delta == null ? '' : r.delta > 0 ? ' a-up' : r.delta < 0 ? ' b-up' : '';
    return `<div class="cmp-row${lead}">
      <span class="v a">${cell(r.a, r.exact)}</span>
      <span class="track a">${bar(r.a, 'a')}</span>
      <span class="lbl">${esc(r.name)}</span>
      <span class="track b">${bar(r.b, 'b')}</span>
      <span class="v b">${cell(r.b, r.exact)}</span>
    </div>`;
  }).join('');

  return modal(html`
    <div class="row between"><h2 style="margin:0">Compare</h2><button class="btn sm ghost" data-close aria-label="Close">✕</button></div>
    <div class="cmp-head">${raw(headline(a))}${raw(headline(b))}</div>
    <div class="cmp-rows">${raw(body)}</div>
    <p class="muted cmp-note">${edgeLine(rows)}${anyEstimate ? ' Tildes are projections, not measurements — he has not played yet.' : ''}</p>
    ${crossPos ? html`<p class="muted cmp-note">Different positions, so the attributes do not line up and the overalls are not the same currency. What a club pays for is leverage: a ${POSITIONS[a.pos].name.toLowerCase()} is worth ${TRUE_LEVERAGE[a.pos]} to a ${POSITIONS[b.pos].name.toLowerCase()}'s ${TRUE_LEVERAGE[b.pos]}.</p>` : ''}
  `);
}

// The player waiting for a partner, if any. Module state rather than app state:
// it is a half-finished gesture, not something a save should remember.
let pending = null;
export const pendingCompare = () => pending;
export const setPendingCompare = (p) => { pending = p; };
export const clearPendingCompare = () => { pending = null; };

/** The button `playerModal` shows, given who is already waiting. */
export function compareButton(p) {
  const other = pending;
  if (other && other.id === p.id) return '<button class="btn sm ghost" data-cmp-cancel>Cancel compare</button>';
  if (other) return `<button class="btn sm" data-cmp-with>Compare with ${esc(other.name)}</button>`;
  return '<button class="btn sm ghost" data-cmp-start>Compare…</button>';
}
