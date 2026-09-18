// Simulate many games between synthetic (or drafted) teams and print league
// averages so engine constants can be tuned to NFL-like output.
// Usage: node scripts/calibrate.mjs [games] [meanA] [meanB]
import { syntheticTeam } from './synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, simulateGame } from '../src/engine/game.js';

const N = Number(process.argv[2] || 300);
const meanA = Number(process.argv[3] || 85);
const meanB = Number(process.argv[4] || 85);

const SD = Number(process.argv[5] || 2);
const A = syntheticTeam('alpha', meanA, SD, 1);
const B = syntheticTeam('bravo', meanB, SD, 2);
const lineupA = buildLineup(A.slots, A.byId);
const lineupB = buildLineup(B.slots, B.byId);

const agg = { games: 0, pts: [0, 0], wins: [0, 0], ties: 0, plays: 0, passAtt: 0, passCmp: 0, passYds: 0, rushAtt: 0, rushYds: 0, sacks: 0, int: 0, fum: 0, to: 0, fd: 0, third: 0, thirdConv: 0, fga: 0, fgm: 0, punts: 0, drives: 0, ot: 0, maxPts: 0, minPts: 999, top: [0, 0], penalties: 0, passTd: 0, rushTd: 0 };
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const g = createGame({ ...A, lineup: lineupA }, { ...B, lineup: lineupB }, { seed: 1000 + i });
  simulateGame(g);
  agg.games++;
  for (const s of [0, 1]) {
    agg.pts[s] += g.score[s];
    agg.maxPts = Math.max(agg.maxPts, g.score[s]);
    agg.minPts = Math.min(agg.minPts, g.score[s]);
    const t = g.stats[s].team;
    agg.plays += t.plays; agg.passAtt += t.passAtt; agg.passCmp += t.passCmp; agg.passYds += t.passYds;
    agg.rushAtt += t.rushAtt; agg.rushYds += t.rushYds; agg.sacks += t.sacksAllowed; agg.to += t.turnovers;
    agg.fd += t.firstDowns; agg.third += t.thirdAtt; agg.thirdConv += t.thirdConv; agg.drives += t.drives; agg.top[s] += t.top;
    for (const ps of Object.values(g.stats[s].players)) {
      agg.int += ps.pass.int; agg.fum += ps.rush.fum; agg.fga += ps.k.fga; agg.fgm += ps.k.fgm; agg.punts += ps.p.n;
      agg.passTd += ps.pass.td; agg.rushTd += ps.rush.td;
    }
  }
  if (g.score[0] > g.score[1]) agg.wins[0]++; else if (g.score[1] > g.score[0]) agg.wins[1]++; else agg.ties++;
  if (g.quarter >= 5) agg.ot++;
  if (i === 0 && process.env.LOG) for (const e of g.log) console.log(`[${e.q} ${Math.floor(e.clock / 60)}:${String(e.clock % 60).padStart(2, '0')}] ${e.situation || ''} ${e.text}`);
}
const per = (x) => (x / (agg.games * 2)).toFixed(1);
console.log(`${N} games in ${Date.now() - t0}ms  (means ${meanA} vs ${meanB})`);
console.log(`win%  A ${(agg.wins[0] / N * 100).toFixed(1)}  B ${(agg.wins[1] / N * 100).toFixed(1)}  ties ${agg.ties}  OT games ${agg.ot}`);
console.log(`pts/team  A ${(agg.pts[0] / N).toFixed(1)}  B ${(agg.pts[1] / N).toFixed(1)}   max ${agg.maxPts} min ${agg.minPts}`);
console.log(`plays/team ${per(agg.plays)}  drives ${per(agg.drives)}  TOP A ${(agg.top[0] / N / 60).toFixed(1)}m B ${(agg.top[1] / N / 60).toFixed(1)}m`);
console.log(`pass att ${per(agg.passAtt)} cmp ${per(agg.passCmp)} (${(agg.passCmp / agg.passAtt * 100).toFixed(1)}%) yds ${per(agg.passYds)} ypa ${(agg.passYds / agg.passAtt).toFixed(2)} td ${per(agg.passTd)} int ${per(agg.int)}`);
console.log(`rush att ${per(agg.rushAtt)} yds ${per(agg.rushYds)} ypc ${(agg.rushYds / agg.rushAtt).toFixed(2)} td ${per(agg.rushTd)} fum ${per(agg.fum)}`);
console.log(`total yds ${per(agg.passYds + agg.rushYds)}  1st downs ${per(agg.fd)}  3rd ${(agg.thirdConv / agg.third * 100).toFixed(1)}%  sacks ${per(agg.sacks)}  TO ${per(agg.to)}`);
console.log(`FG ${per(agg.fgm)}/${per(agg.fga)} (${(agg.fgm / agg.fga * 100).toFixed(1)}%)  punts ${per(agg.punts)}`);
