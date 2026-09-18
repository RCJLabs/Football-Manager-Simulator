// Play-by-play game simulation. A game is a plain serializable object; `step`
// advances it by one event (kickoff, play, PAT). All randomness comes from the
// game's own RNG so a game replays identically from the same seed.

import { RNG, clamp, edge } from './rng.js';
import { composites } from './ratings.js';
import {
  chooseOffense, chooseDefense, goForTwo, onsideKick, tempoSeconds, wantsTimeout,
  fgDistance, fgProbability, halfSecondsLeft, scoreDiff, OFFENSE_CALLS,
} from './playcall.js';
import { emptyTeamStats, statFor, shortName, fmtClock, fmtQuarter } from './stats.js';

const Q_LEN = 900;

/**
 * teams: [home, away] each { id, name, abbr, color, lineup, strategy, isUser }
 * options: { seed, playoff }
 */
export function createGame(home, away, options = {}) {
  const seed = options.seed ?? Math.floor(Math.random() * 4294967296);
  const rng = new RNG(seed);
  const teams = [home, away].map((t) => ({
    id: t.id, name: t.name, abbr: t.abbr, color: t.color, isUser: !!t.isUser,
    strategy: { ...t.strategy },
    lineup: t.lineup,
    comp: composites(t.lineup),
  }));
  const receiving = rng.int(0, 1);
  const g = {
    seed,
    rngState: rng.state,
    playoff: !!options.playoff,
    teams,
    score: [0, 0],
    quarter: 1,
    clock: Q_LEN,
    possession: receiving,
    down: 1, toGo: 10, ballOn: 25,
    phase: 'kickoff',
    kickingTeam: 1 - receiving,
    freeKick: false,
    receivedFirst: receiving,
    clockRunning: false,
    timeouts: [3, 3],
    ot: null,
    drive: null,
    drives: [],
    log: [],
    stats: [{ team: emptyTeamStats(), players: {} }, { team: emptyTeamStats(), players: {} }],
    playCount: 0,
    final: false,
    lastEvent: null,
    pendingCall: null,
  };
  g.rngState = rng.state;
  logEvent(g, { type: 'info', text: `${teams[receiving].name} will receive the opening kickoff.` });
  return g;
}

function getRng(g) {
  return new RNG(g.rngState);
}
function saveRng(g, rng) {
  g.rngState = rng.state;
}

function logEvent(g, e) {
  const entry = {
    i: g.log.length,
    q: g.quarter,
    clock: g.clock,
    off: g.possession,
    down: g.down,
    toGo: g.toGo,
    ballOn: g.ballOn,
    score: [g.score[0], g.score[1]],
    ...e,
  };
  g.log.push(entry);
  g.lastEvent = entry;
  return entry;
}

function startDrive(g) {
  g.drive = {
    team: g.possession,
    startBallOn: g.ballOn,
    startClock: g.clock,
    startQuarter: g.quarter,
    plays: 0,
    yards: 0,
    time: 0,
    result: null,
  };
  g.stats[g.possession].team.drives++;
  if (g.ot) g.ot.possessed[g.possession] = true;
  logEvent(g, { type: 'drive', text: `${g.teams[g.possession].name} ball at ${spot(g, g.possession, g.ballOn)}.` });
}

function endDrive(g, result) {
  if (!g.drive) return;
  g.drive.result = result;
  g.drive.endBallOn = g.ballOn;
  g.drives.push(g.drive);
  g.drive = null;
}

/** Human-readable field position from a team's perspective. */
export function spot(g, team, ballOn) {
  if (ballOn === 50) return 'the 50';
  if (ballOn < 50) return `${g.teams[team].abbr} ${ballOn}`;
  return `${g.teams[1 - team].abbr} ${100 - ballOn}`;
}

export function downText(g) {
  if (g.phase !== 'play') return '';
  const d = ['1st', '2nd', '3rd', '4th'][g.down - 1];
  const tg = g.ballOn + g.toGo >= 100 ? 'Goal' : g.toGo;
  return `${d} & ${tg}`;
}

/** Whether the next step needs a user decision, and which kind. */
export function decisionNeeded(g, userTeamIdx, coachDefense) {
  if (g.final || userTeamIdx == null) return null;
  if (g.phase === 'play') {
    if (g.possession === userTeamIdx) return 'offense';
    if (coachDefense) return 'defense';
  }
  if (g.phase === 'pat' && g.patTeam === userTeamIdx) return 'pat';
  return null;
}

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

/**
 * Advance the game one event.
 * calls: { off?: string, def?: string, pat?: 'xp'|'two' } — omitted = AI chooses.
 */
export function step(g, calls = {}) {
  if (g.final) return g;
  const rng = getRng(g);
  // Handle expired clock before running anything but a PAT.
  if (g.clock <= 0 && g.phase !== 'pat') {
    endOfQuarter(g, rng);
    saveRng(g, rng);
    if (g.final) return g;
  }
  if (g.phase === 'kickoff') doKickoff(g, rng);
  else if (g.phase === 'pat') doPat(g, rng, calls.pat);
  else if (g.phase === 'play') doPlay(g, rng, calls);
  saveRng(g, rng);
  return g;
}

/** Run plays until the possession changes or a score / end of period. */
export function stepDrive(g, calls) {
  const team = g.possession;
  const startDrives = g.drives.length;
  let guard = 0;
  while (!g.final && guard++ < 60) {
    step(g, calls);
    if (g.drives.length > startDrives) break;
    if (g.phase === 'kickoff' && g.possession !== team) break;
  }
  return g;
}

export function stepQuarter(g) {
  const q = g.quarter;
  let guard = 0;
  while (!g.final && g.quarter === q && guard++ < 400) step(g);
  return g;
}

export function simulateGame(g) {
  let guard = 0;
  while (!g.final && guard++ < 2000) step(g);
  if (!g.final) { g.final = true; logEvent(g, { type: 'final', text: 'Game ended (guard).' }); }
  return g;
}

// ---------------------------------------------------------------------------
// Period management
// ---------------------------------------------------------------------------

