// Player careers: ageing, development and retirement.
//
// The shipped pool is one prime-season snapshot per player and carries no age
// at all, so ageing everyone would break the promise the draft screen makes —
// every era, at its best. A career therefore starts the moment a club signs a
// man. Until then he sits in the pool frozen at his prime, which leaves the
// auction the same puzzle it has always been, and turns a long contract into a
// real decision: the 92 you keep for three years is not a 92 in year three.
//
// Generated rookies are the exception and the reason for the whole thing. They
// are fictional, they enter at 22 well short of their prime, and a hidden
// growth curve decides whether a 63 becomes an 80 or never moves. That is what
// makes an intake worth watching in a small league, where the class as a whole
// starts below the rostered cutoff.
//
// Nothing here runs during a season. Careers advance once, in the offseason,
// before keepers are chosen, so you pick knowing who got better and who did not.
//
// The state lives on `league.dev`, not `league.careers`: awards.js got there
// first and uses that name for the accumulated statistics a hall-of-fame case
// is built from. Two different meanings of the word career, one object.

import { POSITIONS, ROSTER_SLOTS } from '../data/positions.js';
import { RNG, hashSeed } from './rng.js';
import { overall, rawOverall } from './ratings.js';

/** Age a rookie class enters at. */
export const ROOKIE_AGE = 22;

/**
 * The age each position peaks at. Backs and corners go early, quarterbacks and
 * specialists late. A real player enters within two years of his own prime,
 * because the pool is his prime season.
 */
export const PRIME_AGE = { QB: 29, RB: 25, WR: 27, TE: 28, OL: 28, DL: 27, LB: 27, CB: 26, S: 28, K: 31, P: 31 };

/** Attributes by how they age. Legs go first, hands next, the head last. */
export const PHYSICAL = ['spd', 'elu', 'mob', 'pow', 'prs', 'thp', 'kpw', 'ppw', 'rac'];
export const SKILL = ['cth', 'rte', 'car', 'rec', 'blk', 'pbk', 'rbk', 'rsd', 'tck', 'cov', 'bal', 'kac', 'pac'];
export const MENTAL = ['awr', 'tha'];

const CLASS_OF = {};
for (const a of PHYSICAL) CLASS_OF[a] = 'physical';
for (const a of SKILL) CLASS_OF[a] = 'skill';
for (const a of MENTAL) CLASS_OF[a] = 'mental';

/**
 * `start` is the age, relative to the position's prime, at which this class of
 * attribute turns over. Speed is going a year before a player peaks; awareness
 * is still climbing six years after. `grow` is the yearly gain at full tilt,
 * `drop` the first year's loss and `accel` how much worse each year after that.
 */
const CURVE = {
  physical: { start: -1, grow: 2.4, drop: 0.95, accel: 0.20 },
  skill: { start: 1, grow: 2.9, drop: 0.60, accel: 0.12 },
  mental: { start: 6, grow: 2.3, drop: 0.40, accel: 0.08 },
};

/** Seasons past prime a player lasts before hanging them up, before jitter. */
export const CAREER_LENGTH = 9;
/** Nobody plays below this. */
export const RETIRE_OVERALL = 52;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function primeAge(pos) {
  return PRIME_AGE[pos] ?? 27;
}

/**
 * One season's change to a single attribute. `t` is age relative to prime.
 * Growth ramps in over the last four years before the turn, so a 22-year-old
 * does not gain the same as a 25-year-old about to peak.
 */
export function step(cls, t, growth, rng) {
  const c = CURVE[cls];
  if (t < c.start) {
    const room = c.start - t;
    return c.grow * growth * clamp(room / 4, 0.25, 1) + rng.normal(0, 0.7);
  }
  const past = t - c.start;
  return -(c.drop + c.accel * past) + rng.normal(0, 0.5);
}

/**
 * A career's fixed facts, derived from the league seed and the player id so a
 * man always enters the same league at the same age with the same ceiling,
 * whichever season he is finally signed in.
 */
