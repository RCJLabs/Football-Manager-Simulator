// Measure what the ageing curves actually do, so the constants in careers.js
// are tuned against numbers rather than against a feeling.
//
//   node scripts/career-sim.mjs
//
// Prints three things: what a player signed at his prime looks like over the
// following decade, what a rookie class looks like after four seasons of
// development, and how long careers run before retirement.

import { PLAYERS } from '../src/data/players.js';
import { overall } from '../src/engine/ratings.js';
import { startCareer, developed, stepCareer, PRIME_AGE, RETIRE_OVERALL } from '../src/engine/careers.js';
import { generateRookies } from '../src/engine/rookies.js';
import { RNG, hashSeed } from '../src/engine/rng.js';

/**
 * Run one player's whole career through the engine's own step function, so this
 * harness cannot drift away from what the game actually does.
 */
function runCareer(p, seedTag) {
  const league = { seed: hashSeed(seedTag) };
  const c = startCareer(league, p);
  const track = [];
  let cur = c;
  for (let yr = 0; yr < 25; yr++) {
    const ovr = overall(developed(p, cur));
    track.push({ age: cur.age, ovr });
    if (cur.age >= cur.retireAt || ovr < RETIRE_OVERALL) break;
    cur = stepCareer(league, p, cur, yr).career;
  }
  return { track, growth: c.growth, entryAge: c.age, retireAt: c.retireAt, ceiling: c.ceiling };
}

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const pct = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

// ---- 1. Real players signed at their prime ----
console.log('=== Signed at his prime: overall after N more seasons ===');
console.log('(the pool\'s top 200, one career each)');
const top = PLAYERS.slice().sort((a, b) => overall(b) - overall(a)).slice(0, 200);
const byYear = {};
const lengths = [];
for (const p of top) {
  const { track } = runCareer(p, `prime:${p.id}`);
  lengths.push(track.length - 1);
  track.forEach((t, i) => { (byYear[i] ??= []).push(t.ovr - track[0].ovr); });
}
for (const yr of [1, 2, 3, 5, 7, 10]) {
  const a = byYear[yr];
  if (!a) continue;
  console.log(`  +${yr} season${yr === 1 ? ' ' : 's'}: ${mean(a) >= 0 ? '+' : ''}${mean(a).toFixed(1)} overall  (survivors ${a.length}/${top.length})`);
}
console.log(`  career length: median ${pct(lengths, 0.5)} seasons, range ${Math.min(...lengths)}-${Math.max(...lengths)}`);

// ---- 2. Rookie development ----
console.log('\n=== Rookie classes: overall at entry and at peak ===');
const rookieLeague = { seed: 777, season: 1, teams: new Array(12).fill(0), rookies: [] };
const rng = new RNG(999);
const klass = generateRookies(rookieLeague, rng, { size: 600, season: 1 });
const entries = [], peaks = [], gains = [];
for (const p of klass) {
  const { track } = runCareer(p, `rk:${p.id}`);
  const peak = Math.max(...track.map((t) => t.ovr));
  entries.push(track[0].ovr); peaks.push(peak); gains.push(peak - track[0].ovr);
}
console.log(`  entry: median ${pct(entries, 0.5)}, 90th ${pct(entries, 0.9)}`);
console.log(`  peak:  median ${pct(peaks, 0.5)}, 90th ${pct(peaks, 0.9)}, 99th ${pct(peaks, 0.99)}, best ${Math.max(...peaks)}`);
console.log(`  gain:  median +${pct(gains, 0.5)}, 10th +${pct(gains, 0.1)}, 90th +${pct(gains, 0.9)}`);
console.log(`  share of a class that peaks at 80+: ${(peaks.filter((x) => x >= 80).length * 100 / peaks.length).toFixed(1)}%`);
console.log(`  share that peaks at 88+ (a real starter anywhere): ${(peaks.filter((x) => x >= 88).length * 100 / peaks.length).toFixed(1)}%`);
console.log(`  share that never gains 5: ${(gains.filter((x) => x < 5).length * 100 / gains.length).toFixed(1)}%`);
console.log(`  best generated player in 600 rookies: ${Math.max(...peaks)} overall`);

// ---- 3. Peak age by position ----
console.log('\n=== Where each position peaks ===');
for (const pos of Object.keys(PRIME_AGE)) {
  const sample = PLAYERS.filter((p) => p.pos === pos).slice(0, 25);
  if (!sample.length) continue;
  const peakAges = sample.map((p) => { const { track } = runCareer(p, `pk:${p.id}`); return track.reduce((b, t) => (t.ovr > b.ovr ? t : b)).age; });
  console.log(`  ${pos.padEnd(3)} prime ${String(PRIME_AGE[pos]).padStart(2)}  measured peak age ${mean(peakAges).toFixed(1)}`);
}
