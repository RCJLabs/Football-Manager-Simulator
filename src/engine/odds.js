// Playoff odds: the rest of the season played a thousand times over, through
// the league's own tiebreakers and bracket, from how strong each club is now.
//
// Each remaining game's margin is drawn around its prior (the power gap times
// `POINTS_PER_POWER`, plus the home edge) with the spread a whole game has
// about that prior in league play (`GAME_SD`). Both were fitted on league
// games rather than taken from the synthetic ones the live chart was first
// fitted on (DESIGN.md, "Playoff odds"). A club's power for each remaining
// week leaves out the men its injury ledger says are still out that week.
// Nothing else about the future is modelled: trades, claims, new injuries,
// a coach benching a starter.
//
// Seeding runs through copies of `makeComparator` and `proStandings` that
// read tables instead of scanning `league.results`. The real ones scan the
// whole results list for every tied comparison, and a thousand finishes took
// a third of a second at midseason on a desktop, which a phone would feel
// every week. The copies are held to the real code on thousands of random
// finishes (tests/odds.test.js): change a tiebreaker there and that test
// fails until it is changed here too.
//
// Every game's draw in every run is keyed by the run and the game, not taken
// in turn from a stream. Run 417 plays week 12's Dallas game off the same
// number whichever week the odds are read in, so from one week to the next
// the odds move because of what happened, not because the dice were rolled
// again (common random numbers). Read fresh each week, a thousand runs wobble
// about a point and a half on their own.

import { CONFERENCES, DIVISIONS } from '../data/pro.js';
import { isPro, playoffFieldSize } from './season.js';
import { buildLineup, teamPower } from './ratings.js';
import { POINTS_PER_POWER, HOME_EDGE_POINTS, GAME_SD } from './winprob.js';
import { hashSeed } from './rng.js';

/** Finishes simulated per reading: about ±1.5 points on a 35% chance. */
export const ODDS_RUNS = 1000;

/**
 * Finishes per reading while the simulator runs weeks on. Its readings only
 * draw the race chart, where common random numbers keep a smaller count
 * smooth, and the week it stops on is read again in full when the hub opens
 * (`refreshOdds`). A season's twenty-odd readings at the full count cost a
 * phone seconds it would spend on nothing anyone looks at.
 */
export const QUICK_RUNS = 250;

/** How often a regular-season game ends level: 0.45% of 6,870 league games. */
export const TIE_CHANCE = 0.005;

// A game's points: only the last two tiebreakers read them, point difference
// and then points scored, so the loser is given half a typical game's total
// (46 in league play) and the winner that plus the margin.
const LOSER_POINTS = 23;

const pctOf = (w, l, t) => { const gp = w + l + t; return gp ? (w + t * 0.5) / gp : 0; };

/** Inverse of the standard normal CDF (Acklam's approximation, good to about 1e-9). */
function invPhi(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - lo) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// A normal draw is a lookup: 4,096 equal-chance slices of the standard normal,
// each at its middle. The slices move a game's chance by under 1/4,096.
const SLICES = 4096;
const Z = Float64Array.from({ length: SLICES }, (_, i) => invPhi((i + 0.5) / SLICES));

/** A 32-bit mix (murmur3's finaliser): the uniform a run draws for one keyed game. */
function mix(x) {
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}
const uniform = (runKey, gameKey) => mix(runKey ^ Math.imul(gameKey + 1, 0x9e3779b1)) / 4294967296;

// A playoff game's key: its round from the first, its pool and its place in it.
const bracketKey = (round, pool, slot) => 0x100000 + round * 256 + pool * 32 + slot;

/**
 * Everything a run needs that does not change from one run to the next: the
 * season so far as tables, the games left with the margin each is expected
 * to have, and who can meet whom in a tiebreak.
 */
