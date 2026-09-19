// Re-audit TRUE_LEVERAGE, the table the whole auction economy hangs on.
//
//   node scripts/leverage-sim.mjs [games]
//
// The shipped numbers came from one method: boost a position group by 8 points
// on an otherwise equal team, take the extra win rate, divide by the number of
// starters at that position. That division assumes the win effect scales
// linearly with how many players you boosted, which is a real assumption and
// not obviously true — targets are a fixed budget, so three better receivers
// may not be three times one better receiver, and dividing by three would then
// under-credit the position.
//
// So this measures two ways and prints both:
//
//   group  boost every starter at the position by 8, divide by starter count
//          (the original method, reproduced to check this harness agrees)
//   solo   boost exactly one starter by 8 and divide by nothing
//          (the marginal value of one player, which is the decision you
//          actually make when bidding on one man)
//
// Where the two disagree, the division is doing the damage.

import { syntheticTeam } from './synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, simulateGame } from '../src/engine/game.js';
import { POSITIONS, ROSTER_SLOTS } from '../src/data/positions.js';
import { TRUE_LEVERAGE } from '../src/engine/auction.js';

const N = Number(process.argv[2] || 4000);
const BOOST = 8;
const MEAN = 82;
const SD = 2;

const STARTERS = {};
for (const s of ROSTER_SLOTS) if (s.starter) STARTERS[s.pos] = (STARTERS[s.pos] || 0) + 1;
const POS = Object.keys(POSITIONS);

/**
 * Two rosters that are identical player for player, differing only in the slots
 * being boosted. This matters more than it looks: building the two sides from
 * different random seeds left one of them simply better, and two "equal" teams
 * split 59/41 rather than 50/50 — a bias that sat inside every reading and made
 * a +8 kicker look worth ten points of win rate. Mirrored rosters put the
 * baseline at 0.500 by construction, so what is left is the boost.
 */
function mirrorPair(seed, slotIds, amount) {
  const base = syntheticTeam('alpha', MEAN, SD, seed);
  const clone = { ...base, id: 'bravo', name: 'Team bravo', abbr: 'BRA', slots: {}, byId: new Map() };
  for (const slot of ROSTER_SLOTS) {
    const p = base.byId.get(base.slots[slot.id]);
    const twin = { ...p, id: `b-${p.id}`, r: { ...p.r } };
    clone.byId.set(twin.id, twin);
    clone.slots[slot.id] = twin.id;
  }
  if (!slotIds.length) return [base, clone];
  const lifted = new Map(base.byId);
  for (const slotId of slotIds) {
    const p = lifted.get(base.slots[slotId]);
    const r = {};
    for (const a of POSITIONS[p.pos].attrs) r[a] = Math.min(99, p.r[a] + amount);
    lifted.set(p.id, { ...p, r });
  }
  return [{ ...base, byId: lifted }, clone];
}

/**
 * A's edge over B across N games: home advantage off, sides swapped every other
 * game so what is measured is the roster and nothing else.
 *
 * Margin is the headline rather than win rate. A win is one bit per game and
 * needs tens of thousands of games to separate two positions a point apart;
 * margin is continuous, and the same run that leaves win rate ±1.1 points
 * pins margin to about ±0.15. The standard error comes back with it so a
 * difference can be called real or not rather than eyeballed.
 */
function measure(A, B, games) {
  const la = buildLineup(A.slots, A.byId);
  const lb = buildLineup(B.slots, B.byId);
  let w = 0, sum = 0, sumSq = 0;
  for (let i = 0; i < games; i++) {
    const flip = i % 2 === 1;
    const home = flip ? { ...B, lineup: lb } : { ...A, lineup: la };
    const away = flip ? { ...A, lineup: la } : { ...B, lineup: lb };
    const g = createGame(home, away, { seed: 90000 + i, homeAdvantage: false });
    simulateGame(g);
    const aScore = flip ? g.score[1] : g.score[0];
    const bScore = flip ? g.score[0] : g.score[1];
    const margin = aScore - bScore;
    sum += margin;
    sumSq += margin * margin;
    if (aScore > bScore) w++; else if (aScore === bScore) w += 0.5;
  }
  const mean = sum / games;
  const variance = Math.max(0, sumSq / games - mean * mean);
  return { margin: mean, se: Math.sqrt(variance / games), win: w / games };
}

const starterSlots = (pos) => ROSTER_SLOTS.filter((s) => s.starter && s.pos === pos).map((s) => s.id);

console.log(`Measuring over ${N} games per reading, boost +${BOOST}, base rating ${MEAN}, no home edge.`);
const base = measure(...mirrorPair(1, [], 0), N);
console.log(`Baseline (mirrored rosters, must be zero): margin ${base.margin.toFixed(3)} ± ${base.se.toFixed(3)}, win rate ${base.win.toFixed(4)}`);
console.log('');
console.log('pos  n   group margin  per starter    solo margin      solo win%   shipped');

const rows = [];
for (const pos of POS) {
  const slots = starterSlots(pos);
  if (!slots.length) continue;
  const group = measure(...mirrorPair(1, slots, BOOST), N);
  const solo = measure(...mirrorPair(1, [slots[0]], BOOST), N);
  const perStarter = group.margin / slots.length;
  rows.push({ pos, starters: slots.length, group: group.margin, perStarter, solo: solo.margin, se: solo.se, win: solo.win, shipped: TRUE_LEVERAGE[pos] });
  console.log(
    `  ${pos.padEnd(3)} ${String(slots.length)}   ${group.margin.toFixed(2).padStart(10)}   ${perStarter.toFixed(2).padStart(9)}   ${solo.margin.toFixed(2).padStart(8)} ±${solo.se.toFixed(2)}   ${(solo.win * 100).toFixed(1).padStart(6)}%   ${String(TRUE_LEVERAGE[pos]).padStart(6)}`,
  );
}

// Rank both ways: what matters for the auction is the order, not the units.
const byShipped = rows.slice().sort((a, b) => b.shipped - a.shipped).map((r) => r.pos);
const bySolo = rows.slice().sort((a, b) => b.solo - a.solo).map((r) => r.pos);
const byGroup = rows.slice().sort((a, b) => b.perStarter - a.perStarter).map((r) => r.pos);
console.log('');
console.log('order, shipped table :', byShipped.join(' > '));
console.log('order, group/starter :', byGroup.join(' > '));
console.log('order, solo (marginal):', bySolo.join(' > '));

// The table's own definition is the group method, so that is what a corrected
// table should be built from. Only ratios matter downstream — the price guide
// normalises by the sum — so the scale is pinned to the shipped quarterback to
// keep the numbers reading the same size as before.
const qb = rows.find((r) => r.pos === 'QB');
const scale = (TRUE_LEVERAGE.QB || 1) / qb.perStarter;
console.log('');
console.log('Recalibrated from the group method, scaled so QB keeps its shipped value:');
const fixed = Object.fromEntries(rows.map((r) => [r.pos, Math.round(r.perStarter * scale * 100) / 100]));
console.log('  ' + JSON.stringify(fixed));
console.log('');
console.log('pos   shipped   measured   change');
for (const r of rows.slice().sort((a, b) => fixed[b.pos] - fixed[a.pos])) {
  const ratio = fixed[r.pos] / (r.shipped || 0.01);
  const flag = ratio > 1.5 || ratio < 0.67 ? '  <-- materially different' : '';
  console.log(`  ${r.pos.padEnd(4)} ${String(r.shipped).padStart(6)}   ${fixed[r.pos].toFixed(2).padStart(8)}   ${ratio.toFixed(2).padStart(5)}×${flag}`);
}
