// AI play-calling and game-management decisions. Pure functions of game state
// plus a team "strategy" object:
//   { passRate: 0.35..0.70, aggression: 0..1 (4th down), tempo: 0..1,
//     blitzRate: 0..1, deepShell: 0..1 }

import { effectiveStrategy } from './gm.js';
import { expectedPoints } from './winprob.js';
import { clamp } from './rng.js';
import { fgShift } from './weather.js';

export const OFFENSE_CALLS = {
  run_in:     { label: 'Inside Run',  kind: 'run' },
  run_out:    { label: 'Outside Run', kind: 'run' },
  screen:     { label: 'Screen',      kind: 'pass' },
  pass_short: { label: 'Short Pass',  kind: 'pass' },
  pass_med:   { label: 'Medium Pass', kind: 'pass' },
  pass_deep:  { label: 'Deep Shot',   kind: 'pass' },
  pa_pass:    { label: 'Play Action', kind: 'pass' },
  fg:         { label: 'Field Goal',  kind: 'special' },
  punt:       { label: 'Punt',        kind: 'special' },
  kneel:      { label: 'Kneel',       kind: 'special' },
  spike:      { label: 'Spike',       kind: 'special' },
};

export const DEFENSE_CALLS = {
  base:     { label: 'Base',          desc: 'Balanced front and coverage.' },
  run_stop: { label: 'Stack the Box', desc: 'Extra run defender. Weak vs medium/deep passes.' },
  blitz:    { label: 'Blitz',         desc: 'Send extra rushers. Boom or bust.' },
  deep:     { label: 'Deep Shell',    desc: 'Two-high, five underneath. Squeezes the passing game. The run eats it.' },
};

/**
 * What each pairing of calls is actually worth, in yards per play.
 *
 * The modifiers that decide a snap live in `game/plays.js` as coefficients on
 * completion, coverage, yards after catch and pressure, which is the right
 * shape for the engine and no use at all to a person choosing a call. This is
 * the same thing measured from the outside: 3,000 snaps per cell, every one a
 * neutral 1st & 10 at our own 25, two evenly matched 84-rated clubs at a
 * neutral site, penalties off so a flag before the snap cannot stand in for
 * the matchup, and the offence pinned — the first published version of this
 * table let a fumble hand the ball over and went on measuring from the other
 * side, which in one cell was 2,388 of 3,000 snaps.
 *
 * It is a league-average reference, not a prediction for the two clubs on the
 * field — the magnitudes move with the rosters. What holds is the ordering,
 * because it comes from the matrix rather than from the ratings: the run dies
 * against a stacked box and eats a two-high shell, the screen is the answer to
 * a blitz, and the deep ball punishes a defence that crowded the line.
 *
 * Re-measure with `scripts/call-grid.mjs` if the matrix changes.
 */
export const CALL_GRID = {
  run_in:     { base: 4.84, run_stop: 3.13, blitz: 5.07, deep: 7.37 },
  run_out:    { base: 4.96, run_stop: 3.57, blitz: 6.65, deep: 7.74 },
  screen:     { base: 5.45, run_stop: 6.27, blitz: 9.46, deep: 4.74 },
  pass_short: { base: 6.53, run_stop: 7.28, blitz: 7.03, deep: 4.28 },
  pass_med:   { base: 8.48, run_stop: 10.25, blitz: 9.18, deep: 7.49 },
  pass_deep:  { base: 11.11, run_stop: 15.47, blitz: 11.79, deep: 7.61 },
  pa_pass:    { base: 9.72, run_stop: 12.49, blitz: 9.16, deep: 7.61 },
};

/**
 * How the call that was made fared against the call that met it.
 *
 * `delta` is this cell against the *base* look, not against the row's average,
 * and the difference matters. Base is the neutral defence — it is the one row
 * of the matrix with no modifiers at all — and it is also what a defence calls
 * most of the time. Measured against a row average it came out slightly
 * negative for nearly every call, because the three committed looks are
 * generous to passing and drag the mean up, so playing it straight read as a
 * defensive win on almost every snap. Against base as the reference, a defence
 * that commits gets credit or blame for committing, and one that does not gets
 * neither, which is the honest reading of a neutral call.
 *
 * Positive is the offence's gain. The thresholds come from the spread of the 21
 * committed cells — a quarter sit inside 0.78 yards, half inside 1.23, three
 * quarters inside 1.94 — so 0.75 and 2 split them roughly five, eleven, five.
 * Returns null for a kick, a kneel or a spike, which nobody defends.
 */
