// The two measurements behind src/engine/pickvalue.js, both of which produced
// answers I did not expect. Usage:
//
//   node scripts/pickcurve.mjs            twelve clubs
//   PRO=1 node scripts/pickcurve.mjs      thirty-two
//
// Part one measures v(k) directly: what a club loses when its pick at slot k is
// swapped for the last pick in the draft, averaged over eight leagues and three
// draws each so the chaos of a single draft cancels. That is the curve the
// fitted shape in pickvalue.js is fitted to.
//
// Part two is the one that mattered. The plan was to retire `projectPickTrade`
// and price every deal off the curve, because simulating a draft twice on the
// render path is slow and its error bar on one deal is ±20 against a signal of
// ±13. Scored against the truth — the real change to a finished roster,
// averaged over six draws — the simulation wins and it is not close. The
// regression slope at the end says whether PICK_SCALE is calibrated; when this
// was run it came back at 1.00 and the curve's error barely moved, which is the
// tell that the gap is not scale but that a curve knows nothing about what a
// club actually needs.

import { PLAYERS, PLAYERS_BY_ID as byId } from '../src/data/db.js';
import { RNG } from '../src/engine/rng.js';
import { createLeague, fillOpenSlots } from '../src/engine/season.js';
import { aiChoose, makePick, openSlots, runAiPicks, currentPicker, TOTAL_ROUNDS } from '../src/engine/draft.js';
import { pickOwner, remainingPicks, validatePickTrade, projectPickTrade } from '../src/engine/draftpicks.js';
import { lineupStrength } from '../src/engine/transactions.js';
import { handValue } from '../src/engine/pickvalue.js';

const PRO = !!process.env.PRO;
const mk = (seed) => createLeague({
  name: 'V', user: { name: 'Me', abbr: 'ME', color: '#fff' },
  numTeams: PRO ? 32 : 12, seed, draftType: 'snake', ...(PRO ? { mode: 'pro' } : {}),
});
const N = mk(1).teams.length, TOTAL = TOTAL_ROUNDS * N;

const sandbox = (l, d) => ({
  league: { ...l, teams: l.teams.map((t) => ({ ...t, slots: { ...t.slots } })) },
  draft: { ...d, taken: { ...d.taken }, picks: d.picks.slice(), traded: { ...(d.traded || {}) } },
});
function roll(lg, d, rng) {
  let guard = 0;
  while (!d.complete && guard++ < TOTAL_ROUNDS * d.order.length + 5) {
    const t = pickOwner(d, d.round, d.pickInRound); if (t == null) break;
    const p = aiChoose(lg, d, PLAYERS, t, rng); if (!p) break;
    makePick(lg, d, p);
  }
}
const val = (lg, i) => lineupStrength(lg.teams[i].slots, byId, null);
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sem = (a) => Math.sqrt(a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) / Math.max(1, a.length - 1)) / Math.sqrt(a.length);
const at = (d, k) => pickOwner(d, Math.floor((k - 1) / N) + 1, (k - 1) % N);

console.log(`${N} clubs, ${TOTAL} picks\n`);
console.log('  slot    frac      v(k)');
for (const k of [1, 2, 3, 5, 8, 12, 16, 20, 24, 32, 48, 64, 96, 150, 250]) {
  if (k >= TOTAL - N) continue;
  const out = [];
  for (let seed = 1; seed <= 8; seed++) {
    const lg = mk(seed), d = lg.draft;
    const a = at(d, k), b = at(d, TOTAL);
    if (a == null || b == null || a === b) continue;
    for (let t = 0; t < 3; t++) {
      const B0 = sandbox(lg, d); roll(B0.league, B0.draft, new RNG(seed * 811 + t));
      const A1 = sandbox(lg, d);
      A1.draft.traded = { ...A1.draft.traded, [k]: b, [TOTAL]: a };
      roll(A1.league, A1.draft, new RNG(seed * 811 + t));
      out.push(val(B0.league, a) - val(A1.league, a));   // what giving up slot k costs
    }
  }
  if (!out.length) continue;
  console.log(`${String(k).padStart(6)}  ${((k - 1) / (TOTAL - 1)).toFixed(4)}  ${mean(out).toFixed(1).padStart(7)} ±${(sem(out) * 2).toFixed(1)}`);
}