function endOfQuarter(g, rng) {
  g.clockRunning = false;
  if (g.quarter === 1 || g.quarter === 3) {
    logEvent(g, { type: 'quarter', text: `End of the ${fmtQuarter(g.quarter)} quarter.` });
    g.quarter++;
    g.clock = Q_LEN;
    return;
  }
  if (g.quarter === 2) {
    logEvent(g, { type: 'quarter', text: `Halftime. ${scoreLine(g)}` });
    endDrive(g, 'end of half');
    g.quarter = 3;
    g.clock = Q_LEN;
    g.timeouts = [3, 3];
    g.phase = 'kickoff';
    g.kickingTeam = g.receivedFirst;
    g.freeKick = false;
    g.possession = 1 - g.receivedFirst;
    return;
  }
  // End of 4th quarter or an OT period.
  if (g.score[0] !== g.score[1]) {
    if (g.quarter === 4 || g.ot) return finishGame(g);
  }
  if (g.quarter === 4 || g.playoff) {
    // Start overtime.
    endDrive(g, 'end of regulation');
    g.quarter++;
    g.clock = g.playoff ? Q_LEN : 600;
    g.ot = g.ot || { possessed: [false, false] };
    if (g.quarter === 5) g.timeouts = [2, 2];
    const receiving = rng.int(0, 1);
    g.phase = 'kickoff';
    g.kickingTeam = 1 - receiving;
    g.possession = receiving;
    g.freeKick = false;
    logEvent(g, { type: 'quarter', text: `${g.quarter === 5 ? 'Overtime' : 'Another overtime period'}. ${g.teams[receiving].name} will receive.` });
    return;
  }
  finishGame(g); // regular season tie
}

function finishGame(g) {
  endDrive(g, 'end of game');
  g.final = true;
  g.phase = 'final';
  g.clockRunning = false;
  const [h, a] = g.score;
  let text;
  if (h === a) text = `Final: ${g.teams[0].name} and ${g.teams[1].name} tie, ${h}-${a}.`;
  else {
    const w = h > a ? 0 : 1;
    text = `Final: ${g.teams[w].name} defeat${''} ${g.teams[1 - w].name}, ${g.score[w]}-${g.score[1 - w]}.`;
  }
  logEvent(g, { type: 'final', text });
  for (const side of [0, 1]) {
    for (const pos of Object.keys(g.teams[side].lineup)) {
      for (const p of g.teams[side].lineup[pos]) statFor(g.stats[side], p.id).games = 1;
    }
    g.stats[side].team.points = g.score[side];
  }
}

function scoreLine(g) {
  return `${g.teams[0].abbr} ${g.score[0]}, ${g.teams[1].abbr} ${g.score[1]}.`;
}

/** OT bookkeeping after a score or change of possession. Returns true if the game ended. */
function checkOvertimeEnd(g, { defensiveScore = false } = {}) {
  if (!g.ot) return false;
  if (defensiveScore && g.score[0] !== g.score[1]) { finishGame(g); return true; }
  if (g.ot.possessed[0] && g.ot.possessed[1] && g.score[0] !== g.score[1]) { finishGame(g); return true; }
  return false;
}

// ---------------------------------------------------------------------------
// Kickoffs & PATs
// ---------------------------------------------------------------------------

function doKickoff(g, rng) {
  const kicking = g.kickingTeam;
  const receiving = 1 - kicking;
  const comp = g.teams[kicking].comp;
  const recComp = g.teams[receiving].comp;
  g.possession = receiving;
  g.down = 1; g.toGo = 10;
  g.clockRunning = false;
  const returner = pickReturner(recComp);
  const wantOnside = !g.freeKick && onsideKick(g, kicking);
  const plays = g.stats[kicking].team;

  if (wantOnside) {
    plays.plays++;
    if (rng.chance(0.12)) {
      const at = 35 + rng.int(8, 14); // kicking team recovers around midfield
      g.possession = kicking;
      g.ballOn = at;
      tick(g, kicking, 4);
      logEvent(g, { type: 'kickoff', text: `ONSIDE KICK recovered by ${g.teams[kicking].name} at ${spot(g, kicking, at)}!` });
    } else {
      g.ballOn = 100 - (35 + rng.int(10, 15));
      tick(g, receiving, 4);
      logEvent(g, { type: 'kickoff', text: `Onside kick fails. ${g.teams[receiving].name} take over at ${spot(g, receiving, g.ballOn)}.` });
    }
    g.phase = 'play';
    g.freeKick = false;
    startDrive(g);
    return;
  }

  const kpw = comp.k ? comp.k.r.kpw : 75;
  const touchbackP = g.freeKick ? 0.15 : clamp(0.45 + (kpw - 80) * 0.012, 0.2, 0.75);
  if (rng.chance(touchbackP)) {
    g.ballOn = g.freeKick ? 35 : 25;
    logEvent(g, { type: 'kickoff', text: `${g.teams[kicking].abbr} kickoff. Touchback.` });
  } else {
    const retSkill = returner ? (returner.r.spd * 0.6 + (returner.r.elu ?? returner.r.rac ?? 75) * 0.4) : 80;
    let ret = Math.round(rng.normal(23 + (retSkill - 85) * 0.15, 7));
    const catchAt = g.freeKick ? rng.int(10, 25) : rng.int(-3, 8);
    let ballOn = catchAt + Math.max(3, ret);
    const st = returner ? statFor(g.stats[receiving], returner.id) : null;
    if (rng.chance(0.012 + Math.max(0, retSkill - 88) * 0.004)) {
      // Breakaway return.
      ballOn = clamp(ballOn + rng.int(30, 75), 40, 100);
    }
    ballOn = clamp(ballOn, 3, 100);
    if (st) { st.ret.kr++; st.ret.krYds += ballOn - Math.max(0, catchAt); }
    tick(g, receiving, rng.int(5, 8));
    if (ballOn >= 100) {
      if (st) st.ret.td++;
      g.score[receiving] += 6;
      logEvent(g, { type: 'td', scoring: true, text: `${g.teams[kicking].abbr} kickoff. ${shortName(returner)} returns it all the way for a TOUCHDOWN!` });
      g.phase = 'pat';
      g.patTeam = receiving;
      g.freeKick = false;
      return;
    }
    g.ballOn = ballOn;
    logEvent(g, { type: 'kickoff', text: `${g.teams[kicking].abbr} kickoff. ${returner ? shortName(returner) : 'Return'} to ${spot(g, receiving, ballOn)}.` });
  }
  g.freeKick = false;
  g.phase = 'play';
  startDrive(g);
}

/** Run `sec` off the clock, charging it to `team`'s time of possession. */
function tick(g, team, sec) {
  const used = Math.min(g.clock, sec);
  g.clock -= used;
  g.stats[team].team.top += used;
}

function pickReturner(comp) {
  const cands = [...(comp.wr || []).slice(1), ...(comp.rb2 ? [comp.rb2] : []), ...(comp.cb || [])];
  if (!cands.length) return comp.rb1 || comp.wr?.[0] || null;
  return cands.reduce((a, b) => (b.r.spd > a.r.spd ? b : a));
}

