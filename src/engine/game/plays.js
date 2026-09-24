// What happens on a snap.
//
// Each resolver reads the game, decides an outcome and returns it as a plain
// object: yards, elapsed time, whether the clock stops, the sentence to print.
// None of them advances the clock, changes possession, scores, or writes to the
// log. `applyOutcome` in game.js does all of that, from the object returned.
//
// That split is what makes this file safe to read on its own, and it was
// already true of the code before it lived here — the only thing these four
// hundred lines reached for outside themselves was `statFor`.

import { clamp, edge } from '../rng.js';
import { rollReturnFoul } from '../penalties.js';
import { fgDistance, fgProbability, scoreDiff } from '../playcall.js';
import { statFor, shortName } from '../stats.js';
import { pickReceiver, primaryDefender, pickTackler, pickRusher, pickBallhawk, pickReturner } from './picks.js';
import { passShift, fumbleFactor, puntShift } from '../weather.js';
import { AWR_MID, COV_AWR, DB_SPD_MID, DEEP_SPD } from '../ratings.js';

const MATRIX = {
  // offense call -> defense call -> modifiers
  run_in:     { base: {}, run_stop: { run: -1.6, stuff: 0.09 }, blitz: { run: -0.3, stuff: 0.04, breakaway: 0.02 }, deep: { run: 2.0, stuff: -0.06 } },
  run_out:    { base: {}, run_stop: { run: -1.2, stuff: 0.07 }, blitz: { run: 0.4, stuff: 0.03, breakaway: 0.03 }, deep: { run: 2.2, stuff: -0.06 } },
  screen:     { base: {}, run_stop: { comp: 0.02, yac: 1 }, blitz: { comp: 0.06, yac: 4, pressure: -0.1 }, deep: { comp: 0.03, yac: -1 } },
  // Two-high is five underneath, which is what actually takes the quick game
  // away: the window closes and there is nowhere to run after the catch. It
  // used to be a small bonus for the short pass, leaving that row flat across
  // all four looks — a call with no counter and so no decision behind it.
  pass_short: { base: {}, run_stop: { comp: 0.05, cov: -4 }, blitz: { pressure: 0.12, cov: -3, yac: 1.5 }, deep: { comp: -0.08, cov: 6, yac: -2.4 } },
  pass_med:   { base: {}, run_stop: { comp: 0.07, cov: -6 }, blitz: { pressure: 0.14, cov: -6, yac: 2 }, deep: { comp: -0.05, cov: 4 } },
  // A two-high shell cut the deep ball from 11.1 yards to 6.1, a 45% erasure
  // harsher than anything else in this table. Cover two has holes — the deep
  // middle between the safeties, the sideline behind the corner — so it costs
  // 31% now instead. It is still the harshest thing done to the deep ball, and
  // the throw is still picked off 7% of the time into that look, because a
  // shell inviting it and jumping it is the whole idea. Loosened further the
  // deep ball overtakes the run as the answer to a shell, which is backwards:
  // stopping it is what the look is for.
  pass_deep:  { base: {}, run_stop: { comp: 0.08, cov: -8 }, blitz: { pressure: 0.16, cov: -8, yac: 3 }, deep: { comp: -0.08, cov: 6, int: 0.02 } },
  pa_pass:    { base: {}, run_stop: { comp: 0.1, cov: -9, pressure: -0.04 }, blitz: { pressure: 0.12, cov: -5 }, deep: { comp: -0.08, cov: 6 } },
};

/**
 * What a carry is worth, and what a punt is.
 *
 * Both came out of the realism audit (`scripts/realism.mjs`), which counts a
 * simulated game against what the real league does. The run game was short at
 * both ends — 3.97 yards a carry against a real 4.3, and 90 rushing yards a
 * game against 95 to 140 — and a punt averaged 40.7 gross where the real number
 * is in the mid-forties.
 *
 * The run mattered more than the shortfall suggests. A game that under-pays
 * carrying the ball is a game where every roster wants to throw, which is
 * exactly what the strategy work found: a balanced squad's best pass rate sat
 * at the top of the dial. Paying the run properly is what gives that dial two
 * ends worth choosing between.
 */
export const RUN_IN = 4.45;     // mean gain on an inside run that is not stuffed
export const RUN_OUT = 4.2;     // the same outside, where the spread is wider
// Scaled by the blocking edge. Set against the share of carries that gain
// nothing or lose ground, which is 16 to 22% in the real league — the rate
// itself is lower than that share, because the branch that is *not* stuffed
// still produces the occasional nothing.
// 0.145 before power began resisting the stuff, then 0.1415, and 0.1370 once
// the linebacker and defensive-line weights were refitted toward what the field
// measures — a front that fits the run better stops more runs behind it, which
// pushed the share back to 22.2 against a real ceiling of 22. Mean run holds at
// 4.51 against a 4.2-4.6 range, so this buys the share without softening the
// ground game.
export const STUFF_RATE = 0.1370;

