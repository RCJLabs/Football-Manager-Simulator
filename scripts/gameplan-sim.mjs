// What the matchup game plan is worth, and who currently gets one.
//
//   node scripts/gameplan-sim.mjs [games]
//
// createGame gives every AI club a plan from makeGameplan every game — up to
// ±0.08 on the pass rate, ±0.15 on the blitz, ±0.08 on the shell, plus deep and
// screen weighting. The human's club is skipped ("a human's sliders are left
// alone") and the `planForUser` option that would include it is never passed by
// anything. So the player is the only club in the league that never adapts to
// who it is playing, and this measures what that costs.
//
// Mirrored rosters, home advantage off, sides swapped every other game, so the
// only difference between the two teams is who is allowed a plan.

import { syntheticTeam } from './synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, simulateGame } from '../src/engine/game.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';

const N = Number(process.argv[2] || 3000);

/**
 * Two lopsided but *fixed* sides. Mirrored rosters are useless here: makeGameplan
 * fires on composite gaps over 5 and 8 points, so against your own clone every
 * gap is zero and the plan comes back empty. A plan can only be worth something
 * where there is an edge to find, which means the sides have to differ.
 */
function pair(seed, meanA, meanB) {
  const a = syntheticTeam('alpha', meanA, 2, seed);
  const b = syntheticTeam('bravo', meanB, 2, seed + 7717);
  return [a, b];
}

/**
 * The same matchup played twice, differing only in whether side A is allowed a
 * matchup plan. Taking the difference cancels the roster gap, which otherwise
 * swamps everything: a six-point mean difference is worth about twenty points a
 * game and the plan is worth a fraction of one.
 *
 * `isUser` is the flag createGame reads to decide who gets skipped, so setting
 * it is how the shipped asymmetry is reproduced rather than simulated.
 */
function planValue(n, meanA, meanB) {
  let sum = 0, sumSq = 0, planned = 0, empty = 0;
  for (let i = 0; i < n; i++) {
    const seed = 5000 + i;
    const [ra, rb] = pair(seed, meanA, meanB);
    const aHome = i % 2 === 0;
    const margins = [];
    for (const aPlans of [false, true]) {
      const mk = (t, isUser) => ({ ...t, lineup: buildLineup(t.slots, t.byId), isUser });
      // A is "user" (skipped) when it must not plan; B is always skipped.
      const A = mk(ra, !aPlans), B = mk(rb, true);
      const g = createGame(aHome ? A : B, aHome ? B : A, { seed, homeAdvantage: false });
      if (aPlans) {
        const side = aHome ? 0 : 1;
        if (!g.teams[side].plan || !g.teams[side].plan.notes.length) empty++;
        else planned++;
      }
      simulateGame(g);
      margins.push(aHome ? g.score[0] - g.score[1] : g.score[1] - g.score[0]);
    }
    const delta = margins[1] - margins[0];
    sum += delta; sumSq += delta * delta;
  }
  const mean = sum / n;
  const se = Math.sqrt(Math.max(0, sumSq / n - mean * mean) / n);
  return { mean, se, planned, empty };
}

console.log(`${N} paired games per row. "plan" = makeGameplan applied to A only.\n`);
console.log('roster gap        plan worth (points to A)   plans with something in them');
for (const [label, ma, mb] of [
  ['even 82 v 82  ', 82, 82],
  ['A weaker 78/86', 78, 86],
  ['A stronger 86/78', 86, 78],
  ['slight 81/83  ', 81, 83],
]) {
  const r = planValue(N, ma, mb);
  const sig = Math.abs(r.mean) > 2 * r.se ? 'real' : 'not separable from zero';
  console.log(`${label.padEnd(17)} ${(r.mean >= 0 ? '+' : '') + r.mean.toFixed(3)} ± ${r.se.toFixed(3)}  (${sig})   ${r.planned}/${r.planned + r.empty}`);
}

// ---------------------------------------------------------------------------
// What the sliders themselves are worth
// ---------------------------------------------------------------------------
//
// The plan only nudges the sliders, so if the sliders are flat the plan cannot
// be worth anything whatever its thresholds. This drives each lever from one end
// of its UI range to the other on otherwise identical rosters. Mirrored teams,
// sides swapped every other game, so the only difference is the dial.

import { DEFAULT_STRATEGY } from '../src/engine/playcall.js';

const RANGES = [
  ['passRate', 0.35, 0.7], ['aggression', 0, 1], ['tempo', 0, 1],
  ['blitzRate', 0.05, 0.6], ['deepShell', 0, 0.6],
];

function mirror(seed) {
  const base = syntheticTeam('alpha', 82, 2, seed);
  const clone = { ...base, id: 'bravo', name: 'Team bravo', abbr: 'BRA', slots: {}, byId: new Map() };
  for (const slot of ROSTER_SLOTS) {
    const p = base.byId.get(base.slots[slot.id]);
    const twin = { ...p, id: `b-${p.id}`, r: { ...p.r } };
    clone.byId.set(twin.id, twin);
    clone.slots[slot.id] = twin.id;
  }
  return [base, clone];
}