function doPat(g, rng, choice) {
  const team = g.patTeam;
  const comp = g.teams[team].comp;
  const two = choice ? choice === 'two' : goForTwo(g, team);
  if (two) {
    const def = g.teams[1 - team].comp;
    const pass = rng.chance(0.6);
    let p;
    if (pass) {
      const skill = (comp.qb ? comp.qb.r.tha * 0.6 + comp.qb.r.awr * 0.4 : 75);
      p = 0.47 + (skill - def.covShort) / 200 - Math.max(0, def.passRush - comp.passBlock) / 300;
    } else {
      const rb = comp.rb1;
      const skill = rb ? rb.r.pow * 0.6 + rb.r.awr * 0.4 : 75;
      p = 0.5 + (skill + comp.runBlock - def.runStop * 2) / 250;
    }
    const good = rng.chance(clamp(p, 0.25, 0.7));
    if (good) g.score[team] += 2;
    logEvent(g, { type: '2pt', scoring: good, text: `Two-point ${pass ? 'pass' : 'run'} is ${good ? 'GOOD' : 'no good'}. ${scoreLine(g)}` });
  } else {
    const k = comp.k;
    const kac = k ? k.r.kac : 75;
    const p = clamp(0.93 + (kac - 80) * 0.003, 0.82, 0.99);
    const good = rng.chance(p);
    if (k) { const s = statFor(g.stats[team], k.id); s.k.xpa++; if (good) s.k.xpm++; }
    if (good) g.score[team] += 1;
    logEvent(g, { type: 'xp', scoring: good, text: `${k ? shortName(k) : 'Kicker'} extra point is ${good ? 'good' : 'NO GOOD'}. ${scoreLine(g)}` });
  }
  g.phase = 'kickoff';
  g.kickingTeam = team;
  g.freeKick = false;
  if (checkOvertimeEnd(g)) return;
  if (g.clock <= 0) return; // quarter end will be processed on next step
}

// ---------------------------------------------------------------------------
// Plays
// ---------------------------------------------------------------------------

function doPlay(g, rng, calls) {
  const off = g.possession;
  const defT = 1 - off;

  // Burn play clock if the game clock is running from the previous play.
  if (g.clockRunning && g.clock > 0) {
    const burn = tempoSeconds(g, off, rng);
    if (burn >= g.clock) {
      g.stats[off].team.top += g.clock;
      if (g.drive) g.drive.time += g.clock;
      g.clock = 0;
      g.clockRunning = false;
      endOfQuarter(g, rng);
      return;
    }
    g.clock -= burn;
    g.stats[off].team.top += burn;
    if (g.drive) g.drive.time += burn;
  }

  const offCall = calls.off && OFFENSE_CALLS[calls.off] ? calls.off : chooseOffense(g, rng);
  const defCall = calls.def || chooseDefense(g, rng);
  const situation = { down: g.down, toGo: g.toGo, ballOn: g.ballOn, q: g.quarter, clock: g.clock };
  g.playCount++;
  g.lastCall = { off: offCall, def: defCall };

  let o;
  switch (offCall) {
    case 'run_in': case 'run_out': o = resolveRun(g, rng, offCall, defCall); break;
    case 'fg': o = resolveFieldGoal(g, rng); break;
    case 'punt': o = resolvePunt(g, rng); break;
    case 'kneel': o = { type: 'kneel', yards: -1, elapsed: 3, clockStops: false, text: `${qbName(g)} kneels.` }; break;
    case 'spike': o = { type: 'spike', yards: 0, elapsed: 1, clockStops: true, text: `${qbName(g)} spikes the ball.` }; break;
    default: o = resolvePass(g, rng, offCall, defCall);
  }
  o.call = offCall; o.defCall = defCall;
  applyOutcome(g, rng, o, situation);
}

function qbName(g) {
  const qb = g.teams[g.possession].comp.qb;
  return qb ? shortName(qb) : 'QB';
}

const MATRIX = {
  // offense call -> defense call -> modifiers
  run_in:     { base: {}, run_stop: { run: -1.6, stuff: 0.09 }, blitz: { run: -0.3, stuff: 0.04, breakaway: 0.02 }, deep: { run: 1.2, stuff: -0.05 } },
  run_out:    { base: {}, run_stop: { run: -1.2, stuff: 0.07 }, blitz: { run: 0.4, stuff: 0.03, breakaway: 0.03 }, deep: { run: 1.4, stuff: -0.05 } },
  screen:     { base: {}, run_stop: { comp: 0.02, yac: 1 }, blitz: { comp: 0.06, yac: 4, pressure: -0.1 }, deep: { comp: 0.03, yac: -1 } },
  pass_short: { base: {}, run_stop: { comp: 0.05, cov: -4 }, blitz: { pressure: 0.12, cov: -3, yac: 1.5 }, deep: { comp: 0.05, cov: -6, yac: -1 } },
  pass_med:   { base: {}, run_stop: { comp: 0.07, cov: -6 }, blitz: { pressure: 0.14, cov: -6, yac: 2 }, deep: { comp: -0.05, cov: 4 } },
  pass_deep:  { base: {}, run_stop: { comp: 0.08, cov: -8 }, blitz: { pressure: 0.16, cov: -8, yac: 3 }, deep: { comp: -0.12, cov: 8, int: 0.02 } },
  pa_pass:    { base: {}, run_stop: { comp: 0.1, cov: -9, pressure: -0.04 }, blitz: { pressure: 0.12, cov: -5 }, deep: { comp: -0.04, cov: 3 } },
};

function mods(offCall, defCall) {
  return (MATRIX[offCall] && MATRIX[offCall][defCall]) || {};
}