/**
 * What a broken tackle and a breakaway are worth, and how often they happen.
 *
 * These four numbers are one setting, not four, because they trade against
 * each other: the pair of them has to leave the mean carry where it is while
 * moving the shape around it. The shape was wrong in a specific way. Measured
 * over twenty-seven thousand carries, run lengths ran p50 4, p90 10, p95 13 —
 * and then p99 30. A cliff. A carry was a normal four-to-ten or it was a
 * thirty-yard housecall, and the thirteen-to-twenty-five band, the good run
 * that is not a touchdown, barely existed. That showed up in the audit as 3.3
 * explosive plays a team against a real 3.5 to 5.5, with only 0.47 of them
 * runs against a real 1.1.
 *
 * The cliff came from the breakaway being a uniform draw: `rng.int(12, 45)` is
 * flat between its ends and cannot go past them, so it produced no
 * thirteen-to-twenty-five band below and a hard ceiling above. It is now a
 * mixture — usually a medium burst, occasionally a long one off an
 * exponential, which has the tail a uniform cannot have. It fires more than
 * twice as often and is smaller when it does, and the break-tackle yardage is
 * cut to pay for the extra mean.
 *
 * Measured paired against the same seeds: explosive plays 3.35 to 3.58, runs
 * of twenty or more 0.47 to 0.69, runs of forty or more held at 0.07, mean
 * carry 4.48 to 4.55 and the stuffed share unmoved. One audit row fixed.
 *
 * The thing that did *not* work is worth recording, because it looked obvious:
 * letting a carry break several tackles in a row. It buys the tail (+0.11
 * explosive plays) but buys mean with it, and every way of paying that mean
 * back costs more than it gives. Shaving the base run moves the *left* tail
 * too and pushes the stuffed share out of range; shrinking each break to
 * compensate cancels the gain outright (+0.002, inside the noise). The tail
 * was coming from the extra yards, not from the stacking, so the cascade was
 * an expensive way to write `+= more`.
 */
/**
 * How much the man with the ball moves a run, against the men who have to
 * bring him down.
 *
 * Every carrier term below is his attribute against its opposite number on the
 * defence — vision against the front's awareness, power against its run
 * stopping, elusiveness against its tackling, speed against its speed — times
 * this. Two things were wrong before, and both were measured against the real
 * game (DESIGN.md, "The back was worth nearly three times too much").
 *
 * Power and elusiveness were measured against a fixed 82 rather than against
 * anybody, so an all-time back got the same lift against an all-time defence
 * as against a poor one. Leagues of greats on both sides ran hot: 5.95 yards a
 * carry and 6.3% of runs going twenty yards, against a real 4.49 and 2.5%.
 *
 * And a point of a back's rating moved his carries five times as far as it
 * does in the real game. Played in the same average side, the 85 backs in the
 * pool with a real season from 1999 on spread from 2.0 to 8.9 yards a carry,
 * standard deviation 1.88, where the same men in the same seasons ran 3.4 to
 * 6.0 with a deviation of 0.56. At full weight a regression of what they
 * really did on what the engine said has a slope of 0.20: the engine's
 * differences between backs came true a fifth as much.
 */
export const CARRIER_WEIGHT = 0.2;
export const BREAK_YDS_IN = 1.9;    // mean yards a broken tackle adds inside
export const BREAK_YDS_OUT = 2.6;   // the same outside, where there is grass
export const BREAKAWAY_RATE = 2.4;  // multiplier on the per-carry breakaway chance
export const HOUSECALL = 0.12;      // share of breakaways that are the long one

export const PUNT_GROSS = 45;

/**
 * How hard the field squeezes the offence: 0 in the open, 1 on the goal line.
 *
 * Inside the twenty there is no grass behind the defence. The safeties play
 * flat, the deep routes run out of room, and the catch that would have been a
 * twenty-yard gain is a two-yard gain. The model had none of that — a throw
 * from the five was resolved exactly like one from midfield — so the red zone
 * produced a touchdown on 67% of trips against a real 55 to 60, and field goal
 * attempts fell to 1.3 a game against a real 1.5 to 2.5.
 */
export function squeeze(ballOn) {
  return clamp((ballOn - 75) / 25, 0, 1);
}

