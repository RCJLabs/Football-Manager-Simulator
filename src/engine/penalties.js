// Penalties. Rates are per relevant play and tied to the people on the field:
// a line with low awareness false-starts and holds, a defense that is beaten
// grabs, a blitzing front jumps early, a beaten corner interferes.
//
// Two kinds of flag, which is what keeps the stat lines honest:
//   - "instead of" a play: pre-snap fouls and offensive holding wipe the play,
//     so it is never resolved and nothing is credited (a nullified play does
//     not count in real football either). Pass interference and defensive
//     holding replace an incompletion the same way.
//   - "added on" to a play: roughing the passer, unnecessary roughness and a
//     facemask are enforced from the end of the play with an automatic first
//     down; the play stands.
// Half the distance to the goal applies everywhere.

import { clamp } from './rng.js';

export const RATES = {
  falseStart: 0.018,
  delay: 0.004,
  offside: 0.009,
  holdPass: 0.018,
  holdRun: 0.014,
  dpi: 0.035,          // per incompletion, scaled by route depth
  defHold: 0.04,       // per incompletion
  roughing: 0.0045,    // per pass play, x2.5 when the passer was pressured
  roughness: 0.011,    // per tackled play
  returnHold: 0.12,    // per kick or punt return
};

const lowAwr = (rng, arr) => {
  if (!arr || !arr.length) return null;
  return rng.weighted(arr, arr.map((p) => Math.exp((80 - (p.r.awr ?? 75)) / 8)));
};
const pick = (rng, arr) => (arr && arr.length ? arr[rng.int(0, arr.length - 1)] : null);
const mean = (arr, k) => (arr && arr.length ? arr.reduce((s, p) => s + (p.r[k] ?? 75), 0) / arr.length : 75);

/** Pre-snap fouls: false start, delay of game, offside. Dead-ball, no play is run. */
export function rollPreSnap(g, rng, off, defT, offCall, defCall) {
  const oc = g.teams[off].comp, dc = g.teams[defT].comp;
  const away = off === 1 && !g.neutral ? 1.2 : 1;
  const olAwr = mean(oc.ol, 'awr');
  if (rng.chance(RATES.falseStart * clamp(1 + (80 - olAwr) / 30, 0.5, 2) * away)) {
    return { name: 'False start', side: off, yards: 5, repeat: true, player: lowAwr(rng, oc.ol) };
  }
  const qbAwr = oc.qb ? oc.qb.r.awr : 70;
  if (rng.chance(RATES.delay * clamp(1 + (80 - qbAwr) / 40, 0.5, 2) * away)) {
    return { name: 'Delay of game', side: off, yards: 5, repeat: true, player: oc.qb };
  }
  const front = [...(dc.dl || []), ...(dc.lb || [])];
  const blitz = defCall === 'blitz' ? 1.5 : 1;
  if (rng.chance(RATES.offside * blitz * clamp(1 + (80 - mean(front, 'awr')) / 30, 0.5, 2))) {
    return { name: rng.chance(0.5) ? 'Offside' : 'Neutral zone infraction', side: defT, yards: 5, repeat: true, player: lowAwr(rng, front) };
  }
  return null;
}

/** Offensive holding wipes the play. Likelier when the line is being beaten. */
export function rollHolding(g, rng, off, defT, offCall) {
  const oc = g.teams[off].comp, dc = g.teams[defT].comp;
  const run = offCall === 'run_in' || offCall === 'run_out';
  const edge = run ? dc.runStop - oc.runBlock : dc.passRush - oc.passBlock;
  const p = (run ? RATES.holdRun : RATES.holdPass) * clamp(1 + edge / 40, 0.5, 2);
  if (!rng.chance(p)) return null;
  return { name: 'Holding', side: off, yards: 10, repeat: true, player: lowAwr(rng, oc.ol), elapsed: rng.int(4, 7) };
}

/**
 * Defensive fouls decided after the play is known. Returns either a
 * replacement outcome (the pass never counted) or an add-on to the play.
 */
export function rollDefensiveFoul(g, rng, o, off, defT, offCall) {
  const oc = g.teams[off].comp, dc = g.teams[defT].comp;
  const isPass = ['pass', 'incomplete'].includes(o.type);
  if (o.type === 'incomplete' && o.target) {
    const depth = { pass_deep: 2.5, pa_pass: 1.4, pass_med: 1.2, pass_short: 0.5, screen: 0 }[offCall] ?? 1;
    const tSkill = o.target.pos === 'RB' ? o.target.r.rec : 0.5 * o.target.r.rte + 0.5 * o.target.r.spd;
    const cov = o.defender ? o.defender.r.cov : dc.covMed;
    const beaten = clamp(1 + (tSkill - cov) / 40, 0.5, 2);
    if (rng.chance(RATES.dpi * depth * beaten)) {
      const rem = 100 - g.ballOn;
      const air = { screen: 2, pass_short: rng.int(4, 10), pass_med: rng.int(9, 20), pass_deep: rng.int(18, 45), pa_pass: rng.int(6, 28) }[offCall] ?? 10;
      // A spot foul: never into the end zone, the 1 at most.
      const yards = clamp(air, 1, Math.max(1, rem - 1));
      return { replace: { type: 'penalty', penalty: { name: 'Pass interference', side: defT, yards, firstDown: true, spot: true, player: o.defender || pick(rng, dc.cb) }, nullify: { qb: oc.qb, target: o.target }, elapsed: rng.int(4, 7) } };
    }
    if (rng.chance(RATES.defHold * (depth < 1 ? 1.2 : 1))) {
      return { replace: { type: 'penalty', penalty: { name: rng.chance(0.6) ? 'Defensive holding' : 'Illegal contact', side: defT, yards: 5, firstDown: true, player: o.defender || pick(rng, dc.cb) }, nullify: { qb: oc.qb, target: o.target }, elapsed: rng.int(4, 7) } };
    }
  }
  if (isPass && !o.td && rng.chance(RATES.roughing * (o.pressured ? 2.5 : 1))) {
    return { addOn: { name: 'Roughing the passer', side: defT, yards: 15, firstDown: true, player: pick(rng, dc.dl) } };
  }
  if ((o.type === 'run' || o.type === 'pass') && !o.td && o.tackler && rng.chance(RATES.roughness)) {
    return { addOn: { name: rng.chance(0.5) ? 'Unnecessary roughness' : 'Facemask', side: defT, yards: 15, firstDown: true, player: o.tackler } };
  }
  return null;
}

/** Holding on a return: ten yards back from where the return ended, never behind the catch. */
export function rollReturnFoul(rng) {
  return rng.chance(RATES.returnHold) ? 10 : 0;
}

/** Yards actually walked off, with half the distance to the goal. */
export function walkOff(g, pen, off) {
  if (pen.side === off) return Math.min(pen.yards, Math.floor(g.ballOn / 2));
  return Math.min(pen.yards, Math.floor((100 - g.ballOn) / 2));
}

export function penaltyLabel(g, pen, yards) {
  const t = g.teams[pen.side];
  const who = pen.player ? ` (${pen.player.pos} ${pen.player.name})` : '';
  return `FLAG: ${pen.name} on ${t.abbr}${who}, ${yards} yard${yards === 1 ? '' : 's'}${pen.firstDown ? ', automatic first down' : pen.repeat ? ', repeat the down' : ''}.`;
}
