// Does a simulated game look like a football game?
//
//   node scripts/realism.mjs [games]
//
// Every number the engine produces, against what the real league does. Not to
// copy the NFL — this is an all-time-greats league and should score more — but
// because the shape has to hold: if third downs convert at 12% or nobody ever
// punts, the game is wrong in a way no amount of balance tuning will fix, and
// it is the sort of wrong that is invisible until it is counted.
//
// Reference column is modern NFL, rounded, from league averages.

import { syntheticTeam } from './synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, simulateGame } from '../src/engine/game.js';

const N = Number(process.argv[2] || 400);
const acc = {};
const add = (k, v) => { acc[k] = (acc[k] || 0) + v; };
let games = 0, sides = 0;
const lens = { run: [], pass: [], punt: [], drivePlays: [] };
let scoringDrives = 0, drives = 0, tds = 0, fgs = 0, puntDrives = 0, driveTurnovers = 0;
let otGames = 0, shutouts = 0, ties = 0;
const margins = [], totals = [];

for (let i = 0; i < N; i++) {
  const a = syntheticTeam(`ra${i}`, 82, 4, 9000 + i);
  const b = syntheticTeam(`rb${i}`, 82, 4, 9500 + i);
  const g = createGame({ ...a, lineup: buildLineup(a.slots, a.byId) }, { ...b, lineup: buildLineup(b.slots, b.byId) }, { seed: 9000 + i });
  simulateGame(g);
  games++;
  if (g.quarter >= 5) otGames++;
  if (g.score[0] === g.score[1]) ties++;
  if (g.score.includes(0)) shutouts++;
  margins.push(Math.abs(g.score[0] - g.score[1]));
  totals.push(g.score[0] + g.score[1]);

  for (const st of g.stats) {
    sides++;
    const t = st.team;
    for (const k of ['plays', 'passAtt', 'passCmp', 'passYds', 'rushAtt', 'rushYds', 'totalYds', 'firstDowns',
      'thirdAtt', 'thirdConv', 'fourthAtt', 'fourthConv', 'turnovers', 'sacksAllowed', 'redZoneAtt', 'redZoneTd',
      'penalties', 'penYds', 'points']) add(k, t[k] || 0);
    for (const p of Object.values(st.players)) {
      add('int', p.pass.int); add('fum', p.rush.fum);
      add('fga', p.k.fga); add('fgm', p.k.fgm); add('xpa', p.k.xpa); add('xpm', p.k.xpm);
      add('punts', p.p.n); add('puntYds', p.p.yds);
      add('rushTd', p.rush.td); add('recTd', p.rec.td);
    }
  }
  for (const d of g.drives || []) {
    drives++;
    const r = d.result || '';
    if (r === 'TD') { tds++; scoringDrives++; }
    else if (r === 'FG') { fgs++; scoringDrives++; }
    else if (r === 'punt') puntDrives++;
    else if (/interception|fumble|turnover on downs/.test(r)) driveTurnovers++;
    if (Number.isFinite(d.plays)) lens.drivePlays.push(d.plays);
  }
  for (const e of g.log || []) {
    // "for 8 yards", "for no gain" and "for a loss of 3" are three different
    // sentences. Matching only the first kept every zero and negative play out
    // of these arrays, which made the mean run read 6.1 against a real 4.3 —
    // a defect in this audit, not in the engine.
    const t = e.text || '';
    let y = null;
    const m = /for (-?\d+) yards?/.exec(t);
    if (m) y = Number(m[1]);
    else if (/for no gain/.test(t)) y = 0;
    else { const l = /for a loss of (\d+)/.exec(t); if (l) y = -Number(l[1]); }
    if (y == null) continue;
    if (e.type === 'run') lens.run.push(y);
    else if (e.type === 'pass') lens.pass.push(y);
  }
}

const per = (k) => (acc[k] || 0) / sides;
const pct = (a, b) => (acc[b] ? (acc[a] / acc[b]) * 100 : 0);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const bad = [];
let checked = 0;
const row = (label, got, want, fmt = (v) => v.toFixed(1)) => {
  // Judged on the number as printed, not on the raw one. A row reading 10.0
  // against a range of 10–13 and carrying a mark looks like a broken report,
  // and the printed figure is the claim the reader is being asked to check.
  const shown = Number(fmt(got));
  const off = Array.isArray(want) && (shown < want[0] || shown > want[1]);
  if (Array.isArray(want)) { checked++; if (off) bad.push(label.trim()); }
  console.log(`${off ? '!' : ' '} ${label.padEnd(26)} ${fmt(got).padStart(7)}   ${Array.isArray(want) ? `${want[0]}–${want[1]}` : want}`);
};