/**
 * How hard the defence plays the first-down marker: 0 on early downs and in
 * short yardage, 1 on third or fourth and long.
 *
 * Nothing in the passing game read `toGo` at all, so a throw on third and nine
 * was resolved exactly like one on first and ten and the receiver ran after
 * the catch as if the sticks were not there. That showed up as a defence that
 * could not get off the field: third down converted 43.9% against a real 39,
 * and the gap widened with distance — 43% from third and seven to nine against
 * a real 32. The offence gained *more* on third down than on first, 6.27 yards
 * against 6.18, where real football has third down as the hardest down by more
 * than a yard.
 *
 * The yards it takes away are subtracted rather than scaled, and that is the
 * whole trick. Scaling multiplies the tail along with the mean, so a version
 * that multiplied cost 0.18 explosive plays a team and undid a row fixed the
 * commit before. Taking a fixed number of yards off instead kills the
 * three-yard checkdown that moves the chains and leaves the twenty-five-yard
 * catch a twenty-yard catch: the conversion goes, the big play stays.
 */
export function sticks(down, toGo) {
  return down >= 3 ? clamp((toGo - 3) / 7, 0, 1) : 0;
}

/** Yards after the catch the defence takes away when it is fully playing the sticks. */
export const STICKS_YAC = 7.0;

/** How much each pass concept suffers for it. A screen barely notices; a deep shot has nowhere to go. */
const SQUEEZE_COMP = { screen: 0.4, pass_short: 0.6, pass_med: 1, pass_deep: 1.4, pa_pass: 0.9 };   // an average punter's leg, before the return

/**
 * How much the squeeze actually costs, once it was measured rather than guessed.
 *
 * The red zone was still the easiest place on the field to score: a touchdown
 * on 64% of trips against a real 56, which is the same defect as touchdowns
 * per field goal reading 2.05 against a real 1.3 to 1.8 — the drives that
 * should have stalled into a kick were finishing. Raising all four
 * coefficients together took red zone touchdowns to 58%, field goal attempts
 * from 1.45 to 1.58 and the ratio to 1.72, and cost nothing else: paired
 * against the same seeds, explosive plays and yards per completion did not
 * move outside the noise.
 */
export const SQUEEZE_STUFF = 0.11;  // added to the chance a run is stuffed
export const SQUEEZE_RUN = 0.36;    // taken off a run that is not
export const SQUEEZE_PASS = 0.18;   // taken off completion probability
export const SQUEEZE_YAC = 0.58;    // taken off yards after the catch

/**
 * Chance a catch turns into a long gain, before the receiver's speed edge.
 *
 * Raised to pay back what `sticks` costs. Taking yards after the catch away on
 * third down removes explosive plays as well as conversions, because third and
 * long is where the deep ball lives; this buys them back somewhere that does
 * not also buy back the conversions, since a breakaway is rare and lands on
 * early downs as often as late.
 */
export const PASS_BREAKAWAY = 0.024;

/**
 * How much a quarterback's own ratings move his throws, against the defence
 * that has to stop them.
 *
 * The passing game had both of the run game's defects, measured the same way
 * (DESIGN.md, "The passing game, held to real quarterbacks"). The sack, the
 * line's awareness and the arm read the quarterback against a fixed number
 * rather than the defence, so synthetic sides at 90 threw for half a yard a
 * dropback more than sides at 82 and drafted leagues of greats ran at 7.18
 * adjusted net yards against a real 5.84 to 6.18. And a point of a passer's
 * rating moved his adjusted net yards 0.192 where the real game moves them
 * 0.080: the 58 quarterbacks in the pool with a real season from 1999 on,
 * played in the same average side, spread 2.43 against the 1.22 the same men
 * managed in the same seasons.
 *
 * Every passer term below now reads him against its opposite number, and at
 * these weights the same 58 move 0.079 a point. The accuracy and arm terms
 * scale by `PASSER_WEIGHT`. Interceptions follow the same accuracy edge and
 * nothing of his own besides: a separate awareness term made them twice as
 * steep as the real game's, where a quarterback's interception rate is mostly
 * luck (it correlates 0.27 with his next season's). Sacks read his awareness
 * at `POCKET_WEIGHT` and his mobility not at all: real mobile quarterbacks
 * are sacked slightly more, not less (correlation +0.27 across the 58).
 */
export const PASSER_WEIGHT = 0.45;
export const POCKET_WEIGHT = 0.15;
/**
 * The passer's half of the accuracy matchup: his accuracy and awareness, in
 * the proportion his rating weighs them. Across real quarterbacks the two
 * correlate 0.99, so the record cannot tell them apart; reading accuracy alone
 * left awareness, a third of the rating, moving almost nothing.
 */
const PASSER_MIX = { tha: 0.53, awr: 0.47 };
/** A sack once pressured, at the calibration level: the old fixed-centre terms' value at 82. */
const SACK_BASE = 0.214;