export function matchup(offCall, defCall) {
  const row = CALL_GRID[offCall];
  if (!row || row[defCall] == null) return null;
  const vals = Object.values(row);
  const yds = row[defCall];
  const delta = yds - row.base;
  const sorted = vals.slice().sort((a, b) => b - a);
  const verdict = defCall === 'base' ? 'straight'
    : delta >= 2 ? 'won' : delta >= 0.75 ? 'edge'
    : delta <= -2 ? 'lost' : delta <= -0.75 ? 'pinched' : 'even';
  return { yds, delta, base: row.base, verdict, rank: sorted.indexOf(yds) + 1, of: vals.length };
}

export const DEFAULT_STRATEGY = {
  passRate: 0.55,
  aggression: 0.4,
  tempo: 0.5,
  blitzRate: 0.25,
  deepShell: 0.2,
};

/** Seconds remaining in the current half (or OT period). */
export function halfSecondsLeft(g) {
  if (g.quarter >= 5) return g.clock;
  return g.quarter === 1 || g.quarter === 3 ? g.clock + 900 : g.clock;
}

export function scoreDiff(g, team) {
  return g.score[team] - g.score[1 - team];
}

export function fgDistance(ballOn) {
  return 100 - ballOn + 17;
}

/**
 * Kicker make probability for a given distance. `weather` moves his range —
 * wind and cold shorten it, less for a big leg; altitude lengthens it — and it
 * is the same function the fourth-down call reads, so a club deciding whether
 * to kick sees the same sky the kick is taken under.
 */
export function fgProbability(kicker, dist, weather = null) {
  const kac = kicker ? kicker.r.kac : 75;
  const kpw = kicker ? kicker.r.kpw : 75;
  const mid = 51 + (kac - 80) * 0.25 + (kpw - 80) * 0.35 + fgShift(weather, kpw);
  return 0.985 / (1 + Math.exp((dist - mid) / 4.5));
}

export function fgRange(kicker, weather = null) {
  const kac = kicker ? kicker.r.kac : 75;
  const kpw = kicker ? kicker.r.kpw : 75;
  return Math.round(50 + (kac - 80) * 0.25 + (kpw - 80) * 0.35 + fgShift(weather, kpw) + 5); // ~roughly 45% make
}

/**
 * The three tempos a club can be in. `g.tempo[team]` holds one of them when a
 * human has taken the clock for that side, and is unset otherwise, in which
 * case the two predicates below read the situation as they always have.
 *
 * The override goes here rather than in `tempoSeconds` because tempo is not
 * only seconds: `chooseOffense` leans on the same two predicates to bias
 * toward the pass in a hurry-up and toward the run when bleeding the clock. A
 * user who sets the tempo and then lets the AI call it should get plays that
 * match the tempo, not only a different play clock.
 */
export const TEMPOS = ['hurry', 'normal', 'kill'];

/**
 * Is the offense in hurry-up mode? Trailing (or tied) late in a half.
 */
export function isHurryUp(g, team) {
  const forced = g.tempo?.[team];
  if (forced) return forced === 'hurry';
  const left = halfSecondsLeft(g);
  const diff = scoreDiff(g, team);
  // Same defect as the old timeout rule, in the same quarter: `diff <= 7` alone
  // meant a club leading by more than a touchdown played the end of the half at
  // walking pace even standing in field-goal range. The lead is a reason to sit
  // on the ball deep in your own half, not a reason to leave points on the
  // field when you are already across midfield.
  if (g.quarter === 2 && left <= 120 && (diff <= 7 || g.ballOn >= 40)) return true;
  if (g.quarter >= 4 && left <= 300 && diff < 0) return true;
  if (g.quarter >= 4 && left <= 150 && diff <= 0) return true;
  return false;
}

/** Leading late: bleed the clock. */
export function isClockKill(g, team) {
  const forced = g.tempo?.[team];
  if (forced) return forced === 'kill';
  const left = halfSecondsLeft(g);
  const diff = scoreDiff(g, team);
  return g.quarter >= 4 && left <= 420 && diff > 0;
}

/**
 * Choose an offensive play. Returns an OFFENSE_CALLS key.
 */
