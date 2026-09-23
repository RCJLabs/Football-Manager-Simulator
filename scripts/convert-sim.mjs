// What a position change is worth, measured rather than assumed.
//
// 1. The table. Every move the attribute lists could allow with one skill to
//    guess: how heavy that skill is at the new position, how well the pool
//    predicts it, and so whether the move is on offer. Where another position
//    carries the guessed skill and every predictor, the fit is also tried on
//    those men — a fit checked only on the players it was fitted to says how
//    well it describes them, not how well it carries over to a different kind
//    of player, and carrying over is exactly what a move asks of it.
// 2. The pool. For every man at a position with somewhere to go: what the move
//    does to his settled rating, and whether he would be worth more there by
//    leverage if nothing were charged — the arbitrage the premium closes.
// 3. The market. Simulated pro leagues are stopped at free agency, when a club
//    can see what the market has, and each club's best move by a rule is
//    applied to a copy of the league. Both copies are run to kickoff off the
//    same random stream, so the difference in that club's lineup and payroll
//    is what the move did. Two rules: one that knows the market (the best man
//    still unsigned at each position) and pays the premium, and a naive one
//    that moves anybody worth more at the new position by leverage. What the
//    first finds is what a club that never moves anybody — every AI club —
//    leaves on the table.
//
// Usage: node scripts/convert-sim.mjs [leagues] [offseasons] [first seed]
import { PLAYERS, PLAYERS_BY_ID } from '../src/data/db.js';
import { POSITIONS, ROSTER_SLOTS } from '../src/data/positions.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, startSeason, registerPlayers } from '../src/engine/season.js';
import { autoDraftAll } from '../src/engine/draft.js';
import { simulateAhead } from '../src/engine/autosim.js';
import { enterOffseason, aiKeepers, confirmKeepers, closeFreeAgency } from '../src/engine/offseason.js';
import { applyCareers, careerIndex } from '../src/engine/careers.js';
import { leaguePool, leagueIndex } from '../src/engine/rookies.js';
import { capHit, marketSalary, MARKET_RATE } from '../src/engine/cap.js';
import { lineupStrength, ownerMap } from '../src/engine/transactions.js';
import { rawOverall, TRUE_LEVERAGE, overall } from '../src/engine/ratings.js';
import { CONVERSIONS, estimateFor, guessError, fillFor, movedBase, MAX_GUESS, SETTLING } from '../src/engine/translate.js';
import { candidatesFor, convertPlayer } from '../src/engine/convert.js';

registerPlayers(PLAYERS_BY_ID);
const LEAGUES = Number(process.argv[2] || 2);
const SEASONS = Number(process.argv[3] || 3);
const SEED0 = Number(process.argv[4] || 5100);
const LEV = TRUE_LEVERAGE;
const q = (xs, f) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN);
const sd = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
const f1 = (v) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(1) : '—');
const pool = (pos) => PLAYERS.filter((p) => p.pos === pos && !p.generated);

// ---- 1. The table --------------------------------------------------------
console.log(`1. Which moves are on offer: at most one skill guessed, and its weight × the fit's typical miss ≤ ${MAX_GUESS} overall point`);
console.log('   move      guessed  weight   miss   R²    ±ovr   on offer   tried elsewhere');
for (const from of Object.keys(POSITIONS)) {
  for (const to of Object.keys(POSITIONS)) {
    if (from === to) continue;
    const miss = POSITIONS[to].attrs.filter((a) => !POSITIONS[from].attrs.includes(a));
    if (miss.length > 1 || POSITIONS[to].attrs.length - miss.length < 3) continue;
    const fit = estimateFor(from, to);
    const on = CONVERSIONS[from]?.includes(to) ? 'yes' : 'no';
    if (!fit) { console.log(`   ${`${from}->${to}`.padEnd(9)} —        nothing to guess                    ${on}`); continue; }
    const w = Math.max(POSITIONS[to].weights[fit.attr] ?? 0, POSITIONS[to].edgeWeights?.[fit.attr] ?? 0);
    // Another position that carries the guessed skill and every predictor.
    const other = Object.keys(POSITIONS).find((p) => p !== to && POSITIONS[p].attrs.includes(fit.attr) && fit.from.every((a) => POSITIONS[p].attrs.includes(a)));
    let elsewhere = '—';
    if (other) {
      const errs = pool(other).map((p) => fit.predict(p.r) - p.r[fit.attr]);
      elsewhere = `on ${other}: miss ${Math.sqrt(mean(errs.map((e) => e * e))).toFixed(1)}, bias ${f1(mean(errs))}`;
    }
    console.log(`   ${`${from}->${to}`.padEnd(9)} ${fit.attr.padEnd(8)} ${w.toFixed(2).padStart(5)}  ${fit.rse.toFixed(2).padStart(5)}  ${(1 - (fit.rse / fit.spread) ** 2).toFixed(2)}  ${guessError(from, to).toFixed(2).padStart(5)}   ${on.padEnd(9)}  ${elsewhere}`);
  }
}