function prepare(league, byId, { power = true } = {}) {
  const teams = league.teams;
  const N = teams.length;
  const pro = isPro(league);
  const conf = teams.map((t) => t.conf ?? 0);
  const div = teams.map((t) => t.div ?? 0);
  // Head to head, from each side: hw[a*N+b] is how often a beat b.
  const hw = new Int16Array(N * N), hl = new Int16Array(N * N), ht = new Int16Array(N * N);
  for (const r of league.results || []) {
    if (r.phase !== 'season' || r.season !== league.season) continue;
    const a = r.home, b = r.away;
    if (r.score[0] > r.score[1]) { hw[a * N + b]++; hl[b * N + a]++; }
    else if (r.score[0] < r.score[1]) { hw[b * N + a]++; hl[a * N + b]++; }
    else { ht[a * N + b]++; ht[b * N + a]++; }
  }
  const rec = {
    w: Int16Array.from(teams, (t) => t.record.w), l: Int16Array.from(teams, (t) => t.record.l),
    t: Int16Array.from(teams, (t) => t.record.t), pf: Int32Array.from(teams, (t) => t.record.pf),
    pa: Int32Array.from(teams, (t) => t.record.pa),
  };
  // Everyone a club plays this season, played or not: by the end of a run
  // every one of those games has a result, which is when the tiebreakers read.
  const faced = teams.map(() => new Set());
  const games = [];
  const first = Math.max(0, (league.week ?? 1) - 1);
  const inSeason = league.phase === 'season';
  (league.schedule || []).forEach((wk, w) => {
    wk.games.forEach((g, i) => {
      faced[g.home].add(g.away); faced[g.away].add(g.home);
      if (inSeason && w >= first && !g.result) games.push({ home: g.home, away: g.away, at: w - first, neutral: !!g.neutral, key: w * 64 + i });
    });
  });
  const weeksLeft = inSeason ? Math.max(0, (league.schedule || []).length - first) : 0;
  const ctx = { N, pro, conf, div, hw, hl, ht, rec, games, faced, weeksLeft, power: power ? powerByWeek(league, byId, weeksLeft) : null };
  // Who a sort starts from, in club order as the real standings build it.
  ctx.everyone = teams.map((_, i) => i);
  ctx.conferences = CONFERENCES.map((__, c) => ctx.everyone.filter((i) => conf[i] === c));
  ctx.divisions = CONFERENCES.map((__, c) => DIVISIONS.map((___, d) => ctx.everyone.filter((i) => conf[i] === c && div[i] === d)));
  // Opponents two clubs have both played, for the common-games tiebreak.
  const commons = new Map();
  ctx.common = (a, b) => {
    const k = a < b ? a * N + b : b * N + a;
    let s = commons.get(k);
    if (!s) { s = new Set([...faced[a]].filter((o) => faced[b].has(o) && o !== a && o !== b)); commons.set(k, s); }
    return s;
  };
  return ctx;
}

/**
 * Each club's power for each week from now, the last entry standing for the
 * playoffs: a man on the injury ledger sits the weeks it has him out for.
 */
function powerByWeek(league, byId, weeksLeft) {
  const inj = league.injuries || {};
  return league.teams.map((t) => {
    const hurt = [];
    for (const id of Object.values(t.slots)) if (id && inj[id]) hurt.push([id, inj[id].weeks]);
    const out = new Float64Array(weeksLeft + 1);
    let key = null, p = 0;
    for (let d = 0; d <= weeksLeft; d++) {
      const sitting = hurt.filter(([, n]) => n > d).map(([id]) => id);
      const k = sitting.join(',');
      if (k !== key) {
        key = k;
        p = teamPower(buildLineup(t.slots, byId, sitting.length ? Object.fromEntries(sitting.map((id) => [id, true])) : null));
      }
      out[d] = p;
    }
    return out;
  });
}

/**
 * The league's comparator (`makeComparator` in season.js) on a run's tables.
 * Same order of tests, same arithmetic, same thresholds, so a sort with it
 * puts clubs exactly where the real standings would. `settle` must be called
 * once the run's games are in and before sorting: it takes each club's
 * winning percentage and forgets the last run's tiebreak figures.
 */
