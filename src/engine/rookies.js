// Generated rookie classes. Every offseason a new intake enters the pool:
// invented names, ratings spread the way a draft class is spread, most of them
// replacement level and a few worth a bid.
//
// Rookies live on the league, not in the shared player file, so two leagues
// never see each other's players and the file's fingerprint, which league
// codes and season cards depend on, does not move.
//
// Nothing ages here. A rookie who never finds a roster washes out after a few
// seasons, which is what keeps the free-agent list readable in a long dynasty.

import { POSITIONS, SLOT_COUNTS, ROSTER_SLOTS } from '../data/positions.js';
import { FIRST_NAMES, LAST_NAMES } from '../data/rookie-names.js';

/** The year a first-season rookie is stamped with; later classes count up from it. */
export const BASE_YEAR = 2026;
/** Seasons an unrostered rookie stays in the pool before washing out. */
export const WASHOUT_SEASONS = 3;
/** Rookies per club, per class. Twenty-eight in an eight-club league. */
export const PER_CLUB = 3.5;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function classSize(league) {
  return Math.max(16, Math.round(league.teams.length * PER_CLUB));
}

/**
 * How good a rookie is. The body of a class sits around replacement level,
 * which is where most intakes sit, and a small share are genuine prospects.
 * A single power law cannot do both at once: it either drowns the class in
 * stars or leaves nobody worth a bid. So it is a modest normal plus an
 * occasional jump, which is closer to how a draft class actually looks.
 */
export const PROSPECT_RATE = 0.07;
/**
 * The ceiling on a rookie's *target* rating. It is not a hard cap on his
 * overall: each attribute then scatters around the target, so a lucky draw on
 * the heavily weighted attributes can carry him a few points past it. Measured
 * over 4,000 rookies the realised ceiling is 94, with 0.9% at 87 or better and
 * 0.2% at 90 or better.
 *
 * It exists because nobody should enter the league already an all-time great.
 * The top of a class is a very good starter; the ones who become more than that
 * do it over seasons, through the career curves in careers.js. Uncapped, the
 * generator occasionally produced a 99 at twenty-two who then had a decade of
 * development still ahead of him.
 */
export const ROOKIE_CEILING = 87;
export function rollOverall(rng) {
  let t = rng.normal(62, 6.5);
  if (rng.chance(PROSPECT_RATE)) t += Math.abs(rng.normal(16, 7));
  return clamp(Math.round(t), 40, ROOKIE_CEILING);
}

/** Positions for a class, in roster proportions so every group gets somebody. */
export function classPositions(size) {
  const slots = Object.entries(SLOT_COUNTS);
  const total = slots.reduce((n, [, c]) => n + c, 0);
  const out = [];
  for (const [pos, count] of slots) {
    const n = Math.max(1, Math.round((count / total) * size));
    for (let i = 0; i < n; i++) out.push(pos);
  }
  // Rounding per position rarely lands on the size asked for; top up from the
  // positions that carry the most roster slots, and trim from the same end.
  const order = slots.slice().sort((a, b) => b[1] - a[1]).map(([pos]) => pos);
  for (let i = 0; out.length < size; i++) out.push(order[i % order.length]);
  return out.slice(0, Math.max(size, slots.length));
}

/**
 * One rookie. Attributes scatter around the target, so a class contains
 * lopsided players — a fast receiver who drops the ball, a mauler who cannot
 * pass protect — rather than smooth ones.
 */
export function makeRookie(pos, target, season, id, rng) {
  const def = POSITIONS[pos];
  const r = {};
  for (const a of def.attrs) r[a] = clamp(Math.round(target + rng.normal(0, 6)), 40, 99);
  const name = `${FIRST_NAMES[rng.int(0, FIRST_NAMES.length - 1)]} ${LAST_NAMES[rng.int(0, LAST_NAMES.length - 1)]}`;
  return { id, name, pos, season, team: 'RK', r, generated: true, draftClass: season };
}

/** A whole class, ready to be added to a league's pool. */
export function generateRookies(league, rng, { size = classSize(league), season = league.season + 1 } = {}) {
  const year = BASE_YEAR + season - 1;
  const positions = classPositions(size);
  const taken = new Set((league.rookies || []).map((p) => p.name));
  const out = [];
  positions.forEach((pos, i) => {
    const id = `rk-${(league.seed >>> 0).toString(36)}-${season}-${i}`;
    let p = makeRookie(pos, rollOverall(rng), year, id, rng);
    // Two players with the same name in one league reads as a bug; try again.
    for (let attempt = 0; attempt < 8 && taken.has(p.name); attempt++) p = makeRookie(pos, rollOverall(rng), year, id, rng);
    taken.add(p.name);
    out.push(p);
  });
  return out;
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

/**
 * Add the new class and wash out the old: a generated player nobody has
 * rostered, from a class older than WASHOUT_SEASONS, leaves the league.
 * Returns what came and went. `league.rookies` is replaced rather than
 * mutated, so anything caching the pool by identity notices.
 */
export function addRookieClass(league, rng, opts = {}) {
  const season = opts.season ?? league.season + 1;
  const owned = ownedIds(league);
  const kept = [], washed = [];
  for (const p of league.rookies || []) {
    const age = season - (p.draftClass - BASE_YEAR + 1);
    if (owned.has(p.id) || age <= WASHOUT_SEASONS) kept.push(p); else washed.push(p);
  }
  const arrived = generateRookies(league, rng, { ...opts, season });
  league.rookies = [...kept, ...arrived];
  league.rookieClasses = { ...(league.rookieClasses || {}), [season]: arrived.length };
  return { arrived, washed };
}

/** The pool a league actually plays with: the shipped players plus its own rookies. */
export function leaguePool(league, players) {
  const base = players.some((p) => p.generated) ? players.filter((p) => !p.generated) : players;
  return league && league.rookies && league.rookies.length ? base.concat(league.rookies) : base;
}

/** An index over that pool. */
export function leagueIndex(league, byId) {
  const stale = [...byId.values()].some((p) => p.generated);
  if (!stale && (!league || !league.rookies || !league.rookies.length)) return byId;
  const m = new Map();
  for (const [id, p] of byId) if (!p.generated) m.set(id, p);
  for (const p of (league && league.rookies) || []) m.set(p.id, p);
  return m;
}
