// One-off tool: widen each position's rating distribution so the top stays put
// and the weakest entries land near 75 overall. Protects each player's best
// attribute (half the drop). Rewrites src/data/players.js in place.
// Usage: node scripts/stretch-ratings.mjs [targetMin=75]
import { readFileSync, writeFileSync } from 'node:fs';
import { RAW } from '../src/data/players.js';
import { POSITIONS } from '../src/data/positions.js';

const TARGET_MIN = Number(process.argv[2] || 75);
const ORDER = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P'];
const ovr = (pos, vals) => POSITIONS[pos].attrs.reduce((s, a, i) => s + vals[i] * POSITIONS[pos].weights[a], 0);

const out = {};
for (const pos of ORDER) {
  const rows = RAW[pos].map((r) => ({ name: r[0], season: r[1], team: r[2], vals: r.slice(3) }));
  rows.sort((a, b) => ovr(pos, b.vals) - ovr(pos, a.vals));
  const minNow = ovr(pos, rows[rows.length - 1].vals);
  const maxDrop = Math.min(pos === 'K' || pos === 'P' ? 10 : 16, Math.max(6, Math.round(minNow - TARGET_MIN)));
  const n = rows.length;
  out[pos] = rows.map((r, i) => {
    const q = n > 1 ? i / (n - 1) : 0;
    const d = Math.round(Math.pow(q, 1.5) * maxDrop);
    const best = r.vals.indexOf(Math.max(...r.vals));
    const vals = r.vals.map((v, j) => Math.max(40, Math.min(99, v - (j === best ? Math.ceil(d / 2) : d))));
    return { ...r, vals };
  });
  console.log(`${pos}: min ${minNow.toFixed(1)} -> ${ovr(pos, out[pos][n - 1].vals).toFixed(1)}, median ${ovr(pos, rows[Math.floor(n / 2)].vals).toFixed(1)} -> ${ovr(pos, out[pos][Math.floor(n / 2)].vals).toFixed(1)} (maxDrop ${maxDrop})`);
}

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
console.log('rewrote src/data/players.js');