function comparator(ctx, run) {
  const { N, pro, conf, div } = ctx;
  const { w: W, l: L, t: T, pf: PF, pa: PA, hw: HW, hl: HL, ht: HT } = run;
  const P = new Float64Array(N);
  // Each tiebreak figure is worked out once a run, the first time a sort asks.
  const memo = { d: new Float64Array(N), c: new Float64Array(N), v: new Float64Array(N), s: new Float64Array(N) };
  const cached = (table, x, fn) => { let v = memo[table][x]; if (v !== v) { v = fn(); memo[table][x] = v; } return v; };
  const pctVs = (x, keep) => {
    let w = 0, l = 0, t = 0;
    for (let o = 0; o < N; o++) {
      if (o === x || !keep(o)) continue;
      w += HW[x * N + o]; l += HL[x * N + o]; t += HT[x * N + o];
    }
    return pctOf(w, l, t);
  };
  const divPct = (x) => cached('d', x, () => pctVs(x, (o) => conf[o] === conf[x] && div[o] === div[x]));
  const confPct = (x) => cached('c', x, () => pctVs(x, (o) => conf[o] === conf[x]));
  // Strength of victory and of schedule: every win, or every game, counts its
  // opponent's record once.
  const combined = (x, winsOnly) => {
    let w = 0, l = 0, t = 0;
    for (let o = 0; o < N; o++) {
      const n = winsOnly ? HW[x * N + o] : HW[x * N + o] + HL[x * N + o] + HT[x * N + o];
      if (!n) continue;
      w += n * W[o]; l += n * L[o]; t += n * T[o];
    }
    return pctOf(w, l, t);
  };
  const sov = (x) => cached('v', x, () => combined(x, true));
  const sos = (x) => cached('s', x, () => combined(x, false));
  const cmp = (a, b) => {
    const d0 = P[b] - P[a];
    if (Math.abs(d0) > 1e-9) return d0;
    const hw = HW[a * N + b], hl = HL[a * N + b], ht = HT[a * N + b];
    const d1 = pctOf(hl, hw, ht) - pctOf(hw, hl, ht);
    if (hw + hl + ht > 0 && Math.abs(d1) > 1e-9) return d1;
    if (pro) {
      if (conf[a] === conf[b] && div[a] === div[b]) {
        const d2 = divPct(b) - divPct(a);
        if (Math.abs(d2) > 1e-9) return d2;
      }
      const d3 = confPct(b) - confPct(a);
      if (Math.abs(d3) > 1e-9) return d3;
      const common = ctx.common(a, b);
      if (common.size >= 4) {
        const d4 = pctVs(b, (o) => common.has(o)) - pctVs(a, (o) => common.has(o));
        if (Math.abs(d4) > 1e-9) return d4;
      }
      const d5 = sov(b) - sov(a);
      if (Math.abs(d5) > 1e-9) return d5;
      const d6 = sos(b) - sos(a);
      if (Math.abs(d6) > 1e-9) return d6;
    }
    const diff = (PF[b] - PA[b]) - (PF[a] - PA[a]);
    if (diff) return diff;
    if (PF[b] !== PF[a]) return PF[b] - PF[a];
    return a - b;
  };
  cmp.settle = () => {
    for (let i = 0; i < N; i++) P[i] = pctOf(W[i], L[i], T[i]);
    for (const k in memo) memo[k].fill(NaN);
  };
  return cmp;
}

/**
 * Seeds for a finished run, in the order `proStandings` or `standings` gives
 * them, with each conference's division winners. The member lists start in
 * club order, as the real ones do, because a sort only agrees with another
 * sort given the same starting order.
 */
function seedsOf(ctx, cmp) {
  const { N, pro } = ctx;
  if (!pro) {
    const order = ctx.everyone.slice().sort(cmp);
    return { pools: [order.slice(0, playoffFieldSize(N))], divisionWinners: [] };
  }
  const pools = [], divisionWinners = [];
  ctx.divisions.forEach((divs, c) => {
    const winners = divs.map((members) => members.slice().sort(cmp)[0]).sort(cmp);
    const others = ctx.conferences[c].filter((i) => !winners.includes(i)).sort(cmp);
    pools.push([...winners, ...others.slice(0, 3)]);
    divisionWinners.push(...winners);
  });
  return { pools, divisionWinners };
}

/** `pairRound` in season.js: the top seeds sit out until the field is a power of two. */
function pairRound(alive) {
  let size = 1;
  while (size < alive.length) size *= 2;
  const byes = size - alive.length;
  const playing = alive.slice(byes);
  const games = [];
  for (let i = 0; i < playing.length / 2; i++) games.push([playing[i], playing[playing.length - 1 - i]]);
  return { games, byes: alive.slice(0, byes) };
}

/** A playoff game's winner off its uniform: the higher seed at home unless neutral, and no ties. */
function playoffWinner(ctx, u, home, away, neutral) {
  const at = ctx.weeksLeft;
  const mu = (ctx.power[home][at] - ctx.power[away][at]) * POINTS_PER_POWER + (neutral ? 0 : HOME_EDGE_POINTS);
  return mu + GAME_SD * Z[(u * SLICES) | 0] >= 0 ? home : away;
}

