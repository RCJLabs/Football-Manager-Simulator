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
import { PLAYERS } from '../data/players.js';
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

/**
 * Attributes by how they age. Legs go first, hands next, the head last.
 *
 * `tha` is a hand and not a head, and putting it with the head made the
 * quarterback the one position ageing could not touch. He is 75% mental by
 * weight — `tha` 0.40 and `awr` 0.35 — and mental does not turn until six
 * seasons past the prime, so a quarterback signed at his best got BETTER for
 * seven years: +1.1, +1.8, +2.1, +2.0, +1.5, +0.9, +0.4, and only worse than
 * you signed him at thirty-seven, by which time he is retiring anyway. Measured
 * peak-to-last across a career, he fell 4.7 where every other position fell 8.9
 * to 17.4, and 22% of quarterbacks never declined by three at all.
 *
 * The line that fixes it is the one already drawn everywhere else on this list:
 * reading the game is mental, executing is a skill. Catching, route running,
 * blocking, coverage and tackling are all skills. Throwing a ball accurately is
 * the same kind of thing — it is what a quarterback DOES, not what he knows —
 * and awareness, which is what he knows, stays where it was.
 *
 * `tha` is a quarterback attribute and nobody else's, so this moves that
 * position and touches no other: every other position's ageing is unchanged to
 * the decimal. The quarterback still ages better than anyone — 7.9 peak-to-last
 * against the offensive line's 8.9 and the rest at 10 to 17 — which is right.
 * He is simply no longer immune.
 */
export const PHYSICAL = ['spd', 'elu', 'mob', 'pow', 'prs', 'thp', 'kpw', 'ppw', 'rac'];
export const SKILL = ['cth', 'rte', 'car', 'rec', 'blk', 'pbk', 'rbk', 'rsd', 'tck', 'cov', 'bal', 'kac', 'pac', 'tha'];
export const MENTAL = ['awr'];

const CLASS_OF = {};
for (const a of PHYSICAL) CLASS_OF[a] = 'physical';
for (const a of SKILL) CLASS_OF[a] = 'skill';
for (const a of MENTAL) CLASS_OF[a] = 'mental';

/**
 * `start` is the age, relative to the position's prime, at which this class of
 * attribute turns over. Speed is going a year before a player peaks; awareness
 * is still climbing six years after. `grow` is the yearly gain at full tilt,
 * `drop` the first year's loss and `accel` how much worse each year after that.
 *
 * The numbers were not retuned to fix the quarterback: `mental` climbing for
 * six years past the prime is the right shape for awareness, and it is what
 * keeps a thirty-four-year-old lineman worth his place. What was wrong was
 * which attributes were being sent down it — see the note on `tha` above.
 */
const CURVE = {
  physical: { start: -1, grow: 2.4, drop: 0.95, accel: 0.20 },
  skill: { start: 1, grow: 2.9, drop: 0.60, accel: 0.12 },
  mental: { start: 6, grow: 2.3, drop: 0.40, accel: 0.08 },
};

/** Seasons past prime a player lasts before hanging them up, before jitter. */
/**
 * What a season-ending injury costs a career.
 *
 * Until now an injury cost weeks and nothing else, so a torn ACL was a bad
 * month and a thirty-four-year-old back was an arithmetic slope. These are the
 * two things that make it a decision instead: he comes back a step slower, and
 * he has one year less in him.
 *
 * Weighted to the legs on purpose. PHYSICAL is where a knee goes, so a running
 * back loses two and a bit points of overall and a quarterback loses one — a
 * back's career ends at a knee and a quarterback's mostly does not. The smaller
 * across-the-board figure is the rest of it: everybody comes back a little
 * less.
 *
 * Scaled by age past prime, because a twenty-three-year-old walks it off and a
 * thirty-three-year-old does not.
 *
 * The split between the two figures was set by measuring what it came to per
 * position. At 3.0 and 0.8 a punter lost more than a running back — `ppw` is
 * physical and carries most of his rating — while an offensive lineman lost
 * almost nothing, because `pbk`, `rbk` and `awr` are none of them physical and
 * a knee does not care. Moving weight into the general figure closes both gaps
 * without flattening the one that should be there: a back still loses half
 * again what a quarterback does.
 */
