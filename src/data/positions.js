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

export const POSITIONS = {
  QB: { name: 'Quarterback',   attrs: ['thp', 'tha', 'awr', 'mob'],
        weights: { tha: 0.35, awr: 0.30, thp: 0.20, mob: 0.15 } },
  RB: { name: 'Running Back',  attrs: ['spd', 'elu', 'pow', 'awr', 'rec', 'car'],
        weights: { spd: 0.20, elu: 0.20, pow: 0.15, awr: 0.20, rec: 0.10, car: 0.15 } },
  WR: { name: 'Wide Receiver', attrs: ['spd', 'cth', 'rte', 'rac'],
        weights: { cth: 0.30, rte: 0.30, spd: 0.20, rac: 0.20 } },
  TE: { name: 'Tight End',     attrs: ['spd', 'cth', 'rte', 'rac', 'blk'],
        weights: { cth: 0.25, rte: 0.20, blk: 0.25, spd: 0.10, rac: 0.20 } },
  OL: { name: 'Offensive Line', attrs: ['pbk', 'rbk', 'awr'],
        weights: { pbk: 0.45, rbk: 0.45, awr: 0.10 } },
  DL: { name: 'Defensive Line', attrs: ['prs', 'rsd', 'tck', 'awr'],
        weights: { prs: 0.40, rsd: 0.35, tck: 0.15, awr: 0.10 } },
  LB: { name: 'Linebacker',    attrs: ['spd', 'tck', 'rsd', 'cov', 'prs', 'awr'],
        weights: { tck: 0.20, rsd: 0.20, cov: 0.20, prs: 0.15, spd: 0.10, awr: 0.15 } },
  CB: { name: 'Cornerback',    attrs: ['spd', 'cov', 'bal', 'tck', 'awr'],
        weights: { cov: 0.40, spd: 0.20, bal: 0.20, tck: 0.05, awr: 0.15 } },
  S:  { name: 'Safety',        attrs: ['spd', 'cov', 'bal', 'tck', 'rsd', 'awr'],
        weights: { cov: 0.30, bal: 0.15, tck: 0.15, rsd: 0.10, spd: 0.15, awr: 0.15 } },
  K:  { name: 'Kicker',        attrs: ['kpw', 'kac'],
        weights: { kpw: 0.40, kac: 0.60 } },
  P:  { name: 'Punter',        attrs: ['ppw', 'pac'],
        weights: { ppw: 0.50, pac: 0.50 } },
};

export const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P'];

// Roster template. Every team drafts exactly one player per slot.
// `starter` slots take the field; bench slots rotate in (RB2 shares carries,
// WR4 gets a few targets). Order within a position group = depth chart order.
export const ROSTER_SLOTS = [
  { id: 'QB1', pos: 'QB', starter: true },
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