export function chooseOffense(g, rng) {
  const team = g.possession;
  const plan = g.teams[team].plan || null;
  const strat = effectiveStrategy(g.teams[team].strategy, plan);
  const comp = g.teams[team].comp;
  const oppTimeouts = g.timeouts[1 - team];
  const diff = scoreDiff(g, team);
  const left = halfSecondsLeft(g);
  const gameLeft = g.quarter >= 4 ? g.clock : g.clock + (4 - g.quarter) * 900;

  // Victory formation.
  if (g.quarter >= 4 && diff > 0 && oppTimeouts === 0 && g.clock <= (4 - g.down + 1) * 40 - 2) return 'kneel';
  if (g.quarter >= 4 && diff > 0 && g.clock <= 40 && g.down <= 3) return 'kneel';
  if (g.quarter === 2 && g.ballOn < 30 && g.clock <= 25 && g.down >= 2 && diff >= 0) return 'kneel';

  // Spike to stop the clock when trailing and no timeouts.
  if (g.clockRunning && left <= 45 && diff < 0 && g.timeouts[team] === 0 && g.down <= 2 && g.quarter >= 4) return 'spike';

  if (g.down === 4) {
    const dec = fourthDownDecision(g, rng);
    if (dec !== 'go') return dec;
  }

  // Last-second field goal when clock is about to expire.
  if (left <= 8 && fgDistance(g.ballOn) <= fgRange(comp.k, g.weather) + 4 && diff <= 0 && (g.quarter === 2 || g.quarter >= 4)) {
    if (g.quarter === 2 || diff >= -3) return 'fg';
  }
  if (g.quarter >= 4 && left <= 5 && diff >= -2 && diff <= 0 && fgDistance(g.ballOn) <= fgRange(comp.k, g.weather) + 6) return 'fg';

  // Base pass probability.
  let pass = strat.passRate;
  const toGo = g.toGo;
  if (g.down === 1) pass += 0;
  else if (g.down === 2) pass += toGo >= 8 ? 0.15 : toGo <= 3 ? -0.15 : 0.05;
  else if (g.down === 3) pass += toGo >= 7 ? 0.38 : toGo >= 4 ? 0.25 : toGo >= 2 ? 0.05 : -0.15;
  else pass += toGo >= 4 ? 0.4 : -0.1;

  if (g.ballOn >= 96) pass -= 0.15; // goal line
  if (isHurryUp(g, team)) pass += 0.35;
  if (isClockKill(g, team)) pass -= 0.3;
  if (g.quarter >= 4 && diff <= -14) pass += 0.2;
  if (g.quarter >= 3 && diff >= 17) pass -= 0.15;
  // Team-fit: elite RB vs weak QB nudges to the run. Gently: at /200 a back
  // eight points better took 2.3 more carries a game, and a point of a back's
  // rating moved his carries 2.6 times as far as the real game's (DESIGN.md,
  // "Backs, receivers and tight ends, held to real seasons").
  const rbOvr = comp.rb1 ? (comp.rb1.r.spd + comp.rb1.r.elu + comp.rb1.r.pow + comp.rb1.r.awr) / 4 : 75;
  const qbOvr = comp.qb ? (comp.qb.r.tha + comp.qb.r.awr) / 2 : 75;
  pass += (qbOvr - rbOvr) / 1000;
  pass = Math.min(0.95, Math.max(0.1, pass));

  if (rng.chance(pass)) {
    // Pick pass depth.
    let w = { screen: 9, pass_short: 48, pass_med: 26, pass_deep: 10, pa_pass: 7 };
    if (toGo <= 3) { w.pass_short += 15; w.pass_deep -= 6; w.pa_pass += 3; }
    if (toGo >= 10) { w.pass_med += 10; w.pass_deep += 5; w.screen += 4; }
    if (g.down === 1) { w.pa_pass += 8; w.pass_deep += 4; }
    if (g.down === 3 && toGo >= 7) { w.pass_med += 15; w.screen -= 4; w.pa_pass -= 4; }
    if (g.ballOn >= 80) { w.pass_deep -= 8; w.pa_pass -= 2; } // red zone
    if (g.ballOn <= 10) { w.pass_deep -= 4; w.screen -= 4; }
    if (isHurryUp(g, team) && diff < -3 && left <= 60) { w.pass_deep += 15; w.pass_med += 10; w.screen -= 6; }
    if (g.quarter >= 4 && diff <= -9 && left <= 240) { w.pass_deep += 8; w.pass_med += 6; }
    const qb = comp.qb;
    if (qb && qb.r.thp >= 92) w.pass_deep += 4;
    if (qb && qb.r.thp <= 78) w.pass_deep -= 4;
    if (plan) { w.pass_deep += plan.deep || 0; w.screen += plan.screen || 0; }
    const keys = Object.keys(w);
    return rng.weighted(keys, keys.map((k) => Math.max(0.5, w[k])));
  }
  // Run type.
  const rb = comp.rb1;
  let outside = 0.4;
  if (rb) outside += (rb.r.spd - rb.r.pow) / 200;
  if (toGo <= 2) outside -= 0.2;
  if (g.ballOn >= 97) outside -= 0.2;
  return rng.chance(Math.min(0.75, Math.max(0.15, outside))) ? 'run_out' : 'run_in';
}