export const KNOCK_PHYSICAL = 2.6;
export const KNOCK_GENERAL = 1.3;
export const KNOCK_YEARS = 1;
export const KNOCK_AGE_SCALE = 0.15;

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
export function step(cls, t, growth, rng, wear = 1) {
  const c = CURVE[cls];
  if (t < c.start) {
    const room = c.start - t;
    return c.grow * growth * clamp(room / 4, 0.25, 1) + rng.normal(0, 0.7);
  }
  const past = t - c.start;
  return -(c.drop + c.accel * past) * wear + rng.normal(0, 0.5);
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
  // HOW SOON, as against how high — and they have to be drawn separately or
  // there is no such thing as how soon.
  //
  // `ceilingFor` sets a prospect's room to `growth * 13 * …` and `step` climbs
  // at a rate also proportional to `growth`, so the distance and the speed
  // cancel and the time to arrive is the same for everybody. Measured before
  // this existed: room ran 7.2 points for the slowest developers to 18.1 for
  // the fastest, a two-and-a-half-fold spread, while the years to reach the
  // ceiling sat at 5.0, 4.8, 5.0, 4.5, 5.1. Flat. Every prospect in the game
  // arrived in about five seasons whoever he was, which is why there was
  // nothing for a scout to be uncertain ABOUT.
  //
  // `pace` multiplies the climb and leaves the ceiling alone, so the two come
  // apart: a quick study is useful to a club that is contending now, a slow
  // one to a club that is building. It defaults to 1, so a career stored
  // before this develops exactly as it did.
  // The shape of a man's arc comes off its own stream, not this one.
  //
  // `ceilingFor` draws from `rng` below, so every field added above it moves
  // the draw that decides every prospect's ceiling. That is how `pace` did it:
  // the share of a class peaking at 80+ went 18.8% to 19.8% and the share that
  // never gains five went 31.3% to 33.3%, which reads like a tuning change and
  // is nothing but a re-rolled seed. Keeping the arc traits on a separate
  // stream means the next one added here costs nothing.
  const arc = new RNG(hashSeed(`arc:${league.seed >>> 0}:${p.id}`));
  const pace = Math.round(clamp(arc.normal(1, 0.28), 0.5, 1.8) * 100) / 100;
  // HOW HE AGES, which until now was not a fact about him at all.
  //
  // The growth branch of `step` is scaled per player, twice over. The decline
  // branch was `-(drop + accel * past)` for everybody: the same slope for a
  // twenty-two-year-old lineman and a thirty-four-year-old back, with nothing
  // in it that belonged to the man. Measured before this existed, a season
  // past prime cost -0.58 at the prime and -2.14 ten years on, with a standard
  // deviation of 0.7 that was the per-attribute noise and nothing else. No
  // career in 2,400 ever lost six points in a season.
  //
  // There was spread in the totals — five seasons past prime ran a standard
  // deviation of 2.19, and 3.09 once injuries were counted — but none of it
  // was attributable. It was the same coin flipped for everybody, so there was
  // no such thing as a player who ages well, and therefore nothing to judge
  // and nothing that could force a decision.
  //
  // `wear` scales the decline only, the way `pace` scales the climb only. It
  // defaults to 1, so a career stored before this ages exactly as it did.
  const wear = Math.round(clamp(arc.normal(1, 0.34), 0.35, 2.0) * 100) / 100;
  return {
    age,
    // The age he started at, so a screen can turn "down 7" into a rate. NOT
    // `from`: `advanceCareers` already writes that, meaning the league season
    // his career began, and it spreads over whatever `startCareer` returned —
    // which silently made every veteran read "down 7 in 35 seasons".
    startAge: age,
    growth: g,
    pace,
    wear,
    retireAt: prime + CAREER_LENGTH + rng.int(-2, 3),
    entry,
    ceiling: ceilingFor(entry, g, rng, p.pos),
    d: {},
  };
}