// ---- 2. The pool ---------------------------------------------------------
console.log('\n2. Every real player at a position with somewhere to go (settled rating, guessed skill marked down)');
console.log('   move    n    rating change: mean   p10   p50   p90 | better there | worth more by leverage, unpriced | premium: median, p90');
for (const [from, tos] of Object.entries(CONVERSIONS)) {
  for (const to of tos) {
    const rows = pool(from).map((p) => {
      const there = movedBase(p, { to, season: 1, fill: fillFor(p.r, from, to) });
      const own = rawOverall(from, p.r);
      const o = rawOverall(to, there.r);
      return { d: o - own, more: LEV[to] * Math.max(0, o - 60) > LEV[from] * Math.max(0, own - 60), premium: Math.max(0, marketSalary(there) - marketSalary(p)) };
    });
    const d = rows.map((r) => r.d);
    console.log(`   ${`${from}->${to}`.padEnd(7)} ${String(rows.length).padStart(3)}   ${f1(mean(d)).padStart(19)} ${String(q(d, 0.1)).padStart(5)} ${String(q(d, 0.5)).padStart(5)} ${String(q(d, 0.9)).padStart(5)} | ${`${(100 * rows.filter((r) => r.d > 0).length / rows.length).toFixed(0)}%`.padStart(12)} | ${`${(100 * rows.filter((r) => r.more).length / rows.length).toFixed(0)}%`.padStart(32)} | $${q(rows.map((r) => r.premium), 0.5)}, $${q(rows.map((r) => r.premium), 0.9)}`);
  }
}
console.log(`   Settling costs every skill ${SETTLING[0]} in the first season and ${SETTLING[1]} in the second: at a corner's leverage that is about $${(MARKET_RATE * LEV.CB * SETTLING[0]).toFixed(1)} and $${(MARKET_RATE * LEV.CB * SETTLING[1]).toFixed(1)} of value.`);

// ---- 3. The market -------------------------------------------------------
const index = (lg) => careerIndex(lg, leagueIndex(lg, PLAYERS_BY_ID));
const poolOf = (lg) => applyCareers(lg, leaguePool(lg, PLAYERS));
const STARTER = new Set(ROSTER_SLOTS.filter((s) => s.starter).map((s) => s.id));

/** The best rating still unsigned at each position: what the market has. */
function available(lg, byId) {
  const owned = ownerMap(lg);
  const retired = new Set(lg.retired || []);
  const best = {};
  for (const p of byId.values()) {
    if (owned.has(p.id) || retired.has(p.id)) continue;
    best[p.pos] = Math.max(best[p.pos] ?? 0, overall(p));
  }
  return best;
}

/** A club's best move under a rule, or null. */
function plan(lg, ti, byId, avail, rule) {
  let best = null;
  for (const s of ROSTER_SLOTS) {
    if (!STARTER.has(s.id) || lg.teams[ti].slots[s.id]) continue;
    for (const c of candidatesFor(lg, ti, s.id, byId)) {
      const from = c.p.pos;
      const score = rule === 'market'
        // His first season at the hole against the best the market has there,
        // and the best the market has at the hole he leaves against him — net
        // of the premium at the market's own rate.
        ? LEV[s.pos] * (c.first - (avail[s.pos] ?? 60)) + LEV[from] * ((avail[from] ?? 60) - c.now) - c.premium / MARKET_RATE
        // Worth more there by leverage, ignoring the market and the premium.
        : LEV[s.pos] * Math.max(0, c.settled - 60) - LEV[from] * Math.max(0, c.now - 60);
      if (score > 0 && (!best || score > best.score)) best = { slot: s.id, id: c.id, score, from, to: s.pos, premium: c.premium };
    }
  }
  return best;
}

/** From free agency to kickoff, the way simulating ahead does it. */
function toKickoff(lg, seed) {
  const byId = index(lg);
  const p = poolOf(lg);
  closeFreeAgency(lg, p, byId);
  autoDraftAll(lg, lg.draft, p, new RNG(seed));
  startSeason(lg, index(lg));
}

