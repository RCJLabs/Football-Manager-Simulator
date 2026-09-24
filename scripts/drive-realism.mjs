// Does a drive go the way a real one does?
//
//   node scripts/drive-realism.mjs [games]
//
// The fourth of the realism scripts, after the run, pass and skill ones, and a
// different question from theirs. Those ask whether a point of a player's
// rating moves what he does as far as it does in the real game. This asks
// whether a game at the calibration level (82 against 82) is shaped like a real
// one, snap by snap: how often a club throws on each down and distance, how
// often each down and distance is converted, what a carry and a completion
// gain, how often the rush gets home on third and long, where fourth down goes,
// where a pooch punt lands, and what all of it adds up to in plays, drives and
// points. The reference column is every regular-season snap of 2022 and 2023
// (nflverse play-by-play), written down below so this runs offline.
//
// It found the drive model's defects (DESIGN.md, "The drive model, held to
// real play-by-play"): early downs converting a quarter too often, third and
// long too rarely, 3.4 scrimmage plays a game missing to a slow clock, and a
// pooch punt that landed inside the ten nineteen times in twenty.
//
// "Neutral" is the first three quarters, within a score, outside the two-minute
// warning: where a play call is a choice rather than the clock's.
import { syntheticTeam } from './synthetic.mjs';
import { createGame, simulateGame } from '../src/engine/game.js';
import { buildLineup } from '../src/engine/ratings.js';

const GAMES = Number(process.argv[2] || 1000);

const REAL = {
  scrimmage: 62.14, drives: 10.99, points: 21.83, firstDowns: 17.78, yardsPerPlay: 5.42,
  punts: 4.11, fga: 1.95, fourthGo: 1.41, tdDrive: 20.7, fgDrive: 15.2,
  pass1st10: 46.0, pass2nd710: 64.5, pass3rd36: 89.9, passAll: 60.6,
  conv1st10: 19.4, conv2nd46: 39.5, conv3rd12: 64.1, conv3rd36: 45.0, conv3rd79: 32.8, conv3rd10: 18.2,
  runStuffed: 18.3, run14: 47.2, run59: 23.9, run10: 10.6, runMean: 4.30,
  completion: 64.4, yardsPerCompletion: 10.92, interception: 2.3, sackEarly: 5.3, sack3rd7: 11.0,
  fourthGoMidfield23: 56.7, poochInside10: 40.7, poochTouchback: 16.6,
};

const RUNS = new Set(['run_in', 'run_out']);
const PASSES = new Set(['screen', 'pass_short', 'pass_med', 'pass_deep', 'pa_pass']);
const SITUATION = /^(1st|2nd|3rd|4th|OT\d*) (\d+):(\d\d) · (1st|2nd|3rd|4th) & (Goal|\d+)/;
const QUARTER = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4 };

const snaps = [];
const drives = [];
let teamGames = 0, points = 0;
for (let i = 0; i < GAMES; i++) {
  const a = syntheticTeam(`dr-a${i}`, 82, 2, 3100 + i), b = syntheticTeam(`dr-b${i}`, 82, 2, 8100 + i);
  const g = createGame({ ...a, lineup: buildLineup(a.slots, a.byId) }, { ...b, lineup: buildLineup(b.slots, b.byId) }, { seed: 61000 + i, homeAdvantage: false });
  simulateGame(g);
  teamGames += 2;
  points += g.score[0] + g.score[1];
  drives.push(...g.drives);
  for (let k = 1; k < g.log.length; k++) {
    const e = g.log[k];
    const m = e.situation && SITUATION.exec(e.situation);
    if (!m || e.from == null) continue;
    const off = e.snapOff, prev = g.log[k - 1].score;
    const q = QUARTER[m[1]] ?? 5, clock = Number(m[2]) * 60 + Number(m[3]);
    const down = QUARTER[m[4]], toGo = m[5] === 'Goal' ? 100 - e.from : Number(m[5]);
    const kind = RUNS.has(e.call) ? 'run' : PASSES.has(e.call) ? 'db' : e.type;
    const text = e.text || '';
    snaps.push({
      q, clock, down, toGo, from: e.from, kind, type: e.type, yards: e.yards ?? 0,
      diff: prev[off] - prev[1 - off],
      turnover: e.type === 'int' || e.type === 'fumble' && /recovered by/.test(text) && !/Fumble recovered by/.test(text),
      td: e.scoring && (e.type === 'run' || e.type === 'pass'),
      sack: e.type === 'sack' || (e.type === 'fumble' && /sacked/.test(text)),
      completion: e.type === 'pass' || (e.type === 'fumble' && / complete to /.test(text)),
    });
  }
}

