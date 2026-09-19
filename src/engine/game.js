// Play-by-play game simulation. A game is a plain serializable object; `step`
// advances it by one event (kickoff, play, PAT). All randomness comes from the
// game's own RNG so a game replays identically from the same seed.

import { RNG, clamp, edge } from './rng.js';
import { composites } from './ratings.js';
import { injuryChance, rollSeverity, POS_RISK, injuryText, fillLineup } from './injuries.js';
import { rollPreSnap, rollHolding, rollDefensiveFoul, rollReturnFoul, walkOff, penaltyLabel } from './penalties.js';
import { winProbability, priorMargin } from './winprob.js';
import { makeGameplan } from './gm.js';
import {
  chooseOffense, chooseDefense, goForTwo, onsideKick, tempoSeconds, wantsTimeout,
  fgDistance, fgProbability, halfSecondsLeft, scoreDiff, OFFENSE_CALLS,
} from './playcall.js';
import { emptyTeamStats, statFor, shortName, fmtClock, fmtQuarter } from './stats.js';
import { pickReturner } from './game/picks.js';
import { mods, resolveRun, resolvePass, resolveFieldGoal, resolvePunt } from './game/plays.js';

const Q_LEN = 900;
// Composite points added to the home side's blocking, rush, coverage and
// tackling. Calibrated so equal teams split home games about 56/44.
const HOME_EDGE = 1.1;
const HOME_KEYS = ['passBlock', 'runBlock', 'passRush', 'blitzRush', 'runStop', 'covShort', 'covMed', 'covDeep', 'tackling'];

/**
 * teams: [home, away] each { id, name, abbr, color, lineup, strategy, isUser }
 * options: { seed, playoff, homeAdvantage (default true; false at a neutral site),
 *            injuryLevel (0 = none, 1 = the default dial; see injuries.js),
 *            penalties (default true) }
 */
