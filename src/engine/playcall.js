// AI play-calling and game-management decisions. Pure functions of game state
// plus a team "strategy" object:
//   { passRate: 0.35..0.70, aggression: 0..1 (4th down), tempo: 0..1,
//     blitzRate: 0..1, deepShell: 0..1 }

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
  deep:     { label: 'Deep Shell',    desc: 'Two-high, protect against the big play. Soft vs runs and short passes.' },
};

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

/** Kicker make probability for a given distance. */
export function fgProbability(kicker, dist) {
  const kac = kicker ? kicker.r.kac : 75;
  const kpw = kicker ? kicker.r.kpw : 75;
  const mid = 51 + (kac - 80) * 0.25 + (kpw - 80) * 0.35;
  return 0.985 / (1 + Math.exp((dist - mid) / 4.5));
}

export function fgRange(kicker) {
  const kac = kicker ? kicker.r.kac : 75;
  const kpw = kicker ? kicker.r.kpw : 75;
  return Math.round(50 + (kac - 80) * 0.25 + (kpw - 80) * 0.35 + 5); // ~roughly 45% make
}

/**
 * Is the offense in hurry-up mode? Trailing (or tied) late in a half.
 */
export function isHurryUp(g, team) {
  const left = halfSecondsLeft(g);
  const diff = scoreDiff(g, team);
  if (g.quarter === 2 && left <= 120 && diff <= 7) return true;
  if (g.quarter >= 4 && left <= 300 && diff < 0) return true;
  if (g.quarter >= 4 && left <= 150 && diff <= 0) return true;
  return false;
}

/** Leading late: bleed the clock. */
export function isClockKill(g, team) {
  const left = halfSecondsLeft(g);
  const diff = scoreDiff(g, team);
  return g.quarter >= 4 && left <= 420 && diff > 0;
}

/**
 * Choose an offensive play. Returns an OFFENSE_CALLS key.
 */
export function chooseOffense(g, rng) {
  const team = g.possession;
  const strat = g.teams[team].strategy;
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
  if (left <= 8 && fgDistance(g.ballOn) <= fgRange(comp.k) + 4 && diff <= 0 && (g.quarter === 2 || g.quarter >= 4)) {
    if (g.quarter === 2 || diff >= -3) return 'fg';
  }
  if (g.quarter >= 4 && left <= 5 && diff >= -2 && diff <= 0 && fgDistance(g.ballOn) <= fgRange(comp.k) + 6) return 'fg';

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
  // Team-fit: elite RB vs weak QB nudges to the run.
  const rbOvr = comp.rb1 ? (comp.rb1.r.spd + comp.rb1.r.elu + comp.rb1.r.pow + comp.rb1.r.awr) / 4 : 75;
  const qbOvr = comp.qb ? (comp.qb.r.tha + comp.qb.r.awr) / 2 : 75;
  pass += (qbOvr - rbOvr) / 200;
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
  const makeP = fgProbability(comp.k, dist);
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
  if ((g.quarter >= 4 && left <= 240 || isOT) && diff === 0 && longRange && toGo > 1) return 'fg';
  // End of half: take the FG.
  if (g.quarter === 2 && left <= 30 && longRange) return 'fg';

  // Standard chart with aggression.
  if (inRange) {
    if (toGo <= 1 && g.ballOn >= 55 && g.ballOn < 90 && rng.chance(0.35 + aggr * 0.5)) return 'go';
    if (toGo <= 2 && g.ballOn >= 60 && g.ballOn < 92 && rng.chance(aggr * 0.5)) return 'go';
    if (makeP < 0.7 && toGo <= 4 && rng.chance(0.3 + aggr * 0.5)) return 'go';
    return 'fg';
  }
  if (longRange && toGo > 5 && rng.chance(0.5 + (makeP - 0.25) * 2 - aggr * 0.3)) return 'fg';
  // Out of FG range.
  if (g.ballOn >= 60) {
    if (toGo <= 3) return 'go';
    if (toGo <= 6 && rng.chance(0.3 + aggr * 0.6)) return 'go';
    if (toGo <= 10 && rng.chance(aggr * 0.5)) return 'go';
    return 'punt';
  }
  if (toGo <= 1 && g.ballOn >= 40 && rng.chance(0.2 + aggr * 0.7)) return 'go';
  if (toGo <= 2 && g.ballOn >= 50 && rng.chance(aggr * 0.6)) return 'go';
  if (g.quarter >= 4 && diff < 0 && gameLeft <= 720 && toGo <= 5 && rng.chance(0.4 + aggr * 0.4)) return 'go';
  return 'punt';
}

/** Choose a defensive call given situation. */
export function chooseDefense(g, rng) {
  const team = 1 - g.possession;
  const strat = g.teams[team].strategy;
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
  if (g.timeouts[team] <= 0) return false;
  const diff = scoreDiff(g, team);
  const left = halfSecondsLeft(g);
  const onOffense = g.possession === team;
  if (g.quarter === 2) return onOffense && left <= 45 && diff <= 3 && g.ballOn >= 50;
  if (g.quarter < 4) return false;
  if (g.quarter >= 5) return onOffense && left <= 60;
  if (onOffense) return diff <= 0 && left <= 120;
  // Defense: trailing, opponent running clock.
  return diff < 0 && diff >= -16 && left <= 180;
}
