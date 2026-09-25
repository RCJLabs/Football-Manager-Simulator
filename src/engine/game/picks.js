// Who gets the ball, and who makes the play.
//
// Pure selection: each of these reads a team's composite and a random number
// and names a player. Nothing here touches the clock, the score, the drive or
// the log — that is applyOutcome's job in game.js — which is why they lift out
// of the simulation cleanly and can be read without holding the rest of it in
// your head.

import { RNG } from '../rng.js';
import { edgeness } from '../../data/positions.js';

export function pickReturner(comp) {
  const cands = [...(comp.wr || []).slice(1), ...(comp.rb2 ? [comp.rb2] : []), ...(comp.cb || [])];
  if (!cands.length) return comp.rb1 || comp.wr?.[0] || null;
  return cands.reduce((a, b) => (b.r.spd > a.r.spd ? b : a));
}

/**
 * How far a receiver's skill pulls the ball his way, and what each role's
 * share is before skill.
 *
 * Fitted to real seasons (DESIGN.md, "Backs, receivers and tight ends, held to
 * real seasons"). At a spread of 9 a receiver nine points better drew 2.7 times
 * the targets, and a point of a receiver's rating moved his share of the
 * targets six times as far as the real game's; a tight end's four times, a
 * back's nearly four. At 60 the three move 0.36, 0.25 and 0.23 of a point of
 * share per point of rating against a real 0.29, 0.27 and 0.24. The role bases
 * split a league's targets as the real one does, 62/20/18 against 59/21/19:
 * receivers took 65 and backs 15.
 */
const TARGET_SPREAD = 60;

export function pickReceiver(g, rng, comp, call) {
  const cands = [];
  const roles = [];
  (comp.wr || []).forEach((p, i) => { cands.push(p); roles.push(['WR1', 'WR2', 'WR3', 'WR4'][i]); });
  if (comp.te) { cands.push(comp.te); roles.push('TE'); }
  if (comp.rb1) { cands.push(comp.rb1); roles.push('RB1'); }
  if (comp.rb2) { cands.push(comp.rb2); roles.push('RB2'); }
  const roleBase = { WR1: 1.0, WR2: 0.8, WR3: 0.52, WR4: 0.14, TE: 0.78, RB1: 0.65, RB2: 0.16 };
  // Who each concept is for. Re-routed when the calls' depths were fitted to
  // real throws (airYards): a screen is now mostly behind the line, and at the
  // old split receivers caught enough of them to lose half a yard a target
  // while backs gained it. At these, target share, catch rate and yards a
  // target by position are within a point of the real game's (2019-2023), bar
  // receivers' yards a target, 7.8 against 8.0.
  const typeMult = {
    screen:     { WR1: 0.5, WR2: 0.5, WR3: 0.5, WR4: 0.3, TE: 0.3, RB1: 3.2, RB2: 1.6 },
    pass_short: { WR1: 0.95, WR2: 0.95, WR3: 1.1, WR4: 1.0, TE: 1.4, RB1: 1.3, RB2: 1.2 },
    pass_med:   { WR1: 1.25, WR2: 1.2, WR3: 1.0, WR4: 1.0, TE: 1.25, RB1: 0.3, RB2: 0.25 },
    pass_deep:  { WR1: 1.4, WR2: 1.35, WR3: 1.0, WR4: 0.9, TE: 0.65, RB1: 0.1, RB2: 0.05 },
    pa_pass:    { WR1: 1.1, WR2: 1.1, WR3: 0.9, WR4: 0.8, TE: 1.5, RB1: 0.3, RB2: 0.3 },
  }[call] || {};
  const weights = cands.map((p, i) => {
    const role = roles[i];
    const skill = p.pos === 'RB' ? p.r.rec : 0.5 * p.r.rte + 0.3 * p.r.cth + 0.2 * p.r.spd;
    let w = roleBase[role] * Math.exp((skill - 82) / TARGET_SPREAD) * (typeMult[role] ?? 1);
    if (call === 'pass_deep' && p.pos !== 'RB') w *= Math.exp((p.r.spd - 88) / TARGET_SPREAD);
    return w;
  });
  const idx = cands.indexOf(rng.weighted(cands, weights));
  return { target: cands[idx], role: roles[idx] };
}

/** Primary defender for a target role. */
export function primaryDefender(def, role, rng) {
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

export function pickTackler(g, defT, kind, rng, prim) {
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

/**
 * Who is credited with a sack. It decides nothing on the field: the draw is one
 * random number whatever the weights, so the same seed plays the same game,
 * and only the box score, the awards and the records read it.
 *
 * Held to real seasons (DESIGN.md, "The trenches, held to real absences"). The
 * 185 linemen and linebackers in the pool with a real season from 1999 on,
 * each played in the same average side: on `(prs - 80) / 7` a lineman's sacks
 * spread twice as far as the same men's real ones did (real on engine, slope
 * 0.52), J.J. Watt's 2014 came to 33 a season and Aaron Donald's 2018 to 30,
 * and an elite rusher took two thirds of his side's sacks, where the real
 * game's leader takes a quarter. At 13 the slope is 0.98 for linemen, 1.07 for
 * edge rushers and 1.18 for off-ball backers, and the best lineman comes to
 * about nineteen. An edge rusher is one of the four on every snap, so he is
 * credited as a lineman is, by how much of an edge rusher he is (`edgeness`);
 * an off-ball backer at 0.6 when he rushes with the four and 1.2 on a blitz.
 */
const SACK_CREDIT_SCALE = 13;

export function pickRusher(g, defT, blitz, rng) {
  const d = g.teams[defT].comp;
  const cands = [], weights = [];
  const rush = (p) => Math.exp((p.r.prs - 80) / SACK_CREDIT_SCALE);
  for (const p of d.dl || []) { cands.push(p); weights.push(rush(p)); }
  for (const p of d.lb || []) {
    const e = edgeness(p.pos, p.r);
    cands.push(p); weights.push(rush(p) * (e + (1 - e) * (blitz ? 1.2 : 0.6)));
  }
  if (blitz) for (const p of d.s || []) { cands.push(p); weights.push(Math.exp((p.r.tck - 85) / 10) * 0.25); }
  if (!cands.length) return null;
  return rng.weighted(cands, weights);
}

export function pickBallhawk(g, defT, rng) {
  const d = g.teams[defT].comp;
  const cands = [], weights = [];
  for (const p of d.cb || []) { cands.push(p); weights.push(Math.exp((p.r.bal - 80) / 8)); }
  for (const p of d.s || []) { cands.push(p); weights.push(Math.exp((p.r.bal - 80) / 8) * 0.9); }
  for (const p of d.lb || []) { cands.push(p); weights.push(Math.exp((p.r.cov - 80) / 8) * 0.35); }
  return rng.weighted(cands, weights);
}