function resolveRun(g, rng, call, defCall) {
  const off = g.possession, defT = 1 - off;
  const comp = g.teams[off].comp;
  const def = g.teams[defT].comp;
  const m = mods(call, defCall);
  const outside = call === 'run_out';
  const shortYardage = g.toGo <= 2;
  // Ball carrier: RB1 most of the time, RB2 shares. QB sneak on very short yardage.
  let carrier;
  let sneak = false;
  if (shortYardage && g.toGo <= 1 && !outside && comp.qb && rng.chance(0.4)) { carrier = comp.qb; sneak = true; }
  else {
    const share = comp.rb2 ? clamp(0.28 + (comp.rb2.r.awr - comp.rb1.r.awr) / 150, 0.1, 0.45) : 0;
    carrier = comp.rb2 && rng.chance(share) ? comp.rb2 : comp.rb1;
  }
  if (!carrier) carrier = comp.qb;
  const rem = 100 - g.ballOn;
  const st = statFor(g.stats[off], carrier.id);
  st.rush.att++;
  g.stats[off].team.rushAtt++;

  const spd = carrier.r.spd ?? 70, elu = carrier.r.elu ?? 60, pow = carrier.r.pow ?? 65, vis = carrier.r.awr ?? 70, car = carrier.r.car ?? 80;
  const blockEdge = edge(comp.runBlock + (vis - 80) * 0.4, def.runStop, 20);
  let yards;
  if (sneak) {
    yards = rng.chance(0.78 + (comp.runBlock - def.runStop) / 200) ? rng.int(1, 3) : rng.int(-1, 0);
  } else {
    const stuffP = clamp(0.21 * (1.6 - blockEdge * 1.2) + (m.stuff || 0), 0.05, 0.45);
    if (rng.chance(stuffP)) {
      yards = clamp(Math.round(rng.normal(-1, 1.4)), -5, 1);
    } else {
      const base = outside ? rng.normal(3.9, 3.4) : rng.normal(4.1, 2.7);
      yards = base + (blockEdge - 0.5) * 3.5 + (m.run || 0);
      // Break a tackle.
      const btP = clamp(0.18 + ((pow * 0.55 + elu * 0.45) - def.tackling) / 260, 0.05, 0.45);
      if (rng.chance(btP)) yards += rng.exp(outside ? 5.5 : 4) + 1;
      // Breakaway.
      const baP = clamp(0.014 + Math.max(0, spd - def.defSpeed) / 450 + (m.breakaway || 0) + (outside ? 0.01 : 0), 0.004, 0.1);
      if (rng.chance(baP)) yards += rng.int(12, 45) * (spd >= 92 ? 1.3 : 1);
      yards = Math.round(yards);
    }
  }
  yards = Math.max(yards, -g.ballOn);
  yards = Math.min(yards, rem);
  const td = yards >= rem;

  // Fumble.
  const fumP = clamp(0.011 * (1 + (82 - car) / 22) * (1 + (def.tackling - 80) / 60), 0.002, 0.05);
  let fumble = !td && rng.chance(fumP);
  const tackler = pickTackler(g, defT, 'run', rng);
  let text = `${shortName(carrier)} ${sneak ? 'sneaks' : outside ? 'runs outside' : 'runs inside'} for ${yardsText(yards)}`;
  const oob = outside ? rng.chance(0.25) : rng.chance(0.06);
  if (td) text += ` — TOUCHDOWN!`;
  else if (tackler) text += ` (${shortName(tackler)})`;
  st.rush.yds += yards;
  st.rush.lng = Math.max(st.rush.lng, yards);
  if (td) st.rush.td++;
  if (tackler && !td) statFor(g.stats[defT], tackler.id).def.tkl++;
  g.stats[off].team.rushYds += yards;
  if (fumble) {
    const lost = rng.chance(0.5);
    st.rush.fum++;
    if (tackler) statFor(g.stats[defT], tackler.id).def.ff++;
    text += `. FUMBLE`;
    if (lost) {
      const recoverer = pickTackler(g, defT, 'run', rng);
      if (recoverer) statFor(g.stats[defT], recoverer.id).def.fr++;
      text += `, recovered by ${recoverer ? shortName(recoverer) : g.teams[defT].abbr}!`;
      return { type: 'fumble', yards, elapsed: 6, clockStops: true, turnover: true, text, carrier, returnYds: rng.int(0, 6) };
    }
    text += `, recovered by ${g.teams[off].abbr}.`;
  }
  return { type: 'run', yards, elapsed: rng.int(5, 8), clockStops: oob || td, oob, td, text: text + (fumble || td ? '' : '.'), carrier };
}

function pickReceiver(g, rng, comp, call) {
  const cands = [];
  const roles = [];
  (comp.wr || []).forEach((p, i) => { cands.push(p); roles.push(['WR1', 'WR2', 'WR3', 'WR4'][i]); });
  if (comp.te) { cands.push(comp.te); roles.push('TE'); }
  if (comp.rb1) { cands.push(comp.rb1); roles.push('RB1'); }
  if (comp.rb2) { cands.push(comp.rb2); roles.push('RB2'); }
  const roleBase = { WR1: 1.0, WR2: 0.8, WR3: 0.52, WR4: 0.14, TE: 0.7, RB1: 0.5, RB2: 0.12 };
  const typeMult = {
    screen:     { WR1: 0.8, WR2: 0.8, WR3: 0.7, WR4: 0.4, TE: 0.4, RB1: 3.0, RB2: 1.5 },
    pass_short: { WR1: 1.0, WR2: 1.0, WR3: 1.1, WR4: 1.0, TE: 1.35, RB1: 1.4, RB2: 1.2 },
    pass_med:   { WR1: 1.15, WR2: 1.1, WR3: 1.0, WR4: 1.0, TE: 1.0, RB1: 0.45, RB2: 0.4 },
    pass_deep:  { WR1: 1.3, WR2: 1.25, WR3: 1.0, WR4: 0.9, TE: 0.55, RB1: 0.15, RB2: 0.1 },
    pa_pass:    { WR1: 1.1, WR2: 1.1, WR3: 0.9, WR4: 0.8, TE: 1.35, RB1: 0.4, RB2: 0.3 },
  }[call] || {};
  const weights = cands.map((p, i) => {
    const role = roles[i];
    const skill = p.pos === 'RB' ? p.r.rec : 0.5 * p.r.rte + 0.3 * p.r.cth + 0.2 * p.r.spd;
    let w = roleBase[role] * Math.exp((skill - 82) / 9) * (typeMult[role] ?? 1);
    if (call === 'pass_deep' && p.pos !== 'RB') w *= Math.exp((p.r.spd - 88) / 10);
    return w;
  });
  const idx = cands.indexOf(rng.weighted(cands, weights));
  return { target: cands[idx], role: roles[idx] };
}

/** Primary defender for a target role. */
function primaryDefender(def, role, rng) {
  const cb = def.cb || [], s = def.s || [], lb = def.lb || [];
  const best = (arr, k) => arr.slice().sort((a, b) => b.r[k] - a.r[k]);
  switch (role) {
    case 'WR1': return cb[0] || s[0];
    case 'WR2': return cb[1] || cb[0] || s[0];
    case 'WR3': return rng.chance(0.5) ? (cb[1] || cb[0]) : (best(s, 'cov')[0] || cb[0]);
    case 'WR4': return best(s, 'cov')[0] || cb[0];
    case 'TE': return rng.chance(0.5) ? best(lb, 'cov')[0] : best(s, 'cov')[0];
    default: return best(lb, 'cov')[0] || s[0];
  }
}