export function createGame(home, away, options = {}) {
  const seed = options.seed ?? Math.floor(Math.random() * 4294967296);
  const rng = new RNG(seed);
  const teams = [home, away].map((t) => ({
    id: t.id, name: t.name, abbr: t.abbr, color: t.color, isUser: !!t.isUser,
    strategy: { ...t.strategy },
    lineup: cloneLineup(t.lineup),
    comp: null,
    injuries: [],
  }));
  const homeAdvantage = options.homeAdvantage !== false;
  const chem = Array.isArray(options.chem) ? [options.chem[0] || 0, options.chem[1] || 0] : [0, 0];
  const receiving = rng.int(0, 1);
  const g = {
    seed,
    rngState: rng.state,
    playoff: !!options.playoff,
    neutral: !homeAdvantage,
    chem,
    injuryLevel: options.injuryLevel ?? 0,
    penalties: options.penalties !== false,
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
  rebuildComp(g, 0);
  rebuildComp(g, 1);
  // What the stronger roster and the home crowd are worth over a full game; the win-probability model spends it as the clock runs.
  g.prior = priorMargin(home, away, !homeAdvantage);
  // AI clubs read the matchup and adjust; a human's sliders are left alone.
  for (const side of [0, 1]) if (!teams[side].isUser || options.planForUser) teams[side].plan = makeGameplan(teams[side].comp, teams[1 - side].comp);
  logEvent(g, { type: 'info', text: `${teams[receiving].name} will receive the opening kickoff.` });
  g.lastEvent.wp = roundWp(winProbability(g));
  return g;
}

function cloneLineup(lineup) {
  const out = {};
  for (const [pos, arr] of Object.entries(lineup || {})) out[pos] = arr.slice();
  return out;
}

/**
 * Team composites come from whoever is still standing: a position group left
 * short by injury is padded with replacement-level players first, and the home
 * side's edge is re-applied so it survives a mid-game rebuild.
 */
function rebuildComp(g, side) {
  const comp = composites(fillLineup(g.teams[side].lineup));
  if (side === 0 && !g.neutral) for (const k of HOME_KEYS) comp[k] += HOME_EDGE;
  // Chemistry is an execution effect, so it rides the same keys as the home
  // edge and is carried separately for the quarterback reads below.
  const chem = (g.chem && g.chem[side]) || 0;
  if (chem) for (const k of HOME_KEYS) comp[k] += chem;
  comp.chem = chem;
  g.teams[side].comp = comp;
}

/**
 * One roll per play for an injury somewhere on the field. The victim is drawn
 * from the players the play actually involved, weighted by how exposed each
 * one was and by how fragile the position is. A hurt player leaves the game
 * on the spot: he is dropped from the lineup, the unit ratings are rebuilt,
 * and the season layer reads his weeks out from the game's injury list.
 */
function maybeInjure(g, rng, o, off, defT) {
  if (!g.injuryLevel) return;
  if (!rng.chance(injuryChance(g.injuryLevel, o.type))) return;
  const oc = g.teams[off].comp, dc = g.teams[defT].comp;
  const cands = [];
  const add = (side, p, w) => { if (p && !p.replacement && g.teams[side].lineup[p.pos]?.some((x) => x.id === p.id)) cands.push({ side, p, w: w * (POS_RISK[p.pos] ?? 1) }); };
  const rnd = (arr) => (arr && arr.length ? arr[rng.int(0, arr.length - 1)] : null);
  const backSeven = (c) => [...(c.lb || []), ...(c.cb || []), ...(c.s || [])];
  switch (o.type) {
    case 'run':
      add(off, o.carrier, 1.0); add(defT, o.tackler, 0.55); add(off, rnd(oc.ol), 0.35); add(defT, rnd(dc.dl), 0.35); add(defT, rnd(dc.lb), 0.2);
      break;
    case 'pass':
      add(off, o.target, 0.9); add(defT, o.tackler, 0.5); add(off, oc.qb, o.pressured ? 0.6 : 0.25); add(off, rnd(oc.ol), 0.3); add(defT, rnd(dc.dl), 0.3); add(defT, o.defender, 0.25);
      break;
    case 'incomplete':
      add(off, o.target, 0.3); add(off, oc.qb, o.pressured ? 0.5 : 0.2); add(off, rnd(oc.ol), 0.2); add(defT, rnd(dc.dl), 0.2); add(defT, o.defender, 0.15);
      break;
    case 'sack':
      add(off, oc.qb, 1.6); add(defT, o.sacker, 0.3); add(off, rnd(oc.ol), 0.3);
      break;
    case 'int':
      add(defT, o.interceptor, 0.6); add(off, o.target, 0.4); add(off, oc.qb, 0.2);
      break;
    case 'fumble':
      add(off, o.carrier || o.target || oc.qb, 0.8); add(defT, o.tackler || o.sacker, 0.5); add(off, rnd(oc.ol), 0.3); add(defT, rnd(dc.dl), 0.3);
      break;
    case 'kickoff': case 'punt': {
      const rs = o.returnSide ?? defT;
      if (!o.returner) return;
      add(rs, o.returner, 0.9); add(1 - rs, rnd(backSeven(g.teams[1 - rs].comp)), 0.6);
      break;
    }
    case 'fg':
      add(off, oc.k, 0.5);
      break;
    default:
      return;
  }
  if (!cands.length) return;
  const pick = rng.weighted(cands, cands.map((c) => c.w));
  injure(g, pick.side, pick.p, rollSeverity(rng));
}

function injure(g, side, p, { kind, weeks }) {
  const t = g.teams[side];
  for (const pos of Object.keys(t.lineup)) t.lineup[pos] = t.lineup[pos].filter((x) => x.id !== p.id);
  t.injuries.push({ id: p.id, name: p.name, pos: p.pos, kind, weeks, q: g.quarter, clock: g.clock });
  statFor(g.stats[side], p.id).games = 1;
  rebuildComp(g, side);
  logEvent(g, { type: 'injury', team: side, text: injuryText(p, kind, weeks) });
}

function getRng(g) {
  return new RNG(g.rngState);
}
function saveRng(g, rng) {
  g.rngState = rng.state;
}

/**
 * Three decimals is more than a chart drawn at pixel resolution and a label
 * printed as a whole percent can use, and a full double costs nineteen
 * characters against five in a save that is mostly play-by-play.
 */
const roundWp = (p) => Math.round(p * 1000) / 1000;

function logEvent(g, e) {
  // `flag` is false on almost every event, and `"flag":false` is twelve
  // characters of nothing. Every reader tests it for truth.
  if (e && e.flag === false) { e = { ...e }; delete e.flag; }
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
    // A trip is a drive that reached the twenty, counted once. It used to be
    // counted at five separate sites — on crossing the line, and again on the
    // touchdown or field goal that followed — so a game showed 6.4 trips out of
    // 10.8 drives and a red zone conversion of 35% against a real 55 to 65.
    inRedZone: false,
  };
  g.stats[g.possession].team.drives++;
  if (g.ot) g.ot.possessed[g.possession] = true;
  logEvent(g, { type: 'drive', text: `${g.teams[g.possession].name} ball at ${spot(g, g.possession, g.ballOn)}.` });
}

/**
 * Note a drive reaching the twenty, once. Also catches a drive that *starts*
 * inside it — a short field after a turnover never crosses the line, which is
 * the case the scattered counters were clumsily trying to cover.
 */
