// A fingerprint of what the simulation actually does, for refactoring it safely.
//
//   node scripts/game-fingerprint.mjs > before.txt
//   ...restructure...
//   node scripts/game-fingerprint.mjs > after.txt && diff before.txt after.txt
//
// The engine is seeded, so the same rosters and the same seed must produce the
// same game down to the last word of play-by-play. That makes a hash of the
// whole output a far stronger check than any test suite: a test asserts the
// properties somebody thought to assert, and this asserts everything.
//
// It covers the paths that diverge — overtime, penalties on and off, every
// injury setting, coach-mode calls, both league modes — because a refactor that
// is correct on the common path and wrong on a rare one is the usual way this
// goes wrong.

import { createHash } from 'node:crypto';
import { syntheticTeam } from './synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, simulateGame, step, decisionNeeded } from '../src/engine/game.js';
import { OFFENSE_CALLS, DEFENSE_CALLS } from '../src/engine/playcall.js';
import { RNG } from '../src/engine/rng.js';

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** Everything a finished game knows, flattened to text. */
function dump(g) {
  const out = [];
  out.push(`score ${g.score.join('-')} q${g.quarter} clock${g.clock} phase:${g.phase}`);
  for (const e of g.log || []) {
    out.push(`  [${e.q}|${e.clock}|${e.situation || ''}] ${e.text} wp=${e.wp == null ? '-' : e.wp.toFixed(4)}`);
  }
  for (const [side, st] of (g.stats || []).entries()) {
    const t = st.team;
    out.push(`  team${side} ${Object.keys(t).sort().map((k) => `${k}=${t[k]}`).join(' ')}`);
    for (const pid of Object.keys(st.players).sort()) {
      out.push(`  p${side}:${pid} ${JSON.stringify(st.players[pid])}`);
    }
  }
  for (const [side, t] of g.teams.entries()) {
    out.push(`  inj${side} ${JSON.stringify(t.injuries || [])}`);
  }
  for (const d of g.drives || []) out.push(`  drive ${JSON.stringify(d)}`);
  return out.join('\n');
}

/** A pair of synthetic sides, optionally lopsided so blowouts happen too. */
function pair(seed, meanA, meanB) {
  const a = syntheticTeam('alpha', meanA, 4, seed);
  const b = syntheticTeam('bravo', meanB, 4, seed + 500);
  return [
    { ...a, lineup: buildLineup(a.slots, a.byId) },
    { ...b, lineup: buildLineup(b.slots, b.byId) },
  ];
}

const cases = [];

// The common path, across a spread of roster gaps so scores vary widely.
for (const [meanA, meanB] of [[82, 82], [90, 70], [70, 90], [86, 84], [95, 60]]) {
  for (let i = 0; i < 24; i++) {
    cases.push({ name: `plain ${meanA}v${meanB} #${i}`, seed: 4000 + i, meanA, meanB, opts: {} });
  }
}

// The paths that diverge: no penalties, every injury rate, neutral site,
// playoff rules. Overtime turns up on its own across enough even matchups.
for (let i = 0; i < 20; i++) {
  cases.push({ name: `nopen #${i}`, seed: 7000 + i, meanA: 84, meanB: 84, opts: { penalties: false } });
  cases.push({ name: `hurt #${i}`, seed: 7100 + i, meanA: 84, meanB: 84, opts: { injuryLevel: 2.5 } });
  cases.push({ name: `neutral #${i}`, seed: 7200 + i, meanA: 84, meanB: 84, opts: { homeAdvantage: false } });
  cases.push({ name: `playoff #${i}`, seed: 7300 + i, meanA: 85, meanB: 83, opts: { playoff: true } });
  cases.push({ name: `chem #${i}`, seed: 7400 + i, meanA: 84, meanB: 84, opts: { chem: [1.5, -1.2] } });
}

const parts = [];
let overtimes = 0, plays = 0;
for (const c of cases) {
  const [home, away] = pair(c.seed, c.meanA, c.meanB);
  const g = createGame(home, away, { seed: c.seed, ...c.opts });
  simulateGame(g);
  if (g.quarter >= 5) overtimes++;
  plays += (g.log || []).length;
  parts.push(`== ${c.name}\n${dump(g)}`);
}

// Coach mode: the human supplies calls, which walks a different branch through
// step() than the AI path does.
for (let i = 0; i < 12; i++) {
  const [home, away] = pair(8000 + i, 84, 84);
  const g = createGame(home, away, { seed: 8000 + i });
  const rng = new RNG(999 + i);
  const offCalls = Object.keys(OFFENSE_CALLS).filter((k) => !['fg', 'punt', 'kneel', 'spike'].includes(k));
  const defCalls = Object.keys(DEFENSE_CALLS);
  let guard = 0;
  while (g.phase !== 'final' && guard++ < 4000) {
    const calls = {};
    if (decisionNeeded(g, 0, true)) {
      calls.offense = offCalls[rng.int(0, offCalls.length - 1)];
      calls.defense = defCalls[rng.int(0, defCalls.length - 1)];
    }
    step(g, calls);
  }
  plays += (g.log || []).length;
  parts.push(`== coach #${i}\n${dump(g)}`);
}

const body = parts.join('\n');
console.log(`games: ${cases.length + 12}`);
console.log(`overtimes: ${overtimes}`);
console.log(`log lines: ${plays}`);
console.log(`fingerprint: ${hash(body)}`);
for (const p of parts) console.log(`${p.split('\n')[0]} ${hash(p)}`);