/**
 * The bracket from here: each pool reseeds every round and plays down to one,
 * and two pools meet in a neutral-site final. `round` counts rounds from the
 * first, so a game keeps its key whichever round the odds are read in, and
 * `decided` holds the winners of the round under way that are already known.
 */
function playBracket(ctx, runKey, pools, round = 0, decided = null) {
  const alive = pools.map((p) => p.alive.slice());
  const opening = round;
  while (alive.some((a) => a.length > 1)) {
    alive.forEach((a, pi) => {
      if (a.length <= 1) return;
      const r = pairRound(a);
      const through = new Set(r.byes);
      r.games.forEach(([h, v], gi) => {
        const known = round === opening && decided ? decided.get(`${h}:${v}`) : undefined;
        through.add(known ?? playoffWinner(ctx, uniform(runKey, bracketKey(round, pi, gi)), h, v, false));
      });
      alive[pi] = pools[pi].seeds.filter((i) => through.has(i));
    });
    round++;
  }
  if (alive.length === 1) return alive[0][0];
  const [a, b] = alive.map((x) => x[0]);
  return playoffWinner(ctx, uniform(runKey, bracketKey(round, 0, 31)), a, b, true);
}

/**
 * Odds for every club: making the playoffs, winning the division (pro), a
 * first-round bye and the title, as shares of `runs` simulated finishes.
 * Reads the league and changes nothing in it, and draws from its own keyed
 * numbers, so it never moves what the season itself will do.
 */
export function playoffOdds(league, byId, { runs = ODDS_RUNS, seed = null } = {}) {
  const N = league.teams.length;
  const blank = () => new Array(N).fill(0);
  const out = { playoff: blank(), division: blank(), bye: blank(), title: blank(), runs };
  if (league.phase === 'complete' && league.champion != null) {
    out.runs = 1;
    for (const pool of league.playoffs?.pools || []) for (const i of pool.seeds) out.playoff[i] = 1;
    out.title[league.champion] = 1;
    return out;
  }
  if (league.phase !== 'season' && league.phase !== 'playoffs') return null;
  const ctx = prepare(league, byId);
  // One season's worth of keys, the same every week: see the note at the top.
  const seasonKey = seed ?? hashSeed(`odds:${league.seed}:${league.season}`);
  const runKey = (r) => mix(seasonKey + Math.imul(r + 1, 0x632be5ab));

  if (league.phase === 'playoffs') {
    // The field is set; only the bracket is left to play.
    const po = league.playoffs;
    const now = po.rounds[po.round - 1];
    const winnerOf = (g) => (g.result.score[0] >= g.result.score[1] ? g.home : g.away);
    for (const p of po.pools) for (const i of p.seeds) out.playoff[i] = runs;
    for (const b of po.rounds[0]?.byes || []) out.bye[b.team] = runs;
    if (isPro(league)) for (const p of po.pools) for (const i of p.seeds.slice(0, 4)) out.division[i] = runs;
    const decided = new Map();
    for (const g of now?.games || []) if (g.result) decided.set(`${g.home}:${g.away}`, winnerOf(g));
    for (let r = 0; r < runs; r++) {
      let champ;
      if (po.final) {
        const g = now.games[0];
        champ = g.result ? winnerOf(g) : playoffWinner(ctx, uniform(runKey(r), bracketKey(po.round - 1, 0, 31)), g.home, g.away, true);
      } else {
        champ = playBracket(ctx, runKey(r), po.pools.map((p) => ({ seeds: p.seeds, alive: p.alive })), po.round - 1, decided);
      }
      out.title[champ]++;
    }
    return finish(out);
  }

  // The games left as flat arrays, each with the margin its sides expect.
  const G = ctx.games.length;
  const gh = Int16Array.from(ctx.games, (g) => g.home), ga = Int16Array.from(ctx.games, (g) => g.away);
  const gk = Int32Array.from(ctx.games, (g) => g.key);
  const gmu = Float64Array.from(ctx.games, (g) => (ctx.power[g.home][g.at] - ctx.power[g.away][g.at]) * POINTS_PER_POWER + (g.neutral ? 0 : HOME_EDGE_POINTS));
  const base = { ...ctx.rec, hw: ctx.hw, hl: ctx.hl, ht: ctx.ht };
  const run = {
    w: new Int16Array(N), l: new Int16Array(N), t: new Int16Array(N), pf: new Int32Array(N), pa: new Int32Array(N),
    hw: new Int16Array(N * N), hl: new Int16Array(N * N), ht: new Int16Array(N * N),
  };
  const { w: W, l: L, t: T, pf: PF, pa: PA, hw: HW, hl: HL, ht: HT } = run;
  const keys = Object.keys(run);
  const cmp = comparator(ctx, run);
  const keep = 1 - TIE_CHANCE;
  for (let r = 0; r < runs; r++) {
    for (const k of keys) run[k].set(base[k]);
    const rk = runKey(r);
    for (let i = 0; i < G; i++) {
      const h = gh[i], a = ga[i];
      // One number settles a tie or places the margin.
      const u = uniform(rk, gk[i]);
      let m = 0;
      if (u >= TIE_CHANCE) {
        const x = gmu[i] + GAME_SD * Z[(((u - TIE_CHANCE) / keep) * SLICES) | 0];
        m = Math.round(x) || (x >= 0 ? 1 : -1);
      }
      const hs = LOSER_POINTS + (m > 0 ? m : 0), as = LOSER_POINTS + (m < 0 ? -m : 0);
      PF[h] += hs; PA[h] += as; PF[a] += as; PA[a] += hs;
      if (m > 0) { W[h]++; L[a]++; HW[h * N + a]++; HL[a * N + h]++; }
      else if (m < 0) { W[a]++; L[h]++; HW[a * N + h]++; HL[h * N + a]++; }
      else { T[h]++; T[a]++; HT[h * N + a]++; HT[a * N + h]++; }
    }
    cmp.settle();
    const { pools, divisionWinners } = seedsOf(ctx, cmp);
    for (const seeds of pools) {
      for (const i of seeds) out.playoff[i]++;
      for (const i of pairRound(seeds).byes) out.bye[i]++;
    }
    for (const i of divisionWinners) out.division[i]++;
    out.title[playBracket(ctx, rk, pools.map((seeds) => ({ seeds, alive: seeds })))]++;
  }
  return finish(out);
}

