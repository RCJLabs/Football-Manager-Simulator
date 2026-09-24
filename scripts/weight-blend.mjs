// How far each position's weights can move toward the field before the record
// objects.
//
//   node scripts/attribute-leverage.mjs 40000 > attrs.txt
//   node scripts/weight-blend.mjs attrs.txt [more.txt ...]
//
// `overall` answers to two authorities (positions.js, and DESIGN.md "Two
// authorities, and where they disagree"): what the field rewards, which
// `attribute-leverage` measures, and what the record rewards, which
// `legacy-check` holds. The rule between them is that a position moves as far
// toward the measured vector as the record will allow: the largest blend that
// leaves `legacy-check` no worse at that position, with every attribute floored
// at 0.05 so nothing on screen is decoration.
//
// This walks the blend in eighths for every position in the readings it is
// given and prints, at each step, the vector, how far it still is from the
// measurement and who the record says it costs. It changes nothing; choosing a
// step is a judgement the output informs, because the rule has exceptions the
// table cannot see: a position with no free move at all may still go the whole
// way when the measurement is decisive and uncontentious (the corner, once),
// and may stay put when the measurement is decisive about this engine and
// contentious about football (the tight end).
//
// The edge vector keeps coverage at nothing rather than the floor: measured on
// a rusher, coverage is worth less than nothing, since it makes him rush less.
import { readFileSync } from 'node:fs';
import { POSITIONS } from '../src/data/positions.js';
import { clearOverallCache } from '../src/engine/ratings.js';
import { auditLegacy, TOLERANCE } from './legacy-check.mjs';

export const FLOOR = 0.05;
export const STEPS = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];

/** Readings from `attribute-leverage` output: { pos: { attr: { margin, se, sigma } } }. */
export function parseReadings(text, into = {}) {
  let pos = null;
  for (const line of text.split('\n')) {
    const h = /^((?:QB|RB|WR|TE|OL|DL|LB|CB|S|K|P)1?|EDGE)\s+\(/.exec(line);
    if (h) { pos = h[1]; into[pos] = {}; continue; }
    const r = /^\s+([a-z]{3})\s+(-?[\d.]+) ±([\d.]+)\s+(-?[\d.]+)/.exec(line);
    if (pos && r) into[pos][r[1]] = { margin: Number(r[2]), se: Number(r[3]), sigma: Number(r[4]) };
  }
  return into;
}

/** Shares of the position's leverage, negatives clamped to nothing. */
export function shares(readings) {
  const t = Object.values(readings).reduce((a, r) => a + Math.max(0, r.margin), 0) || 1;
  return Object.fromEntries(Object.entries(readings).map(([k, r]) => [k, Math.max(0, r.margin) / t]));
}

/**
 * A vector as it would ship: every attribute at least FLOOR except those named
 * in `exempt`, summing to one, in hundredths.
 */
export function tidy(v, exempt = []) {
  const keys = Object.keys(v);
  const w = { ...v };
  for (const k of exempt) w[k] = 0;
  for (let it = 0; it < 20; it++) {
    const low = keys.filter((k) => !exempt.includes(k) && w[k] < FLOOR);
    if (!low.length) break;
    const rest = keys.filter((k) => !exempt.includes(k) && !low.includes(k));
    const restSum = rest.reduce((a, k) => a + w[k], 0);
    for (const k of low) w[k] = FLOOR;
    for (const k of rest) w[k] = w[k] / restSum * (1 - low.length * FLOOR);
  }
  const total = keys.reduce((a, k) => a + w[k], 0);
  const r = Object.fromEntries(keys.map((k) => [k, Math.round(w[k] / total * 100) / 100]));
  const diff = Math.round((1 - Object.values(r).reduce((a, b) => a + b, 0)) * 100) / 100;
  if (diff) {
    const big = keys.reduce((a, b) => (r[a] >= r[b] ? a : b));
    r[big] = Math.round((r[big] + diff) * 100) / 100;
  }
  return r;
}

/** The record's objections at one position, as "name 'yy ovr/bar". */
export function objections(pos) {
  clearOverallCache();
  return auditLegacy().found
    .filter((x) => x.p.pos === pos && x.gap >= TOLERANCE)
    .map((x) => `${x.p.name} '${String(x.p.season).slice(2)} ${x.ovr}/${x.under ? x.floor : x.cap}`);
}

/**
 * Every point the position's recorded seasons sit below their floors, however
 * small. `legacy-check` reports a miss of three or more because on an editorial
 * scale two points on one man is noise; a reweight that moves a whole archetype
 * two points at once is not, and this is what shows it. Moving the edge vector
 * the whole way looked free by the three-point count and took Derrick Thomas,
 * Kevin Greene, DeMarcus Ware and Micah Parsons three to four points each.
 */
export function shortfall(pos) {
  clearOverallCache();
  const found = auditLegacy().found.filter((x) => x.p.pos === pos && x.under);
  return { men: found.length, points: found.reduce((t, x) => t + x.gap, 0) };
}

const l1 = (a, b) => Object.keys({ ...a, ...b }).reduce((s, k) => s + Math.abs((a[k] ?? 0) - (b[k] ?? 0)), 0);

if (process.argv[1] && process.argv[1].endsWith('weight-blend.mjs')) {
  const readings = {};
  for (const f of process.argv.slice(2)) parseReadings(readFileSync(f, 'utf8'), readings);
  if (!Object.keys(readings).length) {
    console.log('usage: node scripts/weight-blend.mjs <attribute-leverage output>...');
    process.exit(1);
  }
  for (const [key, rows] of Object.entries(readings)) {
    const pos = key === 'EDGE' ? 'LB' : key.replace(/1$/, '');
    const field = key === 'EDGE' ? 'edgeWeights' : 'weights';
    const exempt = key === 'EDGE' ? ['cov'] : [];
    const shipped = { ...POSITIONS[pos][field] };
    const m = shares(rows);
    const base = objections(pos);
    const short0 = shortfall(pos);
    const name = (s) => s.split(' \'')[0];
    console.log(`\n${key}  shipped ${JSON.stringify(shipped)}`);
    console.log(`  measured ${Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(3)} (${rows[k].sigma}σ)`).join(', ')}`);
    console.log(`  shipped is ${l1(shipped, m).toFixed(3)} from it; the record objects to ${base.length}${base.length ? `: ${base.join('; ')}` : ''}; ${short0.men} under a floor by ${short0.points} points in all`);
    for (const f of STEPS) {
      const cand = tidy(Object.fromEntries(Object.keys(shipped).map((k) => [k, (1 - f) * shipped[k] + f * (m[k] ?? 0)])), exempt);
      POSITIONS[pos][field] = cand;
      const now = objections(pos);
      const fresh = now.filter((x) => !base.some((b) => name(b) === name(x)));
      const sh = shortfall(pos);
      console.log(`  ${f.toFixed(3)}  ${JSON.stringify(cand)}  ${l1(cand, m).toFixed(3)} left  under a floor ${sh.men} (${sh.points})  ${fresh.length ? `costs ${fresh.join('; ')}` : 'free'}`);
    }
    POSITIONS[pos][field] = shipped;
  }
  clearOverallCache();
}