function markRedZone(g) {
  const d = g.drive;
  if (!d || d.inRedZone || g.ballOn < 80) return;
  d.inRedZone = true;
  g.stats[d.team].team.redZoneAtt++;
}

function endDrive(g, result, endBallOn = g.ballOn) {
  if (!g.drive) return;
  g.drive.result = result;
  // Where the drive actually finished, which is not always where the ball is
  // sitting when we get here: a fumble is spotted downfield before possession
  // changes, and a safety leaves the ball in the end zone.
  g.drive.endBallOn = clamp(Math.round(endBallOn), 0, 100);
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
  const from = g.log.length;
  // Handle expired clock before running anything but a PAT.
  if (g.clock <= 0 && g.phase !== 'pat') {
    endOfQuarter(g, rng);
    saveRng(g, rng);
    if (g.final) { stampWp(g, from); return g; }
  }
  if (g.phase === 'kickoff') doKickoff(g, rng);
  else if (g.phase === 'pat') doPat(g, rng, calls.pat);
  else if (g.phase === 'play') doPlay(g, rng, calls);
  saveRng(g, rng);
  stampWp(g, from);
  return g;
}

/**
 * The state is settled at the end of a step (possession changes included), so
 * every event the step logged carries the home side's chance of winning after
 * it: the play, and the drive or timeout note that may follow it.
 */