export function startCareer(league, p) {
  const rng = new RNG(hashSeed(`career:${league.seed >>> 0}:${p.id}`));
  const prime = primeAge(p.pos);
  const age = p.generated ? ROOKIE_AGE + rng.int(-1, 1) : prime + rng.int(-2, 2);
  // Most players are what they look like. A few break out, a few never arrive.
  let growth = rng.normal(1, 0.3);
  if (rng.chance(0.09)) growth += 0.7;
  else if (rng.chance(0.1)) growth -= 0.45;
  const g = Math.round(clamp(growth, 0.15, 2.2) * 100) / 100;
  const entry = overall(p);
  return {
    age,
    growth: g,
    retireAt: prime + CAREER_LENGTH + rng.int(-2, 3),
    entry,
    ceiling: ceilingFor(entry, g, rng),
    d: {},
  };
}

/**
 * How good a player can get. Growth carries him toward this and stops; it never
 * carries him past it.
 *
 * Without a ceiling the two rolls compound — the rookie generator's prospect
 * bump lands a class-leading entry rating, a high growth draw then adds twenty
 * more, and a long pro dynasty manufactures a dozen fictional 98s. That would
 * swamp the top of the real pool, which is the thing the game is actually
 * about. Room also shrinks as the entry rating rises, so the players with the
 * least left to prove have the least left to gain.
 */
export function ceilingFor(entry, growth, rng) {
  const room = growth * 13 * clamp(1 - (entry - 55) / 55, 0.1, 1.2);
  return clamp(Math.round(entry + room + rng.int(-2, 3)), entry, 96);
}

/** Every player id a club holds, on the roster or on injured reserve. */
function ownedIds(league) {
  const set = new Set();
  for (const t of league.teams) {
    for (const s of ROSTER_SLOTS) if (t.slots[s.id]) set.add(t.slots[s.id]);
    for (const id of t.ir || []) set.add(id);
  }
  return set;
}

/** The player as he is now: base ratings plus everything his career has done. */
export function developed(p, c) {
  const src = p.base || p;
  const r = {};
  for (const a of POSITIONS[src.pos].attrs) {
    r[a] = clamp(Math.round((src.r[a] ?? 60) + (c.d[a] || 0)), 40, 99);
  }
  return { ...src, base: src, r, age: c.age, dev: true, ovr: rawOverall(src.pos, r) };
}

/**
 * The pool as the league sees it: everyone with a career shown at his current
 * ratings, the retired flagged rather than deleted.
 *
 * Flagged, not deleted, for a specific reason: league codes and season cards
 * refuse to open against a different player pool, and they tell pools apart by
 * counting ids. Dropping a retired man would move that fingerprint and a league
 * would stop being able to open its own code. Signing him is blocked at the
 * three places that offer players — free agency, the auction and the draft —
 * and he stays visible in the pool, which is where a retired great belongs.
 *
 * Idempotent: a developed player is rebuilt from the base he carries rather
 * than developed twice.
 */
export function applyCareers(league, players) {
  const careers = league && league.dev;
  const retired = league && league.retired && league.retired.length ? new Set(league.retired) : null;
  if (!careers && !retired) return players.some((p) => p.dev) ? players.map((p) => p.base || p) : players;
  return players.map((p) => viewOf(p, careers, retired));
}

/** An index over that pool. */
export function careerIndex(league, byId) {
  const careers = league && league.dev;
  const retired = league && league.retired && league.retired.length ? new Set(league.retired) : null;
  const stale = [...byId.values()].some((p) => p.dev || p.retired);
  if (!careers && !retired && !stale) return byId;
  const m = new Map();
  for (const [, p] of byId) {
    const src = p.base || p;
    m.set(src.id, viewOf(src, careers, retired));
  }
  return m;
}

function viewOf(p, careers, retired) {
  const src = p.base || p;
  const c = careers && careers[src.id];
  const out = c ? developed(src, c) : src;
  if (!retired || !retired.has(src.id)) return out;
  return { ...out, base: src, retired: true };
}

/**
 * One season of a single career. Returns the next career state, approaching the
 * ceiling smoothly rather than jumping over it: a season that would cross the
 * ceiling has its gains scaled back to land on it.
 */
