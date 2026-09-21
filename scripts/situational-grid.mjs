#!/usr/bin/env node
/**
 * The call grid, one situation at a time.
 *
 *   node scripts/situational-grid.mjs [snapsPerCell]
 *
 * `call-grid.mjs` measures first and ten and nothing else, and solving that one
 * situation says the blitz and the stacked box are never worth calling. That is
 * a claim about first down, not about the playbook: a stacked box is a 3rd & 1
 * call and a blitz is a 3rd & 8 call, and neither shows up where it does not
 * belong. This measures the situations where they should.
 *
 * The payoff changes with the situation, because what a play is worth does.
 * On first and second down it is yards, less a turnover priced at forty of
 * them (a giveaway costs about four points and four points is about forty
 * yards). On third down yards barely matter — converting does — so the payoff
 * is the conversion rate, less a turnover priced in conversions: failing a
 * third down means punting, turning it over means handing back the same field
 * without the punt, which is worth about 0.8 of a conversion.
 *
 * Both prices are assumptions. Each table prints the raw metric beside the
 * adjusted one so it is visible how much the answer leans on them.
 */
import { syntheticTeam } from './synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, step } from '../src/engine/game.js';
import { CALL_GRID, DEFENSE_CALLS } from '../src/engine/playcall.js';

const N = Number(process.argv[2] || 2500);
const TURNOVER_YDS = 40;
const TURNOVER_CONV = 0.8;
const OFF = Object.keys(CALL_GRID);
const DEF = Object.keys(DEFENSE_CALLS);
const A = syntheticTeam('alpha', 84, 3, 1);
const B = syntheticTeam('bravo', 84, 3, 2);
const LA = buildLineup(A.slots, A.byId);
const LB = buildLineup(B.slots, B.byId);

const SITUATIONS = [
  { name: '1st & 10, own 25', down: 1, toGo: 10, ballOn: 25, metric: 'yards' },
  { name: '2nd & 7, own 35', down: 2, toGo: 7, ballOn: 35, metric: 'yards' },
  { name: '3rd & 1, midfield', down: 3, toGo: 1, ballOn: 50, metric: 'convert' },
  { name: '3rd & 3, midfield', down: 3, toGo: 3, ballOn: 50, metric: 'convert' },
  { name: '3rd & 7, midfield', down: 3, toGo: 7, ballOn: 50, metric: 'convert' },
  { name: '3rd & 12, midfield', down: 3, toGo: 12, ballOn: 50, metric: 'convert' },
  { name: '1st & goal, the 6', down: 1, toGo: 6, ballOn: 94, metric: 'yards' },
];

function measure(off, def, sit) {
  const g = createGame({ ...A, lineup: LA }, { ...B, lineup: LB }, { seed: 4242, penalties: false, homeAdvantage: false });
  step(g);
  let yards = 0, plays = 0, got = 0, turnovers = 0;
  while (plays < N && !g.final) {
    g.quarter = 1; g.clock = 900; g.phase = 'play'; g.possession = 0;
    g.down = sit.down; g.toGo = sit.toGo; g.ballOn = sit.ballOn;
    g.score = [0, 0]; g.clockRunning = false; g.drive = null;
    const from = g.log.length;
    step(g, { off, def });
    const e = g.log.slice(from).find((x) => x.from != null);
    if (!e) continue;
    plays++;
    const y = e.yards || 0;
    const lost = e.type === 'int' || e.type === 'fumble';
    yards += y;
    if (lost) turnovers++;
    else if (y >= sit.toGo) got++;
  }
  const to = turnovers / plays;
  return sit.metric === 'yards'
    ? { raw: yards / plays, adj: yards / plays - to * TURNOVER_YDS, to }
    : { raw: got / plays, adj: got / plays - to * TURNOVER_CONV, to };
}

/** Fictitious play: each side keeps answering the other's history until it settles. */
function solve(M, iters = 200000) {
  const oc = OFF.map(() => 0), dc = DEF.map(() => 0);
  const op = OFF.map(() => 0), dp = DEF.map(() => 0);
  for (let t = 0; t < iters; t++) {
    let bo = 0; for (let i = 1; i < OFF.length; i++) if (op[i] > op[bo]) bo = i;
    let bd = 0; for (let j = 1; j < DEF.length; j++) if (dp[j] < dp[bd]) bd = j;
    oc[bo]++; dc[bd]++;
    for (let i = 0; i < OFF.length; i++) op[i] += M[i][bd];
    for (let j = 0; j < DEF.length; j++) dp[j] += M[bo][j];
  }
  const om = oc.map((c) => c / iters), dm = dc.map((c) => c / iters);
  let v = 0;
  for (let i = 0; i < OFF.length; i++) for (let j = 0; j < DEF.length; j++) v += om[i] * dm[j] * M[i][j];
  return { om, dm, v };
}

const pct = (x) => `${(x * 100).toFixed(0)}%`;
const liveIn = Object.fromEntries(DEF.map((d) => [d, []]));

console.log(`${N} snaps a cell, neutral site, penalties off, the offence pinned\n`);
for (const sit of SITUATIONS) {
  const cells = {};
  for (const o of OFF) { cells[o] = []; for (const d of DEF) cells[o].push(measure(o, d, sit)); }
  const fmt = (m) => (sit.metric === 'yards' ? m.raw.toFixed(2) : pct(m.raw)).padStart(10);
  console.log(`--- ${sit.name} — ${sit.metric === 'yards' ? 'yards a play' : 'conversion rate'} ---`);
  console.log('call'.padEnd(12) + DEF.map((d) => d.padStart(10)).join(''));
  for (const o of OFF) console.log(o.padEnd(12) + cells[o].map(fmt).join(''));
  const { om, dm, v } = solve(OFF.map((o) => cells[o].map((m) => m.adj)));
  DEF.forEach((d, j) => { if (dm[j] >= 0.05) liveIn[d].push(sit.name); });
  console.log('  defence  ' + DEF.map((d, j) => `${d} ${pct(dm[j])}`).join(', '));
  console.log('  offence  ' + OFF.map((o, i) => `${o} ${pct(om[i])}`).filter((x) => !x.endsWith(' 0%')).join(', '));
  console.log(`  worth    ${sit.metric === 'yards' ? `${v.toFixed(2)} yards` : pct(v)} a play, turnovers priced in\n`);
}

console.log('Where each defensive call earns its place (5% or more of the mix):');
for (const d of DEF) {
  console.log(`  ${d.padEnd(10)} ${liveIn[d].length ? liveIn[d].join('; ') : 'NOWHERE — it is a dead call'}`);
}
