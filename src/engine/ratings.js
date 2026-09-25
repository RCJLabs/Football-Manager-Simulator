import { POSITIONS, ROSTER_SLOTS, eraOf, weightsFor, edgeness } from '../data/positions.js';
const ovrCache = new Map();

/** Drop a cached overall after a rating edit. */
export function forgetOverall(id) {
  ovrCache.delete(id);
}
export function clearOverallCache() {
  ovrCache.clear();
}

/**
 * The weighted sum on its own, with no cache. Anything that rates a set of
 * attributes not attached to a fixed player id — a career being aged, a
 * what-if — has to come through here, because the cache below is keyed by id
 * and would hand back a stale number.
 */
export function rawOverall(pos, r) {
  // `weightsFor`, not `POSITIONS[pos].weights`: a linebacker is rated on a
  // blend of the off-ball and edge vectors according to how much of a rusher
  // he is. Every other position hands back its one vector unchanged.
  const w = weightsFor(pos, r);
  let s = 0;
  for (const k in w) s += (r[k] ?? 60) * w[k];
  return Math.round(s);
}

/** Weighted overall rating for a player, 40..99. */
export function overall(p) {
  // A player the career code has aged carries his own, because the cache is
  // keyed by id and two leagues can hold the same man at different ages.
  if (p.ovr != null) return p.ovr;
  // A generated rookie is never cached, for the same reason in a sharper
  // form: his id is the league seed, the class and a number, so two leagues
  // on one seed — a league and its own share code, or the two arms of a
  // paired measurement — name different men the same once their classes have
  // come apart, and the cache handed one league the other's ratings. It went
  // unseen until it made every alternative draft read look forty points
  // worse by a dynasty's seventh season. A handful of multiplications a man.
  if (p.generated) return rawOverall(p.pos, p.r);
  if (ovrCache.has(p.id)) return ovrCache.get(p.id);
  const o = rawOverall(p.pos, p.r);
  ovrCache.set(p.id, o);
  return o;
}

export function playerLabel(p) {
  return `${p.name} (${p.season} ${p.team})`;
}

export function playerEra(p) {
  return eraOf(p.season);
}

const mean = (arr, key) => (arr.length ? arr.reduce((s, p) => s + p.r[key], 0) / arr.length : 60);
const meanBy = (arr, fn) => (arr.length ? arr.reduce((s, p) => s + fn(p), 0) / arr.length : 60);
const topN = (arr, key, n) => arr.slice().sort((a, b) => b.r[key] - a.r[key]).slice(0, n);

/**
 * Build a depth chart from a team's slot -> playerId map.
 * Returns { QB: [..], RB: [..], WR: [..], TE: [..], OL: [..], DL: [..], LB: [..], CB: [..], S: [..], K: [..], P: [..] }
 * in depth-chart order (slot order).
 */
export function buildLineup(slots, byId, injuries = null) {
  const lineup = {};
  for (const slot of ROSTER_SLOTS) {
    const id = slots[slot.id];
    const p = byId.get(id);
    if (!p) continue;
    // A player on the injury ledger sits; the next man in the group moves up.
    if (injuries && injuries[id]) continue;
    (lineup[slot.pos] ??= []).push(p);
  }
  return lineup;
}

/**
 * Where the coverage composites centre a defender's awareness and a
 * secondary's speed, and how much of each they add. Exported because the
 * passing game re-reads both against the offence (plays.js, `resolvePass`):
 * a composite cannot see the other side, and a term centred on a fixed 82
 * rises with the level of play on one side of the ball only.
 */
export const AWR_MID = 82;
export const COV_AWR = 0.30;
export const DB_SPD_MID = 82;
export const DEEP_SPD = 0.30;

