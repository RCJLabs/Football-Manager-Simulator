// What a player would be at another position.
//
// A rating is how dominant a man was at a skill relative to his contemporaries
// at his position, put onto one 40-99 scale by honours — All-Pro, Pro Bowl,
// solid starter (DESIGN.md, "Cross-era ratings"). So a skill carries across positions
// only where both positions rate it against the same kind of player. The pool
// shows what happens where they do not: linebackers rate as fast as corners,
// 83.1 against 82.5, and faster than safeties, which is true of no common
// scale — a linebacker's 90 in coverage is a linebacker's 90. Carried across
// as it stands, it made Ray Lewis a 92 cornerback. Nobody in the pool is rated
// at two positions that share a skill, so the gap cannot be measured and
// corrected; a move is
// therefore allowed only inside a group whose players are rated against
// overlapping peers — defensive backs with defensive backs (safeties a little
// slower than corners and better tacklers, as they should be on one scale),
// receivers with receivers (tight ends slower than receivers, likewise), and
// the pass rush with the pass rush.
//
// Within a group the man is the same man judged by a different weighting, and
// the engine plays him by his skills whatever the depth chart calls him. Most
// moves still need a skill the old position never rated, and DESIGN.md
// recorded, under positional decline, that a position change "cannot be built
// without inventing attributes he has never had". That is the second rule: a
// move may need at most one skill he was never rated on, and only when
// guessing it cannot move his rating by more than `MAX_GUESS` points. The guess
// is what men at the new position with his other skills are rated at it,
// fitted over the pool, so its weight times its typical error is the bound.
// Derived from the groups, attribute lists, weights and fits rather than
// listed, so re-rating the pool re-draws the table:
//
//   nothing to estimate   S -> CB, TE -> WR, LB -> DL
//   one light skill       CB -> S (run defence)
//
// What the rules turn away, and why, is written down in DESIGN.md.
//
// The estimate is marked down by `UNTRAINED`, because a skill a man was never
// asked to use is not one he has kept sharp. And the job itself takes learning:
// his first season at the new position costs every skill `SETTLING[0]`, his
// second `SETTLING[1]`, and then he is what the translation says he is.
//
// A leaf: positions, the pool and the rating formula, nothing from the
// engine, so careers.js can build its views through it without a cycle.

import { POSITIONS } from '../data/positions.js';
import { PLAYERS } from '../data/players.js';
import { rawOverall } from './ratings.js';

/** Points off the one estimated skill, for never having trained it. Chosen, not measured. */
export const UNTRAINED = 5;
/** Points off every skill in his first and second seasons at the new position. Chosen, not measured. */
export const SETTLING = [4, 2];
/** The most the estimated skill may typically move his rating, in overall points. */
export const MAX_GUESS = 1;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Positions whose players are rated against overlapping peers, so that a
 * skill means the same thing at each. A linebacker belongs with the pass rush
 * rather than the secondary because an edge rusher is the same athlete at
 * either end of the line, and because the one comparison the pool allows —
 * speed, which linebackers share with defensive backs — puts him on a scale
 * of his own.
 */
export const GROUP = { QB: 'passer', RB: 'back', WR: 'receiver', TE: 'receiver', OL: 'line', DL: 'rush', LB: 'rush', CB: 'secondary', S: 'secondary', K: 'kick', P: 'kick' };

function missingFor(from, to) {
  const have = new Set(POSITIONS[from]?.attrs || []);
  return (POSITIONS[to]?.attrs || []).filter((a) => !have.has(a));
}

/**
 * Least squares by the normal equations, for the handful of predictors a
 * position has. Gaussian elimination with partial pivoting; no library.
 * `rse` is the residual standard error — the typical miss, corrected for the
 * parameters the fit spent — and `spread` the
 * skill's own standard deviation, so `1 - (rse / spread)²` reads as R².
 */
function ols(rows, xs, y) {
  const k = xs.length + 1;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const v = new Array(k).fill(0);
  for (const r of rows) {
    const x = [1, ...xs.map((a) => r[a])];
    for (let i = 0; i < k; i++) {
      v[i] += x[i] * r[y];
      for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j];
    }
  }
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    [v[c], v[piv]] = [v[piv], v[c]];
    for (let r = 0; r < k; r++) {
      if (r === c || !A[c][c]) continue;
      const f = A[r][c] / A[c][c];
      for (let j = c; j < k; j++) A[r][j] -= f * A[c][j];
      v[r] -= f * v[c];
    }
  }
  const beta = v.map((val, i) => (A[i][i] ? val / A[i][i] : 0));
  const predict = (r) => beta[0] + xs.reduce((s, a, i) => s + beta[i + 1] * (r[a] ?? 60), 0);
  const mean = rows.reduce((s, r) => s + r[y], 0) / rows.length;
  let sse = 0, sst = 0;
  for (const r of rows) { sse += (r[y] - predict(r)) ** 2; sst += (r[y] - mean) ** 2; }
  return { beta, predict, rse: Math.sqrt(sse / Math.max(1, rows.length - k)), spread: Math.sqrt(sst / rows.length), n: rows.length };
}