/** 'go' | 'punt' | 'fg' */
export function fourthDownDecision(g, rng) {
  const team = g.possession;
  const strat = g.teams[team].strategy;
  const comp = g.teams[team].comp;
  const diff = scoreDiff(g, team);
  const left = halfSecondsLeft(g);
  const gameLeft = g.quarter >= 4 ? g.clock : g.clock + (4 - g.quarter) * 900;
  const dist = fgDistance(g.ballOn);
  const makeP = fgProbability(comp.k, dist, g.weather);
  const inRange = makeP >= 0.5;
  const longRange = makeP >= 0.25;
  const toGo = g.toGo;
  const aggr = strat.aggression ?? 0.4;
  const isOT = g.quarter >= 5;

  // Desperation: trailing late.
  if ((g.quarter >= 4 || isOT) && diff < 0) {
    const needTd = diff < -3;
    if (gameLeft <= 300 || (gameLeft <= 600 && diff < -8)) {
      if (!needTd && longRange && (gameLeft <= 180 || toGo > 3)) return 'fg';
      if (needTd || !longRange) return 'go';
      return toGo <= 2 ? 'go' : 'fg';
    }
  }
  // Tied late in regulation or OT: take the points if you can.
  if ((g.quarter >= 4 && left <= 240 || isOT) && diff === 0 && toGo > 1 && (makeP >= 0.45 || (longRange && left <= 60))) return 'fg';
  // End of half: take the FG.
  if (g.quarter === 2 && left <= 30 && longRange) return 'fg';

  // Everything else is an expected-points question, answered as one.
  return byExpectedPoints(g, comp, dist, makeP, aggr);
}

/**
 * How often fourth-and-N gets picked up, before the two rosters are weighed.
 * The real league runs about 68% on one yard, 52% on three, 32% on ten.
 */
export function convertChance(toGo, comp, def) {
  // Real fourth-down rates: about 68% on a yard, 57% on two, 52% on three,
  // 44% on five, 32% on ten. A power curve sits on all five within a point.
  const base = clamp(0.70 * Math.pow(Math.max(1, toGo), -0.30), 0.2, 0.78);
  const push = ((comp.runBlock + comp.passBlock) / 2 - (def.runStop + def.passRush) / 2) / 130;
  return clamp(base + push, 0.1, 0.92);
}

/**
 * How much better going for it has to look before a coach takes it.
 *
 * Expected points alone produces a bot, and a bot goes for it far more than
 * anybody actually does — straight arithmetic gave 2.9 attempts a game and
 * half a field goal, which is not a football match. Real coaches are more
 * conservative than the maths, consistently and by a known margin, and this is
 * that margin. Aggression moves it: a gambler needs less convincing.
 */
export const RISK_AVERSION = 1.15;

/**
 * Fourth down as arithmetic rather than a chart of thresholds.
 *
 * What was here before was a dozen `rng.chance` lines keyed off field-position
 * bands: it never asked how likely the conversion was, never priced what the
 * other side gets on a failure, and ignored the kicker's leg except to ask
 * whether he was "in range". It produced 1.03 attempts a game against a real
 * 0.8 to 2.5, almost all of them on one yard.
 *
 * Each option is valued in points from the offence's side, using the same
 * expected-points curve the win-probability model runs on, and the best one
 * wins. Aggression is no longer a die roll: it is a thumb on the scale, worth
 * up to about half a point either way, which is how a coach's temperament
 * actually shows up — it changes where the break-even sits, not whether there
 * is one. That also gives the dial two ends: the audit found it helped a
 * strong offence and did nothing otherwise, because the thresholds rarely bound.
 */
export function byExpectedPoints(g, comp, dist, makeP, aggr) {
  const off = g.possession;
  const def = g.teams[1 - off].comp;
  const ep = (spot) => expectedPoints(clamp(spot, 1, 99), 1, 10);
  // What the other side is worth from a spot of ours, costed to us.
  const theirs = (ourSpot) => -ep(100 - clamp(ourSpot, 1, 99));

  const p = convertChance(g.toGo, comp, def);
  const goValue = p * ep(Math.min(99, g.ballOn + g.toGo)) + (1 - p) * theirs(g.ballOn);

  // A kickoff hands them the ball around their own 25.
  const fgValue = dist <= 63
    ? makeP * (3 - ep(25)) + (1 - makeP) * theirs(Math.max(20, g.ballOn - 7))
    : -Infinity;

  // Net of the return, and never past the goal line.
  const puntNet = 40;
  const puntValue = g.ballOn > 95 ? -Infinity : theirs(Math.min(99, Math.max(g.ballOn + 20, g.ballOn + puntNet)));

  // What a coach needs before he takes it, less the nerve he happens to have.
  const bar = RISK_AVERSION - (aggr - 0.4) * 1.4;
  const kick = Math.max(fgValue, puntValue);
  if (goValue - bar > kick) return 'go';
  return fgValue >= puntValue ? 'fg' : 'punt';
}