/** Team-level composite ratings the simulator consumes. */
export function composites(lineup) {
  const g = (pos) => lineup[pos] || [];
  const qb = g('QB')[0];
  const rb = g('RB');
  const wr = g('WR');
  const te = g('TE')[0];
  const ol = g('OL');
  const dl = g('DL');
  const lb = g('LB');
  const cb = g('CB');
  const s = g('S');
  const k = g('K')[0];
  const p = g('P')[0];
  const teBlk = te ? te.r.blk : 60;
  const dbs = [...cb, ...s];
  const allDef = [...dl, ...lb, ...cb, ...s];

  const top2DL = topN(dl, 'prs', 2);
  const restDL = dl.filter((x) => !top2DL.includes(x));
  // What a man is worth as one of the four rushers. A lineman is worth his pass
  // rush; a linebacker is worth his, pulled toward replacement level by however
  // much of an off-ball player he is. `RUSH_FLOOR` is not a guess at what a
  // covering backer would manage if he rushed -- it is the level at which he
  // loses the seat to a lineman, which is the only thing it decides.
  const RUSH_FLOOR = 60;
  const rushPrs = (x) => {
    // Linemen rush for a living and are worth their pass rush outright. Only a
    // linebacker is gated -- `edgeness` returns 0 for every other position, so
    // reading it unconditionally discounted the whole line to the floor.
    if (x.pos !== 'LB') return x.r.prs;
    return RUSH_FLOOR + (x.r.prs - RUSH_FLOOR) * edgeness(x.pos, x.r);
  };
  const otherRushers = [...restDL, ...lb].sort((a, b) => rushPrs(b) - rushPrs(a)).slice(0, 2);

  // Awareness is what a defender does before the snap and in the first step
  // after it: reading the route, filling the right gap. It used to be gathered
  // here as `defAwr` and read by nothing, which made it fifteen per cent of a
  // corner's rating and none of his effect — two corners eight points apart in
  // awareness played games that came out identical to the character.
  //
  // It reaches the field now through the thing it improves rather than as a
  // number of its own, and it improves its OWN group: a smart corner covers
  // better, a smart front fits the run better. Centred on 82, the mean of the
  // synthetic population the engine's constants were fitted against, so the
  // calibration holds still. A real defence reads above that reference, but so
  // does the offence it plays, and a composite only sees one side: the passing
  // game reads the coverage's share against the passer's awareness instead
  // (DESIGN.md, "The passing game, held to real quarterbacks").
  const covOf = (arr) => (arr.length ? mean(arr, 'cov') + (mean(arr, 'awr') - AWR_MID) * COV_AWR : 60);
  /**
   * The linebackers' share of coverage, weighted by how much of an off-ball
   * player each one is.
   *
   * The other half of `passRush` above, and the half that was missing. An edge
   * rusher is not in coverage -- on a passing down he is one of the four going
   * after the quarterback, which the rush already says. Charging the defence
   * for his coverage too counted him in both places at once, and it was why the
   * record and the engine could not both be satisfied: the moment his own
   * coverage carried weight, his rating had to price it, and a hall of famer
   * fell back under what the record supports. Measured: the twelve edge rushers
   * the record argues for clear their bar only when that charge is zero.
   *
   * A front with no off-ball backer left still has to cover somebody, and it
   * covers with the men it has -- so below `OFF_BALL_MIN` the plain mean is the
   * floor, not a free pass. Fielding three rushers is still a coverage problem,
   * which is the trade-off this is supposed to create.
   */
  // Deep coverage's footrace term; see `covDeep` below.
  const dbSpeed = () => 0.6 * mean(cb, 'spd') + 0.4 * mean(s, 'spd');

  const OFF_BALL_MIN = 0.5;
  const covOfLb = () => {
    if (!lb.length) return 60;
    const w = lb.map((x) => 1 - edgeness(x.pos, x.r));
    const tot = w.reduce((a, b) => a + b, 0);
    if (tot < OFF_BALL_MIN) return covOf(lb);
    const wm = (key) => lb.reduce((acc, x, i) => acc + x.r[key] * w[i], 0) / tot;
    return wm('cov') + (wm('awr') - AWR_MID) * COV_AWR;
  };
  const fitOf = (arr) => (arr.length ? mean(arr, 'rsd') + (mean(arr, 'awr') - AWR_MID) * 0.25 : 60);

  return {
    qb,
    rb1: rb[0], rb2: rb[1],
    te, wr, ol, dl, lb, cb, s, k, p,
    // offense
    // The tight end used to count for 0.20 of the run block against 0.80 shared
    // by five linemen — 0.16 each — which made him the single most important run
    // blocker on the field. He is one of six blockers and usually the least
    // central of them. At 0.12 he is worth about two thirds of a lineman, which
    // is the right end of the order. Level is untouched on a uniform roster,
    // since the shares still sum to one.
    passBlock: 0.90 * mean(ol, 'pbk') + 0.10 * teBlk,
    runBlock: 0.88 * mean(ol, 'rbk') + 0.12 * teBlk,
    olAwr: mean(ol, 'awr'),
    // defense
    // A defence sends four. Two linemen always go; the other two seats are
    // contested between the rest of the line and any EDGE linebacker, ranked by
    // `rushPrs` above.
    //
    // The old line read `0.15 * mean(lb, 'prs')` across all three backers, so
    // one elite edge rusher moved the rush by 0.05 a point against 0.30 for a
    // top lineman -- six times less. That is why LB `prs` measured 0.108
    // leverage against a 0.150 price: the attribute was very nearly inert, and
    // a whole class of famous players had nothing to be good at. The two terms
    // are normalised over the four men actually rushing, which holds the
    // synthetic calibration mean to within a hundredth of a point.
    passRush: 0.67 * mean(top2DL, 'prs') + 0.33 * meanBy(otherRushers, rushPrs),
    // Blitzing is deliberately NOT gated. Sending extra men is exactly when an
    // off-ball linebacker rushes, so this still reads the whole corps.
    blitzRush: 0.45 * mean(top2DL, 'prs') + 0.15 * mean(restDL.length ? restDL : dl, 'prs') + 0.4 * mean(lb, 'prs'),
    runStop: 0.45 * fitOf(dl) + 0.35 * fitOf(lb) + 0.1 * mean(s, 'rsd') + 0.1 * mean(lb, 'tck'),
    covShort: 0.4 * covOf(cb) + 0.35 * covOfLb() + 0.25 * covOf(s),
    covMed: 0.5 * covOf(cb) + 0.2 * covOfLb() + 0.3 * covOf(s),
    // Deep coverage is partly a footrace, and none of the above says so.
    //
    // A corner's `spd` reached the simulation only through `defSpeed`, and every
    // use of it is clamped — `Math.max(0, receiver.spd - defSpeed)` — so once a
    // secondary is fast enough, more speed does nothing at all. Measured on the
    // calibration population, the receiver is the faster man in 38% of matchups,
    // which leaves a corner's speed inert in the other 62%. The one unclamped
    // channel is deep completion, about a tenth of throws. That is why `spd`
    // measured 0.094 of a corner's leverage against the 0.170 he was priced at.
    //
    // What was missing is that speed never helped him COVER: two corners with
    // the same `cov` and four tenths between them covered a post identically.
    // Centred on 82, the mean of the population the constants were fitted
    // against, so an ordinary secondary is left where the calibration put it.
    covDeep: 0.5 * covOf(cb) + 0.4 * covOf(s) + 0.1 * covOfLb() + (dbSpeed() - DB_SPD_MID) * DEEP_SPD,
    ballSkills: 0.6 * mean(cb, 'bal') + 0.4 * mean(s, 'bal'),
    tackling: 0.2 * mean(dl, 'tck') + 0.4 * mean(lb, 'tck') + 0.15 * mean(cb, 'tck') + 0.25 * mean(s, 'tck'),
    defSpeed: 0.45 * mean(cb, 'spd') + 0.35 * mean(s, 'spd') + 0.2 * mean(lb, 'spd'),
    // Kept for anything that wants the raw number; the effect lives in covOf
    // and fitOf above.
    defAwr: mean(allDef, 'awr'),
  };
}