const scrim = (s) => s.kind === 'run' || s.kind === 'db';
const converted = (s) => !s.turnover && (s.td || s.yards >= s.toGo);
const halfLeft = (s) => (s.q === 1 || s.q === 3 ? s.clock + 900 : s.clock);
const neutral = (s) => s.q <= 3 && Math.abs(s.diff) <= 7 && halfLeft(s) > 120;
const share = (xs, f) => 100 * xs.filter(f).length / Math.max(1, xs.length);
const mean = (xs) => xs.reduce((t, v) => t + v, 0) / Math.max(1, xs.length);
const per = (n) => n / teamGames;
const passRate = (f) => share(snaps.filter((s) => scrim(s) && neutral(s) && f(s)), (s) => s.kind === 'db');
const convRate = (f) => share(snaps.filter((s) => scrim(s) && f(s)), converted);
const runs = snaps.filter((s) => s.kind === 'run' && s.type !== 'fumble');
const attempts = snaps.filter((s) => s.kind === 'db' && !s.sack && s.type !== 'run');
const completions = snaps.filter((s) => s.kind === 'db' && s.completion);
const sackRate = (f) => share(snaps.filter((s) => s.kind === 'db' && f(s)), (s) => s.sack);
const res = (r) => 100 * drives.filter((d) => d.result === r).length / drives.length;
const fourth = snaps.filter((s) => s.down === 4 && (s.q <= 3 || (s.q === 4 && s.clock > 600)) && Math.abs(s.diff) <= 7
  && s.from >= 50 && s.from < 70 && s.toGo >= 2 && s.toGo <= 3 && (scrim(s) || s.kind === 'punt' || s.kind === 'fg'));
// A pooch: a punt from the opponent's forty-one to fifty, and where the next drive started.
const pooches = [];
for (let d = 0; d + 1 < drives.length; d++) {
  const p = drives[d], n = drives[d + 1];
  if (p.result === 'punt' && p.endBallOn >= 50 && p.endBallOn < 60 && n.team !== p.team) pooches.push(n.startBallOn);
}

const ENGINE = {
  scrimmage: per(snaps.filter(scrim).length), drives: per(drives.length), points: per(points),
  firstDowns: per(snaps.filter((s) => scrim(s) && converted(s)).length), yardsPerPlay: mean(snaps.filter(scrim).map((s) => s.yards)),
  punts: per(snaps.filter((s) => s.kind === 'punt').length), fga: per(snaps.filter((s) => s.kind === 'fg').length),
  fourthGo: per(snaps.filter((s) => scrim(s) && s.down === 4).length), tdDrive: res('TD'), fgDrive: res('FG'),
  pass1st10: passRate((s) => s.down === 1 && s.toGo === 10), pass2nd710: passRate((s) => s.down === 2 && s.toGo >= 7 && s.toGo <= 10),
  pass3rd36: passRate((s) => s.down === 3 && s.toGo >= 3 && s.toGo <= 6), passAll: share(snaps.filter(scrim), (s) => s.kind === 'db'),
  conv1st10: convRate((s) => s.down === 1 && s.toGo === 10), conv2nd46: convRate((s) => s.down === 2 && s.toGo >= 4 && s.toGo <= 6),
  conv3rd12: convRate((s) => s.down === 3 && s.toGo <= 2), conv3rd36: convRate((s) => s.down === 3 && s.toGo >= 3 && s.toGo <= 6),
  conv3rd79: convRate((s) => s.down === 3 && s.toGo >= 7 && s.toGo <= 9), conv3rd10: convRate((s) => s.down === 3 && s.toGo >= 10),
  runStuffed: share(runs, (s) => s.yards <= 0), run14: share(runs, (s) => s.yards >= 1 && s.yards <= 4),
  run59: share(runs, (s) => s.yards >= 5 && s.yards <= 9), run10: share(runs, (s) => s.yards >= 10), runMean: mean(runs.map((s) => s.yards)),
  completion: share(attempts, (s) => s.completion), yardsPerCompletion: mean(completions.map((s) => s.yards)),
  interception: share(attempts, (s) => s.type === 'int'),
  sackEarly: sackRate((s) => s.down <= 2), sack3rd7: sackRate((s) => s.down === 3 && s.toGo >= 7),
  fourthGoMidfield23: share(fourth, scrim),
  poochInside10: share(pooches, (b) => b < 10), poochTouchback: share(pooches, (b) => b === 20),
};