/** Choose a defensive call given situation. */
export function chooseDefense(g, rng) {
  const team = 1 - g.possession;
  const strat = effectiveStrategy(g.teams[team].strategy, g.teams[team].plan || null);
  const diff = scoreDiff(g, team); // from defense's perspective
  const toGo = g.toGo;
  let w = { base: 55, run_stop: 15, blitz: 20, deep: 10 };
  w.blitz += (strat.blitzRate - 0.25) * 60;
  w.deep += (strat.deepShell - 0.2) * 60;
  if (g.down >= 3 && toGo >= 7) { w.blitz += 15; w.deep += 15; w.run_stop -= 12; }
  if (g.down >= 2 && toGo <= 2) { w.run_stop += 30; w.deep -= 8; }
  if (g.down === 1) { w.base += 10; }
  if (g.quarter >= 4 && diff >= 9 && g.clock <= 300) { w.deep += 25; w.blitz -= 10; }
  if (g.quarter >= 4 && diff < 0 && g.clock <= 240) { w.blitz += 15; }
  if (g.ballOn >= 90) { w.run_stop += 15; w.deep -= 10; } // goal line
  if (isHurryUp(g, g.possession)) { w.deep += 10; w.run_stop -= 8; }
  const keys = Object.keys(w);
  return rng.weighted(keys, keys.map((k) => Math.max(1, w[k])));
}

/** Go for two? Based on classic charts. */
export function goForTwo(g, team) {
  const diff = scoreDiff(g, team); // after the TD has been added
  const late = g.quarter >= 4 && g.clock <= 600;
  if (g.quarter >= 5) return false;
  if (!late && g.quarter < 4) return diff === -2 && g.quarter === 3 && g.clock < 300;
  // Trailing after TD: -2 (go), -5 (go), -10 (go), -16 (go); leading by 1 (go for 3? no), by 5 (go for 7), by 12 (go for 14)
  return [-2, -5, -10, -16, -12, 1, 5, 12].includes(diff);
}

/** Onside kick? Trailing late. */
export function onsideKick(g, team) {
  const diff = scoreDiff(g, team);
  const left = g.quarter >= 4 ? g.clock : Infinity;
  if (g.quarter < 4) return false;
  if (diff < 0 && diff >= -8 && left <= 150) return true;
  if (diff < 0 && diff >= -16 && left <= 300 && diff <= -9) return true;
  return false;
}

/**
 * Seconds a team wants to burn between plays (play clock usage).
 */
export function tempoSeconds(g, team, rng) {
  const strat = g.teams[team].strategy;
  if (isHurryUp(g, team)) return rng.int(10, 17);
  if (isClockKill(g, team)) return rng.int(36, 40);
  const base = 36 - (strat.tempo - 0.5) * 10; // faster tempo = fewer seconds
  return Math.round(rng.normal(base, 3));
}

/**
 * Should `team` (on defense or offense) call timeout now to stop the clock?
 * Called after a play that left the clock running.
 */
export function wantsTimeout(g, team) {
  // A human running the clock spends their own. Set only while someone is
  // actually watching and calling; skipping ahead and simming hand it back,
  // because a drill with three timeouts left unspent is worse management than
  // the heuristic, not better.
  if (g.userClock === team) return false;
  if (g.timeouts[team] <= 0) return false;
  const diff = scoreDiff(g, team);
  const left = halfSecondsLeft(g);
  const onOffense = g.possession === team;
  // Before half, the score is not the question. The old rule required
  // `diff <= 3`, so a club leading by more than a field goal never stopped the
  // clock and took the two-minute drill off — measured over 400 games at 0:50
  // on the opponent's 40, leading by seven, that was 1.00 point and a 79.0%
  // win rate against 3.32 and 89.0% for spending them. What decides it is
  // whether there is something to gain: the ball, time to use it, and field
  // position to use it from.
  if (g.quarter === 2) return onOffense && left <= 90 && g.ballOn >= 45;
  if (g.quarter < 4) return false;
  if (g.quarter >= 5) return onOffense && left <= 60;
  if (onOffense) return diff <= 0 && left <= 120;
  // Defense: trailing, opponent running clock.
  return diff < 0 && diff >= -16 && left <= 180;
}