function resolvePass(g, rng, call, defCall) {
  const off = g.possession, defT = 1 - off;
  const comp = g.teams[off].comp;
  const def = g.teams[defT].comp;
  const m = mods(call, defCall);
  const qb = comp.qb;
  const rem = 100 - g.ballOn;
  const st = statFor(g.stats[off], qb.id);
  const blitz = defCall === 'blitz';

  // Pressure.
  const rush = blitz ? def.blitzRush + 4 : def.passRush;
  const baseP = { screen: 0.13, pass_short: 0.22, pass_med: 0.27, pass_deep: 0.33, pa_pass: 0.29 }[call];
  const pressureP = clamp(baseP * (0.45 + edge(rush, comp.passBlock + (comp.olAwr - 80) * 0.2, 20) * 1.1) + (m.pressure || 0), 0.05, 0.7);
  const pressured = rng.chance(pressureP);
  if (pressured) {
    const sackP = clamp(0.27 - (qb.r.mob - 70) * 0.003 - (qb.r.awr - 80) * 0.002 + (call === 'pass_deep' ? 0.05 : 0) + (blitz ? 0.04 : 0), 0.08, 0.5);
    if (rng.chance(sackP)) {
      const sacker = pickRusher(g, defT, blitz, rng);
      let yards = -rng.int(3, 10);
      yards = Math.max(yards, -g.ballOn);
      st.pass.sck++; st.pass.sckYds += -yards;
      g.stats[off].team.sacksAllowed++;
      g.stats[off].team.passYds += yards;
      if (sacker) { const ds = statFor(g.stats[defT], sacker.id); ds.def.sck++; ds.def.tkl++; }
      // Strip sack.
      if (rng.chance(0.11) && g.ballOn + yards > 0) {
        st.rush.fum++;
        if (sacker) statFor(g.stats[defT], sacker.id).def.ff++;
        if (rng.chance(0.55)) {
          const rec = pickTackler(g, defT, 'run', rng);
          if (rec) statFor(g.stats[defT], rec.id).def.fr++;
          return { type: 'fumble', yards, elapsed: 6, clockStops: true, turnover: true, returnYds: rng.int(0, 5),
            text: `${shortName(qb)} sacked by ${sacker ? shortName(sacker) : 'the defense'} for ${yardsText(yards)}. FUMBLE, recovered by ${rec ? shortName(rec) : g.teams[defT].abbr}!` };
        }
        return { type: 'sack', yards, elapsed: 6, clockStops: false,
          text: `${shortName(qb)} sacked by ${sacker ? shortName(sacker) : 'the defense'} for ${yardsText(yards)}. Fumble recovered by ${g.teams[off].abbr}.` };
      }
      return { type: 'sack', yards, elapsed: rng.int(5, 7), clockStops: false, safety: g.ballOn + yards <= 0,
        text: `${shortName(qb)} sacked by ${sacker ? shortName(sacker) : 'the defense'} for ${yardsText(yards)}${g.ballOn + yards <= 0 ? ' — SAFETY!' : '.'}` };
    }
    // Scramble.
    const scrP = clamp((qb.r.mob - 55) / 120, 0.02, 0.4);
    if (rng.chance(scrP)) {
      let yards = Math.round(rng.normal(3 + (qb.r.mob - 70) * 0.12, 5));
      yards = clamp(yards, -3, rem);
      const td = yards >= rem;
      const rs = st;
      rs.rush.att++; rs.rush.yds += yards; rs.rush.lng = Math.max(rs.rush.lng, yards); if (td) rs.rush.td++;
      g.stats[off].team.rushAtt++; g.stats[off].team.rushYds += yards;
      const tackler = pickTackler(g, defT, 'run', rng);
      if (tackler && !td) statFor(g.stats[defT], tackler.id).def.tkl++;
      const oob = rng.chance(0.4);
      return { type: 'run', yards, td, oob, elapsed: rng.int(5, 8), clockStops: td || oob, carrier: qb,
        text: `${shortName(qb)} escapes pressure and scrambles for ${yardsText(yards)}${td ? ' — TOUCHDOWN!' : tackler ? ` (${shortName(tackler)}).` : '.'}` };
    }
  }

  // Throw.
  const { target, role } = pickReceiver(g, rng, comp, call);
  const prim = primaryDefender(def, role, rng);
  const covComp = { screen: def.covShort, pass_short: def.covShort, pass_med: def.covMed, pass_deep: def.covDeep, pa_pass: def.covMed }[call];
  let cov = prim ? 0.55 * prim.r.cov + 0.45 * covComp : covComp;
  cov += m.cov || 0;
  const tSkill = target.pos === 'RB' ? target.r.rec : 0.45 * target.r.rte + 0.55 * target.r.cth;
  const skill = qb.r.tha * 0.55 + tSkill * 0.45 - (pressured ? 9 : 0);
  const baseComp = { screen: 0.78, pass_short: 0.74, pass_med: 0.61, pass_deep: 0.42, pa_pass: 0.62 }[call];
  let compP = baseComp + (skill - cov) * 0.004 + (m.comp || 0);
  if (call === 'pass_deep') compP += ((target.r.spd ?? 80) - def.defSpeed) * 0.002 + (qb.r.thp - 85) * 0.0015;
  if (pressured) compP -= 0.08;
  compP = clamp(compP, 0.12, 0.93);

  st.pass.att++;
  const ts = statFor(g.stats[off], target.id);
  ts.rec.tgt++;
  g.stats[off].team.passAtt++;

  // Interception.
  const baseInt = { screen: 0.004, pass_short: 0.011, pass_med: 0.021, pass_deep: 0.04, pa_pass: 0.02 }[call];
  let intP = baseInt * (1 + (def.ballSkills - 80) / 50) * (1 + (86 - qb.r.awr) / 40) * (pressured ? 1.5 : 1) * (1 + (cov - skill) / 60) + (m.int || 0);
  if (g.quarter >= 4 && scoreDiff(g, off) < -8 && g.clock < 240) intP *= 1.25; // desperation
  intP = clamp(intP, 0.002, 0.2);

  const air = airYards(rng, call, qb, target);
  if (rng.chance(intP)) {
    st.pass.int++;
    const picker = rng.chance(0.55) && prim ? prim : pickBallhawk(g, defT, rng);
    const ds = statFor(g.stats[defT], picker.id);
    ds.def.int++;
    const spotAir = Math.min(air, rem);
    let ret = Math.max(0, Math.round(rng.exp(9)));
    if (rng.chance(0.06 + Math.max(0, picker.r.spd - 90) * 0.01)) ret += rng.int(20, 60);
    const intSpot = g.ballOn + spotAir; // from offense perspective
    const defSpot = 100 - intSpot; // from defense perspective after catch
    const endSpot = defSpot + ret;
    return { type: 'int', yards: 0, elapsed: rng.int(6, 10), clockStops: true, turnover: true, interceptor: picker,
      intSpot, returnYds: ret, defTd: endSpot >= 100,
      text: `${shortName(qb)} ${callVerb(call)} intended for ${shortName(target)} is INTERCEPTED by ${shortName(picker)}${endSpot >= 100 ? ' and returned for a TOUCHDOWN!' : ret >= 15 ? ` and returned ${ret} yards.` : '.'}` };
  }

  if (!rng.chance(compP)) {
    const drop = rng.chance(clamp((90 - target.r.cth) / 160, 0.02, 0.2));
    const pd = !drop && rng.chance(0.35);
    if (pd && prim) { statFor(g.stats[defT], prim.id).def.pd++; }
    const txt = drop ? `${shortName(qb)} ${callVerb(call)} to ${shortName(target)} — DROPPED.`
      : pd ? `${shortName(qb)} ${callVerb(call)} to ${shortName(target)} broken up by ${shortName(prim)}.`
      : `${shortName(qb)} ${callVerb(call)} to ${shortName(target)} — incomplete${pressured ? ' under pressure' : ''}.`;
    return { type: 'incomplete', yards: 0, elapsed: rng.int(4, 7), clockStops: true, text: txt, target };
  }

  // Completion.
  const yacMean = { screen: 6.5, pass_short: 3.2, pass_med: 2.6, pass_deep: 4, pa_pass: 3.4 }[call] + (m.yac || 0);
  const rac = target.r.rac ?? (target.r.elu ? (target.r.elu * 0.6 + target.r.pow * 0.4) : 70);
  let yac = rng.exp(Math.max(1, yacMean + (rac - def.tackling) * 0.05));
  const baP = clamp(0.012 + Math.max(0, (target.r.spd ?? 80) - def.defSpeed) / 450 + (call === 'screen' ? 0.015 : 0), 0.004, 0.1);
  if (rng.chance(baP)) yac += rng.int(15, 45);
  let yards = Math.round(air + yac);
  yards = Math.max(yards, -g.ballOn + 1);
  yards = Math.min(yards, rem);
  const td = yards >= rem;
  st.pass.cmp++; st.pass.yds += yards; st.pass.lng = Math.max(st.pass.lng, yards);
  ts.rec.rec++; ts.rec.yds += yards; ts.rec.lng = Math.max(ts.rec.lng, yards);
  if (td) { st.pass.td++; ts.rec.td++; }
  g.stats[off].team.passCmp++;
  g.stats[off].team.passYds += yards;
  const tackler = td ? null : pickTackler(g, defT, call, rng, prim);
  if (tackler) statFor(g.stats[defT], tackler.id).def.tkl++;
  const oob = rng.chance(call === 'pass_deep' ? 0.3 : call === 'screen' ? 0.15 : 0.22);
  // Fumble after catch.
  if (!td && rng.chance(0.005 * (1 + (def.tackling - 80) / 40))) {
    ts.rush.fum++;
    if (tackler) statFor(g.stats[defT], tackler.id).def.ff++;
    if (rng.chance(0.5)) {
      const rec = pickTackler(g, defT, 'run', rng);
      if (rec) statFor(g.stats[defT], rec.id).def.fr++;
      return { type: 'fumble', yards, elapsed: 7, clockStops: true, turnover: true, returnYds: rng.int(0, 8),
        text: `${shortName(qb)} ${callVerb(call)} complete to ${shortName(target)} for ${yardsText(yards)}. FUMBLE, recovered by ${rec ? shortName(rec) : g.teams[defT].abbr}!` };
    }
    return { type: 'pass', yards, elapsed: 7, clockStops: false, target,
      text: `${shortName(qb)} ${callVerb(call)} complete to ${shortName(target)} for ${yardsText(yards)}. Fumble recovered by ${g.teams[off].abbr}.` };
  }
  return { type: 'pass', yards, td, oob, elapsed: rng.int(6, 9), clockStops: td || oob, target,
    text: `${shortName(qb)} ${callVerb(call)} complete to ${shortName(target)} for ${yardsText(yards)}${td ? ' — TOUCHDOWN!' : tackler ? ` (${shortName(tackler)}).` : '.'}` };
}

