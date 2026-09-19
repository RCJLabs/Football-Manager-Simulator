// Tuning harness for the two defensive dials, with guardrails.
//
//   node scripts/defense-tune.mjs [games]
//
// A dial is a decision when the best setting *flips* with the roster: blitzing
// should pay behind an elite front that can also cover, and cost behind a thin
// secondary. The pass/run balance already behaves that way and is the model.
//
// Measured before this harness existed: across its whole range the blitz bought
// +0.42 ± 0.08 sacks and conceded +0.26 ± 0.07 yards an attempt — about nine
// yards given up to save four, on every roster. The shell moved yards an
// attempt in the right direction and by the right relative amounts (-0.38 for a
// slow secondary against -0.14 for a fast one) but never reached the scoreboard.
// Right shape, an order of magnitude too weak.
//
// The guardrails exist because it is easy to make a dial matter by making
// defence dominate. Scoring, sack rate, completion rate and yards an attempt
// all have to stay where they are.

import { syntheticTeam } from './synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, simulateGame } from '../src/engine/game.js';
import { ROSTER_SLOTS } from '../src/data/positions.js';

const N = Number(process.argv[2] || 700);
const BASE = { passRate: 0.55, aggression: 0.4, tempo: 0.5, blitzRate: 0.25, deepShell: 0.2 };

function clone(base) {
  const c = { ...base, id: 'bravo', name: 'bravo', abbr: 'BRA', slots: {}, byId: new Map() };
  for (const s of ROSTER_SLOTS) {
    const p = base.byId.get(base.slots[s.id]);
    const t = { ...p, id: `b-${p.id}`, r: { ...p.r } };
    c.byId.set(t.id, t); c.slots[s.id] = t.id;
  }
  return c;
}

/**
 * A's dial moved from `lo` to `hi`, paired: the same seed and the same rosters
 * played twice, so the difference is the dial and nothing else.
 *
 * Reported on what A's defence allowed rather than on the final margin. A
 * game's margin carries a standard deviation of about 13 points, so 500 games
 * leaves ±0.55 on it — wider than the effect being tuned, and three rounds of
 * tuning against it were three rounds of chasing noise. Points and yards an
 * attempt allowed come from sixty-odd plays a game instead of one result, and
 * land inside ±0.1. Margin is confirmed once at the end, with the games to
 * afford it.
 */
function paired(key, lo, hi, posMeans) {
  const dPts = [], dYpa = [], dSck = [], dMargin = [];
  for (let i = 0; i < N; i++) {
    const seed = 9600 + i;
    const base = syntheticTeam('alpha', 82, 2, seed, { posMeans });
    const opp = clone(base);
    const aHome = i % 2 === 0;
    const snap = [];
    for (const v of [lo, hi]) {
      const mk = (t, val) => ({ ...t, lineup: buildLineup(t.slots, t.byId), isUser: true, strategy: { ...BASE, [key]: val } });
      const g = createGame(aHome ? mk(base, v) : mk(opp, BASE[key]), aHome ? mk(opp, BASE[key]) : mk(base, v), { seed, homeAdvantage: false });
      simulateGame(g);
      const a = aHome ? 0 : 1, o = 1 - a;
      const t = g.stats[o].team;
      snap.push({ pts: g.score[o], ypa: t.passAtt ? t.passYds / t.passAtt : 0, sck: t.sacksAllowed || 0, margin: g.score[a] - g.score[o] });
    }
    dPts.push(snap[1].pts - snap[0].pts);
    dYpa.push(snap[1].ypa - snap[0].ypa);
    dSck.push(snap[1].sck - snap[0].sck);
    dMargin.push(snap[1].margin - snap[0].margin);
  }
  const stat = (arr) => {
    const m = arr.reduce((s, x) => s + x, 0) / arr.length;
    const sd = Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
    return { m, se: sd / Math.sqrt(arr.length) };
  };
  return { pts: stat(dPts), ypa: stat(dYpa), sck: stat(dSck), margin: stat(dMargin) };
}