console.log(`${games} games, ${sides} team-games. "!" marks a number outside the real league's range.\n`);
console.log('                              sim      real NFL');
row('points / team / game', per('points'), [20, 27]);
row('total yards', per('totalYds'), [300, 400]);
row('plays', per('plays'), [58, 70]);
row('first downs', per('firstDowns'), [17, 24]);
console.log('');
row('pass attempts', per('passAtt'), [30, 38]);
row('completion %', pct('passCmp', 'passAtt'), [60, 70]);
row('pass yards', per('passYds'), [200, 260]);
row('yards / attempt', acc.passAtt ? acc.passYds / acc.passAtt : 0, [6.3, 7.8], (v) => v.toFixed(2));
row('sacks allowed', per('sacksAllowed'), [1.8, 3.2]);
row('sack rate %', acc.passAtt ? (acc.sacksAllowed / (acc.passAtt + acc.sacksAllowed)) * 100 : 0, [5.5, 8.5]);
row('interception rate %', pct('int', 'passAtt'), [1.8, 3.2], (v) => v.toFixed(2));
console.log('');
row('rush attempts', per('rushAtt'), [22, 30]);
row('rush yards', per('rushYds'), [95, 140]);
row('yards / carry', acc.rushAtt ? acc.rushYds / acc.rushAtt : 0, [3.9, 4.9], (v) => v.toFixed(2));
row('fumbles lost', per('fum'), [0.3, 1.0], (v) => v.toFixed(2));
row('turnovers', per('turnovers'), [0.9, 1.9], (v) => v.toFixed(2));
console.log('');
row('third down att', per('thirdAtt'), [11, 16]);
row('third down conv %', pct('thirdConv', 'thirdAtt'), [35, 45]);
row('fourth down att', per('fourthAtt'), [0.8, 2.5], (v) => v.toFixed(2));
row('fourth down conv %', pct('fourthConv', 'fourthAtt'), [40, 60]);
row('red zone trips', per('redZoneAtt'), [2.5, 4.5], (v) => v.toFixed(2));
row('red zone TD %', pct('redZoneTd', 'redZoneAtt'), [50, 65]);
console.log('');
row('punts', per('punts'), [3.5, 5.5], (v) => v.toFixed(2));
row('punt average', acc.punts ? acc.puntYds / acc.punts : 0, [43, 50]);
row('field goals att', per('fga'), [1.5, 2.5], (v) => v.toFixed(2));
row('field goal %', pct('fgm', 'fga'), [78, 90]);
row('extra point %', pct('xpm', 'xpa'), [92, 98]);
row('penalties', per('penalties'), [5, 8], (v) => v.toFixed(2));
row('penalty yards', per('penYds'), [40, 65]);
console.log('');
// Everything below used to be hand-written console.log lines carrying the
// reference range as a literal string, which meant fifteen of the forty rows
// could never be marked. The report said "! marks a number outside the real
// league's range" while quietly exempting a third of itself — TD : FG sat at
// 1.99 against a stated 1.3–1.8 with no mark on it for as long as that lasted.
// Every row goes through `row` now, and `bad` at the end is the count.
row('drives / team / game', drives / 2 / games, [10, 13]);
row('plays / drive', mean(lens.drivePlays), [5.5, 6.5]);
row('scoring drive %', (scoringDrives / drives) * 100, [35, 42]);
row('punt drive %', (puntDrives / drives) * 100, [32, 40]);
row('mean run', mean(lens.run), [4.2, 4.6], (v) => v.toFixed(2));
row('runs stopped at or behind', (lens.run.filter((x) => x <= 0).length / Math.max(1, lens.run.length)) * 100, [16, 22]);
row('yards / completion', mean(lens.pass), [10.8, 12.0], (v) => v.toFixed(2));
row('20+ yard plays / team', (lens.run.filter((x) => x >= 20).length + lens.pass.filter((x) => x >= 20).length) / sides, [3.5, 5.5], (v) => v.toFixed(2));
console.log('');
row('overtime games %', (otGames / games) * 100, [5, 8]);
row('ties %', (ties / games) * 100, [0, 2]);
row('shutouts %', (shutouts / games) * 100, [1, 3]);
row('mean margin', mean(margins), [9.5, 11.5]);
row('mean total points', mean(totals), [42, 47]);
// Counts turnover on downs alongside giveaways, so the reference is roughly
// 1.3 giveaways plus 0.6 failed fourth downs over 11 drives, not 1.3 over 11.
row('turnover drive %', (driveTurnovers / drives) * 100, [14, 19]);
row('TD : FG', tds / Math.max(1, fgs), [1.3, 1.8], (v) => v.toFixed(2));
console.log(`\n${bad.length ? `${bad.length} of ${checked} outside the range: ${bad.join(', ')}` : `all ${checked} inside the real league's range`}`);