/**
 * What the defence showed, when it is the reason the play went the way it did.
 *
 * Every snap is decided by the MATRIX above — a blitz buys pressure and sells
 * coverage, a shell gives up the underneath throw — and none of that reached
 * the page. The log said "short pass complete for 8 yards" whether the call had
 * beaten a blitz or fallen into a two-high shell, so the one system that makes
 * play calling a game was invisible while playing it.
 *
 * Only when it mattered. A tag on every snap is wallpaper; a tag on the screen
 * that beat the blitz is the story of the play.
 */
export function defenceNote(defCall, kind, { pressured = false, sacked = false, stuffed = false, big = false } = {}) {
  if (defCall === 'blitz') {
    if (sacked) return ' on the blitz';
    if (kind === 'pass' && big && !pressured) return ', beating the blitz';
    if (kind === 'screen' && big) return ' — the screen beats the blitz';
    if (kind === 'run' && big) return ' through the vacated gap';
  }
  if (defCall === 'run_stop') {
    if (kind === 'run' && stuffed) return ' into a stacked box';
    if (kind === 'pass' && big) return ' against a defence selling out on the run';
  }
  if (defCall === 'deep') {
    if (kind === 'run' && big) return ' against a two-high look';
    if (kind === 'pass' && big) return ' underneath the shell';
    if (kind === 'deep' && !big) return ' into the shell';
  }
  return '';
}

export function mods(offCall, defCall) {
  return (MATRIX[offCall] && MATRIX[offCall][defCall]) || {};
}

export function callVerb(call) {
  return { screen: 'screen pass', pass_short: 'short pass', pass_med: 'pass', pass_deep: 'deep pass', pa_pass: 'play-action pass' }[call] || 'pass';
}

/**
 * How far the ball travels in the air.
 *
 * Re-fitted after the only realism metric that had never been diagnosed —
 * `yards / completion` at 12.10 against a 10.8-12.0 range — turned out to be
 * the visible tip of a composition error. Decomposed, a completion in this
 * engine was 8.93 air and 3.81 after the catch; the real game is nearer 6.0 and
 * 5.3. The two errors mostly cancel, which is why the total was only a fraction
 * out while the shape underneath was a downfield passing game where football is
 * a short one.
 *
 * The clamp on `pass_short` was the clearest single wrong thing: a floor of 1
 * meant this offence could not throw a checkdown at or behind the line of
 * scrimmage, which is a large share of real short passing. It goes to -1.
 *
 * Moved part of the way rather than all of it. The direction is solid — air was
 * about seventy per cent of a completion here against a bit over half in the
 * real game — but the exact targets are league averages held to a precision
 * this document cannot justify, so the numbers below aim for the shape and stop
 * short of claiming the destination.
 */
export function airYards(rng, call, qb, target, def) {
  switch (call) {
    case 'screen': return clamp(rng.normal(0, 2.2), -4, 4);
    case 'pass_short': return clamp(rng.normal(4.5, 2.6), -1, 11);
    case 'pass_med': return clamp(rng.normal(11.8, 3.5), 7, 20);
    // The deep ball's length: the arm against how fast the secondary gets back.
    case 'pass_deep': return clamp(rng.normal(26.55 + (qb.r.thp - (def?.defSpeed ?? 82)) * 0.15 * PASSER_WEIGHT, 7), 17, 52);
    case 'pa_pass': return clamp(rng.normal(13, 5.5), 3, 31);
    default: return 6;
  }
}

export function yardsText(y) {
  if (y === 1) return '1 yard';
  if (y === 0) return 'no gain';
  if (y < 0) return `a loss of ${-y}`;
  return `${y} yards`;
}

