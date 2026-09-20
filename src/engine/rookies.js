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

/**
 * Rookies per club in a pro league, where the class is the only supply there is.
 *
 * A fantasy league drafts the all-time pool every year, so its intake only has
 * to be interesting. A pro league drains its all-time players away and then
 * lives on what the draft brings. Measured over eighteen seasons at the
 * fantasy league's 3.5 a club: the market fell to about 135 men for 32 clubs,
 * ran out of kickers and punters repeatedly, minted up to 49 emergency bodies
 * a year to stay afloat, and still left a club an offseason short of a full
 * roster. At 5.5 the same save keeps a market of 350 to 470, never runs a
 * position dry, and mints no emergency bodies at all.
 */
export const PRO_PER_CLUB = 5.5;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function classSize(league) {
  const per = league?.mode === 'pro' ? PRO_PER_CLUB : PER_CLUB;
  return Math.max(16, Math.round(league.teams.length * per));
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

/**
 * How much of a position the market must carry, as a share of what the league
 * fields at it.
 *
 * Thirty-two clubs need thirty-two punters and a punter is a twenty-seventh of
 * a roster, so even a large class brings only five or six a year. That is a
 * supply with very little slack, and it runs down: measured over a ten-season
 * save the market went 21, 22, 24, 22, 19, 16, 12, 8, 5 punters and then none,
 * and the next club to need one came out of the offseason with an empty slot —
 * the invariant this game holds above all others is that nobody starts a
 * season a man short.
 *
 * It is a share of league demand rather than a flat count because a club
 * fields one kicker and five offensive linemen, and it is measured against
 * what can actually be *signed*. Two earlier versions counted the wrong thing
 * and both reported that position healthy right up to the offseason that could
 * not fill it. The first counted the arriving class, which belongs to the
 * draft that year — `signablePool` keeps it off the market, so five punters in
 * the class are five punters nobody can sign. The second counted every punter
 * in the league, but a man under contract is not cover either. What is left is
 * the right answer: alive, off a roster, and not in this year's draft.
 *
 * Tuning the class size until it stopped happening is not a fix, because the
 * next bad run starts it again. So the shortage is answered directly, at the
 * one moment a season's supply is decided. It is a backstop and not a source:
 * at the pro class size it fires for specialists and almost nothing else.
 */
export const MARKET_COVER = 0.25;

/** The smallest market a position may be left with, whatever the share says. */
export const MARKET_COVER_MIN = 4;

/**
 * What an emergency body is worth.
 *
 * A camp arm, not a prospect. The point is that the league can always field a
 * punter, not that running short is rewarded with a good one.
 */
export const STREET_OVERALL = 55;

/**
 * Bodies for a position the market cannot otherwise stock.
 *
 * They are stamped with last year's class rather than this one, which is what
 * makes them free agents instead of draftees: `draftablePool` is this season's
 * class and nothing else, and a club that needs a punter in August needs one
 * it can sign now.
 */
export function topUpPositions(league, rng, season, pool, signable = []) {
  if (league?.mode !== 'pro' || !pool || !pool.length) return [];
  const teams = league.teams?.length || 1;
  const gone = new Set(league.departed || []);
  const retired = new Set(league.retired || []);
  const owned = ownedIds(league);
  // On the market: alive, not on a roster, and not in the draft. A man under
  // contract is not cover — counting the whole league as its own market was
  // the second version of this and it reported a position healthy right up to
  // the offseason that could not fill it.
  const free = (p) => !gone.has(p.id) && !retired.has(p.id) && !p.retired && !owned.has(p.id);
  const have = {};
  // The shipped pool comes from `pool`; the generated players come from the
  // list the caller passes, which is newer than any pool it holds. Neither
  // includes the class arriving this offseason, and that is the point.
  for (const p of pool) if (!p.generated && free(p)) have[p.pos] = (have[p.pos] || 0) + 1;
  for (const p of signable) if (free(p)) have[p.pos] = (have[p.pos] || 0) + 1;
  const out = [];
  const year = BASE_YEAR + season - 2;
  for (const [pos, slots] of Object.entries(SLOT_COUNTS)) {
    const need = Math.max(MARKET_COVER_MIN, Math.ceil(slots * teams * MARKET_COVER));
    for (let i = 0, short = need - (have[pos] || 0); i < short; i++) {
      const target = clamp(Math.round(rng.normal(STREET_OVERALL, 5)), 40, 70);
      out.push(makeRookie(pos, target, year, `fa-${(league.seed >>> 0).toString(36)}-${season}-${pos}-${i}`, rng));
    }
  }
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
  // Whatever the market cannot cover on its own. Measured against `kept` and
  // the shipped pool, never against `arrived`: this year's class belongs to
  // the draft and cannot be signed off the street.
  const street = topUpPositions(league, rng, season, opts.pool, kept);
  league.rookies = [...kept, ...arrived, ...street];
  league.rookieClasses = { ...(league.rookieClasses || {}), [season]: arrived.length };
  return { arrived, washed, street };
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