const ROWS = [
  ['A team game', null],
  ['scrimmage plays', 'scrimmage', 2], ['drives', 'drives', 2], ['points', 'points', 2], ['first downs by a play', 'firstDowns', 2],
  ['yards a scrimmage play', 'yardsPerPlay', 2], ['punts', 'punts', 2], ['field goal attempts', 'fga', 2], ['fourth downs gone for', 'fourthGo', 2],
  ['drives ending in a touchdown %', 'tdDrive', 1], ['drives ending in a field goal %', 'fgDrive', 1],
  ['Pass rate, neutral', null],
  ['first and ten', 'pass1st10', 1], ['second and seven to ten', 'pass2nd710', 1], ['third and three to six', 'pass3rd36', 1], ['every snap, any situation', 'passAll', 1],
  ['Converted: first down or touchdown', null],
  ['first and ten', 'conv1st10', 1], ['second and four to six', 'conv2nd46', 1], ['third and one or two', 'conv3rd12', 1],
  ['third and three to six', 'conv3rd36', 1], ['third and seven to nine', 'conv3rd79', 1], ['third and ten or more', 'conv3rd10', 1],
  ['A carry', null],
  ['nothing or a loss %', 'runStuffed', 1], ['one to four %', 'run14', 1], ['five to nine %', 'run59', 1], ['ten or more %', 'run10', 1], ['mean', 'runMean', 2],
  ['A dropback', null],
  ['completion %', 'completion', 1], ['yards a completion', 'yardsPerCompletion', 2], ['interception %', 'interception', 1],
  ['sacked, first and second down %', 'sackEarly', 1], ['sacked, third and seven or more %', 'sack3rd7', 1],
  ['Fourth down and the kicking game', null],
  ['go on 4th & 2-3, opponent 31-50, neutral %', 'fourthGoMidfield23', 1],
  ['punt from the opponent 41-50: inside the ten %', 'poochInside10', 1], ['and a touchback %', 'poochTouchback', 1],
];
console.log(`${GAMES} games at 82 against 82, no home edge. Real: every regular-season snap of 2022 and 2023.\n`);
console.log(''.padEnd(48) + 'engine'.padStart(10) + 'real'.padStart(10));
for (const [label, key, dp] of ROWS) {
  if (!key) { console.log(`\n${label}`); continue; }
  console.log(`  ${label.padEnd(46)}${ENGINE[key].toFixed(dp).padStart(10)}${REAL[key].toFixed(dp).padStart(10)}`);
}
console.log('');
console.log(`scrimmage plays a team game: ${ENGINE.scrimmage.toFixed(2)}`);
console.log(`points a team game: ${ENGINE.points.toFixed(2)}`);
console.log(`neutral first-and-ten pass rate: ${ENGINE.pass1st10.toFixed(1)}`);
console.log(`third and seven to nine converted: ${ENGINE.conv3rd79.toFixed(1)}`);