export function resolveRun(g, rng, call, defCall) {
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
  // Every carrier term is his attribute against its opposite number, times
  // CARRIER_WEIGHT (above). Vision reads the blocks against a front that reads
  // them back.
  const k = CARRIER_WEIGHT;
  const blockEdge = edge(comp.runBlock + (vis - def.defAwr) * 0.4 * k, def.runStop, 11);
  let yards;
  if (sneak) {
    yards = rng.chance(0.78 + (comp.runBlock - def.runStop) / 200) ? rng.int(1, 3) : rng.int(-1, 0);
  } else {
    // A back with real power turns a would-be stuff into two yards, and that is
    // most of what power is for — against a front that stops the run, not
    // against a fixed number. This did not look at the carrier at all once,
    // which is why an eight-point lift in `pow` measured as worth nothing.
    const stuffP = clamp(STUFF_RATE * (1.6 - blockEdge * 1.2) - (pow - def.runStop) * 0.0055 * k + (m.stuff || 0) + squeeze(g.ballOn) * SQUEEZE_STUFF, 0.05, 0.45);
    if (rng.chance(stuffP)) {
      yards = clamp(Math.round(rng.normal(-1, 1.4)), -5, 1);
    } else {
      const base = outside ? rng.normal(RUN_OUT, 3.4) : rng.normal(RUN_IN, 2.7);
      yards = (base + (blockEdge - 0.5) * 5 + (m.run || 0)) * (1 - squeeze(g.ballOn) * SQUEEZE_RUN);
      // Break a tackle: power and elusiveness against the men tackling.
      const btP = clamp(0.18 + ((pow * 0.55 + elu * 0.45) - def.tackling) * k / 115, 0.05, 0.45);
      if (rng.chance(btP)) yards += rng.exp(outside ? BREAK_YDS_OUT : BREAK_YDS_IN) + 0.48;
      // Breakaway: usually a medium burst, occasionally one that goes the
      // distance. The exponential is what gives the long one a tail instead of
      // a ceiling — a ninety-yard run is rare rather than impossible.
      // Speed gets there by outrunning the secondary, floored so a back slower
      // than it is not punished twice; elusiveness by making its tacklers miss,
      // signed, so a back who lacks it is worse off. Pace also stretches the
      // burst once he is through, against the same secondary — a flat bonus at
      // 92 speed used to hand an all-time back 30% longer runs against an
      // all-time defence.
      const baP = clamp(BREAKAWAY_RATE * (0.014 + (Math.max(0, spd - def.defSpeed) + (elu - def.tackling) * 0.7) * k / 300 + (m.breakaway || 0) + (outside ? 0.01 : 0)), 0.004, 0.24);
      if (rng.chance(baP)) {
        const burst = rng.chance(HOUSECALL) ? 30 + rng.exp(20) : rng.int(9, 26);
        yards += burst * (1 + Math.max(0, spd - def.defSpeed) * 0.03 * k);
      }
      yards = Math.round(yards);
    }
  }
  yards = Math.max(yards, -g.ballOn);
  yards = Math.min(yards, rem);
  const td = yards >= rem;

  // Fumble.
  const fumP = clamp(0.011 * (1 + (82 - car) / 22) * (1 + (def.tackling - 80) / 60) * fumbleFactor(g.weather), 0.002, 0.05);
  let fumble = !td && rng.chance(fumP);
  const tackler = pickTackler(g, defT, 'run', rng);
  let text = `${shortName(carrier)} ${sneak ? 'sneaks' : outside ? 'runs outside' : 'runs inside'} for ${yardsText(yards)}`;
  text += defenceNote(defCall, 'run', { stuffed: yards <= 0, big: yards >= 12 });
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
      return { type: 'fumble', yards, elapsed: 6, clockStops: true, turnover: true, text, carrier, tackler, returnYds: rng.int(0, 6) };
    }
    text += `, recovered by ${g.teams[off].abbr}.`;
  }
  return { type: 'run', yards, elapsed: rng.int(5, 8), clockStops: oob || td, oob, td, text: text + (fumble || td ? '' : '.'), carrier, tackler };
}