/** Which reading the league is due: entering a week of the season, or a playoff round. */
export function oddsKey(league) {
  if (league.phase === 'season') return `w${league.week}`;
  if (league.phase === 'playoffs' && league.playoffs) return `p${league.playoffs.round}`;
  return null;
}

/**
 * The odds entering this week or round, kept on the league for the season so
 * the race chart can show how they moved: `league.odds.points`, one per key,
 * each a share per club in thousandths. A reading already taken is returned
 * as it is, unless it was taken with fewer finishes than asked for, when it
 * is taken again in full.
 */
export function refreshOdds(league, byId, { runs = ODDS_RUNS } = {}) {
  const key = oddsKey(league);
  if (!key || !byId) return null;
  if (league.odds?.season !== league.season) league.odds = { season: league.season, points: [] };
  const have = league.odds.points.find((p) => p.key === key);
  if (have && have.runs >= runs) return have;
  const o = playoffOdds(league, byId, { runs });
  if (!o) return null;
  const mille = (a) => a.map((x) => Math.round(x * 1000));
  const point = { key, runs: o.runs, playoff: mille(o.playoff), division: mille(o.division), title: mille(o.title) };
  if (have) Object.assign(have, point);
  else league.odds.points.push(point);
  return point;
}

/** The season's readings so far, oldest first, or none. */
export function oddsPoints(league) {
  return league.odds?.season === league.season ? league.odds.points : [];
}

function finish(out) {
  for (const k of ['playoff', 'division', 'bye', 'title']) out[k] = out[k].map((n) => n / out.runs);
  return out;
}

/**
 * The seeds the tables give for the season as it stands, with nothing
 * simulated: what the test holding this file to the real standings compares.
 */
export function _seedsForTest(league) {
  const ctx = prepare(league, null, { power: false });
  const cmp = comparator(ctx, { ...ctx.rec, hw: ctx.hw, hl: ctx.hl, ht: ctx.ht });
  cmp.settle();
  return seedsOf(ctx, cmp);
}
