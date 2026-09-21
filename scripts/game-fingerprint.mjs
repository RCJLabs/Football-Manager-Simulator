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

/**
 * A pair of synthetic sides, optionally lopsided so blowouts happen too.
 *
 * `tag` is load-bearing and was not always here. `syntheticTeam` names its
 * players after the club, so every pair built as alpha/bravo produced the same
 * player ids — and `overall()` caches by id. The first pair's ratings were
 * therefore handed back for every pair after it, and `teamPower` reported a gap
 * of 0.1 for all five roster gaps below, the 95-against-60 blowout included.
 * Play outcomes were never affected, because those read the raw attributes
 * through `composites()`, but the win probability on every logged line comes
 * from `priorMargin`, so the one column that is supposed to reflect the
 * matchup reflected nothing. A distinct id per case fixes it; `abbr` and `name`
 * are put back afterwards so the play-by-play still reads ALP and BRA.
 *
 * `shape` makes a pair lopsided a second way, by position rather than by
 * overall mean. Every other case draws every position from one mean, so
 * reweighting `TRUE_LEVERAGE` moves both sides equally and the gap does not
 * move at all. Sides strong in different places make the leverage table reach
 * the output, so a change to it cannot pass this check unnoticed.
 */
function pair(seed, meanA, meanB, shape, tag = '') {
  const a = syntheticTeam(`alpha${tag}`, meanA, 4, seed, shape ? { posMeans: shape[0] } : {});
  const b = syntheticTeam(`bravo${tag}`, meanB, 4, seed + 500, shape ? { posMeans: shape[1] } : {});
  return [
    { ...a, id: 'alpha', name: 'Team alpha', abbr: 'ALP', lineup: buildLineup(a.slots, a.byId) },
    { ...b, id: 'bravo', name: 'Team bravo', abbr: 'BRA', lineup: buildLineup(b.slots, b.byId) },
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

// Sides built strong in different places, so the leverage weights reach the
// power gap. One club buys the quarterback and the other buys the backfield and
// the line; one splits the secondary against the receivers; one is the absurd
// case of a club that spent everything on specialists, which is where a
// mis-weighted kicker would show up.
const SHAPES = [
  [{ QB: 95, RB: 72, OL: 74, TE: 74 }, { QB: 72, RB: 95, OL: 93, TE: 92 }],
  [{ CB: 95, S: 93, DL: 72, LB: 74 }, { WR: 95, TE: 93, CB: 72, S: 74 }],
  [{ K: 97, P: 97, QB: 76, WR: 76 }, { QB: 92, WR: 90, K: 62, P: 62 }],
];
for (let s = 0; s < SHAPES.length; s++) {
  for (let i = 0; i < 8; i++) {
    cases.push({ name: `shape${s} #${i}`, seed: 9000 + s * 100 + i, meanA: 84, meanB: 84, shape: SHAPES[s], opts: {} });
  }
}

const parts = [];
let overtimes = 0, plays = 0;
for (const c of cases) {
  const [home, away] = pair(c.seed, c.meanA, c.meanB, c.shape, c.name.replace(/[^a-z0-9]/gi, ''));
  const g = createGame(home, away, { seed: c.seed, ...c.opts });
  simulateGame(g);
  if (g.quarter >= 5) overtimes++;
  plays += (g.log || []).length;
  parts.push(`== ${c.name}\n${dump(g)}`);
}

// Coach mode: the human supplies calls, which walks a different branch through
// step() than the AI path does.
for (let i = 0; i < 12; i++) {
  const [home, away] = pair(8000 + i, 84, 84, null, `coach${i}`);
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
