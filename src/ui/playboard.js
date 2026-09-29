// The coach-mode play board: a diagram on every call button, a line over the
// calls saying what the other side has shown in this situation, and a fold with
// the whole game so far — the other side's calls by situation and the two
// sides' calls against each other (engine/tendencies.js).
//
// Offence down the side and defence across, whichever the human is calling,
// which is the shape of `CALL_GRID`: on the ball it is the human's calls
// against their looks, on defence their calls against the human's.

import { html, raw } from '../util.js';
import { OFFENSE_CALLS, DEFENSE_CALLS } from '../engine/playcall.js';
import { SITUATIONS, situationKey, defenceTendency, offenceTendency, callGrid } from '../engine/tendencies.js';

/** The scrimmage calls in the order the buttons show them. */
export const PLAY_KEYS = ['run_in', 'run_out', 'pass_short', 'pass_med', 'pass_deep', 'screen', 'pa_pass'];
const LOOK_KEYS = Object.keys(DEFENSE_CALLS);
const LOOK_SHORT = { base: 'Base', run_stop: 'Stack', blitz: 'Blitz', deep: 'Deep' };
const KIND_LABEL = { run: 'Run', pass: 'Pass' };

// ---------------------------------------------------------------------------
// Diagrams
// ---------------------------------------------------------------------------