function callVerb(call) {
  return { screen: 'screen pass', pass_short: 'short pass', pass_med: 'pass', pass_deep: 'deep pass', pa_pass: 'play-action pass' }[call] || 'pass';
}

function airYards(rng, call, qb, target) {
  switch (call) {
    case 'screen': return clamp(rng.normal(0, 2.2), -4, 4);
    case 'pass_short': return clamp(rng.normal(6, 2.4), 1, 11);
    case 'pass_med': return clamp(rng.normal(12.5, 3.5), 8, 21);
    case 'pass_deep': return clamp(rng.normal(27 + (qb.r.thp - 85) * 0.15, 7), 17, 52);
    case 'pa_pass': return clamp(rng.normal(14, 5.5), 4, 32);
    default: return 6;
  }
}

function yardsText(y) {
  if (y === 1) return '1 yard';
  if (y === 0) return 'no gain';
  if (y < 0) return `a loss of ${-y}`;
  return `${y} yards`;
}

function pickTackler(g, defT, kind, rng, prim) {
  const d = g.teams[defT].comp;
  const groups = { dl: d.dl || [], lb: d.lb || [], cb: d.cb || [], s: d.s || [] };
  let gw;
  if (kind === 'run') gw = { dl: 0.3, lb: 0.45, cb: 0.07, s: 0.18 };
  else if (kind === 'pass_deep') gw = { dl: 0, lb: 0.05, cb: 0.55, s: 0.4 };
  else if (kind === 'screen') gw = { dl: 0.1, lb: 0.4, cb: 0.25, s: 0.25 };
  else gw = { dl: 0.04, lb: 0.36, cb: 0.35, s: 0.25 };
  if (prim && kind !== 'run' && rng.chance(0.45)) return prim;
  const cands = [], weights = [];
  for (const [k, arr] of Object.entries(groups)) {
    for (const p of arr) { cands.push(p); weights.push((gw[k] / Math.max(1, arr.length)) * Math.exp((p.r.tck - 80) / 15)); }
  }
  if (!cands.length) return null;
  return rng.weighted(cands, weights);
}

function pickRusher(g, defT, blitz, rng) {
  const d = g.teams[defT].comp;
  const cands = [], weights = [];
  for (const p of d.dl || []) { cands.push(p); weights.push(Math.exp((p.r.prs - 80) / 7)); }
  for (const p of d.lb || []) { cands.push(p); weights.push(Math.exp((p.r.prs - 80) / 7) * (blitz ? 1.2 : 0.45)); }
  if (blitz) for (const p of d.s || []) { cands.push(p); weights.push(Math.exp((p.r.tck - 85) / 10) * 0.25); }
  if (!cands.length) return null;
  return rng.weighted(cands, weights);
}

