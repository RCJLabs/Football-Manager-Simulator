import { POSITIONS, ROSTER_SLOTS, eraOf } from '../data/positions.js';
const ovrCache = new Map();

/** Drop a cached overall after a rating edit. */
export function forgetOverall(id) {
  ovrCache.delete(id);
}
export function clearOverallCache() {
  ovrCache.clear();
}

/**
 * The weighted sum on its own, with no cache. Anything that rates a set of
 * attributes not attached to a fixed player id — a career being aged, a
 * what-if — has to come through here, because the cache below is keyed by id
 * and would hand back a stale number.
 */
export function rawOverall(pos, r) {
  const w = POSITIONS[pos].weights;
  let s = 0;
  for (const k in w) s += (r[k] ?? 60) * w[k];
  return Math.round(s);
}

/** Weighted overall rating for a player, 40..99. */
export function overall(p) {
  // A player the career code has aged carries his own, because the cache is
  // keyed by id and two leagues can hold the same man at different ages.
  if (p.ovr != null) return p.ovr;
  if (ovrCache.has(p.id)) return ovrCache.get(p.id);
  const o = rawOverall(p.pos, p.r);
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
export function buildLineup(slots, byId, injuries = null) {
  const lineup = {};
  for (const slot of ROSTER_SLOTS) {
    const id = slots[slot.id];
    const p = byId.get(id);
    if (!p) continue;
    // A player on the injury ledger sits; the next man in the group moves up.
    if (injuries && injuries[id]) continue;
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
/**
 * What a position is actually worth, measured by boosting it on an otherwise
 * equal roster and taking the extra win rate. Documented in auction.js, which
 * is where it is used to price players and where it is re-exported from; it
 * lives here so `teamPower` can weight by it without the two files importing
 * each other.
 */
export const TRUE_LEVERAGE = { QB: 15.89, RB: 9.39, TE: 5.58, CB: 4.39, WR: 2.95, S: 2.87, LB: 2.76, DL: 2.46, OL: 2.17, P: 2.00, K: 1.25 };

/**
 * How strong a lineup is, on the 40..99 rating scale.
 *
 * The weights used to be a guess — QB 3, everyone else between 0.2 and 1.2 —
 * and a guess is what it measured like. Against the point differential from a
 * full round robin across six leagues it came out at r = 0.34, which is to say
 * it explained about a tenth of who actually beat whom, while being printed on
 * the team page as "Power" and, worse, feeding `priorMargin` and the live
 * win-probability model.
 *
 * Weighting by TRUE_LEVERAGE instead — the table this game already measured for
 * exactly this question — takes it to r = 0.56. Measured at the same time: a
 * point of power is worth 3.25 points of margin, against the 3.3 winprob.js
 * was already using, so that constant did not have to move.
 *
 * It is still only r = 0.56. One number over a whole roster cannot capture a
 * matchup, and the rest is the simulation's own variance. The claim on the team
 * page is "this squad is stronger", not "this squad wins".
 */
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
  let s = 0, w = 0;
  for (const p of starters) {
    const k = TRUE_LEVERAGE[p.pos] ?? 1;
    s += overall(p) * k; w += k;
  }
  return Math.round((s / w) * 10) / 10;
}