/** A single number summarizing team strength, for standings/AI flavor. */
/**
 * What a position is actually worth, measured by boosting it on an otherwise
 * equal roster and taking the extra margin (`npm run leverage`). Documented in
 * auction.js, which is where it is used to price players and where it is
 * re-exported from; it lives here so `teamPower` can weight by it without the
 * two files importing each other.
 *
 * The mean of six synthetic rosters at 10,000 games each, scaled to keep the
 * starter-weighted total at 86.45. Set that way on 2026-09-24 with the back at
 * 13.99, nearly a quarterback, and set again the same day at 5.44 once the run
 * game was measured against real carries and a back's rating turned out to
 * move his five times as far as the real game's (DESIGN.md, "The back was
 * worth nearly three times too much"). Every table before those came from one
 * roster, whose own quirks sat inside the numbers.
 *
 * Set a third time once the passer, the receivers and the backs' other
 * channels were held to real seasons the same way (DESIGN.md, "The passing
 * game, held to real quarterbacks" and "Backs, receivers and tight ends, held
 * to real seasons"). A point of a quarterback's rating had moved his
 * production 2.4 times the real game's, and the table priced him accordingly;
 * with him right-sized, the back and the tight end, whose own targets,
 * carries and fumbles were inflated too, would have stood at 0.8 of him.
 * Measured with all of it fixed: the quarterback at 9.02, twice a corner and
 * 2.3 backs.
 *
 * Set a fourth time once the drive around the players was held to real
 * play-by-play (DESIGN.md, "The drive model, held to real play-by-play"):
 * real passing depths, the rush that makes third and long hard, the real
 * kicking curve and a fourth-down call that moves with field position. The
 * quarterback is 8.68 (± 0.43 between rosters), 1.96 tight ends; the tight
 * end, the back and the corner are within a standard error of one another.
 * The kicker rose from 1.50 to 1.87 and the offensive line from 3.19 to 3.53,
 * and the defensive line fell from 3.90 to 3.60 and the corner from 4.52 to
 * 4.15, none of it isolated.
 *
 * Set a fifth time once the lines were held to real absences (DESIGN.md, "The
 * trenches, held to real absences"): a carry had read the two lines three to
 * six times as far as the real game's, and reads them at a quarter now. In
 * raw margin a lineman lost half his value and a defensive lineman, a
 * linebacker and a tight end about a quarter to a third, and nothing else
 * moved outside its noise; the table keeps its total, so every other position
 * rose with the room they left. The offensive line is 2.21, the lowest of any
 * starter; the quarterback 11.16 (± 0.64 between rosters), 2.1 backs.
 */