/**
 * The best man who ever played each position, out of the shipped pool.
 *
 * A generated rookie may grow into him and may not grow past him. This is a
 * game about all-time greats, and a decade into a save it was handing out
 * fictional punters rated 97 against Ray Guy's 94, a fictional linebacker at 97
 * against Ray Lewis's 93, and a safety above Ronnie Lott — which is the premise
 * quietly coming apart. A flat ceiling of 96 was fine for the positions whose
 * best is 96 or 97 and nonsense for the five where it is not.
 *
 * Derived rather than listed, so it cannot go stale when the pool is re-rated.
 * It goes through `rawOverall` on purpose: `overall` caches by id, and these
 * are read at module load before any league exists to seed that cache.
 */
const PEAK = {};
for (const p of PLAYERS) {
  const o = rawOverall(p.pos, p.r);
  if (!(PEAK[p.pos] >= o)) PEAK[p.pos] = o;
}
export function positionPeak(pos) {
  return PEAK[pos] ?? 96;
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
 *
 * `pos` is optional because a caller who has no position gets the old flat 96;
 * the `Math.max` against `entry` is there so a man who somehow enters above his
 * position's peak is left alone rather than clamped backwards.
 */
export function ceilingFor(entry, growth, rng, pos) {
  const room = growth * 13 * clamp(1 - (entry - 55) / 55, 0.1, 1.2);
  const top = Math.max(entry, pos ? positionPeak(pos) : 96);
  return clamp(Math.round(entry + room + rng.int(-2, 3)), entry, top);
}

/** Every player id a club holds, on the roster or on injured reserve. */
function ownedIds(league) {
  const set = new Set();
  for (const t of league.teams) {
    for (const s of ROSTER_SLOTS) if (t.slots[s.id]) set.add(t.slots[s.id]);
    for (const id of t.ir || []) set.add(id);
    for (const id of t.squad || []) set.add(id);
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
  // `knocks` rides along so a screen can say why a man is not what he was, and
  // `seasons` so it can say how long it took — which is the only honest read on
  // how a man is ageing, since `wear` itself is not something a club is told.
  const seasons = c.startAge != null ? Math.max(0, c.age - c.startAge) : null;
  return { ...src, base: src, r, age: c.age, dev: true, knocks: c.knocks || 0, seasons, ovr: rawOverall(src.pos, r) };
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
export function stepCareer(league, src, c, season, knocks = 0) {
  const prime = primeAge(src.pos);
  const rng = new RNG(hashSeed(`dev:${league.seed >>> 0}:${src.id}:${season}`));
  const before = overall(developed(src, c));
  const next = { ...c, age: c.age + 1, d: { ...c.d } };
  if (knocks > 0) {
    // Paid before the year's development, so a man who tears a knee at
    // twenty-four can still grow through it — just from further back.
    const wear = knocks * (1 + Math.max(0, next.age - prime) * KNOCK_AGE_SCALE);
    for (const a of POSITIONS[src.pos].attrs) {
      const cost = (PHYSICAL.includes(a) ? KNOCK_PHYSICAL : KNOCK_GENERAL) * wear;
      next.d[a] = (next.d[a] || 0) - cost;
    }
    next.retireAt = Math.max(next.age, (next.retireAt ?? prime + CAREER_LENGTH) - KNOCK_YEARS * knocks);
    next.knocks = (c.knocks || 0) + knocks;
    // A ceiling he can no longer reach is not a ceiling. But pinning it to what
    // he is worth the day after the injury is not right either: that freezes him
    // there for good, and contradicts paying the damage before the year's
    // development so he can still grow through it. Drop the ceiling by what the
    // knock actually cost him, so the room he had left is the room he keeps, and
    // never below what he is worth now.
    if (next.ceiling != null) {
      const hurt = overall(developed(src, next));
      next.ceiling = Math.max(hurt, Math.round(next.ceiling - (before - hurt)));
    }
  }
  // Where this year's growth actually starts: after the knock, before the gains.
  // The clamps below measure against this rather than `before`, which is what he
  // was last season. A knocked man is already under `before`, so measuring the
  // ceiling against it skipped the clamp entirely and let him finish the season
  // above his own ceiling — and stay there, every season after, because he then
  // began each one already over it.
  const start = overall(developed(src, next));
  // Deltas as they stand after the knock. The scale-back rebuilds from these and
  // not from `c.d`, which would hand the injury straight back.
  const baseD = { ...next.d };
  const gain = {};
  for (const a of POSITIONS[src.pos].attrs) {
    // `pace` scales the climb only. The ceiling is drawn from `growth` alone,
    // which is what lets the two vary independently.
    gain[a] = step(CLASS_OF[a] || 'skill', next.age - prime, next.growth * (next.pace ?? 1), rng, next.wear ?? 1);
    next.d[a] = (next.d[a] || 0) + gain[a];
  }
  let after = overall(developed(src, next));
  const cap = next.ceiling ?? 99;
  if (after > cap && after > start) {
    const scale = clamp((cap - start) / (after - start), 0, 1);
    for (const a of POSITIONS[src.pos].attrs) next.d[a] = (baseD[a] || 0) + gain[a] * scale;
    after = overall(developed(src, next));
  }
  for (const a of POSITIONS[src.pos].attrs) next.d[a] = Math.round(next.d[a] * 10) / 10;
  // Rounding six deltas to a tenth can land a man a point over his own ceiling,
  // which is how generated players were turning up at 97 against a cap of 96.
  // The scale-back above lands him exactly on it; rounding then puts him over.
  //
  // Shave this season's biggest GAIN, not his biggest career delta. Those are
  // different attributes for anyone past a rookie year, and taking it off the
  // career total would claw back progress he made in earlier seasons to pay for
  // a tenth of a point of rounding in this one. `start` floors it, so a season
  // can be cancelled out but never reversed.
  const attrs = POSITIONS[src.pos].attrs;
  for (let guard = 0; guard < 40; guard++) {
    const now = overall(developed(src, next));
    if (now <= cap || now <= start) break;
    const biggest = attrs.reduce((x, y) => ((gain[x] || 0) >= (gain[y] || 0) ? x : y));
    next.d[biggest] = Math.round(((next.d[biggest] || 0) - 0.1) * 10) / 10;
    gain[biggest] = (gain[biggest] || 0) - 0.1;
  }
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
  const hurt = [];

  for (const id of owned) {
    if (league.dev && league.dev[id]) continue;
    const p = byId.get(id);
    if (p) careers[id] = { ...startCareer(league, p.base || p), from: season };
  }
  for (const [id, prev] of Object.entries(league.dev || {})) careers[id] = prev;

  for (const [id, c] of Object.entries(careers)) {
    const p = byId.get(id);
    if (!p) { delete careers[id]; continue; }
    const src = p.base || p;
    const knocks = (league.knocks && league.knocks[id]) || 0;
    const { career: next, before, after } = stepCareer(league, src, c, season, knocks);
    if (retires(next, after)) {
      retired.push({ id, name: src.name, pos: src.pos, age: next.age, ovr: after, owned: owned.has(id), knocks: next.knocks || 0 });
      delete careers[id];
      continue;
    }
    careers[id] = next;
    if (!owned.has(id)) continue;
    if (knocks) hurt.push({ id, name: src.name, pos: src.pos, age: next.age, from: before, to: after, knocks });
    const move = after - before;
    if (move >= 3) risers.push({ id, name: src.name, pos: src.pos, age: next.age, from: before, to: after });
    else if (move <= -3) fallers.push({ id, name: src.name, pos: src.pos, age: next.age, from: before, to: after });
  }

  // The ledger is settled once. Leaving it would charge the same knee every
  // offseason until the man retired of it.
  league.knocks = {};
  league.dev = careers;
  if (retired.length) league.retired = [...(league.retired || []), ...retired.map((r) => r.id)];
  risers.sort((a, b) => (b.to - b.from) - (a.to - a.from));
  fallers.sort((a, b) => (a.to - a.from) - (b.to - b.from));
  hurt.sort((a, b) => (a.to - a.from) - (b.to - b.from));
  return { retired, risers, fallers, hurt, aged: Object.keys(careers).length };
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
    if (t.squad && t.squad.length) t.squad = t.squad.filter((id) => !gone.has(id));
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
