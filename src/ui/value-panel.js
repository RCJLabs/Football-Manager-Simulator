// "Where money wins games": the one thing a new manager has no way to work out
// and cannot play well without.
//
// The auction is deliberately mispriced. Asking prices follow reputation, real
// value follows win impact, and the gap between them is the entire strategy —
// but until now that gap was documented in DESIGN.md and nowhere in the product,
// so a first-time player faced a $200 budget over 1,269 names with no idea that
// a kicker is worth a fortieth of a quarterback.
//
// It is positional, never per player. Showing what an individual is worth would
// hand over the answer and delete the auction; showing that the room overpays
// for running backs is a strategy you still have to execute under a budget,
// against nine other bidders, with the good ones gone by the time you commit.
//
// Everything here is derived from the engine's own tables at render time rather
// than written down, so retuning a leverage number moves this screen with it and
// it cannot quietly start teaching something the simulation no longer does.

import { html, raw } from '../util.js';
import { positionValue } from '../engine/auction.js';
import { POSITIONS } from '../data/positions.js';

const VERDICT_CLASS = { underpaid: 'good', 'about right': 'fair', overpaid: 'poor', 'badly overpaid': 'bad', 'barely matters': 'nil' };

/**
 * The panel. `compact` drops the explanation for the in-auction version, where
 * the screen is already busy and the reader has met the idea before.
 */
export function valuePanel({ compact = false } = {}) {
  const rows = positionValue();
  const maxShare = Math.max(...rows.flatMap((r) => [r.wins, r.price]));
  const bar = (v, cls) => `<span class="vbar ${cls}" style="width:${(v / maxShare * 100).toFixed(1)}%"></span>`;
  const body = rows.map((r) => `<tr>
    <td><b>${r.pos}</b> <span class="muted hide-sm">${POSITIONS[r.pos].name}</span></td>
    <td class="vcell">${bar(r.wins, 'wins')}<span class="vnum">${(r.wins * 100).toFixed(1)}%</span></td>
    <td class="vcell">${bar(r.price, 'price')}<span class="vnum">${(r.price * 100).toFixed(1)}%</span></td>
    <td class="num"><span class="verdict ${VERDICT_CLASS[r.verdict]}" title="${r.verdict}">${r.ratio.toFixed(2)}×</span></td>
    <td class="num hide-sm">${r.starters}</td>
  </tr>`).join('');

  return html`<div class="value-panel">
    ${compact ? '' : html`<p class="muted" style="font-size:.9rem;margin:.2rem 0 .6rem">
      Two numbers drive this auction and the gap between them is the whole game. <b>Wins</b> is what one player of a given rating is actually worth, measured by boosting a position group on an otherwise equal team and taking the extra win rate. <b>Price</b> is what the room will pay for that same player. Where wins runs ahead of price, the bargains are.
    </p>`}
    <div class="table-wrap"><table class="value-table">
      <thead><tr><th>Position</th><th>Wins</th><th>Price</th><th class="num">Value</th><th class="num hide-sm">Starters</th></tr></thead>
      <tbody>${raw(body)}</tbody>
    </table></div>
    <small class="muted">Per player of equal rating, so it is the right unit when bidding on one man and the wrong one for a whole budget: a lineman is worth a fifth of a quarterback and you have to buy five of him. Two caveats worth knowing. It is an average across a position's starters, and where there are several the first is worth appreciably more than the average — a number one receiver is worth about two-thirds again what the figure here says. And a good ratio on a position worth almost nothing is still worth almost nothing, which is what <span class="verdict nil">barely matters</span> means. All measured against this simulation, not received football wisdom.</small>
  </div>`;
}

/** One sentence for a screen that only has room for one. */
export function valueHint() {
  const rows = positionValue();
  const best = rows.slice(0, 2).map((r) => r.pos).join(' and ');
  const worst = rows.filter((r) => r.pos !== 'K' && r.pos !== 'P').slice(-2).map((r) => r.pos).join(' and ');
  return `${best} go for less than they are worth; ${worst} go for more. Kickers and punters are worth almost nothing and always cost something.`;
}