function stampWp(g, from) {
  const wp = roundWp(winProbability(g));
  for (let i = from; i < g.log.length; i++) g.log[i].wp = wp;
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
    const retHold = g.penalties && ballOn < 100 ? rollReturnFoul(rng) : 0;
    if (retHold) {
      const back = Math.min(retHold, Math.max(0, ballOn - Math.max(1, catchAt)));
      ballOn = Math.max(1, ballOn - back);
      g.stats[receiving].team.penalties++;
      g.stats[receiving].team.penYds += back;
      g.ballOn = ballOn;
      g.freeKick = false;
      g.phase = 'play';
      logEvent(g, { type: 'kickoff', flag: true, text: `${g.teams[kicking].abbr} kickoff. ${returner ? shortName(returner) : 'Return'} brings it out, but FLAG: holding on ${g.teams[receiving].abbr} on the return, ${back} yards. ${g.teams[receiving].abbr} ball at ${spot(g, receiving, ballOn)}.` });
      startDrive(g);
      return;
    }
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
    maybeInjure(g, rng, { type: 'kickoff', returner, returnSide: receiving }, kicking, receiving);
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


function doPat(g, rng, choice) {
  const team = g.patTeam;
  const comp = g.teams[team].comp;
  const two = choice ? choice === 'two' : goForTwo(g, team);
  if (two) {
    const def = g.teams[1 - team].comp;
    const pass = rng.chance(0.6);
    let p;
    if (pass) {
      const skill = (comp.qb ? comp.qb.r.tha * 0.6 + comp.qb.r.awr * 0.4 + comp.chem : 75);
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
  g.lastCall = { off: offCall, def: defCall };

  if (g.penalties) {
    const scrimmage = !['fg', 'punt', 'kneel', 'spike'].includes(offCall);
    const pre = rollPreSnap(g, rng, off, defT, offCall, defCall);
    if (pre) { enforcePenalty(g, pre, situation, 0); return; }
    if (scrimmage) {
      const hold = rollHolding(g, rng, off, defT, offCall);
      if (hold) { enforcePenalty(g, hold, situation, hold.elapsed); return; }
    }
  }
  g.playCount++;

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
  if (g.penalties) {
    const foul = rollDefensiveFoul(g, rng, o, off, defT, offCall);
    if (foul?.replace) {
      // The pass never counted: take the attempt and the target back.
      const n = foul.replace.nullify;
      if (n?.qb) statFor(g.stats[off], n.qb.id).pass.att--;
      if (n?.target) statFor(g.stats[off], n.target.id).rec.tgt--;
      g.stats[off].team.passAtt--;
      g.playCount--;
      enforcePenalty(g, foul.replace.penalty, situation, foul.replace.elapsed);
      return;
    }
    if (foul?.addOn) o.addOn = foul.addOn;
  }
  applyOutcome(g, rng, o, situation);
  maybeInjure(g, rng, o, off, defT);
}

/**
 * Walk off an "instead of" penalty: the down is replayed (or an automatic
 * first down given), the clock stops, the offending club is charged.
 */
function enforcePenalty(g, pen, sit, elapsed = 0) {
  const off = g.possession;
  const yards = walkOff(g, pen, off);
  const ts = g.stats[pen.side].team;
  ts.penalties++;
  ts.penYds += yards;
  if (elapsed) {
    const used = Math.min(g.clock, elapsed);
    g.clock -= used;
    g.stats[off].team.top += used;
    if (g.drive) g.drive.time += used;
  }
  // A drive's yardage is the ground it covered, penalties included — the
  // convention every drive chart uses, and the only one that agrees with the
  // band drawn on the field. Team total yards stays scrimmage-only, which is
  // the separate NFL convention, so the two are charged in different places.
  if (pen.side === off) {
    g.ballOn -= yards;
    if (g.drive) g.drive.yards -= yards;
    g.toGo = Math.min(g.toGo + yards, 100 - g.ballOn);
  } else {
    g.ballOn += yards;
    if (g.drive) g.drive.yards += yards;
    if (pen.firstDown || g.toGo - yards <= 0) {
      g.down = 1;
      g.toGo = Math.min(10, 100 - g.ballOn);
      g.stats[off].team.firstDowns++;
    } else {
      g.toGo -= yards;
    }
  }
  const prefix = `${fmtQuarter(sit.q)} ${fmtClock(sit.clock)} · ${['1st', '2nd', '3rd', '4th'][sit.down - 1]} & ${sit.ballOn + sit.toGo >= 100 ? 'Goal' : sit.toGo} at ${spot(g, off, sit.ballOn)}`;
  logEvent(g, { type: 'penalty', flag: true, yards: pen.side === off ? -yards : yards, situation: prefix, text: `${penaltyLabel(g, pen, yards)} ${downText(g)} at ${spot(g, off, g.ballOn)}.` });
  g.clockRunning = false;
}

function qbName(g) {
  const qb = g.teams[g.possession].comp.qb;
  return qb ? shortName(qb) : 'QB';
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
  const base = { type: o.type, call: o.call, defCall: o.defCall, yards: o.yards, situation: prefix, text: o.text, flag: !!o.flag };

  // Special outcomes first.
  if (o.type === 'fg') {
    if (o.fgGood) {
      g.score[off] += 3;
      ts.points += 0;
      endDrive(g, 'FG');
      logEvent(g, { ...base, scoring: true, text: `${o.text} ${scoreLine(g)}` });
      g.phase = 'kickoff'; g.kickingTeam = off; g.clockRunning = false;
      checkOvertimeEnd(g);
      return;
    }
    // Miss: defense takes over at spot of kick (7 yards behind LOS) or 20 if inside.
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
    const kneelTo = Math.max(1, g.ballOn - 1);
    if (g.drive) g.drive.yards += kneelTo - g.ballOn;
    g.ballOn = kneelTo;
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
      // Touchback if intercepted in the end zone and not returned out. Decided
      // here rather than after the handover, because changePossession opens the
      // new drive and announces the spot.
      const touchback = o.intSpot >= 100 && o.returnYds < 5;
      changePossession(g, touchback ? 20 : clamp(defSpot, 1, 99));
      g.clockRunning = false;
      return;
    }
    // Fumble lost.
    const spotOff = clamp(sit.ballOn + o.yards, 1, 99);
    ts.totalYds += o.yards;
    if (g.drive) g.drive.yards += o.yards;
    endDrive(g, 'fumble', spotOff);
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
    endDrive(g, 'safety', 0);
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
    // The trip is already counted; this is only whether it paid off.
    if (g.drive?.inRedZone) ts.redZoneTd++;
    if (wasThird) ts.thirdConv++;
    if (wasFourth) ts.fourthConv++;
    ts.firstDowns++;
    endDrive(g, 'TD');
    logEvent(g, { ...base, scoring: true });
    g.phase = 'pat'; g.patTeam = off; g.clockRunning = false;
    return;
  }
  g.ballOn = newBallOn;
  if (o.addOn) {
    const pen = o.addOn;
    const yards = walkOff(g, pen, off);
    g.stats[pen.side].team.penalties++;
    g.stats[pen.side].team.penYds += yards;
    g.ballOn += yards;
    if (g.drive) g.drive.yards += yards;
    g.down = 1;
    g.toGo = Math.min(10, 100 - g.ballOn);
    ts.firstDowns++;
    if (wasThird) ts.thirdConv++;
    if (wasFourth) ts.fourthConv++;
    markRedZone(g);
    logEvent(g, { ...base, flag: true, text: `${o.text} ${penaltyLabel(g, pen, yards)} ${downText(g)} at ${spot(g, off, g.ballOn)}.` });
    g.clockRunning = false;
    return;
  }
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
  markRedZone(g);
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