const results = { market: [], naive: [], oracle: [] };
const ORACLE_EVERY = Number(process.env.ORACLE_EVERY || 4);
let clubStops = 0, withCandidates = 0, oracleClubs = 0;
for (let L = 0; L < LEAGUES; L++) {
  const seed = SEED0 + L * 41;
  let lg = createLeague({ name: 'M', mode: 'pro', numTeams: 32, franchise: 12, seed, draftType: 'snake', user: {}, injuries: 'normal' });
  lg.settings.jobs = false;
  autoDraftAll(lg, lg.draft, PLAYERS, new RNG(seed));
  startSeason(lg, PLAYERS_BY_ID);
  for (let yr = 1; yr <= SEASONS; yr++) {
    simulateAhead(lg, index(lg), poolOf(lg), new RNG(seed * 7 + yr), 'offseason');
    if (lg.phase !== 'complete') break;
    enterOffseason(lg, poolOf(lg), index(lg));
    const u = lg.teams.findIndex((t) => t.isUser);
    confirmKeepers(lg, aiKeepers(lg, u, poolOf(lg), index(lg), null), poolOf(lg), index(lg));
    if (lg.offseason?.step !== 'freeagency') throw new Error(`expected free agency, at ${lg.phase}/${lg.offseason?.step}`);
    const byId = index(lg);
    const avail = available(lg, byId);
    const kick = seed * 13 + yr;
    // The league with nobody moved, run to kickoff once: every club's move is
    // measured against the same baseline. Run twice and compared first, since
    // a baseline that did not reproduce would make every difference noise.
    const base = structuredClone(lg);
    toKickoff(base, kick);
    const again = structuredClone(lg);
    toKickoff(again, kick);
    const baseIdx = index(base);
    const without = base.teams.map((t, ti) => ({ line: lineupStrength(t.slots, baseIdx), cap: capHit(base, ti) }));
    if (again.teams.some((t, ti) => lineupStrength(t.slots, index(again)) !== without[ti].line)) throw new Error('the baseline does not reproduce');
    const measure = (ti, id, slot) => {
      const b = structuredClone(lg);
      const res = convertPlayer(b, ti, id, slot, index(b));
      if (!res.ok) throw new Error(res.reason);
      toKickoff(b, kick);
      const gain = lineupStrength(b.teams[ti].slots, index(b)) - without[ti].line;
      const paid = capHit(b, ti) - without[ti].cap;
      return { gain, paid, net: gain - paid / MARKET_RATE };
    };
    lg.teams.forEach((_, ti) => {
      clubStops++;
      const open = ROSTER_SLOTS.filter((s) => STARTER.has(s.id) && !lg.teams[ti].slots[s.id]);
      const options = open.flatMap((s) => candidatesFor(lg, ti, s.id, byId).map((c) => ({ slot: s.id, c })));
      if (options.length) withCandidates++;
      for (const rule of ['market', 'naive']) {
        const pick = plan(lg, ti, byId, avail, rule);
        if (!pick) continue;
        results[rule].push({ ...measure(ti, pick.id, pick.slot), est: pick.score, move: `${pick.from}->${pick.to}` });
      }
      // Every move the club could make, each run to kickoff, and the best of
      // them or none: a ceiling on what a club that sees the future could get.
      if (ti % ORACLE_EVERY === 0 && options.length) {
        oracleClubs++;
        let best = { net: 0, gain: 0, paid: 0, move: 'none' };
        for (const { slot, c } of options) {
          const m = measure(ti, c.id, slot);
          if (m.net > best.net) best = { ...m, move: `${c.p.pos}->${ROSTER_SLOTS.find((s) => s.id === slot).pos}` };
        }
        results.oracle.push({ ...best, tried: options.length });
      }
    });
    lg = base;
  }
}
console.log(`\n3. At free agency, ${LEAGUES} leagues × ${SEASONS} offseasons × 32 clubs: ${clubStops} club-offseasons, ${withCandidates} with an open starting slot somebody on the club could move into; the oracle tried every such move at ${oracleClubs} of them`);
console.log('   The club\'s lineup at kickoff, with its best move against without (overall × leverage; a starter point at corner is 4.39):');
for (const [rule, rows] of Object.entries(results)) {
  if (!rows.length) { console.log(`   ${rule.padEnd(7)} never moves anybody`); continue; }
  if (rule === 'oracle') {
    const net = rows.map((r) => r.net);
    console.log(`   oracle  best of ${mean(rows.map((r) => r.tried)).toFixed(1)} moves, or none · a move helps at all in ${(100 * rows.filter((r) => r.net > 0).length / rows.length).toFixed(0)}% · net ${f1(mean(net))} ± ${(sd(net) / Math.sqrt(net.length)).toFixed(1)} (se) · p50 ${f1(q(net, 0.5))} p90 ${f1(q(net, 0.9))} max ${f1(Math.max(...net))} · lineup ${f1(mean(rows.map((r) => r.gain)))}, payroll ${f1(mean(rows.map((r) => r.paid)))}`);
    continue;
  }
  const net = rows.map((r) => r.net);
  const moves = {};
  for (const r of rows) moves[r.move] = (moves[r.move] || 0) + 1;
  console.log(`   ${rule.padEnd(7)} moves in ${rows.length} (${(100 * rows.length / clubStops).toFixed(1)}%) · lineup ${f1(mean(rows.map((r) => r.gain)))} · payroll ${f1(mean(rows.map((r) => r.paid)))} · net of payroll at the market rate ${f1(mean(net))} ± ${(sd(net) / Math.sqrt(net.length)).toFixed(1)} (se) · net > 0 in ${(100 * net.filter((x) => x > 0).length / net.length).toFixed(0)}% · p10 ${f1(q(net, 0.1))} p90 ${f1(q(net, 0.9))}`);
  console.log(`           ${Object.entries(moves).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
}
