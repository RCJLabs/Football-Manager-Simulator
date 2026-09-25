// Position definitions: which rating attributes each position carries, and
// how they combine into an overall rating. All ratings are integers 40..99.
//
// Attribute glossary
//   spd  speed / long speed            awr  awareness, reads, instincts
//   thp  throw power / arm strength    tha  throw accuracy (all levels)
//   mob  mobility (escape, scramble)   elu  elusiveness / agility
//   pow  power / break tackle          rec  receiving (for backs)
//   car  ball security (carrying)      cth  catching / hands / contested
//   rte  route running / separation    rac  run after catch
//   blk  blocking (TE)                 pbk  pass blocking
//   rbk  run blocking                  prs  pass rush
//   rsd  run defense / gap integrity   tck  tackling
//   cov  coverage (man + zone)         bal  ball skills (INT / PD)
//   kpw  kick power / range            kac  kick accuracy
//   ppw  punt power / distance         pac  punt accuracy / hang / placement

// These are fitted against two authorities that do not agree.
//
// `npm run attrs` measures what the field rewards: lift one attribute eight
// points across a position's starters, read the margin. `npm run legacy`
// measures what the record rewards: 443 seasons of MVPs, major awards and
// records, each setting a floor the rating has to clear. A weight wants to
// follow the first — `overall` prices the auction, ranks the board and sorts
// every depth chart, so pricing what does not win games is how a club is
// robbed. But following it blindly imports the simulation's own blind spots
// into the economy, and the record is the thing that catches those.
//
// So each position moves as far toward the measured vector as the record will
// allow: the largest blend that leaves `legacy-check` no worse at that
// position. Some take all of it, some take none, and where a position takes
// none that is a finding about the simulation rather than about the weights —
// see DESIGN.md, "Two authorities, and where they disagree".
//
// Re-measured once the drive was held to real play-by-play (DESIGN.md, "The
// rating weights, re-measured on the engine as it now is"), with `npm run
// blend` walking each position's blend against the record and counting every
// point its recorded seasons sit below their floors as well as the misses the
// check reports. The corner, the off-ball linebacker, the kicker and the punter
// went the whole way and the defensive line an eighth, where the record's pass
// rushers stop it. The edge vector moved everywhere but its pass rush, which
// the record will not let fall by a hundredth (Terrell Suggs sits on his bar).
// The receiver and the safety measured a long way off on the field and did not
// move then, on a check that turned out to be too noisy to decide it (below).
//
// Re-measured again once the lines were held to real absences (DESIGN.md, "The
// trenches, held to real absences"), which turned the offensive line from run
// blocking at 1.7 times pass blocking to pass blocking at 3.8 times run
// blocking. The line went three quarters of the way, the off-ball linebacker the
// whole way (run defence 0.35 -> 0.16), the safety five eighths and the
// receiver the whole way. The check against generated players' production had
// read each man over 600 games once, and on independent games the same
// comparison moved by as much as 0.04; averaged over 3,000 it agrees with the
// field at all four. The defensive line and the edge rusher stay: there the
// generated players rank better on more run defence, not less, on every run of
// games, against the field's reading, so the two authorities disagree and
// neither is taken. Jim Ringo '61, whom the line's move put a point under his
// Hall of Fame floor, was rated below every centre of his time and is corrected
// rather than recorded, as the record's own rule for a five-point nudge asks.
//
// And once the pocket read the lines (DESIGN.md, "The pocket, held to real
// absences"), which put what a catch gains after it on the protection against
// the rush: the line measured pass blocking at 5.2 times run blocking and went
// the whole way, which the record allows and generated players' production
// neither asks for nor objects to (-0.001, -0.003 to +0.001). The defensive
// line and the edge rusher measured more pass rush again, and generated
// players again rank better on more run defence at every step, so they stay.
// The tight end measured blocking at 0.39 and generated players agree, but
// the record will not have it: an eighth puts Brock Bowers '24 three points
// under his floor, the receiving tight end the real game pays for.
export const POSITIONS = {
  QB: { name: 'Quarterback',   attrs: ['thp', 'tha', 'awr', 'mob'],
        weights: { tha: 0.40, awr: 0.35, thp: 0.17, mob: 0.08 } },
  RB: { name: 'Running Back',  attrs: ['spd', 'elu', 'pow', 'awr', 'rec', 'car'],
        weights: { spd: 0.30, elu: 0.19, awr: 0.19, pow: 0.14, car: 0.08, rec: 0.10 } },
  WR: { name: 'Wide Receiver', attrs: ['spd', 'cth', 'rte', 'rac'],
        weights: { cth: 0.38, spd: 0.33, rte: 0.20, rac: 0.09 } },
  TE: { name: 'Tight End',     attrs: ['spd', 'cth', 'rte', 'rac', 'blk'],
        weights: { cth: 0.25, blk: 0.25, rte: 0.20, rac: 0.20, spd: 0.10 } },
  OL: { name: 'Offensive Line', attrs: ['pbk', 'rbk', 'awr'],
        weights: { pbk: 0.69, awr: 0.18, rbk: 0.13 } },
  DL: { name: 'Defensive Line', attrs: ['prs', 'rsd', 'tck', 'awr'],
        weights: { prs: 0.60, rsd: 0.21, tck: 0.11, awr: 0.08 } },
  // `edgeWeights` is the same position doing a different job -- see `edgeness`
  // below. A linebacker's rating blends the two by how much of an edge rusher
  // he is, so the pool does not have to be hand-tagged and a man who grows into
  // a rusher is re-priced as one without anybody editing a file.
  LB: { name: 'Linebacker',    attrs: ['spd', 'tck', 'rsd', 'cov', 'prs', 'awr'],
        weights:     { cov: 0.28, tck: 0.23, rsd: 0.16, awr: 0.16, prs: 0.10, spd: 0.07 },
        edgeWeights: { prs: 0.45, rsd: 0.23, tck: 0.17, awr: 0.09, spd: 0.06, cov: 0.00 } },
  CB: { name: 'Cornerback',    attrs: ['spd', 'cov', 'bal', 'tck', 'awr'],
        weights: { cov: 0.51, bal: 0.19, spd: 0.16, awr: 0.09, tck: 0.05 } },
  S:  { name: 'Safety',        attrs: ['spd', 'cov', 'bal', 'tck', 'rsd', 'awr'],
        weights: { cov: 0.36, tck: 0.17, bal: 0.16, spd: 0.14, awr: 0.09, rsd: 0.08 } },
  K:  { name: 'Kicker',        attrs: ['kpw', 'kac'],
        weights: { kac: 0.50, kpw: 0.50 } },
  P:  { name: 'Punter',        attrs: ['ppw', 'pac'],
        weights: { ppw: 0.85, pac: 0.15 } },
};

