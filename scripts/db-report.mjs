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

// Era balance: count, mean overall and share of the top 100, per era.
const top = PLAYERS.slice().sort((a, b) => overall(b) - overall(a)).slice(0, 100);
const topEra = {};
for (const p of top) { const e = `${Math.floor(p.season / 10) * 10}s`; topEra[e] = (topEra[e] || 0) + 1; }
const byEra = {};
for (const p of PLAYERS) (byEra[`${Math.floor(p.season / 10) * 10}s`] ??= []).push(overall(p));
console.log('\nera balance (count / mean overall / in the top 100 / per position):');
for (const e of Object.keys(byEra).sort()) {
  const a = byEra[e];
  const perPos = POSITION_ORDER.map((pos) => `${pos} ${PLAYERS.filter((p) => p.pos === pos && `${Math.floor(p.season / 10) * 10}s` === e).length}`).join(' ');
  console.log(`  ${e}: ${String(a.length).padStart(3)} / ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)} / ${String(topEra[e] || 0).padStart(2)} / ${perPos}`);
}