function pickBallhawk(g, defT, rng) {
  const d = g.teams[defT].comp;
  const cands = [], weights = [];
  for (const p of d.cb || []) { cands.push(p); weights.push(Math.exp((p.r.bal - 80) / 8)); }
  for (const p of d.s || []) { cands.push(p); weights.push(Math.exp((p.r.bal - 80) / 8) * 0.9); }
  for (const p of d.lb || []) { cands.push(p); weights.push(Math.exp((p.r.cov - 80) / 8) * 0.35); }
  return rng.weighted(cands, weights);
}

function resolveFieldGoal(g, rng) {
  const off = g.possession, defT = 1 - off;
  const comp = g.teams[off].comp;
  const k = comp.k;
  const dist = fgDistance(g.ballOn);
  const p = fgProbability(k, dist);
  const blocked = rng.chance(0.012);
  const good = !blocked && rng.chance(p);
  if (k) { const s = statFor(g.stats[off], k.id); s.k.fga++; if (good) { s.k.fgm++; s.k.lng = Math.max(s.k.lng, dist); } }
  const name = k ? shortName(k) : 'Kicker';
  if (good) return { type: 'fg', yards: 0, elapsed: 5, clockStops: true, fgGood: true, text: `${name} ${dist}-yard field goal is GOOD.` };
  return { type: 'fg', yards: 0, elapsed: 5, clockStops: true, fgGood: false, missDist: dist,
    text: blocked ? `${name} ${dist}-yard field goal is BLOCKED!` : `${name} ${dist}-yard field goal is NO GOOD (${rng.chance(0.5) ? 'wide right' : dist > 50 ? 'short' : 'wide left'}).` };
}

function resolvePunt(g, rng) {
  const off = g.possession, defT = 1 - off;
  const comp = g.teams[off].comp;
  const p = comp.p;
  const ppw = p ? p.r.ppw : 75, pac = p ? p.r.pac : 75;
  if (p) statFor(g.stats[off], p.id).p.n++;
  const rem = 100 - g.ballOn;
  const name = p ? shortName(p) : 'Punter';
  if (rng.chance(0.006)) {
    // Blocked punt.
    const loss = rng.int(5, 15);
    return { type: 'punt', yards: -loss, elapsed: 5, clockStops: true, puntBlocked: true, text: `${name} punt is BLOCKED!` };
  }
  let dist = rng.normal(39 + (ppw - 75) * 0.4, 6);
  // Pooch when close.
  if (rem < 55) dist = Math.min(dist, rem - rng.int(0, 6) - (100 - pac) / 8);
  dist = clamp(Math.round(dist), 20, 75);
  let landing = g.ballOn + dist; // offense perspective
  const ps = p ? statFor(g.stats[off], p.id) : null;
  if (landing >= 100) {
    // Touchback unless placement skill pins it.
    if (rng.chance(clamp((pac - 70) / 60, 0.05, 0.6)) && rem > 35) {
      landing = 100 - rng.int(1, 8);
    } else {
      if (ps) { ps.p.yds += rem; ps.p.lng = Math.max(ps.p.lng, rem); }
      return { type: 'punt', yards: 0, elapsed: 6, clockStops: true, puntTo: 20, text: `${name} punts ${rem} yards into the end zone. Touchback.` };
    }
  }
  let netTo = 100 - landing; // from receiving team's perspective (their own yard line)
  let ret = 0;
  const returner = pickReturner(g.teams[defT].comp);
  const fairCatch = rng.chance(0.35 + (pac - 75) * 0.01) || netTo <= 10;
  if (!fairCatch && netTo > 5) {
    const retSkill = returner ? returner.r.spd * 0.6 + (returner.r.elu ?? returner.r.rac ?? 75) * 0.4 : 80;
    ret = Math.max(0, Math.round(rng.exp(7 + (retSkill - 85) * 0.1)));
    if (rng.chance(0.012)) ret += rng.int(20, 60);
    if (returner) { const rs = statFor(g.stats[defT], returner.id); rs.ret.pr++; rs.ret.prYds += Math.min(ret, 100 - netTo); }
  }
  let finalTo = netTo + ret;
  if (ps) { ps.p.yds += dist; ps.p.lng = Math.max(ps.p.lng, dist); if (netTo <= 20) ps.p.in20++; }
  if (finalTo >= 100) {
    if (returner) statFor(g.stats[defT], returner.id).ret.td++;
    return { type: 'punt', yards: 0, elapsed: 10, clockStops: true, puntReturnTd: true, text: `${name} punts ${dist} yards. ${returner ? shortName(returner) : 'Returner'} takes it back for a TOUCHDOWN!` };
  }
  finalTo = clamp(finalTo, 1, 99);
  const text = `${name} punts ${dist} yards${fairCatch ? ', fair catch' : ret ? `, returned ${ret} yards` : ''}${netTo <= 20 && !ret ? ' — inside the 20' : ''}.`;
  return { type: 'punt', yards: 0, elapsed: fairCatch ? 5 : rng.int(6, 10), clockStops: true, puntTo: finalTo, text };
}

// ---------------------------------------------------------------------------
// Outcome application
// ---------------------------------------------------------------------------

