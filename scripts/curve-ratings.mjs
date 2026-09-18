// Reshape each position's rating distribution onto a realistic talent curve.
//
// A hand-written pool bunches at the top: notable players are the ones you
// remember, so the 700th entry still rated an 83 and every draft pick was good.
// This maps rank within position onto a target overall, then shifts a player's
// attributes by that delta. Shifting rather than scaling keeps each player's own
// shape intact, so a corner who cannot tackle still cannot tackle.
//
// Ordering never changes, only spacing. Usage:
//   node scripts/curve-ratings.mjs [--apply] [exponent]
import { readFileSync, writeFileSync } from 'node:fs';
import { RAW } from '../src/data/players.js';
import { POSITIONS } from '../src/data/positions.js';

const ORDER = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P'];
const APPLY = process.argv.includes('--apply');
const K = Number(process.argv.find((a) => /^[\d.]+$/.test(a)) || 1.1);

// Where the worst player at each position lands. Specialists stay functional;
// a replacement-level quarterback really is that bad.
const FLOOR = { QB: 52, RB: 58, WR: 58, TE: 58, OL: 58, DL: 58, LB: 58, CB: 58, S: 58, K: 62, P: 64 };

const ovr = (pos, vals) => POSITIONS[pos].attrs.reduce((s, a, i) => s + vals[i] * POSITIONS[pos].weights[a], 0);

const out = {};
for (const pos of ORDER) {
  const rows = RAW[pos].map((r) => ({ name: r[0], season: r[1], team: r[2], vals: r.slice(3) }));
  rows.sort((a, b) => ovr(pos, b.vals) - ovr(pos, a.vals));
  const top = ovr(pos, rows[0].vals);
  const floor = FLOOR[pos];
  const n = rows.length;
  out[pos] = rows.map((r, i) => {
    const q = n > 1 ? i / (n - 1) : 0;
    const target = top - (top - floor) * Math.pow(q, K);
    // Only ever shift down. Rounding a positive delta would lift a second-ranked
    // player past the one above him, which reorders the top of the position.
    const delta = Math.min(0, Math.round(target - ovr(pos, r.vals)));
    const vals = r.vals.map((v) => Math.max(40, Math.min(99, v + delta)));
    return { ...r, vals };
  });
  const o = out[pos].map((r) => Math.round(ovr(pos, r.vals)));
  const at = (f) => o[Math.min(n - 1, Math.floor(n * f))];
  console.log(`${pos.padEnd(3)} ${String(n).padStart(4)}  top ${o[0]}  p25 ${at(0.25)}  median ${at(0.5)}  p75 ${at(0.75)}  min ${o[n - 1]}`);
}

if (!APPLY) { console.log('\ndry run — pass --apply to write the file'); process.exit(0); }

const src = readFileSync(new URL('../src/data/players.js', import.meta.url), 'utf8');
const head = src.slice(0, src.indexOf('export const RAW = {'));
const tail = src.slice(src.indexOf('\n};\n') + 1);
const q = (name) => (name.includes("'") ? JSON.stringify(name) : `'${name}'`);
let body = 'export const RAW = {\n';
for (const pos of ORDER) {
  body += `  // ---- ${pos}: ${POSITIONS[pos].attrs.join(', ')} ----\n  ${pos}: [\n`;
  for (const r of out[pos]) body += `    [${q(r.name)}, ${r.season}, '${r.team}', ${r.vals.join(', ')}],\n`;
  body += '  ],\n';
}
writeFileSync(new URL('../src/data/players.js', import.meta.url), head + body + tail);
console.log('\nrewrote src/data/players.js');
