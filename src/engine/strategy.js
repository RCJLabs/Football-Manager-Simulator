// What this squad is actually built to do, and which way the one dial that
// matters should point.
//
// **The read is fitted against the clubs you actually play.** Every club in
// real drafted leagues was played as the human's club is — no matchup plan,
// the default sliders — at every setting the dial allows, each game paired
// against the same game at 0.55, against its own league's AI clubs
// (`npm run passrate -- read`). The payoff is two-ended: the most pass-built
// squads want the dial all the way up, nearly everybody else wants it all the
// way down, and between the two it is flat. So the read is a ramp through the
// run edge where the two ends trade places, which differs by kind of league:
//
//   league              crossover   following the read, against a flat 0.55
//   fantasy (8/10/12)     -5.25      +0.53 to +0.64 a game, out of sample
//   pro (32)              -3.50      +0.35 to +0.70 a game, out of sample
//
// Nearly every squad wants to run more than its roster suggests. Why is not
// established. It is not mainly the AI's matchup plans: with the opponents'
// plans switched off, running 0.35 still earns +0.55 a game in eight-club
// leagues against +0.62 with them on.
//
// **The read this replaced had gone stale.** It was fitted to synthetic rosters
// and validated against each club's own clone, both on default sliders and
// neither planning, at +0.98 ± 0.22 a game over 0.55 — on the engine of the day.
// A dozen changes to the play model followed, several of them strengthening
// the run, and nothing measured the read again: its test pinned the formula to
// the table it came from rather than to the engine, so it could not fail.
// Replayed today in exactly that clone setup, it loses to 0.55 (-0.29 a game in
// eight-club leagues); against real leagues' AI clubs it lost -0.16 to -0.27 in
// fantasy leagues and won nothing to +0.3 in pro ones, because it told almost
// every squad to throw 64% to 70% of the time. The audit now re-measures it.
//
// The metric itself reads the league correctly, which is what makes it worth
// keeping: sorted by average run edge, Ground & Pound clubs come out most
// run-leaning and Air Raid most pass-leaning, in that order, without the
// personality ever being consulted.
//
// The AI clubs do not use it. Moving every AI club's pass rate the same way,
// anywhere from -0.20 to +0.10, is worth nothing on average (`npm run passrate
// -- ai`), and their own plans adjust the dial by matchup. Moved each to its
// own read at kickoff they would gain about half a point a game, nearly all of
// it the run-built clubs, who open too pass-heavy — and the weekly drift in
// gm.js walks those down by midseason anyway. Starting them on the read is a
// possible change to the AI, not made here.
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

import { composites, buildLineup, teamPower } from './ratings.js';
import { fillLineup } from './injuries.js';

export const RATE_MIN = 0.35;
export const RATE_MAX = 0.7;
/**
 * The run edge at which throwing and running come out level against the clubs
 * a squad plays, by kind of league. Fitted by what following the read earns and
 * checked on leagues the fit never saw: eight-club leagues put it at -5.5,
 * ten-club at -6.0, twelve-club at -4.75, and three pro seed sets at -3.0,
 * -3.25 and -3.75 to -4.25. A fantasy squad has an elite passer and elite
 * opponents; a pro squad has neither, which is why the two differ.
 */
export const CROSSOVER = { fantasy: -5.25, pro: -3.5 };
/**
 * How fast the dial moves through the crossover, per point of run edge: from
 * one end to the other over about two and a third points. A switch earned the
 * same out of sample, and would flip the advice from 35% to 70% when one
 * injury nudged the edge.
 */
export const RAMP = 0.15;
/** Within this much of the crossover the two ends come out level, so the dial is a free choice. */
export const EVEN_ENOUGH = 1;
const MID = (RATE_MIN + RATE_MAX) / 2;

/** The crossover for this league. */
export function crossoverFor(league) {
  return league?.mode === 'pro' ? CROSSOVER.pro : CROSSOVER.fantasy;
}

/**
 * Why only this dial gets a read, when tempo turned out to be a real lever too.
 *
 * Tempo works on a different axis — not what your squad is shaped like but how
 * good it is next to the ones it plays, since more possessions means more
 * chances for the better side to be the better side. Measured against a real
 * talent gap, 900 games a cell: +3.81 ± 0.65 for a much better club (88 against
 * 76), +2.54 ± 0.59 for a better one, nothing when even, and -1.68 ± 0.61 for
 * an underdog. It went into the audit as flat, which was a broken test rather
 * than a flat dial: it had been measured against a mirror of itself, where both
 * sides are equal by construction and extra possessions can favour neither.
 *
 * It still gets no read, and the reason has been re-measured since it was first
 * written here. The original argument was that clubs are only 0.78 `teamPower`
 * apart in an eight-club league, which turned out to lean on a number that
 * explains r = 0.34 of results; clubs actually differ by 5.5 to 6.4 points a
 * game. What survives is the direct measurement: a tempo read built on the
 * power gaps a real league produces came out at +1.15 ± 0.83 over 273 paired
 * games, which is not a recommendation, it is a coin flip with a sentence
 * attached. If it is ever worth revisiting, do it on a gap measured in points
 * rather than in power.
 */


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
export function recommendedPassRate(edge, crossover = CROSSOVER.fantasy) {
  return clamp(MID - RAMP * (edge - crossover), RATE_MIN, RATE_MAX);
}

/**
 * The read for one club: what it is built to do, where the dial should sit, and
 * how much moving it is worth. `strength` is deliberately a band rather than a
 * number: out of sample the read is worth +0.35 to +0.70 a game over 0.55
 * depending on the league, and a per-club figure would be made up.
 */
export function strategyRead(league, teamIdx, byId) {
  const team = league.teams[teamIdx];
  if (!team) return null;
  const comp = composites(fillLineup(buildLineup(team.slots, byId, league.injuries || {})));
  const edge = runEdge(comp);
  const crossover = crossoverFor(league);
  const rate = recommendedPassRate(edge, crossover);
  const current = team.strategy?.passRate ?? 0.55;
  const even = Math.abs(edge - crossover) < EVEN_ENOUGH;
  const off = Math.abs(current - rate) >= 0.05;

  // What the squad is, and then what to do with it, which are not the same
  // thing: a squad whose passer is its best player is still usually told to run.
  const built = edge > 3 ? 'Your line and your backs are the better half of this offence; your passer and receivers are the weaker half.'
    : edge < -3 ? 'Your quarterback and receivers are the better half of this offence; the run game is the weaker half.'
      : 'Your passing and running games are about as good as each other.';
  const lean = edge > 3 ? 'run' : edge < -3 ? 'pass' : 'balanced';
  const measured = 'squads built like yours win more by leaning on the run, measured against the clubs you play.';
  const advice = even ? 'Against the clubs you play, running and throwing come out about level, so the dial is close to a free choice.'
    : rate > MID ? 'Your passing game is strong enough that throwing pays, measured against the clubs you play, so throw.'
      : lean === 'pass' ? `Even so, ${measured}`
        : lean === 'balanced' ? `And ${measured}`
          : 'Run: it is what this squad does best.';

  return {
    edge, rate, current, even,
    // "Worth moving" only when the squad is off the crossover and the dial is not already there.
    act: !even && off,
    lean,
    strength: even ? 'barely worth moving for this squad' : 'worth about half a point a game, measured against the clubs you play',
    why: `${built} ${advice}`,
  };
}