/** League-average shape of a game, so a tuning change cannot quietly break it. */
function guardrails() {
  let pts = 0, sck = 0, att = 0, cmp = 0, yds = 0, ints = 0, games = 0;
  for (let i = 0; i < N; i++) {
    const seed = 5200 + i;
    const a = syntheticTeam('alpha', 82, 2, seed);
    const b = syntheticTeam('bravo', 82, 2, seed + 991);
    const mk = (t) => ({ ...t, lineup: buildLineup(t.slots, t.byId), isUser: true, strategy: { ...BASE } });
    const g = createGame(mk(a), mk(b), { seed, homeAdvantage: false });
    simulateGame(g);
    for (const side of [0, 1]) {
      const t = g.stats[side].team;
      pts += g.score[side]; sck += t.sacksAllowed || 0;
      att += t.passAtt || 0; cmp += t.passCmp || 0; yds += t.passYds || 0; ints += t.turnovers || 0;
    }
    games++;
  }
  return { pts: pts / games / 2, sck: sck / games / 2, cmpPct: cmp / att * 100, ypa: yds / att, int: ints / games / 2 };
}

const fmt = (s) => `${(s.m >= 0 ? '+' : '') + s.m.toFixed(2)}±${s.se.toFixed(2)}`;
const helps = (s) => s.m < -2 * s.se;   // allowed fewer points: the call paid off
const hurts = (s) => s.m > 2 * s.se;

console.log(`${N} paired games per cell. Change when A moves the dial up.\n`);
// Each pair varies exactly one thing. The first attempt at these moved the
// front and the secondary together, which confounded the axis being tested: a
// poor defence gains more from any gamble simply because it is poor, so a
// "thin front, thin cover" roster came out liking the blitz more than an elite
// one did. What a blitz actually asks is whether the secondary can survive
// being left alone, so the front is held level and only the coverage moves.
const cases = [
  ['blitz', 'blitzRate', 0.05, 0.6,
    ['good front, good cover', { DL: 90, LB: 88, CB: 90, S: 89 }],
    ['good front, thin cover', { DL: 90, LB: 88, CB: 72, S: 72 }]],
  ['shell', 'deepShell', 0, 0.6,
    ['slow secondary        ', { CB: 72, S: 72, DL: 84, LB: 84 }],
    ['fast secondary        ', { CB: 92, S: 92, DL: 84, LB: 84 }]],
];
for (const [name, key, lo, hi, wantHigh, wantLow] of cases) {
  const a = paired(key, lo, hi, wantHigh[1]);
  const b = paired(key, lo, hi, wantLow[1]);
  console.log(`${name} up on ${wantHigh[0]}: pts ${fmt(a.pts)}  y/att ${fmt(a.ypa)}  sacks ${fmt(a.sck)}  margin ${fmt(a.margin)}`);
  console.log(`${' '.repeat(name.length)} up on ${wantLow[0]}: pts ${fmt(b.pts)}  y/att ${fmt(b.ypa)}  sacks ${fmt(b.sck)}  margin ${fmt(b.margin)}`);
  const flips = helps(a.pts) && hurts(b.pts);
  console.log(`${' '.repeat(name.length)} => ${flips ? 'A DECISION: pays on one roster, costs on the other' : helps(a.pts) || hurts(b.pts) ? 'moves, but does not flip' : 'still flat'}\n`);
}

const gr = guardrails();
console.log(`guardrails (per team per game): ${gr.pts.toFixed(1)} pts · ${gr.sck.toFixed(2)} sacks · ${gr.cmpPct.toFixed(1)}% comp · ${gr.ypa.toFixed(2)} y/att · ${gr.int.toFixed(2)} turnovers`);
console.log('baseline before this pass:       23.3 pts · 2.47 sacks · 63.3% comp · 7.44 y/att');