export function resolvePass(g, rng, call, defCall) {
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
  // The line's awareness against the front's: picking up the stunt and the blitz.
  const pressureP = clamp(baseP * (0.3 + edge(rush, comp.passBlock + (comp.olAwr - def.defAwr) * 0.2, 11) * 1.4) + (m.pressure || 0), 0.05, 0.7);
  const pressured = rng.chance(pressureP);
  if (pressured) {
    const sackP = clamp(SACK_BASE - (qb.r.awr - def.defAwr) * 0.004 * POCKET_WEIGHT - comp.chem * 0.004 + (call === 'pass_deep' ? 0.05 : 0) + (blitz ? 0.04 : 0), 0.08, 0.5);
    if (rng.chance(sackP)) {
      const sacker = pickRusher(g, defT, blitz, rng);
      let yards = -rng.int(3, 10);
      yards = Math.max(yards, -g.ballOn);
      st.pass.sck++; st.pass.sckYds += -yards;
      g.stats[off].team.sacksAllowed++;
      g.stats[off].team.passYds += yards;
      if (sacker) { const ds = statFor(g.stats[defT], sacker.id); ds.def.sck++; ds.def.tkl++; }
      // Strip sack; a wet ball comes out more.
      if (rng.chance(0.11 * fumbleFactor(g.weather)) && g.ballOn + yards > 0) {
        st.rush.fum++;
        if (sacker) statFor(g.stats[defT], sacker.id).def.ff++;
        if (rng.chance(0.55)) {
          const rec = pickTackler(g, defT, 'run', rng);
          if (rec) statFor(g.stats[defT], rec.id).def.fr++;
          return { type: 'fumble', yards, elapsed: 6, clockStops: true, turnover: true, returnYds: rng.int(0, 5), carrier: qb, sacker,
            text: `${shortName(qb)} sacked by ${sacker ? shortName(sacker) : 'the defense'} for ${yardsText(yards)}. FUMBLE, recovered by ${rec ? shortName(rec) : g.teams[defT].abbr}!` };
        }
        return { type: 'sack', yards, elapsed: 6, clockStops: false, sacker,
          text: `${shortName(qb)} sacked by ${sacker ? shortName(sacker) : 'the defense'} for ${yardsText(yards)}. Fumble recovered by ${g.teams[off].abbr}.` };
      }
      return { type: 'sack', yards, elapsed: rng.int(5, 7), clockStops: false, sacker, safety: g.ballOn + yards <= 0,
        text: `${shortName(qb)} sacked by ${sacker ? shortName(sacker) : 'the defense'} for ${yardsText(yards)}${defenceNote(defCall, 'pass', { sacked: true })}${g.ballOn + yards <= 0 ? ' — SAFETY!' : '.'}` };
    }
    // Scramble.
    const scrP = clamp((qb.r.mob - 55) / 120, 0.02, 0.4);
    if (rng.chance(scrP)) {
      let yards = Math.round(rng.normal(3 + (qb.r.mob - 70) * 0.12, 5));
      // Never past his own goal line: a loss from inside the three is a safety
      // at the line, as a run is, not a spot a yard behind it.
      yards = clamp(yards, Math.max(-3, -g.ballOn), rem);
      const td = yards >= rem;
      const rs = st;
      rs.rush.att++; rs.rush.yds += yards; rs.rush.lng = Math.max(rs.rush.lng, yards); if (td) rs.rush.td++;
      g.stats[off].team.rushAtt++; g.stats[off].team.rushYds += yards;
      const tackler = pickTackler(g, defT, 'run', rng);
      if (tackler && !td) statFor(g.stats[defT], tackler.id).def.tkl++;
      const oob = rng.chance(0.4);
      return { type: 'run', yards, td, oob, elapsed: rng.int(5, 8), clockStops: td || oob, carrier: qb, tackler,
        text: `${shortName(qb)} escapes pressure and scrambles for ${yardsText(yards)}${td ? ' — TOUCHDOWN!' : tackler ? ` (${shortName(tackler)}).` : '.'}` };
    }
  }

  // Throw.
  const { target, role } = pickReceiver(g, rng, comp, call);
  const prim = primaryDefender(def, role, rng);
  const covComp = { screen: def.covShort, pass_short: def.covShort, pass_med: def.covMed, pass_deep: def.covDeep, pa_pass: def.covMed }[call];
  let cov = prim ? 0.55 * prim.r.cov + 0.45 * covComp : covComp;
  cov += m.cov || 0;
  // The composite reads the coverage's awareness, and on a deep ball its speed,
  // against a fixed 82 (ratings.js). Here each is read against the man it has
  // to beat instead: the passer reading the coverage, the receiver in the race.
  const share = prim ? 0.45 : 1;
  cov += share * COV_AWR * (AWR_MID - qb.r.awr);
  if (call === 'pass_deep') cov += share * DEEP_SPD * (DB_SPD_MID - (target.r.spd ?? 80));
  const tSkill = target.pos === 'RB' ? target.r.rec : 0.45 * target.r.rte + 0.55 * target.r.cth;
  const passer = qb.r.tha * PASSER_MIX.tha + qb.r.awr * PASSER_MIX.awr;
  // Chemistry reaches the passing game as timing with receivers he knows.
  const matchup = 0.6 * PASSER_WEIGHT * (passer - cov) + 0.4 * (tSkill - cov) + comp.chem - (pressured ? 9 : 0);
  // `pass_short` completes more often than it used to because it IS shorter
  // now: its air yards came down from a mean of 6 to 4.5 when the passing game
  // was re-composed, and completion probability here is per call rather than
  // per yard, so the rate has to move with it or the shorter throw is priced as
  // though it were still the longer one.
  const baseComp = { screen: 0.78, pass_short: 0.775, pass_med: 0.615, pass_deep: 0.416, pa_pass: 0.625 }[call];
  let compP = baseComp + matchup * 0.008 + (m.comp || 0);
  if (call === 'pass_deep') compP += ((target.r.spd ?? 80) - def.defSpeed) * 0.003;
  // Arm strength, by how far the ball has to travel.
  //
  // This used to be a deep-ball term and nothing else, which is why `thp`
  // measured 0.052 of a quarterback's leverage against the 0.170 he was priced
  // at: deep shots are a tenth of the throws, so the attribute was very nearly
  // decorative and the fix looked like dropping its price. That would have been
  // wrong for the same reason it was wrong for `defAwr` — an attribute can read
  // as worthless because it is barely wired, not because it does not matter.
  // Velocity gets the ball to a covered man before the defender closes, and
  // that is a sideline out as much as a post.
  //
  // Read against the secondary's speed, the defenders who have to close. It
  // was centred on a fixed 82 (85 on the deep ball), which let a league of
  // great arms throw into a league of great secondaries as if they were
  // ordinary; the deep base rate absorbs the old 85.
  const ARM_BY_CALL = { screen: 0, pass_short: 0.0008, pass_med: 0.0018, pa_pass: 0.0018, pass_deep: 0 };
  const arm = (qb.r.thp - def.defSpeed) * PASSER_WEIGHT;
  compP += arm * (ARM_BY_CALL[call] ?? 0);
  if (call === 'pass_deep') compP += arm * 0.003;
  if (pressured) compP -= 0.08;
  compP -= squeeze(g.ballOn) * SQUEEZE_PASS * (SQUEEZE_COMP[call] ?? 1);
  // The sky: wind by how far the ball travels, against the arm throwing it;
  // a wet or frozen ball a little on every throw. Nothing without weather.
  compP += passShift(g.weather, call, qb.r.thp);
  compP = clamp(compP, 0.12, 0.93);

  st.pass.att++;
  const ts = statFor(g.stats[off], target.id);
  ts.rec.tgt++;
  g.stats[off].team.passAtt++;

  // Interception: the accuracy matchup above, and the ball skills of the men in
  // coverage against the hands of the man they are contesting it with. Both
  // read one side against the other, so a league of greats throws them as
  // often as an ordinary one. The base rates are the old ones times 1.2, which
  // is 2.4% of attempts at the calibration level against a real 2.31 to 2.36.
  const baseInt = { screen: 0.0048, pass_short: 0.0132, pass_med: 0.0252, pass_deep: 0.048, pa_pass: 0.024 }[call];
  const hands = target.pos === 'RB' ? target.r.rec : target.r.cth;
  let intP = baseInt * (1 + (def.ballSkills - hands) / 35) * (1 - comp.chem / 25) * (pressured ? 1.5 : 1) * (1 - matchup / 40) + (m.int || 0);
  if (g.quarter >= 4 && scoreDiff(g, off) < -8 && g.clock < 240) intP *= 1.25; // desperation
  intP = clamp(intP, 0.002, 0.2);

  const air = airYards(rng, call, qb, target, def);
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
    return { type: 'int', yards: 0, elapsed: rng.int(6, 10), clockStops: true, turnover: true, interceptor: picker, target,
      intSpot, returnYds: ret, defTd: endSpot >= 100,
      text: `${shortName(qb)} ${callVerb(call)} intended for ${shortName(target)} is INTERCEPTED by ${shortName(picker)}${endSpot >= 100 ? ' and returned for a TOUCHDOWN!' : ret >= 15 ? ` and returned ${ret} yards.` : '.'}` };
  }

  if (!rng.chance(compP)) {
    const drop = rng.chance(clamp((90 - target.r.cth) / 160, 0.02, 0.2));
    const pd = !drop && rng.chance(0.35);
    if (pd && prim) { statFor(g.stats[defT], prim.id).def.pd++; }
    const txt = drop ? `${shortName(qb)} ${callVerb(call)} to ${shortName(target)} — DROPPED.`
      : pd ? `${shortName(qb)} ${callVerb(call)} to ${shortName(target)} broken up by ${shortName(prim)}.`
      : `${shortName(qb)} ${callVerb(call)} to ${shortName(target)} — incomplete${pressured ? ' under pressure' : defenceNote(defCall, call === 'pass_deep' ? 'deep' : 'pass', {})}.`;
    return { type: 'incomplete', yards: 0, elapsed: rng.int(4, 7), clockStops: true, text: txt, target, pressured, defender: prim };
  }

  // Completion.
  // Raised with the air yards above: the ball is caught shorter now, and the
  // real game makes up the difference after the catch rather than before it.
  const yacMean = { screen: 5.9, pass_short: 4.6, pass_med: 3.0, pass_deep: 3.4, pa_pass: 3.4 }[call] + (m.yac || 0);
  const rac = target.r.rac ?? (target.r.elu ? (target.r.elu * 0.6 + target.r.pow * 0.4) : 70);
  let yac = rng.exp(Math.max(1, yacMean + (rac - def.tackling) * 0.09)) * (1 - squeeze(g.ballOn) * SQUEEZE_YAC);
  yac = Math.max(0, yac - sticks(g.down, g.toGo) * STICKS_YAC);
  const baP = clamp(PASS_BREAKAWAY + Math.max(0, (target.r.spd ?? 80) - def.defSpeed) / 300 + (call === 'screen' ? 0.015 : 0), 0.004, 0.15);
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
  // Ball security counts here too, on the same shape as the run fumble above.
  // It read only the defence's tackling, so a back who coughed it up carrying
  // never did catching, which is `car` meaning two different things on two
  // plays. Only backs carry the attribute; a receiver's `car` is undefined and
  // defaults to the centre, leaving him exactly where he was.
  if (!td && rng.chance(0.005 * (1 + (82 - (target.r.car ?? 82)) / 22) * (1 + (def.tackling - 80) / 40) * fumbleFactor(g.weather))) {
    ts.rush.fum++;
    if (tackler) statFor(g.stats[defT], tackler.id).def.ff++;
    if (rng.chance(0.5)) {
      const rec = pickTackler(g, defT, 'run', rng);
      if (rec) statFor(g.stats[defT], rec.id).def.fr++;
      return { type: 'fumble', yards, elapsed: 7, clockStops: true, turnover: true, returnYds: rng.int(0, 8), target, tackler, pressured,
        text: `${shortName(qb)} ${callVerb(call)} complete to ${shortName(target)} for ${yardsText(yards)}. FUMBLE, recovered by ${rec ? shortName(rec) : g.teams[defT].abbr}!` };
    }
    return { type: 'pass', yards, elapsed: 7, clockStops: false, target, tackler, pressured, defender: prim,
      text: `${shortName(qb)} ${callVerb(call)} complete to ${shortName(target)} for ${yardsText(yards)}. Fumble recovered by ${g.teams[off].abbr}.` };
  }
  return { type: 'pass', yards, td, oob, elapsed: rng.int(6, 9), clockStops: td || oob, target, tackler, pressured, defender: prim,
    text: `${shortName(qb)} ${callVerb(call)} complete to ${shortName(target)} for ${yardsText(yards)}${defenceNote(defCall, call === 'screen' ? 'screen' : 'pass', { pressured, big: yards >= 15 })}${td ? ' — TOUCHDOWN!' : tackler ? ` (${shortName(tackler)}).` : '.'}` };
}

