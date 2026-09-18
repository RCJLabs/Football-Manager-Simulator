// Validates src/data/players.js against the schema in src/data/positions.js.
// Usage: node scripts/validate-players.mjs
import { POSITIONS, SLOT_COUNTS } from '../src/data/positions.js';

const MIN_PER_POS = { QB: 28, RB: 34, WR: 44, TE: 18, OL: 48, DL: 44, LB: 34, CB: 28, S: 24, K: 10, P: 8 };

export function validatePlayers(PLAYERS) {
const errors = [];
const ids = new Set();
const counts = {};
const eras = {};

if (!Array.isArray(PLAYERS)) errors.push('PLAYERS is not an array');

for (const [i, p] of PLAYERS.entries()) {
  const where = `#${i} ${p && p.name}`;
  if (!p || typeof p !== 'object') { errors.push(`${where}: not an object`); continue; }
  if (typeof p.id !== 'string' || !/^[a-z0-9-]+-\d{4}$/.test(p.id)) errors.push(`${where}: bad id "${p.id}" (expected slug-YYYY)`);
  if (ids.has(p.id)) errors.push(`${where}: duplicate id ${p.id}`);
  ids.add(p.id);
  if (typeof p.name !== 'string' || p.name.length < 3) errors.push(`${where}: bad name`);
  const def = POSITIONS[p.pos];
  if (!def) { errors.push(`${where}: unknown pos ${p.pos}`); continue; }
  if (!Number.isInteger(p.season) || p.season < 1920 || p.season > 2026) errors.push(`${where}: bad season ${p.season}`);
  if (typeof p.team !== 'string' || !/^[A-Z]{2,4}$/.test(p.team)) errors.push(`${where}: bad team "${p.team}"`);
  if (!p.r || typeof p.r !== 'object') { errors.push(`${where}: missing ratings`); continue; }
  const keys = Object.keys(p.r).sort();
  const want = [...def.attrs].sort();
  if (keys.join() !== want.join()) errors.push(`${where}: ratings keys [${keys}] != expected [${want}]`);
  for (const [k, v] of Object.entries(p.r)) {
    if (!Number.isInteger(v) || v < 40 || v > 99) errors.push(`${where}: rating ${k}=${v} out of 40..99`);
  }
  counts[p.pos] = (counts[p.pos] || 0) + 1;
  const era = `${Math.floor(p.season / 10) * 10}s`;
  eras[era] = (eras[era] || 0) + 1;
}

for (const [pos, min] of Object.entries(MIN_PER_POS)) {
  if ((counts[pos] || 0) < min) errors.push(`position ${pos}: only ${counts[pos] || 0}, need at least ${min}`);
}
const teams8 = Object.fromEntries(Object.entries(SLOT_COUNTS).map(([k, v]) => [k, v * 8]));
for (const [pos, need] of Object.entries(teams8)) {
  if ((counts[pos] || 0) < need) errors.push(`position ${pos}: ${counts[pos] || 0} < ${need} needed for an 8-team league`);
}

return { errors, counts, eras };
}

if (process.argv[1] && process.argv[1].endsWith('validate-players.mjs')) {
  const { PLAYERS } = await import('../src/data/players.js');
  const { errors, counts, eras } = validatePlayers(PLAYERS);
  console.log('players:', PLAYERS.length);
  console.log('by position:', counts);
  console.log('by era:', Object.fromEntries(Object.entries(eras).sort()));
  if (errors.length) {
    console.error(`\n${errors.length} error(s):`);
    for (const e of errors.slice(0, 80)) console.error(' -', e);
    if (errors.length > 80) console.error(` ... and ${errors.length - 80} more`);
    process.exit(1);
  }
  console.log('OK');
}