/**
 * How much of an edge rusher a linebacker is, from 0 to 1.
 *
 * The game had one linebacker position and the sport has two jobs. An off-ball
 * backer is paid to tackle, fit the run and cover; an edge rusher is paid to
 * get to the quarterback and is usually a liability in coverage. Averaging both
 * into one weight vector priced neither correctly: Derrick Thomas, a hall of
 * famer with the single-game sack record, came out at 77 -- below an average
 * starter -- because sixty per cent of an LB's rating sat in three things he
 * was not paid to do. His attribute line was not wrong. The weights were.
 *
 * Derived from the attributes rather than stored as a flag, for three reasons.
 * A stored tag needs 158 hand edits and a rule for generated rookies anyway; a
 * derived one cannot go stale when the pool is re-rated; and a BINARY tag would
 * make `overall` jump the moment a developing player crossed the line, which
 * the economy reads as a man suddenly worth several points more. A continuous
 * blend has no such cliff.
 *
 * The measure is simply how much better he rushes than he covers. It sorts the
 * real pool with nothing by hand: Derrick Thomas, Kevin Greene, DeMarcus Ware,
 * Von Miller, T.J. Watt and James Harrison all reach 1.00; Khalil Mack and
 * Terrell Suggs 0.93; Micah Parsons 0.87; and Lawrence Taylor 0.70, which is
 * the case that says the measure is doing something real -- he was chiefly a
 * rusher and genuinely did both jobs, and he lands between the pure rushers and
 * the pure backers without anybody deciding that. Ray Lewis, Urlacher, Seau and
 * Kuechly all read 0.00. Forty-six of 158 linebackers carry any edge character
 * at all and fourteen reach the cap.
 *
 * `EDGE_SPAN` was chosen against the record rather than for tidiness. Widening
 * it to 45 stops anyone saturating, which looks better and costs four of the
 * twelve rated seasons the record argues for. Saturation is not a defect here:
 * a man who rushes forty points better than he covers and one who rushes thirty
 * better are both simply rushers, and the cap says so.
 */
export const EDGE_SPAN = 30;

export function edgeness(pos, r) {
  if (pos !== 'LB' || !r) return 0;
  const d = (r.prs ?? 60) - (r.cov ?? 60);
  return Math.max(0, Math.min(1, d / EDGE_SPAN));
}

