// What this squad is actually built to do, and which way the one dial that
// matters should point.
//
// **The read is fitted against the clubs you actually play.** Every club in
// real drafted leagues was played as the human's club is — no matchup plan,
// the default sliders — at every setting the dial allows, each game paired
// against the same game at 0.55, against its own league's AI clubs
// (`npm run passrate -- read`). On the engine as it now is the payoff has one
// end: every kind of squad does best with the dial all the way up.
//
//   league              always 0.70, against a flat 0.55
//   fantasy, 8 clubs      +0.68 a game
//   fantasy, 10 clubs     +1.00
//   fantasy, 12 clubs     +0.81
//   pro, 32 clubs         +1.04
//
// Sorted into fifths by run edge, every fifth of every league wants 0.65 or
// 0.70, and gains +0.13 to +1.68 at 0.70. So the read still says what a squad
// is built to do, and tells every one of them to throw. Measured again once
// the passer and the receivers were held to real seasons (DESIGN.md, "The
// passing game, held to real quarterbacks"): it had read +1.04, +1.01, +1.10
// and +1.11, and the fifths +0.40 to +1.68.
//
// **It said the opposite until the run game was fixed.** Fitted on the
// engine of 24 September, the read had nearly every squad running, through
// crossovers at -5.25 and -3.5, and this file admitted that why was not
// established. It was the backs: a point of a back's rating moved his carries
// five times as far as it does in the real game, and power and elusiveness were
// measured against a fixed 82 rather than against the defence, so a league of
// all-time greats ran at 5.95 yards a carry against a real 4.49 (DESIGN.md, "The
// back was worth nearly three times too much"). Once the run game matched real
// carries, that read went from +0.77 a game to -1.17. The one before it, fitted
// to synthetic rosters on 19 September — 0.64 - 0.023 x edge, throw 64% to 70%
// for almost everyone — scores +0.89 to +1.05 here: it had the direction right
// before the run game was broken.
//
// A dial that goes one way for every squad is a tax on anybody who does not
// max it, which is what the team page's other dials already are. It is not in
// itself unrealistic: in the real game a dropback was worth +0.007 expected
// points in 2022-23 and a designed run -0.062, and a dropback was worth more in
// 46 of 64 team-seasons. What keeps real teams running is defences that adjust
// to how often an offence throws, and the engine's never do, so throwing more
// has no price; that is recorded rather than done. The passing game's own heat
// is mostly gone: drafted leagues throw for 7.8 yards an attempt against a
// real 7.1, from 8.1.
//
// The metric itself reads the league correctly, which is what makes it worth
// keeping: sorted by average run edge, Ground & Pound clubs come out most
// run-leaning and Air Raid most pass-leaning, in that order, without the
// personality ever being consulted.
//
// The AI clubs do not use it. On the engine before the run game was fixed,
// moving every AI club's pass rate the same way, anywhere from -0.20 to
// +0.10, was worth nothing on average (`npm run passrate -- ai`), and their own
// plans adjust the dial by matchup. It has not been measured on this engine,
// where a club throwing 0.44 may well leave points on the field; starting the
// AI on the read is a possible change to the AI, not made here.
//
// The other four dials are measured the same way against real leagues' clubs
// (`npm run dials`), and none of them depends on the roster the way the
// pass/run balance once did, so none gets a read. With the passer and the
// receivers held to real seasons and every club throwing on this read:
// fourth-down aggression at the top of the dial is worth +0.71 a game in
// eight-club leagues and +0.82 in pro ones, for every kind of squad; blitzing
// least +0.33 and +0.23; the deepest shell +0.38 in eight-club leagues and
// nothing measurable in pro ones; tempo nothing either way. On the run game's
// fix alone they read +0.64 and +0.88, +0.32 and +0.34, +0.66 and nothing;
// before it +1.19 to +1.25, +0.31 to +0.48, +0.33 to +0.47 and nothing; and
// the first, on 19 September and on identical rosters, had aggression helping
// only a strong offence with a poor kicker and the other three flat.
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
 * a squad plays, by kind of league — or `null`, which is what every kind of
 * league measures now: no squad gets there.
 *
 * Fitted at -5.25 in fantasy leagues and -3.5 in pro ones on 24 September,
 * which had nearly every squad running, on an engine whose backs were worth
 * five times too much a point of rating and whose leagues ran 5.95 yards a
 * carry. Measured again once the run game matched real carries, every fifth of
 * every kind of league by run edge earns more at 0.70 than at 0.55, the most
 * run-built included (+0.40 to +1.68 a game), and the fitted crossover runs off
 * the right-hand end of the range it is searched over. A crossover beyond every
 * squad measured would be a number made up for rosters nobody has built, so
 * there is none. If a change to the passing game brings one back, it is a
 * number again, and the ramp below already knows what to do with it.
 */
export const CROSSOVER = { fantasy: null, pro: null };
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

/** Where the dial should sit for a club with this much of a run edge: all the way up where no squad crosses over. */
export function recommendedPassRate(edge, crossover = CROSSOVER.fantasy) {
  if (crossover == null) return RATE_MAX;
  return clamp(MID - RAMP * (edge - crossover), RATE_MIN, RATE_MAX);
}

/**
 * The read for one club: what it is built to do, where the dial should sit, and
 * how much moving it is worth. `strength` is deliberately a band rather than a
 * number: the read is worth +1.01 to +1.11 a game over 0.55 depending on the
 * league, less for the most run-built squads, and a per-club figure would be
 * made up.
 */
export function strategyRead(league, teamIdx, byId) {
  const team = league.teams[teamIdx];
  if (!team) return null;
  const comp = composites(fillLineup(buildLineup(team.slots, byId, league.injuries || {})));
  const edge = runEdge(comp);
  const crossover = crossoverFor(league);
  const rate = recommendedPassRate(edge, crossover);
  const current = team.strategy?.passRate ?? 0.55;
  const even = crossover != null && Math.abs(edge - crossover) < EVEN_ENOUGH;
  const off = Math.abs(current - rate) >= 0.05;

  // What the squad is, and then what to do with it, which are not the same
  // thing: a squad whose line and backs are its best players is still told to
  // throw.
  const built = edge > 3 ? 'Your line and your backs are the better half of this offence; your passer and receivers are the weaker half.'
    : edge < -3 ? 'Your quarterback and receivers are the better half of this offence; the run game is the weaker half.'
      : 'Your passing and running games are about as good as each other.';
  const lean = edge > 3 ? 'run' : edge < -3 ? 'pass' : 'balanced';
  const measured = 'squads built like yours win more by throwing, measured against the clubs you play.';
  const advice = even ? 'Against the clubs you play, running and throwing come out about level, so the dial is close to a free choice.'
    : rate <= MID ? 'Run: against the clubs you play, it is what this squad does best.'
      : lean === 'run' ? `Even so, ${measured}`
        : lean === 'balanced' ? `And ${measured}`
          : 'Throw: it is what this squad does best, and it pays against the clubs you play.';

  return {
    edge, rate, current, even,
    // "Worth moving" only when the squad is off the crossover and the dial is not already there.
    act: !even && off,
    lean,
    strength: even ? 'barely worth moving for this squad' : 'worth two-thirds of a point to a point a game, measured against the clubs you play',
    why: `${built} ${advice}`,
  };
}
