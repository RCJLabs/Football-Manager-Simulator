// Quick human-readable report on the player pool: top players per position, era mix, name duplicates.
import { PLAYERS } from '../src/data/players.js';
import { POSITION_ORDER } from '../src/data/positions.js';
import { overall } from '../src/engine/ratings.js';

const byPos = {};
for (const p of PLAYERS) (byPos[p.pos] ??= []).push(p);
for (const pos of POSITION_ORDER) {
  const arr = (byPos[pos] || []).sort((a, b) => overall(b) - overall(a));
  const ovrs = arr.map(overall);
  console.log(`\n${pos} (${arr.length}) top ${ovrs[0]} / p25 ${ovrs[Math.floor(arr.length * 0.25)]} / median ${ovrs[Math.floor(arr.length / 2)]} / min ${ovrs.at(-1)}`);
  console.log('  top: ' + arr.slice(0, 8).map((p) => `${p.name} '${String(p.season).slice(2)} ${overall(p)}`).join(', '));
  console.log('  bottom: ' + arr.slice(-4).map((p) => `${p.name} '${String(p.season).slice(2)} ${overall(p)}`).join(', '));
}
const names = {};
for (const p of PLAYERS) (names[p.name] ??= []).push(p.season);
const dups = Object.entries(names).filter(([, v]) => v.length > 1);
console.log('\nmulti-season players:', dups.map(([n, v]) => `${n} (${v.join('/')})`).join(', ') || 'none');
const eras = {};
for (const p of PLAYERS) eras[`${Math.floor(p.season / 10) * 10}s`] = (eras[`${Math.floor(p.season / 10) * 10}s`] || 0) + 1;
console.log('eras:', Object.entries(eras).sort().map(([k, v]) => `${k}:${v}`).join(' '));