const fits = new Map();
/**
 * How the missing skill is estimated for a move, fitted once over the new
 * position's players in the shipped pool: the skill against the ones the mover
 * has. `null` for a move with nothing to estimate, or more than one.
 */
export function estimateFor(from, to) {
  const key = `${from}>${to}`;
  if (fits.has(key)) return fits.get(key);
  const miss = missingFor(from, to);
  let fit = null;
  if (miss.length === 1 && POSITIONS[from] && POSITIONS[to]) {
    const xs = POSITIONS[to].attrs.filter((a) => a !== miss[0]);
    const rows = PLAYERS.filter((p) => p.pos === to && !p.generated).map((p) => p.r);
    if (rows.length > xs.length + 1) fit = { attr: miss[0], from: xs, ...ols(rows, xs, miss[0]) };
  }
  fits.set(key, fit);
  return fit;
}

/**
 * The heaviest a skill weighs in any vector the position is rated on. A
 * linebacker is rated on whichever of two vectors suits him, so a skill light
 * in one can be heavy in the other, and the bound has to hold for both.
 */
function heaviest(pos, attr) {
  const def = POSITIONS[pos];
  return Math.max(def?.weights?.[attr] ?? 0, def?.edgeWeights?.[attr] ?? 0);
}

/** How far, typically, the estimate could leave his new rating from the truth. */
export function guessError(from, to) {
  const fit = estimateFor(from, to);
  return fit ? heaviest(to, fit.attr) * fit.rse : 0;
}

/** Every move the rule allows, as `{ from: [to, ...] }`. */
export const CONVERSIONS = (() => {
  const out = {};
  for (const from of Object.keys(POSITIONS)) {
    for (const to of Object.keys(POSITIONS)) {
      if (from === to || GROUP[from] !== GROUP[to]) continue;
      const miss = missingFor(from, to);
      const shared = POSITIONS[to].attrs.length - miss.length;
      if (shared < 3 || miss.length > 1) continue;
      if (miss.length === 1 && !(estimateFor(from, to) && guessError(from, to) <= MAX_GUESS)) continue;
      (out[from] ??= []).push(to);
    }
  }
  return out;
})();

export function canMove(from, to) {
  return !!CONVERSIONS[from]?.includes(to);
}

/**
 * The missing skill as it would be read today, from the skills he has now:
 * `{ attr: rating }`, empty for a move with nothing to estimate. Read once, at
 * the move, and then kept — re-reading it every season would count his
 * development twice, once in the skills it is read from and again in the
 * career deltas the skill then earns in its own right.
 */
export function fillFor(r, from, to) {
  const fit = estimateFor(from, to);
  if (!fit) return {};
  return { [fit.attr]: clamp(Math.round(fit.predict(r || {}) - UNTRAINED), 40, 99) };
}

/**
 * The man as his new position sees him, before careers or settling: the
 * record careers develop from once he has moved. Always built from the pool's
 * own record, which `orig` keeps, so a view is rebuilt from the start rather
 * than moved twice. `move.fill` is the estimated skill as a base rating — see
 * convert.js for how a career's delta is taken out of it.
 */
export function movedBase(orig, move) {
  const r = {};
  let guessed = null;
  for (const a of POSITIONS[move.to].attrs) {
    if (orig.r && a in orig.r) r[a] = orig.r[a];
    else if (move.fill && a in move.fill) r[a] = move.fill[a];
    else r[a] = (guessed ??= fillFor(orig.r, orig.pos, move.to))[a] ?? 60;
  }
  return { ...orig, pos: move.to, r, orig, moved: { from: orig.pos, to: move.to, season: move.season }, ovr: rawOverall(move.to, r) };
}

/** What learning the job still costs him in this season. */
export function settlingCost(move, season) {
  const years = (season ?? move.season) - move.season;
  return years >= 0 ? (SETTLING[years] ?? 0) : 0;
}

/**
 * A view with this season's settling cost taken off every skill. `base` is
 * kept, or set to the unsettled record, so careers never develop from a cost
 * that is meant to wear off.
 */
export function settle(view, move, season, src) {
  const pen = settlingCost(move, season);
  if (!pen) return view;
  const r = {};
  for (const [a, v] of Object.entries(view.r)) r[a] = clamp(v - pen, 40, 99);
  return { ...view, r, ovr: rawOverall(view.pos, r), base: view.base ?? src, settling: pen };
}