/**
 * The weight vector a player is actually rated on: the one that rates him
 * higher, which is to say the job he is better at.
 *
 * This was a blend by `edgeness` first, and the blend had a defect that is
 * worth keeping written down, because it is not obvious and it is the kind of
 * thing the economy would have carried silently. Blending made a rating
 * NON-MONOTONIC in coverage. Raising a rusher's `cov` lowers his `edgeness`,
 * which shifts weight off the edge vector, where `prs` is worth 0.50, onto the
 * off-ball one, where it is worth 0.05 -- and for a man with an elite pass rush
 * that loss is bigger than anything the coverage gains him. Measured across a
 * grid of profiles: a linebacker with `prs` 96 read 88 at `cov` 67 and 84 at
 * `cov` 82. Improving a player by fifteen points made him four points worse,
 * which development, the rating editor and the draft board would all have
 * acted on.
 *
 * Taking the better of the two vectors is monotonic by construction -- each is
 * a non-negative weighted sum, and the maximum of two such is non-decreasing in
 * every attribute. Swept over the same grid: zero non-monotonic steps in `cov`
 * and zero in `prs`. It is also the more honest description. A man is worth
 * what he is worth at the thing he is good at, and nobody rates Derrick Thomas
 * as seven-tenths of a coverage linebacker.
 *
 * `edgeness` stays, and stays continuous, because the ENGINE asks a different
 * question: not what a man is worth but how often he rushes, which really is a
 * matter of degree. See `composites` in ratings.js.
 */
export function weightsFor(pos, r) {
  const def = POSITIONS[pos];
  if (!def.edgeWeights || !r) return def.weights;
  const dot = (w) => { let s = 0; for (const k in w) s += (r[k] ?? 60) * w[k]; return s; };
  return dot(def.edgeWeights) > dot(def.weights) ? def.edgeWeights : def.weights;
}

/** True when a player is rated as an edge rusher rather than an off-ball backer. */
export function ratedAsEdge(pos, r) {
  return POSITIONS[pos]?.edgeWeights ? weightsFor(pos, r) === POSITIONS[pos].edgeWeights : false;
}

export const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P'];

// Roster template. Every team drafts exactly one player per slot.
// `starter` slots take the field; bench slots rotate in (RB2 shares carries,
// WR4 gets a few targets) and step up when a starter is hurt. QB2 exists
// because a quarterback injury without a backup is a season-defining event.
// Order within a position group = depth chart order.
export const ROSTER_SLOTS = [
  { id: 'QB1', pos: 'QB', starter: true },
  { id: 'QB2', pos: 'QB', starter: false },
  { id: 'RB1', pos: 'RB', starter: true },
  { id: 'RB2', pos: 'RB', starter: false },
  { id: 'WR1', pos: 'WR', starter: true },
  { id: 'WR2', pos: 'WR', starter: true },
  { id: 'WR3', pos: 'WR', starter: true },
  { id: 'WR4', pos: 'WR', starter: false },
  { id: 'TE1', pos: 'TE', starter: true },
  { id: 'OL1', pos: 'OL', starter: true },
  { id: 'OL2', pos: 'OL', starter: true },
  { id: 'OL3', pos: 'OL', starter: true },
  { id: 'OL4', pos: 'OL', starter: true },
  { id: 'OL5', pos: 'OL', starter: true },
  { id: 'DL1', pos: 'DL', starter: true },
  { id: 'DL2', pos: 'DL', starter: true },
  { id: 'DL3', pos: 'DL', starter: true },
  { id: 'DL4', pos: 'DL', starter: true },
  { id: 'LB1', pos: 'LB', starter: true },
  { id: 'LB2', pos: 'LB', starter: true },
  { id: 'LB3', pos: 'LB', starter: true },
  { id: 'CB1', pos: 'CB', starter: true },
  { id: 'CB2', pos: 'CB', starter: true },
  { id: 'S1',  pos: 'S',  starter: true },
  { id: 'S2',  pos: 'S',  starter: true },
  { id: 'K1',  pos: 'K',  starter: true },
  { id: 'P1',  pos: 'P',  starter: true },
];

export const SLOT_COUNTS = ROSTER_SLOTS.reduce((acc, s) => {
  acc[s.pos] = (acc[s.pos] || 0) + 1;
  return acc;
}, {});

export function eraOf(season) {
  const d = Math.floor(season / 10) * 10;
  return `${d}s`;
}
