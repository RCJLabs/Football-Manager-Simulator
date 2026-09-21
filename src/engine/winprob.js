// Win probability for the home side, fitted to this simulation rather than to
// the real league. A normal model: the margin the game will end at is the
// current margin plus what the possession is worth plus what the stronger
// roster still expects to add, with a spread that shrinks with the time left.
//
// Fit on synthetic games with penalties on: final margins spread about 12.5
// points (standard deviation) between equal rosters, a point of team power is
// worth about 3.3 points of margin, and the home edge is about two points.
// Calibration is checked in tests/winprob.test.js.

import { teamPower } from './ratings.js';

export const MARGIN_SD = 12.5;
export const POINTS_PER_POWER = 3.3;
export const HOME_EDGE_POINTS = 2.2;
const Q_LEN = 900;

/** Standard normal CDF (Abramowitz-Stegun, good to 1e-7). */
export function Phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/**
 * Points the offense can expect from here, before the defense answers.
 *
 * Measured rather than drawn: `scripts/expected-points.mjs` takes every drive
 * in a few hundred games, finds the next score by either side, and credits it
 * to whoever had the ball. The line that used to be here — `(ballOn - 20) / 12`
 * — put midfield at 3.10 points where the simulation actually pays 1.81, and
 * ran at twelve yards to a point against a measured eighteen. As a small
 * correction inside a probability model nobody noticed; asked whether to punt,
 * it says go for it on fourth and five from your own forty.
 *
 * The fit is weighted by how many drives sit behind each spot, because the far
 * end of the field is thin and an unweighted line lets a handful of drives from
 * the opponent's ten drag the whole curve. Mean error against the measured
 * buckets is 0.15 points.
 *
 * Re-fitted after `sticks` and the stronger red-zone squeeze, which changed
 * what drives are worth and so made the previous fit — 0.0525 and 0.009 — a
 * stale measurement of an engine that no longer existed. It read own-20 at
 * 1.06 points against a measured 0.93. Note the loop: this curve decides
 * fourth downs, fourth downs change drive outcomes, and drive outcomes are
 * what the curve is fitted to, so re-running `npm run ep` after changing it
 * gives a slightly different answer again. It settles quickly — 0.0547 then
 * 0.0539, which is eight hundredths of a point at midfield — and the second
 * pass is what ships.
 *
 * Re-fitted again when the passing game was re-composed: a completion in this
 * engine was 8.93 air yards and 3.81 after the catch, against a real game
 * nearer 6.0 and 5.3, and moving it part of the way changed what a drive is
 * worth. 0.0539 to 0.0528, about a tenth of a point at midfield. Same loop,
 * same rule: re-run and ship the pass that has stopped moving.
 */
export const EP_PER_YARD = 0.0528;
export const EP_AT_OWN_GOAL = -0.269;

export function expectedPoints(ballOn, down = 1, toGo = 10) {
  let ep = ballOn * EP_PER_YARD + EP_AT_OWN_GOAL;
  ep -= (down - 1) * 0.45 + Math.max(0, toGo - 10) * 0.08;
  if (down === 4 && toGo > 3) ep -= 1.2;
  return ep;
}

/** The margin the stronger side expects over a full game: power gap and home edge. */
export function priorMargin(home, away, neutral) {
  const gap = teamPower(home.lineup) - teamPower(away.lineup);
  return gap * POINTS_PER_POWER + (neutral ? 0 : HOME_EDGE_POINTS);
}

/** Seconds left in regulation, or in the current overtime period. */
export function secondsLeft(g) {
  if (g.ot) return Math.max(0, g.clock);
  return Math.max(0, (4 - g.quarter) * Q_LEN + g.clock);
}

/** Home side's chance of winning from the current state, 0..1. */
export function winProbability(g) {
  if (g.final) return g.score[0] > g.score[1] ? 1 : g.score[0] < g.score[1] ? 0 : 0.5;
  const diff = g.score[0] - g.score[1];
  const left = secondsLeft(g);
  const frac = Math.max(left, 1) / 3600;
  let poss = 0;
  if (g.phase === 'play') poss = (g.possession === 0 ? 1 : -1) * expectedPoints(g.ballOn, g.down, g.toGo);
  else if (g.phase === 'pat') poss = (g.patTeam === 0 ? 1 : -1) * 1.0;
  else if (g.phase === 'kickoff') poss = (g.kickingTeam === 0 ? -1 : 1) * 0.4;
  const prior = (g.prior ?? 0) * frac;
  let p = Phi((diff + poss + prior) / (MARGIN_SD * Math.sqrt(frac) + 0.5));
  // Overtime and the last seconds: a lead is nearly decisive, a tie is a coin flip plus possession.
  if (left <= 0 && diff !== 0) p = diff > 0 ? 0.99 : 0.01;
  return Math.max(0.005, Math.min(0.995, p));
}