// Drawn on a 36 by 24 field, upfield being up, in the button's own colour so
// they follow the theme and a pressed button. Few marks and heavy ones: at
// the size a phone gives them, three and a half pixels to a yard, a formation
// of eleven reads as noise, so each shows the one thing its call is about.
// The label says what the call is, so a diagram is decoration to a screen
// reader and hidden from it.
const f1 = (n) => Math.round(n * 10) / 10;
const dot = (x, y, r = 1.7) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor" stroke="none"/>`;
const cross = (x, y, s = 1.35) => `<path d="M${f1(x - s)} ${f1(y - s)}L${f1(x + s)} ${f1(y + s)}M${f1(x + s)} ${f1(y - s)}L${f1(x - s)} ${f1(y + s)}"/>`;
function route(points, { dashed = false, head = true } = {}) {
  let out = `<path d="M${points.map(([x, y]) => `${f1(x)} ${f1(y)}`).join('L')}"${dashed ? ' stroke-dasharray="2.2 2"' : ''}/>`;
  if (head) {
    const [x1, y1] = points[points.length - 2], [x2, y2] = points[points.length - 1];
    const a = Math.atan2(y2 - y1, x2 - x1);
    const wing = (t) => `${f1(x2 - 3 * Math.cos(a + t))} ${f1(y2 - 3 * Math.sin(a + t))}`;
    out += `<path d="M${wing(-0.6)}L${f1(x2)} ${f1(y2)}L${wing(0.6)}"/>`;
  }
  return out;
}
const svg = (body) => `<svg class="callicon" viewBox="0 0 36 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
// The line of scrimmage and the three interior linemen, faint, for bearings.
const line = (y, lineY) => `<g class="faint"><path d="M1.5 ${y}H34.5" stroke-width="1"/>${[13.5, 18, 22.5].map((x) => dot(x, lineY, 1.35)).join('')}</g>`;
// On the ball: the line near the top of the drawing's lower half.
const OFF = line(13, 15.6);
const QB = dot(18, 19.4);
const RB = dot(18, 22);
// On defence: the line of scrimmage at the foot, three down linemen on it.
const DEF = '<path class="faint" d="M1.5 21H34.5" stroke-width="1"/>' + [12, 18, 24].map((x) => cross(x, 17.6, 1.6)).join('');
const ICONS = {
  run_in: OFF + RB + route([[18, 20], [15.8, 16.4], [15.8, 3.2]]),
  run_out: OFF + RB + route([[19.8, 21.6], [25.5, 20.4], [29.8, 16.6], [31, 12], [31, 3.2]]),
  // The throw behind the line, dashed, then the catch and run.
  screen: OFF + QB + route([[16.2, 19.4], [9.6, 19.4]], { dashed: true, head: false }) + route([[7.8, 19.4], [7.8, 3.2]]),
  pass_short: OFF + QB + dot(31, 13) + route([[31, 10.8], [31, 8], [25, 4.6]]),
  pass_med: OFF + QB + dot(31, 13) + route([[31, 10.8], [31, 5], [21, 5]]),
  pass_deep: OFF + QB + dot(5, 13) + dot(31, 13) + route([[5, 10.8], [5, 1.8]]) + route([[31, 10.8], [31, 1.8]]),
  // The fake into the line, dashed, and the throw over the top of it.
  pa_pass: OFF + QB + route([[18, 21.8], [16, 17.6]], { dashed: true, head: false }) + dot(5, 13) + route([[5, 10.8], [5, 7], [22, 2]]),
  // Three levels, evenly spread.
  base: DEF + [10, 26].map((x) => cross(x, 11.2, 1.6)).join('') + [13, 23].map((x) => cross(x, 4.4, 1.6)).join(''),
  // Everyone crowded down on the line.
  run_stop: DEF + [6, 12, 18, 24, 30].map((x) => cross(x, 12.2, 1.6)).join(''),
  // The second level coming through the gaps.
  blitz: DEF + route([[8.5, 6], [12.4, 13.4]]) + route([[18, 5.4], [18, 12.8]]) + route([[27.5, 6], [23.6, 13.4]]),
  // Two deep, each with half the field over the top.
  deep: DEF + [10, 26].map((x) => cross(x, 12, 1.6)).join('') + [8, 28].map((x) => cross(x, 6.4, 1.6)).join('')
    + '<path d="M1.8 7Q8 -0.4 14.2 7M21.8 7Q28 -0.4 34.2 7" stroke-width="1.3"/>',
};

/** The diagram for a call, as SVG markup, or '' for one without. */
export function callIcon(key) {
  return ICONS[key] ? svg(ICONS[key]) : '';
}

// ---------------------------------------------------------------------------
// The line over the calls
// ---------------------------------------------------------------------------

/** "Deep Shell 3 · Blitz 2 · Base 1", most shown first, nothing shown left out. */
function countList(calls, label) {
  const order = Object.keys(calls);
  return Object.entries(calls)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([k, n]) => `${label(k)} ${n}`)
    .join(' · ');
}

const lookLabel = (k) => DEFENSE_CALLS[k]?.label || k;
const kindLabel = (k) => KIND_LABEL[k] || k;

/**
 * What the other side has shown in the situation the human is calling in, or
 * over every down while this situation has not come up yet. Nothing on the
 * first snap, when there is nothing to say.
 *
 * `mode` is the decision the human faces: 'offense' reads their defence,
 * 'defense' reads their offence.
 */
export function tendencyLine(g, mode, userSide, snaps) {
  const theirs = 1 - userSide;
  const t = mode === 'offense' ? defenceTendency(snaps, theirs) : offenceTendency(snaps, theirs);
  if (!t.all.n) return '';
  const key = situationKey({ down: g.down, toGo: g.toGo, ballOn: g.ballOn });
  const sit = SITUATIONS.find((s) => s.key === key);
  const side = mode === 'offense' ? 'Their defence' : 'Their offence';
  const label = mode === 'offense' ? lookLabel : kindLabel;
  const here = t.by[key];
  if (here.n) return html`<p class="tendency"><span class="muted">${side} ${sit.phrase}:</span> ${countList(here.calls, label)}</p>`;
  return html`<p class="tendency"><span class="muted">None ${sit.phrase} yet. ${side} on every down:</span> ${countList(t.all.calls, label)}</p>`;
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

const MINUS = '−';
/** Points a play, signed, to a tenth. */
export function fmtPoints(p) {
  const r = Math.round(p * 10) / 10;
  if (r === 0) return '0.0';
  return `${r > 0 ? '+' : MINUS}${Math.abs(r).toFixed(1)}`;
}
/** Good or bad for the human, whichever side of the ball the points were scored on. */
const tone = (p, forUser) => {
  const r = Math.round(p * 10) / 10 * (forUser ? 1 : -1);
  return r > 0 ? 'good' : r < 0 ? 'bad' : '';
};

function situationTable(t, mode, nowKey) {
  const cols = mode === 'offense' ? LOOK_KEYS : ['run', 'pass'];
  const head = mode === 'offense' ? (k) => LOOK_SHORT[k] : kindLabel;
  const title = mode === 'offense' ? (k) => DEFENSE_CALLS[k].label : kindLabel;
  return html`<div class="pb-scroll"><table class="pb-table">
    <caption>${mode === 'offense' ? 'Their defence' : 'Their offence'}, by situation</caption>
    <thead><tr><th scope="col" class="lbl"><span class="sr-only">Situation</span></th>${cols.map((k) => html`<th scope="col" class="num" title="${title(k)}">${head(k)}</th>`)}</tr></thead>
    <tbody>${SITUATIONS.map((s) => {
      const row = t.by[s.key];
      const top = Math.max(0, ...cols.map((k) => row.calls[k]));
      const lead = cols.filter((k) => row.calls[k] === top).length === 1 ? top : -1;
      return html`<tr class="${s.key === nowKey ? 'now' : ''}"><th scope="row" class="lbl">${s.label}${s.key === nowKey ? html` <span class="nowtag">now</span>` : ''}</th>${cols.map((k) => {
        const n = row.calls[k];
        return n ? html`<td class="num">${n === lead ? html`<b>${n}</b>` : n}</td>` : html`<td class="num nil">–</td>`;
      })}</tr>`;
    })}</tbody>
  </table></div>`;
}

function gridCell(c, forUser) {
  if (!c || !c.n) return html`<td class="num nil">–</td>`;
  const p = c.points / c.n;
  return html`<td class="num"><span class="pts ${tone(p, forUser)}">${fmtPoints(p)}</span><small>${c.n}</small></td>`;
}

function gridTable(grid, mode) {
  const forUser = mode === 'offense';
  const rows = PLAY_KEYS.filter((k) => grid.rows[k]?.n);
  if (!rows.length) return '';
  return html`<div class="pb-scroll"><table class="pb-table pb-grid">
    <caption>${forUser ? 'Your calls against theirs' : 'Their calls against yours'}</caption>
    <thead><tr><th scope="col" class="lbl"><span class="sr-only">${forUser ? 'Your call' : 'Their call'}</span></th>${LOOK_KEYS.map((k) => html`<th scope="col" class="num" title="${DEFENSE_CALLS[k].label}">${LOOK_SHORT[k]}</th>`)}<th scope="col" class="num">All</th></tr></thead>
    <tbody>${rows.map((k) => html`<tr><th scope="row" class="lbl">${OFFENSE_CALLS[k].label}</th>${LOOK_KEYS.map((d) => gridCell(grid.rows[k].cells[d], forUser))}${gridCell(grid.rows[k], forUser)}</tr>`)}</tbody>
    <tfoot><tr><th scope="row" class="lbl">All</th>${LOOK_KEYS.map((d) => gridCell(grid.cols[d], forUser))}${gridCell(grid.total, forUser)}</tr></tfoot>
  </table></div>`;
}

/**
 * The fold. `open` is whether the player left it open, which the view keeps
 * across redraws. The other side's game plan leads, as the matchup card on
 * the hub printed it before kickoff: it is what they meant to do, and the
 * counts under it are what they have done.
 */
export function playBoard(g, mode, userSide, snaps, { open = false } = {}) {
  const theirs = 1 - userSide;
  const offSide = mode === 'offense' ? userSide : theirs;
  // The snaps the board is about: the human's with the ball, theirs without.
  const count = snaps.filter((s) => s.off === offSide).length;
  const t = mode === 'offense' ? defenceTendency(snaps, theirs) : offenceTendency(snaps, theirs);
  const nowKey = situationKey({ down: g.down, toGo: g.toGo, ballOn: g.ballOn });
  const notes = g.teams[theirs].plan?.notes || [];
  return html`<details class="playboard" data-fold="board" ${open ? 'open' : ''}>
    <summary class="muted">Play board${count ? ` · ${count} snap${count === 1 ? '' : 's'}` : ''}</summary>
    ${notes.length ? html`<p class="pb-plan"><span class="muted">Their game plan:</span> ${notes.join('; ')}.</p>` : ''}
    ${count ? html`
      ${situationTable(t, mode, nowKey)}
      ${gridTable(callGrid(snaps, offSide), mode)}
      <p class="muted pb-note">Each box is points a play, with the number of plays under it: what a snap added to the expected points of the drive, on the curve the fourth-down calls use. Plus is ${mode === 'offense' ? 'yours' : 'theirs'}. One play swings it by more than the gap between two calls, so a few plays in a box are what happened, not what will.</p>`
      : html`<p class="muted pb-note">Nothing yet: the board fills in from the first snap.</p>`}
  </details>`;
}
