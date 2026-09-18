// Merge new player rows into src/data/players.js.
// Usage: node scripts/add-players.mjs <additions.json>
// The JSON is { "QB": [["Name", season, "TEAM", ...ratings], ...], ... } using
// the same column order as the data file. Rows are merged in, each position is
// re-sorted by overall, and duplicates (same name + season) are rejected.
import { readFileSync, writeFileSync } from 'node:fs';
import { RAW, slugify } from '../src/data/players.js';
import { POSITIONS } from '../src/data/positions.js';

const ORDER = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P'];
const file = process.argv[2];
if (!file) { console.error('usage: node scripts/add-players.mjs <additions.json>'); process.exit(1); }
const additions = JSON.parse(readFileSync(file, 'utf8'));

const ovr = (pos, vals) => POSITIONS[pos].attrs.reduce((s, a, i) => s + vals[i] * POSITIONS[pos].weights[a], 0);

const seen = new Set();
for (const pos of ORDER) for (const r of RAW[pos]) seen.add(`${slugify(r[0])}-${r[1]}`);

const merged = {};
const errors = [];
let added = 0;
for (const pos of ORDER) {
  const rows = (RAW[pos] || []).slice();
  for (const r of additions[pos] || []) {
    const [name, season, team, ...vals] = r;
    const id = `${slugify(name)}-${season}`;
    const want = POSITIONS[pos].attrs.length;
    if (seen.has(id)) { errors.push(`duplicate ${pos} ${name} ${season}`); continue; }
    if (vals.length !== want) { errors.push(`${pos} ${name}: ${vals.length} ratings, expected ${want} (${POSITIONS[pos].attrs.join(',')})`); continue; }
    if (!vals.every((v) => Number.isInteger(v) && v >= 40 && v <= 99)) { errors.push(`${pos} ${name}: ratings out of 40..99`); continue; }
    if (!Number.isInteger(season) || season < 1930 || season > 2026) { errors.push(`${pos} ${name}: bad season ${season}`); continue; }
    if (!/^[A-Z]{2,4}$/.test(team)) { errors.push(`${pos} ${name}: bad team "${team}"`); continue; }
    seen.add(id);
    rows.push([name, season, team, ...vals]);
    added++;
  }
  rows.sort((a, b) => ovr(pos, b.slice(3)) - ovr(pos, a.slice(3)));
  merged[pos] = rows;
}
if (errors.length) {
  console.error(`${errors.length} problem(s):`);
  for (const e of errors.slice(0, 40)) console.error(' -', e);
  process.exit(1);
}

const src = readFileSync(new URL('../src/data/players.js', import.meta.url), 'utf8');
const head = src.slice(0, src.indexOf('export const RAW = {'));
const tail = src.slice(src.indexOf('\n};\n') + 1);
const q = (name) => (name.includes("'") ? JSON.stringify(name) : `'${name}'`);
let body = 'export const RAW = {\n';
for (const pos of ORDER) {
  body += `  // ---- ${pos}: ${POSITIONS[pos].attrs.join(', ')} ----\n  ${pos}: [\n`;
  for (const r of merged[pos]) body += `    [${q(r[0])}, ${r[1]}, '${r[2]}', ${r.slice(3).join(', ')}],\n`;
  body += '  ],\n';
}
writeFileSync(new URL('../src/data/players.js', import.meta.url), head + body + tail);
console.log(`added ${added} players`);
for (const pos of ORDER) {
  const o = merged[pos].map((r) => Math.round(ovr(pos, r.slice(3))));
  console.log(`  ${pos.padEnd(3)} ${String(merged[pos].length).padStart(3)}  top ${o[0]}  median ${o[Math.floor(o.length / 2)]}  min ${o[o.length - 1]}`);
}
