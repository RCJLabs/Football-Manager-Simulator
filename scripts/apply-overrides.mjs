// Bake a rating-edits file (exported from the app's settings screen) into
// src/data/players.js. Dry run by default: prints every change. Add --write
// to rewrite the data file, then run `npm run validate`.
// Usage: node scripts/apply-overrides.mjs <edits.json> [--write]
import { readFileSync, writeFileSync } from 'node:fs';
import { RAW, slugify, PLAYERS } from '../src/data/players.js';
import { POSITIONS } from '../src/data/positions.js';
import { poolFingerprint } from '../src/engine/share.js';

const ORDER = ['QB', 'RB', 'WR', 'TE', 'OL', 'DL', 'LB', 'CB', 'S', 'K', 'P'];
const file = process.argv[2];
const write = process.argv.includes('--write');
if (!file) { console.error('usage: node scripts/apply-overrides.mjs <edits.json> [--write]'); process.exit(1); }

/** Apply a changes list to a copy of RAW; returns { rows, applied, problems }. */
export function mergeOverrides(raw, edits) {
  const rows = Object.fromEntries(ORDER.map((pos) => [pos, (raw[pos] || []).map((r) => r.slice())]));
  const applied = [], problems = [];
  for (const ch of edits.changes || []) {
    const pos = ch.pos;
    if (!POSITIONS[pos]) { problems.push(`${ch.id}: unknown position ${pos}`); continue; }
    const row = rows[pos].find((r) => `${slugify(r[0])}-${r[1]}` === ch.id);
    if (!row) { problems.push(`${ch.id}: not in the pool`); continue; }
    for (const [attr, value] of Object.entries(ch.to || {})) {
      const i = POSITIONS[pos].attrs.indexOf(attr);
      if (i < 0) { problems.push(`${ch.id}: no attribute ${attr} at ${pos}`); continue; }
      const v = Math.round(Number(value));
      if (!(v >= 40 && v <= 99)) { problems.push(`${ch.id}: ${attr}=${value} out of 40..99`); continue; }
      applied.push({ id: ch.id, name: row[0], attr, from: row[3 + i], to: v });
      row[3 + i] = v;
    }
  }
  return { rows, applied, problems };
}

const edits = JSON.parse(readFileSync(file, 'utf8'));
const fp = poolFingerprint(PLAYERS);
if (edits.pool && edits.pool !== fp) console.warn(`warning: edits were made against pool ${edits.pool}, this pool is ${fp}; ids are matched by name and season anyway`);
const { rows, applied, problems } = mergeOverrides(RAW, edits);
for (const a of applied) console.log(`${a.name} (${a.id}): ${a.attr} ${a.from} -> ${a.to}`);
for (const p of problems) console.error('problem:', p);
console.log(`${applied.length} change(s)${write ? '' : ' (dry run; add --write to apply)'}`);
if (write && applied.length) {
  const src = readFileSync(new URL('../src/data/players.js', import.meta.url), 'utf8');
  const head = src.slice(0, src.indexOf('export const RAW = {'));
  const tail = src.slice(src.indexOf('\n};\n') + 1);
  const q = (name) => (name.includes("'") ? JSON.stringify(name) : `'${name}'`);
  let body = 'export const RAW = {\n';
  for (const pos of ORDER) {
    body += `  // ---- ${pos}: ${POSITIONS[pos].attrs.join(', ')} ----\n  ${pos}: [\n`;
    for (const r of rows[pos]) body += `    [${q(r[0])}, ${r[1]}, '${r[2]}', ${r.slice(3).join(', ')}],\n`;
    body += '  ],\n';
  }
  writeFileSync(new URL('../src/data/players.js', import.meta.url), head + body + tail);
  console.log('written; run npm run validate');
}
