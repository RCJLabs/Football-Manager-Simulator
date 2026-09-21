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
export const POSITIONS = {
  QB: { name: 'Quarterback',   attrs: ['thp', 'tha', 'awr', 'mob'],
        weights: { tha: 0.40, awr: 0.35, thp: 0.17, mob: 0.08 } },
  RB: { name: 'Running Back',  attrs: ['spd', 'elu', 'pow', 'awr', 'rec', 'car'],
        weights: { spd: 0.20, elu: 0.20, awr: 0.20, pow: 0.15, car: 0.15, rec: 0.10 } },
  WR: { name: 'Wide Receiver', attrs: ['spd', 'cth', 'rte', 'rac'],
        weights: { spd: 0.27, cth: 0.27, rte: 0.26, rac: 0.20 } },
  TE: { name: 'Tight End',     attrs: ['spd', 'cth', 'rte', 'rac', 'blk'],
        weights: { cth: 0.25, blk: 0.25, rte: 0.20, rac: 0.20, spd: 0.10 } },
  OL: { name: 'Offensive Line', attrs: ['pbk', 'rbk', 'awr'],
        weights: { pbk: 0.45, rbk: 0.45, awr: 0.10 } },
  DL: { name: 'Defensive Line', attrs: ['prs', 'rsd', 'tck', 'awr'],
        weights: { prs: 0.55, rsd: 0.27, tck: 0.11, awr: 0.07 } },
  LB: { name: 'Linebacker',    attrs: ['spd', 'tck', 'rsd', 'cov', 'prs', 'awr'],
        weights: { tck: 0.20, rsd: 0.20, cov: 0.20, prs: 0.15, awr: 0.15, spd: 0.10 } },
  CB: { name: 'Cornerback',    attrs: ['spd', 'cov', 'bal', 'tck', 'awr'],
        weights: { cov: 0.48, spd: 0.17, bal: 0.17, awr: 0.12, tck: 0.06 } },
  S:  { name: 'Safety',        attrs: ['spd', 'cov', 'bal', 'tck', 'rsd', 'awr'],
        weights: { cov: 0.38, tck: 0.20, spd: 0.13, bal: 0.12, rsd: 0.11, awr: 0.06 } },
  K:  { name: 'Kicker',        attrs: ['kpw', 'kac'],
        weights: { kac: 0.60, kpw: 0.40 } },
  P:  { name: 'Punter',        attrs: ['ppw', 'pac'],
        weights: { ppw: 0.69, pac: 0.31 } },
};

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
