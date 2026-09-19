// Does a simulated game look like a football game?
//
//   node scripts/realism.mjs [games-per-block] [blocks]
//
// Every number the engine produces, against what the real league does. Not to
// copy the NFL — this is an all-time-greats league and should score more — but
// because the shape has to hold: if third downs convert at 12% or nobody ever
// punts, the game is wrong in a way no amount of balance tuning will fix, and
// it is the sort of wrong that is invisible until it is counted.
//
// **It runs several independent blocks and prints an error bar, and that is not
// decoration.** For a long time this ran one block of four hundred games and
// printed one number a row, and those numbers were treated as facts: a change
// was kept or reverted on whether a row moved. Then the same unchanged engine
// was run against three different seed ranges and scored 6, 8 and 9 rows
// outside the range — yards per completion came out 11.98, 12.08 and 12.15
// against a boundary of 12.0, and touchdowns per field goal 1.99, 2.24 and
// 2.03. Half the rows sit near a boundary and flip on the draw. Every
// single-block comparison made before this was inside the noise, including
// three tuning attempts that were reverted for "making it worse".
//
// So each row is a mean across blocks with a 95% interval, and is marked `!`
// only when that whole interval sits outside the reference range. A row whose
// interval straddles a boundary is marked `~`: not evidence of anything, and
// not evidence against anything either.
//
// The interval is Student's t on the block means, not the min-to-max spread.
// The spread was the first attempt and it is wrong in a way worth recording:
// min and max wander further apart the more blocks you draw, so raising the
// block count made findings *disappear* — the same engine scored 6, 7, 7 and 6
// at three blocks and 5, 7, 4 and 3 at five. An error bar that grows with
// evidence is not an error bar. The t interval shrinks with sqrt(blocks), so
// more games buy more confidence, as they should. With few blocks the standard
// deviation is itself badly estimated, which is what the fat t multiplier at
// low degrees of freedom is for: three blocks earn a wide interval honestly
// rather than a narrow one by assumption.
//
// Ten blocks is the default because that is where it was measured to settle.
// Run against four separate seed sets it named the same six rows every time,
// where three blocks named 3, 4, 2 and 4 rows with only one row common to all
// four. The verdict, not just the numbers, has to reproduce before a row is
// worth acting on.
//
// Reference column is modern NFL, rounded, from league averages.

import { syntheticTeam } from './synthetic.mjs';
import { buildLineup } from '../src/engine/ratings.js';
import { createGame, simulateGame } from '../src/engine/game.js';

const N = Number(process.argv[2] || 300);
const BLOCKS = Number(process.argv[3] || 10);
const SEED0 = Number(process.env.REALISM_SEED || 9000);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/** One independent run of `n` games. Returns every metric the report prints. */
function block(seed0, n) {
  const acc = {};
  const add = (k, v) => { acc[k] = (acc[k] || 0) + v; };
  let games = 0, sides = 0;
  const lens = { run: [], pass: [], drivePlays: [] };
  let scoringDrives = 0, drives = 0, tds = 0, fgs = 0, puntDrives = 0, driveTurnovers = 0;
  let otGames = 0, shutouts = 0, ties = 0;
  const margins = [], totals = [];

  for (let i = 0; i < n; i++) {
    const a = syntheticTeam(`ra${seed0}-${i}`, 82, 4, seed0 + i);
    const b = syntheticTeam(`rb${seed0}-${i}`, 82, 4, seed0 + 500 + i);
    const g = createGame({ ...a, lineup: buildLineup(a.slots, a.byId) }, { ...b, lineup: buildLineup(b.slots, b.byId) }, { seed: seed0 + i });
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
  const pct = (x, y) => (acc[y] ? (acc[x] / acc[y]) * 100 : 0);
  return {
    games,
    sides,
    'points / team / game': per('points'),
    'total yards': per('totalYds'),
    plays: per('plays'),
    'first downs': per('firstDowns'),
    'pass attempts': per('passAtt'),
    'completion %': pct('passCmp', 'passAtt'),
    'pass yards': per('passYds'),
    'yards / attempt': acc.passAtt ? acc.passYds / acc.passAtt : 0,
    'sacks allowed': per('sacksAllowed'),
    'sack rate %': acc.passAtt ? (acc.sacksAllowed / (acc.passAtt + acc.sacksAllowed)) * 100 : 0,
    'interception rate %': pct('int', 'passAtt'),
    'rush attempts': per('rushAtt'),
    'rush yards': per('rushYds'),
    'yards / carry': acc.rushAtt ? acc.rushYds / acc.rushAtt : 0,
    'fumbles lost': per('fum'),
    turnovers: per('turnovers'),
    'third down att': per('thirdAtt'),
    'third down conv %': pct('thirdConv', 'thirdAtt'),
    'fourth down att': per('fourthAtt'),
    'fourth down conv %': pct('fourthConv', 'fourthAtt'),
    'red zone trips': per('redZoneAtt'),
    'red zone TD %': pct('redZoneTd', 'redZoneAtt'),
    punts: per('punts'),
    'punt average': acc.punts ? acc.puntYds / acc.punts : 0,
    'field goals att': per('fga'),
    'field goal %': pct('fgm', 'fga'),
    'extra point %': pct('xpm', 'xpa'),
    penalties: per('penalties'),
    'penalty yards': per('penYds'),
    'drives / team / game': drives / 2 / games,
    'plays / drive': mean(lens.drivePlays),
    'scoring drive %': (scoringDrives / drives) * 100,
    'punt drive %': (puntDrives / drives) * 100,
    'mean run': mean(lens.run),
    'runs stopped at or behind': (lens.run.filter((x) => x <= 0).length / Math.max(1, lens.run.length)) * 100,
    'yards / completion': mean(lens.pass),
    '20+ yard plays / team': (lens.run.filter((x) => x >= 20).length + lens.pass.filter((x) => x >= 20).length) / sides,
    'overtime games %': (otGames / games) * 100,
    'ties %': (ties / games) * 100,
    'shutouts %': (shutouts / games) * 100,
    'mean margin': mean(margins),
    'mean total points': mean(totals),
    // Counts turnover on downs alongside giveaways, so the reference is roughly
    // 1.3 giveaways plus 0.6 failed fourth downs over 11 drives, not 1.3 over 11.
    'turnover drive %': (driveTurnovers / drives) * 100,
    'TD : FG': tds / Math.max(1, fgs),
  };
}

const runs = [];
for (let b = 0; b < BLOCKS; b++) runs.push(block(SEED0 + b * 100000, N));

// Raw block means, for a paired A/B against another build of the engine. Two
// independent intervals overlapping proves nothing about a change; the same
// seeds run twice and differenced block by block cancels the draw, which is
// the only test with the power to see a tenth of a yard.
if (process.env.REALISM_JSON) {
  console.log(JSON.stringify(runs));
  process.exit(0);
}

const out = [], shaky = [];
let checked = 0;
const two = (v) => v.toFixed(2);
const one = (v) => v.toFixed(1);

// Two-sided 95% t, by degrees of freedom. Blunt, because the interesting part
// is the top of the table: at two degrees of freedom the multiplier is 4.3, and
// a three-block run should be made to admit that.
const T95 = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 12: 2.179, 15: 2.131, 20: 2.086, 30: 2.042 };
const tcrit = (df) => {
  if (df < 1) return Infinity;
  if (T95[df]) return T95[df];
  const keys = Object.keys(T95).map(Number).filter((k) => k <= df);
  return keys.length ? T95[Math.max(...keys)] : 1.96;
};

