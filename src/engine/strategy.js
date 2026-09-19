// What this squad is actually built to do, and which way the one dial that
// matters should point.
//
// Measured, 450 paired games per cell against the same roster held at 0.55:
// the best pass rate tracks the gap between a club's passing and running games
// almost linearly.
//
//   runEdge   -19.6  -13.1   -6.8   -0.2   +6.2  +12.5  +19.0
//   best rate   .70    .70    .70    .65    .50    .35    .35
//
// That sweep used synthetic rosters built to order, and it overstates what is
// on offer in a real league. Surveyed across 144 drafted clubs, the run edge
// only spans -7.3 to +1.4 in an eight-club snake league, -8.9 to -0.4 in an
// auction, and -11.1 to +4.6 in a 32-club pro league — the pool and the worth
// table between them mean almost every squad comes out leaning pass, and none
// comes out as run-built as the sweep's far end. So the honest figure is the
// one measured on real rosters: following the read rather than sitting at the
// flat 0.55 is worth +0.98 ± 0.22 points a game over 3,200 games. Real, and
// about a point — not the three the synthetic far end would suggest.
//
// The metric does read the league correctly, which is the thing that makes it
// trustworthy: sorted by average run edge, Ground & Pound clubs come out most
// run-leaning (-0.1) and Air Raid most pass-leaning (-6.1), in that order,
// without the personality ever being consulted.
//
// Open, and for the engine pass rather than this one: DEFAULT_STRATEGY sits at
// 0.55 while nearly every real roster wants 0.61 to 0.70, so the shipped
// default is simply low. Moving it changes every simulated game, so it belongs
// with the retune of the other dials and a full re-measure.
//
// The other four dials were measured the same way and do not behave like this.
// Driven end to end on rosters built to want each end, blitz came back at
// -0.58 ± 0.42, the deep shell at -0.44 ± 0.43 and tempo at +0.17 ± 0.36 —
// flat either way. Aggression is worth +1.40 ± 0.38 with a strong offence and a
// poor kicker and nothing otherwise, so it helps sometimes and never hurts.
// Only the pass/run balance is a decision, which is why only it gets a read.
//
// Why this exists at all: every AI personality drafts and calls plays to match
// — Air Raid buys quarterbacks and receivers and throws at 0.66, Ground & Pound
// buys backs and linemen and runs at 0.44. The human draft is whatever the
// human drafted, and the dial starts at a flat 0.55 regardless. This closes
// that asymmetry by telling you what you built, not by deciding for you.

import { composites, buildLineup } from './ratings.js';
import { fillLineup } from './injuries.js';

/** The fitted line through the sweep above. */
export const FIT_BASE = 0.64;
export const FIT_SLOPE = 0.023;
export const RATE_MIN = 0.35;
export const RATE_MAX = 0.7;
/** Below this the squad is even enough that the dial stops being worth moving. */
export const EVEN_ENOUGH = 3;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mean = (arr, f) => (arr && arr.length ? arr.reduce((s, p) => s + f(p), 0) / arr.length : 70);

/**
 * How much better this club's running game is than its passing game, on the
 * rating scale. Positive means run. Built from what the engine already
 * computes about a lineup rather than from a separate table, so it moves when
 * a player is signed, hurt, developed or dropped down the depth chart.
 */
export function runEdge(comp) {
  const passPower = 0.45 * (comp.qb ? comp.qb.r.tha : 70)
    + 0.20 * (comp.qb ? comp.qb.r.awr : 70)
    + 0.25 * mean(comp.wr, (p) => 0.5 * p.r.cth + 0.5 * p.r.rte)
    + 0.10 * comp.passBlock;
  const runPower = 0.55 * comp.runBlock
    + 0.45 * (comp.rb1 ? 0.5 * comp.rb1.r.elu + 0.3 * comp.rb1.r.pow + 0.2 * comp.rb1.r.spd : 70);
  return runPower - passPower;
}

/** Where the dial should sit for a club with this much of a run edge. */
export function recommendedPassRate(edge) {
  return clamp(FIT_BASE - edge * FIT_SLOPE, RATE_MIN, RATE_MAX);
}

/**
 * The read for one club: what it is built to do, where the dial should sit, and
 * how much moving it is worth. `strength` is deliberately a band rather than a
 * number — the sweep puts the gain between roughly half a point and three
 * points depending on the tilt, and a cell there carries about ±0.5 of noise,
 * so a precise per-club figure would be made up.
 */
export function strategyRead(league, teamIdx, byId) {
  const team = league.teams[teamIdx];
  if (!team) return null;
  const comp = composites(fillLineup(buildLineup(team.slots, byId, league.injuries || {})));
  const edge = runEdge(comp);
  const rate = recommendedPassRate(edge);
  const current = team.strategy?.passRate ?? 0.55;
  const even = Math.abs(edge) < EVEN_ENOUGH;
  const off = Math.abs(current - rate) >= 0.05;

  let why;
  if (even) why = 'Your passing and running games are about as good as each other, so the balance is close to a free choice.';
  else if (edge > 0) why = 'Your line and your backs are the better half of this offence; your passer and receivers are the weaker half.';
  else why = 'Your quarterback and receivers are the better half of this offence; the run game is the weaker half.';

  return {
    edge, rate, current, even,
    // "Worth moving" only when the squad is tilted and the dial is not already there.
    act: !even && off,
    lean: edge > EVEN_ENOUGH ? 'run' : edge < -EVEN_ENOUGH ? 'pass' : 'balanced',
    strength: even ? 'barely worth moving for this squad' : 'worth about a point a game, measured',
    why,
  };
}