export const TRUE_LEVERAGE = { QB: 11.16, RB: 5.37, CB: 5.32, TE: 4.28, WR: 3.55, S: 3.48, DL: 3.16, LB: 2.90, P: 2.84, K: 2.23, OL: 2.21 };

/**
 * How strong a lineup is, on the 40..99 rating scale.
 *
 * The weights used to be a guess — QB 3, everyone else between 0.2 and 1.2 —
 * and a guess is what it measured like. Against the point differential from a
 * full round robin across six leagues it came out at r = 0.34, which is to say
 * it explained about a tenth of who actually beat whom, while being printed on
 * the team page as "Power" and, worse, feeding `priorMargin` and the live
 * win-probability model.
 *
 * Weighting by TRUE_LEVERAGE instead — the table this game already measured for
 * exactly this question — takes it to r = 0.56. Measured at the same time: a
 * point of power is worth 3.25 points of margin, against the 3.3 winprob.js
 * was already using, so that constant did not have to move.
 *
 * It is still only r = 0.56. One number over a whole roster cannot capture a
 * matchup, and the rest is the simulation's own variance. The claim on the team
 * page is "this squad is stronger", not "this squad wins".
 */
export function teamPower(lineup) {
  const starters = [];
  for (const slot of ROSTER_SLOTS) {
    if (!slot.starter) continue;
    const arr = lineup[slot.pos];
    if (!arr) continue;
    const idx = ROSTER_SLOTS.filter((x) => x.pos === slot.pos).indexOf(slot);
    if (arr[idx]) starters.push(arr[idx]);
  }
  if (!starters.length) return 0;
  let s = 0, w = 0;
  for (const p of starters) {
    const k = TRUE_LEVERAGE[p.pos] ?? 1;
    s += overall(p) * k; w += k;
  }
  return Math.round((s / w) * 10) / 10;
}