/** Half-width of the 95% interval on the mean of the block means. */
export function halfWidth(vals) {
  const k = vals.length;
  if (k < 2) return Infinity;
  const m = mean(vals);
  const sd = Math.sqrt(vals.reduce((s, x) => s + (x - m) ** 2, 0) / (k - 1));
  return tcrit(k - 1) * sd / Math.sqrt(k);
}

const row = (label, want, fmt = one) => {
  const vals = runs.map((r) => r[label]);
  const m = mean(vals);
  const h = halfWidth(vals);
  const lo = m - h, hi = m + h;
  checked++;
  // Judged on the interval, not on one draw. Wholly outside is a finding;
  // straddling a boundary is a shrug, and saying so is the point of the column.
  const wholly = hi < want[0] || lo > want[1];
  const partly = !wholly && (lo < want[0] || hi > want[1]);
  if (wholly) out.push(label);
  if (partly) shaky.push(label);
  const mark = wholly ? '!' : partly ? '~' : ' ';
  console.log(`${mark} ${label.padEnd(26)} ${fmt(m).padStart(7)} ±${fmt(h).padStart(5)}   ${want[0]}–${want[1]}`);
};

const gap = () => console.log('');
console.log(`${BLOCKS} blocks of ${runs[0].games} games from separate seeds. The figure is the mean across blocks and ± is a 95% interval on it.`);
console.log('"!" marks a row whose whole interval is outside the real league\'s range; "~" a row whose interval straddles a boundary, which is not a finding either way.\n');
console.log('                                 sim              real NFL');
row('points / team / game', [20, 27]);
row('total yards', [300, 400]);
row('plays', [58, 70]);
row('first downs', [17, 24]);
gap();
row('pass attempts', [30, 38]);
row('completion %', [60, 70]);
row('pass yards', [200, 260]);
row('yards / attempt', [6.3, 7.8], two);
row('sacks allowed', [1.8, 3.2]);
row('sack rate %', [5.5, 8.5]);
row('interception rate %', [1.8, 3.2], two);
gap();
row('rush attempts', [22, 30]);
row('rush yards', [95, 140]);
row('yards / carry', [3.9, 4.9], two);
row('fumbles lost', [0.3, 1.0], two);
row('turnovers', [0.9, 1.9], two);
gap();
row('third down att', [11, 16]);
row('third down conv %', [35, 45]);
row('fourth down att', [0.8, 2.5], two);
row('fourth down conv %', [40, 60]);
row('red zone trips', [2.5, 4.5], two);
row('red zone TD %', [50, 65]);
gap();
row('punts', [3.5, 5.5], two);
row('punt average', [43, 50]);
row('field goals att', [1.5, 2.5], two);
row('field goal %', [78, 90]);
row('extra point %', [92, 98]);
row('penalties', [5, 8], two);
row('penalty yards', [40, 65]);
gap();
row('drives / team / game', [10, 13]);
row('plays / drive', [5.5, 6.5]);
row('scoring drive %', [35, 42]);
row('punt drive %', [32, 40]);
row('mean run', [4.2, 4.6], two);
row('runs stopped at or behind', [16, 22]);
row('yards / completion', [10.8, 12.0], two);
row('20+ yard plays / team', [3.5, 5.5], two);
gap();
row('overtime games %', [5, 8]);
row('ties %', [0, 2]);
row('shutouts %', [1, 3]);
row('mean margin', [9.5, 11.5]);
row('mean total points', [42, 47]);
row('turnover drive %', [14, 19]);
row('TD : FG', [1.3, 1.8], two);

console.log(`\n${out.length ? `${out.length} of ${checked} wholly outside: ${out.join(', ')}` : `none of ${checked} wholly outside the real league's range`}`);
if (shaky.length) console.log(`${shaky.length} straddling a boundary, which the noise cannot settle: ${shaky.join(', ')}`);
