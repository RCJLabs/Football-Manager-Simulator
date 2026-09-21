// What each ATTRIBUTE is worth, measured on the field.
//
//   node scripts/attribute-leverage.mjs [games] [pos...]
//
// `leverage-sim.mjs` answered "what is a position worth". This answers the
// question inside it: of the attributes a position carries, which ones actually
// decide games. The two are not the same question and the game holds two
// different answers to it.
//
//   POSITIONS[pos].weights  ->  overall(p)  ->  auction price, draft board,
//                                               trade value, depth-chart order,
//                                               teamPower and the win-prob prior
//   composites(lineup)      ->  the simulation itself
//
// Nothing keeps those two in agreement, and where they disagree the economy
// misprices a player the field rewards, or pays for something the field
// ignores. The linebacker is the loud case: `composites` reads his pass rush at
// 0.40 of `blitzRush`, and `POSITIONS.LB.weights` gives `prs` 0.15 of his
// overall.
//
// Method is `leverage-sim.mjs`'s, narrowed: mirrored rosters so the baseline is
// zero by construction, home advantage off, sides swapped every other game,
// margin rather than win rate because margin is continuous and a win is one bit.
// The only change is that a reading lifts ONE attribute rather than all of them.
//
// Read the normalised column, not the raw margins. What a weight vector encodes
// is the split between a position's own attributes; the scale it sits on is the
// position's leverage, which TRUE_LEVERAGE already carries.

import { syntheticTeam } from './synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, simulateGame } from '../src/engine/game.js';
import { POSITIONS, ROSTER_SLOTS } from '../src/data/positions.js';

const N = Number(process.argv[2] || 3000);
const ONLY = process.argv.slice(3).filter((a) => POSITIONS[a]);
const BOOST = 8;
const MEAN = 82;
const SD = 2;

/**
 * Two rosters identical player for player, differing only in one attribute on
 * the named slots. Building the sides from different seeds leaves one simply
 * better and puts a bias inside every reading; mirroring pins the baseline at
 * 0.500 so what is left is the boost.
 */
function mirrorPair(seed, slotIds, attr, amount) {
  const base = syntheticTeam('alpha', MEAN, SD, seed);
  const clone = { ...base, id: 'bravo', name: 'Team bravo', abbr: 'BRA', slots: {}, byId: new Map() };
  for (const slot of ROSTER_SLOTS) {
    const p = base.byId.get(base.slots[slot.id]);
    const twin = { ...p, id: `b-${p.id}`, r: { ...p.r } };
    clone.byId.set(twin.id, twin);
    clone.slots[slot.id] = twin.id;
  }
  if (!slotIds.length || !attr) return [base, clone];
  const lifted = new Map(base.byId);
  for (const slotId of slotIds) {
    const p = lifted.get(base.slots[slotId]);
    lifted.set(p.id, { ...p, r: { ...p.r, [attr]: Math.min(99, p.r[attr] + amount) } });
  }
  return [{ ...base, byId: lifted }, clone];
}

function measure(A, B, games) {
  const la = buildLineup(A.slots, A.byId);
  const lb = buildLineup(B.slots, B.byId);
  // Both halves of a swap share a seed. The borrowed harness advanced the seed
  // and the flip together, so the two sides never played the same game and a
  // mirrored pair left 0.6 points of residue to be averaged away. Paired, a
  // mirrored roster cancels to exactly zero — variance the reading no longer
  // has to out-shout — and the error has to be taken over the PAIRS, because
  // the two games in one are about as far from independent as two games get.
  const pairs = Math.floor(games / 2);
  let sum = 0, sumSq = 0;
  for (let k = 0; k < pairs; k++) {
    let d = 0;
    for (const flip of [false, true]) {
      const home = flip ? { ...B, lineup: lb } : { ...A, lineup: la };
      const away = flip ? { ...A, lineup: la } : { ...B, lineup: lb };
      const g = createGame(home, away, { seed: 90000 + k, homeAdvantage: false });
      simulateGame(g);
      d += (flip ? g.score[1] - g.score[0] : g.score[0] - g.score[1]);
    }
    d /= 2;
    sum += d; sumSq += d * d;
  }
  const mean = sum / pairs;
  return { margin: mean, se: Math.sqrt(Math.max(0, sumSq / pairs - mean * mean) / pairs) };
}

const starterSlots = (pos) => ROSTER_SLOTS.filter((s) => s.starter && s.pos === pos).map((s) => s.id);

export function sweep(games = N, positions = Object.keys(POSITIONS)) {
  const out = {};
  for (const pos of positions) {
    const slots = starterSlots(pos);
    if (!slots.length) continue;
    out[pos] = POSITIONS[pos].attrs.map((attr) => {
      const m = measure(...mirrorPair(1, slots, attr, BOOST), games);
      return { attr, margin: m.margin, se: m.se };
    });
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('attribute-leverage.mjs')) {
  const positions = ONLY.length ? ONLY : Object.keys(POSITIONS);
  console.log(`${N} games a reading, +${BOOST} on one attribute across every starter, base ${MEAN}, no home edge.`);
  const zero = measure(...mirrorPair(1, [], null, 0), Math.min(N, 2000));
  console.log(`baseline (must be zero): ${zero.margin.toFixed(3)} ± ${zero.se.toFixed(3)}\n`);
  const res = sweep(N, positions);
  for (const [pos, rows] of Object.entries(res)) {
    // Negative readings are noise around zero, not evidence an attribute hurts;
    // clamp before normalising so one unlucky reading cannot flip a weight.
    const total = rows.reduce((s, r) => s + Math.max(0, r.margin), 0) || 1;
    const w = POSITIONS[pos].weights;
    console.log(`${pos}  (${starterSlots(pos).length} starters)`);
    console.log('  attr   margin      se    measured   shipped   change');
    for (const r of rows.slice().sort((a, b) => b.margin - a.margin)) {
      const got = Math.max(0, r.margin) / total;
      const want = w[r.attr] ?? 0;
      const flag = Math.abs(got - want) >= 0.10 ? '  <<' : '';
      console.log(`  ${r.attr.padEnd(5)} ${r.margin.toFixed(3).padStart(7)} ±${r.se.toFixed(3)}   ${got.toFixed(3).padStart(8)}  ${want.toFixed(3).padStart(8)}   ${(got - want >= 0 ? '+' : '') + (got - want).toFixed(3)}${flag}`);
    }
    console.log('');
  }
}