// The truth: the real change to the club's finished roster, over several draws.
function truth(lg, d, a, u, aGives, uGives, draws = 6) {
  const out = [];
  for (let k = 0; k < draws; k++) {
    const B0 = sandbox(lg, d); roll(B0.league, B0.draft, new RNG(1009 + k * 13));
    fillOpenSlots(B0.league, PLAYERS, byId, { log: false });
    const A1 = sandbox(lg, d);
    A1.draft.traded ??= {};
    for (const p of aGives) A1.draft.traded[p.overall] = u;
    for (const p of uGives) A1.draft.traded[p.overall] = a;
    roll(A1.league, A1.draft, new RNG(1009 + k * 13));
    fillOpenSlots(A1.league, PLAYERS, byId, { log: false });
    out.push(val(A1.league, u) - val(B0.league, u));
  }
  return mean(out);
}
// The curve's answer: the club's hand of picks, before and after.
function curved(lg, d, u, aGives, uGives) {
  const slots = openSlots(lg.teams[u]).length;
  const before = remainingPicks(d, u);
  const gone = new Set(uGives.map((p) => p.overall));
  const after = before.filter((p) => !gone.has(p.overall)).concat(aGives);
  return handValue(after, slots, TOTAL, N) - handValue(before, slots, TOTAL, N);
}

const rows = [];
for (let seed = 1; seed <= 7; seed++) {
  const lg = mk(seed), d = lg.draft, u = lg.teams.findIndex((t) => t.isUser);
  runAiPicks(lg, d, PLAYERS, new RNG(seed * 7));
  if (d.complete || currentPicker(d) !== u) continue;
  const mine = remainingPicks(d, u);
  for (const a of lg.teams.map((_, i) => i).filter((i) => i !== u).slice(0, 3)) {
    const theirs = remainingPicks(d, a);
    for (const [ag, ug] of [
      [[theirs[0]], [mine[0]]],
      [[theirs[0]], [mine[1]]],
      [[theirs[0]], [mine[0], mine[1]]],
      [[theirs[0]], [mine[0], mine[mine.length - 1]]],
      [[theirs[0], theirs[1]], [mine[0]]],
    ]) {
      if (!ag.every(Boolean) || !ug.every(Boolean)) continue;
      if (!validatePickTrade(lg, d, a, u, ag, ug).ok) continue;
      rows.push({
        t: truth(lg, d, a, u, ag, ug),
        sim: projectPickTrade(lg, d, PLAYERS, byId, a, u, ag, ug).b,
        cv: curved(lg, d, u, ag, ug),
      });
    }
  }
}
const corr = (x, y) => {
  const mx = mean(x), my = mean(y);
  let s = 0, a = 0, b = 0;
  for (let i = 0; i < x.length; i++) { const dx = x[i] - mx, dy = y[i] - my; s += dx * dy; a += dx * dx; b += dy * dy; }
  return s / Math.sqrt(a * b);
};
const T = rows.map((r) => r.t), S = rows.map((r) => r.sim), C = rows.map((r) => r.cv);
const mae = (p) => mean(p.map((v, i) => Math.abs(v - T[i])));
console.log(`\n${rows.length} trades scored against the truth (6 draws each)\n`);
console.log(`  simulation  r = ${corr(T, S).toFixed(3)}   mean |error| ${mae(S).toFixed(1)}`);
console.log(`  curve       r = ${corr(T, C).toFixed(3)}   mean |error| ${mae(C).toFixed(1)}`);
const mc = mean(C), mt = mean(T);
let num = 0, den = 0;
for (let i = 0; i < C.length; i++) { num += (C[i] - mc) * (T[i] - mt); den += (C[i] - mc) ** 2; }
console.log(`\n  truth ~= ${(num / den).toFixed(2)} x curve  (1.00 means PICK_SCALE is calibrated)`);