export function stepCareer(league, src, c, season) {
  const prime = primeAge(src.pos);
  const rng = new RNG(hashSeed(`dev:${league.seed >>> 0}:${src.id}:${season}`));
  const before = overall(developed(src, c));
  const next = { ...c, age: c.age + 1, d: { ...c.d } };
  const gain = {};
  for (const a of POSITIONS[src.pos].attrs) {
    gain[a] = step(CLASS_OF[a] || 'skill', next.age - prime, next.growth, rng);
    next.d[a] = (next.d[a] || 0) + gain[a];
  }
  let after = overall(developed(src, next));
  const cap = c.ceiling ?? 99;
  if (after > cap && after > before) {
    const scale = clamp((cap - before) / (after - before), 0, 1);
    for (const a of POSITIONS[src.pos].attrs) next.d[a] = (c.d[a] || 0) + gain[a] * scale;
    after = overall(developed(src, next));
  }
  for (const a of POSITIONS[src.pos].attrs) next.d[a] = Math.round(next.d[a] * 10) / 10;
  return { career: next, before, after: overall(developed(src, next)) };
}

/** Has this player earned a place in the pool for another year? */
function retires(c, ovr) {
  return c.age >= c.retireAt || ovr < RETIRE_OVERALL;
}

/**
 * Advance every career by a season, start one for anybody newly under contract,
 * and retire whoever is finished. Rosters are not touched here; the caller
 * releases the retired, because only it knows whether slots are being cleared
 * for a keeper round anyway.
 *
 * `league.dev` is replaced rather than mutated, so anything caching the
 * pool by identity notices.
 */
export function advanceCareers(league, byId, { season = league.season } = {}) {
  const careers = {};
  const owned = ownedIds(league);
  const retired = [];
  const risers = [];
  const fallers = [];

  for (const id of owned) {
    if (league.dev && league.dev[id]) continue;
    const p = byId.get(id);
    if (p) careers[id] = startCareer(league, p.base || p);
  }
  for (const [id, prev] of Object.entries(league.dev || {})) careers[id] = prev;

  for (const [id, c] of Object.entries(careers)) {
    const p = byId.get(id);
    if (!p) { delete careers[id]; continue; }
    const src = p.base || p;
    const { career: next, before, after } = stepCareer(league, src, c, season);
    if (retires(next, after)) {
      retired.push({ id, name: src.name, pos: src.pos, age: next.age, ovr: after, owned: owned.has(id) });
      delete careers[id];
      continue;
    }
    careers[id] = next;
    if (!owned.has(id)) continue;
    const move = after - before;
    if (move >= 3) risers.push({ id, name: src.name, pos: src.pos, age: next.age, from: before, to: after });
    else if (move <= -3) fallers.push({ id, name: src.name, pos: src.pos, age: next.age, from: before, to: after });
  }

  league.dev = careers;
  if (retired.length) league.retired = [...(league.retired || []), ...retired.map((r) => r.id)];
  risers.sort((a, b) => (b.to - b.from) - (a.to - a.from));
  fallers.sort((a, b) => (a.to - a.from) - (b.to - b.from));
  return { retired, risers, fallers, aged: Object.keys(careers).length };
}

/** Drop retired players from every roster, bench and injured-reserve list. */
export function releaseRetired(league, retiredIds) {
  const gone = new Set(retiredIds);
  if (!gone.size) return 0;
  let n = 0;
  for (const t of league.teams) {
    for (const s of ROSTER_SLOTS) {
      if (t.slots[s.id] && gone.has(t.slots[s.id])) { t.slots[s.id] = null; n++; }
    }
    if (t.ir && t.ir.length) t.ir = t.ir.filter((id) => !gone.has(id));
  }
  for (const id of gone) if (league.contracts) delete league.contracts[id];
  return n;
}

/** What a career looks like on screen. */
export function careerOf(league, id) {
  return (league && league.dev && league.dev[id]) || null;
}

/** "27, entering his prime" — a short read on where a player is in his career. */
export function careerPhase(pos, age) {
  const prime = primeAge(pos);
  const t = age - prime;
  if (t <= -4) return 'developing';
  if (t <= -1) return 'rising';
  if (t <= 1) return 'in his prime';
  if (t <= 4) return 'holding on';
  return 'declining';
}