/** A at `hi`, B at `lo`, on the same dial. Positive means the high end wins. */
function sliderValue(n, key, lo, hi) {
  let sum = 0, sumSq = 0, wins = 0, ties = 0;
  for (let i = 0; i < n; i++) {
    const seed = 9000 + i;
    const [ra, rb] = mirror(seed);
    const aHome = i % 2 === 0;
    const mk = (t, v) => ({ ...t, lineup: buildLineup(t.slots, t.byId), isUser: true, strategy: { ...DEFAULT_STRATEGY, [key]: v } });
    const A = mk(ra, hi), B = mk(rb, lo);
    const g = createGame(aHome ? A : B, aHome ? B : A, { seed, homeAdvantage: false });
    simulateGame(g);
    const m = aHome ? g.score[0] - g.score[1] : g.score[1] - g.score[0];
    sum += m; sumSq += m * m;
    if (m > 0) wins++; else if (m === 0) ties++;
  }
  const mean = sum / n;
  return { mean, se: Math.sqrt(Math.max(0, sumSq / n - mean * mean) / n), winPct: (wins + ties / 2) / n };
}

console.log(`\nEach dial driven end to end on identical rosters, ${N} games:\n`);
console.log('dial         range          high end is worth        wins');
for (const [key, lo, hi] of RANGES) {
  const r = sliderValue(N, key, lo, hi);
  const sig = Math.abs(r.mean) > 2 * r.se ? 'real' : 'noise';
  console.log(`${key.padEnd(12)} ${String(lo).padEnd(5)}→${String(hi).padEnd(6)} ${(r.mean >= 0 ? '+' : '') + r.mean.toFixed(2)} ± ${r.se.toFixed(2)} pts (${sig})   ${(r.winPct * 100).toFixed(1)}%`);
}

// ---------------------------------------------------------------------------
// Does following the read actually win?
// ---------------------------------------------------------------------------
//
// The fit in strategy.js was fitted to the sweep above, so reproducing it
// proves nothing. This is the non-circular check: take real drafted rosters,
// play each club against its own clone, one side following the read and the
// other left at the flat 0.55 the app used to hand everybody, and see who wins.

import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { strategyRead, runEdge } from '../src/engine/strategy.js';
import { composites } from '../src/engine/ratings.js';

registerPlayers(PLAYERS_BY_ID);

function realRosters(seeds) {
  const out = [];
  for (const seed of seeds) {
    const lg = createLeague({ name: 'V', user: { name: 'Me', abbr: 'ME', color: '#fff' }, numTeams: 8, seed, draftType: 'snake' });
    autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
    startSeason(lg, PLAYERS_BY_ID);
    for (let i = 0; i < lg.teams.length; i++) out.push({ lg, i, read: strategyRead(lg, i, PLAYERS_BY_ID) });
  }
  return out;
}

function cloneTeam(team) {
  const byId = new Map();
  const slots = {};
  for (const s of ROSTER_SLOTS) {
    const id = team.slots[s.id];
    if (!id) continue;
    const p = PLAYERS_BY_ID.get(id);
    if (!p) continue;
    const twin = { ...p, id: `c-${p.id}`, r: { ...p.r } };
    byId.set(twin.id, twin);
    slots[s.id] = twin.id;
  }
  return { id: 'clone', name: 'Clone', abbr: 'CLN', color: '#888', slots, byId };
}

const rosters = realRosters([41, 42, 43, 44]);
const edges = rosters.map((r) => r.read.edge);
edges.sort((a, b) => a - b);
console.log(`\n${rosters.length} real drafted clubs. Run edge spread: ${edges[0].toFixed(1)} to ${edges[edges.length - 1].toFixed(1)}, median ${edges[Math.floor(edges.length / 2)].toFixed(1)}`);
const tilted = rosters.filter((r) => !r.read.even).length;
console.log(`${tilted} of ${rosters.length} are tilted enough for the read to suggest moving the dial.`);

let sum = 0, sumSq = 0, n = 0, wins = 0;
const GAMES = Math.max(40, Math.round(N / 8));
for (const { lg, i, read } of rosters) {
  const team = lg.teams[i];
  const twin = cloneTeam(team);
  if (Object.keys(twin.slots).length < 20) continue;
  const mine = { ...team, byId: PLAYERS_BY_ID };
  for (let gi = 0; gi < GAMES; gi++) {
    const seed = 7700 + gi;
    const aHome = gi % 2 === 0;
    const mk = (t, byId, pr) => ({ ...t, lineup: buildLineup(t.slots, byId), isUser: true,
      strategy: { passRate: pr, aggression: 0.4, tempo: 0.5, blitzRate: 0.25, deepShell: 0.2 } });
    const A = mk(mine, PLAYERS_BY_ID, read.rate);       // follows the read
    const B = mk(twin, twin.byId, 0.55);                // the old flat default
    const g = createGame(aHome ? A : B, aHome ? B : A, { seed, homeAdvantage: false });
    simulateGame(g);
    const m = aHome ? g.score[0] - g.score[1] : g.score[1] - g.score[0];
    sum += m; sumSq += m * m; n++;
    if (m > 0) wins++;
  }
}
const mean = sum / n;
const se = Math.sqrt(Math.max(0, sumSq / n - mean * mean) / n);
console.log(`Following the read vs a flat 0.55, ${n} games: ${(mean >= 0 ? '+' : '') + mean.toFixed(2)} ± ${se.toFixed(2)} points, ${(wins / n * 100).toFixed(1)}% wins`);
console.log(Math.abs(mean) > 2 * se ? (mean > 0 ? 'The read is worth following.' : 'The read is WRONG — it loses.') : 'Not separable from zero.');
