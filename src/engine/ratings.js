import { POSITIONS, ROSTER_SLOTS, eraOf } from '../data/positions.js';
const ovrCache = new Map();

/** Weighted overall rating for a player, 40..99. */
export function overall(p) {
  if (ovrCache.has(p.id)) return ovrCache.get(p.id);
  const w = POSITIONS[p.pos].weights;
  let s = 0;
  for (const k in w) s += (p.r[k] ?? 60) * w[k];
  const o = Math.round(s);
  ovrCache.set(p.id, o);
  return o;
}

export function playerLabel(p) {
  return `${p.name} (${p.season} ${p.team})`;
}

export function playerEra(p) {
  return eraOf(p.season);
}

const mean = (arr, key) => (arr.length ? arr.reduce((s, p) => s + p.r[key], 0) / arr.length : 60);
const topN = (arr, key, n) => arr.slice().sort((a, b) => b.r[key] - a.r[key]).slice(0, n);

/**
 * Build a depth chart from a team's slot -> playerId map.
 * Returns { QB: [..], RB: [..], WR: [..], TE: [..], OL: [..], DL: [..], LB: [..], CB: [..], S: [..], K: [..], P: [..] }
 * in depth-chart order (slot order).
 */
export function buildLineup(slots, byId) {
  const lineup = {};
  for (const slot of ROSTER_SLOTS) {
    const id = slots[slot.id];
    const p = byId.get(id);
    if (!p) continue;
    (lineup[slot.pos] ??= []).push(p);
  }
  return lineup;
}

/** Team-level composite ratings the simulator consumes. */
export function composites(lineup) {
  const g = (pos) => lineup[pos] || [];
  const qb = g('QB')[0];
  const rb = g('RB');
  const wr = g('WR');
  const te = g('TE')[0];
  const ol = g('OL');
  const dl = g('DL');
  const lb = g('LB');
  const cb = g('CB');
  const s = g('S');
  const k = g('K')[0];
  const p = g('P')[0];
  const teBlk = te ? te.r.blk : 60;
  const dbs = [...cb, ...s];
  const allDef = [...dl, ...lb, ...cb, ...s];

  const top2DL = topN(dl, 'prs', 2);
  const restDL = dl.filter((x) => !top2DL.includes(x));

  return {
    qb,
    rb1: rb[0], rb2: rb[1],
    te, wr, ol, dl, lb, cb, s, k, p,
    // offense
    passBlock: 0.85 * mean(ol, 'pbk') + 0.15 * teBlk,
    runBlock: 0.8 * mean(ol, 'rbk') + 0.2 * teBlk,
    olAwr: mean(ol, 'awr'),
    // defense
    passRush: 0.6 * mean(top2DL, 'prs') + 0.25 * mean(restDL.length ? restDL : dl, 'prs') + 0.15 * mean(lb, 'prs'),
    blitzRush: 0.45 * mean(top2DL, 'prs') + 0.15 * mean(restDL.length ? restDL : dl, 'prs') + 0.4 * mean(lb, 'prs'),
    runStop: 0.45 * mean(dl, 'rsd') + 0.35 * mean(lb, 'rsd') + 0.1 * mean(s, 'rsd') + 0.1 * mean(lb, 'tck'),
    covShort: 0.4 * mean(cb, 'cov') + 0.35 * mean(lb, 'cov') + 0.25 * mean(s, 'cov'),
    covMed: 0.5 * mean(cb, 'cov') + 0.2 * mean(lb, 'cov') + 0.3 * mean(s, 'cov'),
    covDeep: 0.5 * mean(cb, 'cov') + 0.4 * mean(s, 'cov') + 0.1 * mean(lb, 'cov'),
    ballSkills: 0.6 * mean(cb, 'bal') + 0.4 * mean(s, 'bal'),
    tackling: 0.2 * mean(dl, 'tck') + 0.4 * mean(lb, 'tck') + 0.15 * mean(cb, 'tck') + 0.25 * mean(s, 'tck'),
    defSpeed: 0.45 * mean(cb, 'spd') + 0.35 * mean(s, 'spd') + 0.2 * mean(lb, 'spd'),
    defAwr: mean(allDef, 'awr'),
  };
}

/** A single number summarizing team strength, for standings/AI flavor. */
export function teamPower(lineup) {
  const starters = [];
  for (const slot of ROSTER_SLOTS) {
    if (!slot.starter) continue;
    const arr = lineup[slot.pos];
    if (!arr) continue;
    const idx = ROSTER_SLOTS.filter((x) => x.pos === slot.pos).indexOf(slot);
    if (arr[idx]) starters.push(arr[idx]);
  }
  if (!starters.length) return 0;
  const weight = { QB: 3, RB: 1.2, WR: 1.1, TE: 0.9, OL: 0.8, DL: 1, LB: 0.9, CB: 1, S: 0.9, K: 0.4, P: 0.2 };
  let s = 0, w = 0;
  for (const p of starters) { s += overall(p) * weight[p.pos]; w += weight[p.pos]; }
  return Math.round((s / w) * 10) / 10;
}