export function resolveFieldGoal(g, rng) {
  const off = g.possession, defT = 1 - off;
  const comp = g.teams[off].comp;
  const k = comp.k;
  const dist = fgDistance(g.ballOn);
  const p = fgProbability(k, dist, g.weather);
  const blocked = rng.chance(0.012);
  const good = !blocked && rng.chance(p);
  if (k) { const s = statFor(g.stats[off], k.id); s.k.fga++; if (good) { s.k.fgm++; s.k.lng = Math.max(s.k.lng, dist); } }
  const name = k ? shortName(k) : 'Kicker';
  if (good) return { type: 'fg', yards: 0, elapsed: 5, clockStops: true, fgGood: true, text: `${name} ${dist}-yard field goal is GOOD.` };
  return { type: 'fg', yards: 0, elapsed: 5, clockStops: true, fgGood: false, missDist: dist,
    text: blocked ? `${name} ${dist}-yard field goal is BLOCKED!` : `${name} ${dist}-yard field goal is NO GOOD (${rng.chance(0.5) ? 'wide right' : dist > 50 ? 'short' : 'wide left'}).` };
}

export function resolvePunt(g, rng) {
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
  let dist = rng.normal(PUNT_GROSS + (ppw - 75) * 0.4 + puntShift(g.weather), 6);
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
  let retFlag = '';
  if (ret > 0 && g.penalties && finalTo < 100) {
    const hold = rollReturnFoul(rng);
    if (hold) {
      const back = Math.min(hold, ret);
      finalTo -= back;
      g.stats[defT].team.penalties++;
      g.stats[defT].team.penYds += back;
      retFlag = ` FLAG: holding on ${g.teams[defT].abbr} on the return, ${back} yards.`;
    }
  }
  if (ps) { ps.p.yds += dist; ps.p.lng = Math.max(ps.p.lng, dist); if (netTo <= 20) ps.p.in20++; }
  if (finalTo >= 100) {
    if (returner) statFor(g.stats[defT], returner.id).ret.td++;
    return { type: 'punt', yards: 0, elapsed: 10, clockStops: true, puntReturnTd: true, returner, text: `${name} punts ${dist} yards. ${returner ? shortName(returner) : 'Returner'} takes it back for a TOUCHDOWN!` };
  }
  finalTo = clamp(finalTo, 1, 99);
  const text = `${name} punts ${dist} yards${fairCatch ? ', fair catch' : ret ? `, returned ${ret} yards` : ''}${netTo <= 20 && !ret ? ' — inside the 20' : ''}.${retFlag}`;
  return { type: 'punt', yards: 0, elapsed: fairCatch ? 5 : rng.int(6, 10), clockStops: true, puntTo: finalTo, returner: ret ? returner : null, flag: !!retFlag, text };
}