function applyOutcome(g, rng, o, sit) {
  const off = g.possession, defT = 1 - off;
  const ts = g.stats[off].team;
  ts.plays++;
  if (g.drive) { g.drive.plays++; }

  const wasThird = sit.down === 3, wasFourth = sit.down === 4 && !['punt', 'fg'].includes(o.type);
  if (wasThird) ts.thirdAtt++;
  if (wasFourth) ts.fourthAtt++;

  // Clock consumption for the play itself.
  const elapsed = Math.min(g.clock, o.elapsed || 5);
  g.clock -= elapsed;
  ts.top += elapsed;
  if (g.drive) g.drive.time += elapsed;

  const prefix = `${fmtQuarter(sit.q)} ${fmtClock(sit.clock)} · ${['1st', '2nd', '3rd', '4th'][sit.down - 1]} & ${sit.ballOn + sit.toGo >= 100 ? 'Goal' : sit.toGo} at ${spot(g, off, sit.ballOn)}`;
  const base = { type: o.type, call: o.call, defCall: o.defCall, yards: o.yards, situation: prefix, text: o.text };

  // Special outcomes first.
  if (o.type === 'fg') {
    if (o.fgGood) {
      g.score[off] += 3;
      ts.points += 0;
      if (sit.ballOn >= 80) ts.redZoneAtt++;
      endDrive(g, 'FG');
      logEvent(g, { ...base, scoring: true, text: `${o.text} ${scoreLine(g)}` });
      g.phase = 'kickoff'; g.kickingTeam = off; g.clockRunning = false;
      checkOvertimeEnd(g);
      return;
    }
    // Miss: defense takes over at spot of kick (7 yards behind LOS) or 20 if inside.
    if (sit.ballOn >= 80) ts.redZoneAtt++;
    endDrive(g, 'missed FG');
    logEvent(g, { ...base });
    changePossession(g, Math.max(20, 100 - (sit.ballOn - 7)));
    g.clockRunning = false;
    return;
  }
  if (o.type === 'punt') {
    endDrive(g, 'punt');
    if (o.puntReturnTd) {
      g.possession = defT;
      g.score[defT] += 6;
      logEvent(g, { ...base, scoring: true });
      g.phase = 'pat'; g.patTeam = defT; g.clockRunning = false;
      return;
    }
    logEvent(g, { ...base });
    if (o.puntBlocked) changePossession(g, clamp(100 - (sit.ballOn + o.yards), 1, 99));
    else changePossession(g, o.puntTo);
    g.clockRunning = false;
    return;
  }
  if (o.type === 'kneel') {
    g.ballOn = Math.max(1, g.ballOn - 1);
    g.down++; g.toGo += 1;
    logEvent(g, { ...base });
    if (g.down > 4) { endDrive(g, 'turnover on downs'); changePossession(g, 100 - g.ballOn); g.clockRunning = false; }
    else g.clockRunning = g.clock > 0;
    return;
  }
  if (o.type === 'spike') {
    g.down++;
    logEvent(g, { ...base });
    g.clockRunning = false;
    if (g.down > 4) { endDrive(g, 'turnover on downs'); changePossession(g, 100 - g.ballOn); }
    return;
  }

  // Turnovers.
  if (o.turnover) {
    ts.turnovers++;
    if (o.type === 'int') {
      const defSpot = 100 - o.intSpot + o.returnYds;
      endDrive(g, 'interception');
      if (o.defTd) {
        g.possession = defT;
        g.score[defT] += 6;
        logEvent(g, { ...base, scoring: true });
        statFor(g.stats[defT], o.interceptor.id).def.td++;
        g.phase = 'pat'; g.patTeam = defT; g.clockRunning = false;
        if (checkOvertimeEnd(g, { defensiveScore: true })) return;
        return;
      }
      logEvent(g, { ...base });
      changePossession(g, clamp(defSpot, 1, 99));
      // Touchback if intercepted in the end zone and not returned out.
      if (o.intSpot >= 100 && o.returnYds < 5) g.ballOn = 20;
      g.clockRunning = false;
      return;
    }
    // Fumble lost.
    const spotOff = clamp(sit.ballOn + o.yards, 1, 99);
    ts.totalYds += o.yards;
    if (g.drive) g.drive.yards += o.yards;
    endDrive(g, 'fumble');
    const defSpot = clamp(100 - spotOff + (o.returnYds || 0), 1, 99);
    if (100 - spotOff + (o.returnYds || 0) >= 100) {
      g.possession = defT;
      g.score[defT] += 6;
      logEvent(g, { ...base, scoring: true, text: `${o.text} Returned for a TOUCHDOWN!` });
      g.phase = 'pat'; g.patTeam = defT; g.clockRunning = false;
      checkOvertimeEnd(g, { defensiveScore: true });
      return;
    }
    logEvent(g, { ...base });
    changePossession(g, defSpot);
    g.clockRunning = false;
    return;
  }

  // Normal from-scrimmage result.
  const newBallOn = sit.ballOn + o.yards;
  if (o.safety || newBallOn <= 0) {
    // Safety.
    ts.totalYds += o.yards;
    if (g.drive) g.drive.yards += o.yards;
    g.score[defT] += 2;
    endDrive(g, 'safety');
    logEvent(g, { ...base, scoring: true, text: `${o.text} Safety. ${scoreLine(g)}` });
    g.phase = 'kickoff'; g.kickingTeam = off; g.freeKick = true; g.clockRunning = false;
    checkOvertimeEnd(g, { defensiveScore: true });
    return;
  }
  if (g.drive) g.drive.yards += o.yards;
  ts.totalYds += o.yards;
  if (o.td || newBallOn >= 100) {
    g.ballOn = 100;
    g.score[off] += 6;
    if (sit.ballOn >= 80) { ts.redZoneAtt++; ts.redZoneTd++; }
    if (wasThird) ts.thirdConv++;
    if (wasFourth) ts.fourthConv++;
    ts.firstDowns++;
    endDrive(g, 'TD');
    logEvent(g, { ...base, scoring: true });
    g.phase = 'pat'; g.patTeam = off; g.clockRunning = false;
    return;
  }
  g.ballOn = newBallOn;
  if (o.yards >= sit.toGo) {
    g.down = 1;
    g.toGo = Math.min(10, 100 - g.ballOn);
    ts.firstDowns++;
    if (wasThird) ts.thirdConv++;
    if (wasFourth) ts.fourthConv++;
  } else {
    g.down = sit.down + 1;
    g.toGo = sit.toGo - o.yards;
    if (g.down > 4) {
      endDrive(g, 'turnover on downs');
      logEvent(g, { ...base, text: `${o.text} Turnover on downs.` });
      changePossession(g, 100 - g.ballOn);
      g.clockRunning = false;
      return;
    }
  }
  if (sit.ballOn < 80 && g.ballOn >= 80) ts.redZoneAtt++;
  logEvent(g, { ...base });
  g.clockRunning = !o.clockStops && g.clock > 0;
  // Out of bounds outside two minutes: clock restarts on ready-for-play.
  if (o.oob && !o.td && halfSecondsLeft(g) > 120 && g.clock > 0) {
    g.clockRunning = true;
  }
  if (g.clockRunning) {
    for (const t of [off, defT]) {
      if (wantsTimeout(g, t)) {
        g.timeouts[t]--;
        g.clockRunning = false;
        logEvent(g, { type: 'timeout', text: `Timeout, ${g.teams[t].name} (${g.timeouts[t]} left).` });
        break;
      }
    }
  }
}

function changePossession(g, newBallOnForNewTeam) {
  const wasOt = !!g.ot;
  g.possession = 1 - g.possession;
  g.ballOn = clamp(Math.round(newBallOnForNewTeam), 1, 99);
  g.down = 1;
  g.toGo = Math.min(10, 100 - g.ballOn);
  g.phase = 'play';
  if (wasOt && checkOvertimeEnd(g)) return;
  startDrive(g);
}
